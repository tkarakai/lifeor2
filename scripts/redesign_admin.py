#!/usr/bin/env python3
"""Explicit local Convex administration without a source-watching deploy process.

Use a copied state directory for migration rehearsals. Configuration and CLI
credentials stay in the ignored state directory and are never printed.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request

from local_ports import ensure_available
from local_processes import Children, project_lock

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / 'node_modules' / '.bin' / 'convex'


def configuration(state):
    return json.loads((state / 'config.json').read_text())


def prepare(source, destination, cloud_port, site_port):
    if destination.exists():
        raise SystemExit('Destination already exists; no data overwritten.')
    if cloud_port == site_port or not all(1024 <= p <= 65535 for p in (cloud_port, site_port)):
        raise SystemExit('Specify two distinct unprivileged ports.')
    shutil.copytree(source, destination)
    destination.chmod(0o700)
    config = configuration(destination)
    config['ports'] = {'cloud': cloud_port, 'site': site_port}
    config_path = destination / 'config.json'
    config_path.write_text(json.dumps(config, indent=2) + '\n')
    config_path.chmod(0o600)
    # A copied process descriptor belongs to the source, never to this clone.
    for name in ('processes.json', 'runner.pid'):
        candidate = destination / name
        if candidate.exists():
            candidate.unlink()
    with sqlite3.connect(f'file:{destination / "convex_local_backend.sqlite3"}?mode=ro', uri=True) as db:
        result = db.execute('pragma integrity_check').fetchone()[0]
    if result != 'ok':
        raise SystemExit('Copied database failed integrity check.')
    print(f'Prepared {destination} on {cloud_port}/{site_port}; SQLite integrity ok.')


def serve(state):
    config = configuration(state)
    cloud_port, site_port = config['ports']['cloud'], config['ports']['site']
    ensure_available((cloud_port, site_port))
    stopping = False

    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    with project_lock(state), (state / 'admin-backend.log').open('a') as log:
        children = Children(state)
        try:
            backend = children.spawn([
                config['binary'], '--interface', '127.0.0.1', '--port', str(cloud_port),
                '--site-proxy-port', str(site_port), '--instance-name', config['instanceName'],
                '--instance-secret', config['instanceSecret'], '--disable-beacon',
                '--local-storage', str(state / 'convex_local_storage'),
                str(state / 'convex_local_backend.sqlite3'),
            ], cwd=ROOT, stdout=log, stderr=log)
            for _ in range(100):
                if stopping:
                    return
                if backend.poll() is not None:
                    raise SystemExit(f'Backend exited; inspect {state / "admin-backend.log"}.')
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{cloud_port}/instance_name', timeout=1) as response:
                        if response.read().decode() != config['instanceName']:
                            raise SystemExit('Unexpected backend instance.')
                    break
                except urllib.error.URLError:
                    time.sleep(0.1)
            else:
                raise SystemExit('Backend readiness timed out.')
            print(f'Backend ready on {cloud_port}/{site_port}; no source watcher or automatic deploy.', flush=True)
            while not stopping:
                if backend.poll() is not None:
                    raise SystemExit('Backend exited unexpectedly.')
                time.sleep(0.25)
        finally:
            children.close()
            print('Administrative backend stopped.', flush=True)


def cli(state, args, capture=False):
    config = configuration(state)
    # An explicit file takes priority over the application's .env.local.
    env_path = state / 'admin.env'
    env_path.write_text(
        f'CONVEX_SELF_HOSTED_URL=http://127.0.0.1:{config["ports"]["cloud"]}\n'
        f'CONVEX_SELF_HOSTED_ADMIN_KEY={config["adminKey"]}\n'
    )
    env_path.chmod(0o600)
    env = dict(os.environ)
    for key in ('CONVEX_DEPLOYMENT', 'CONVEX_DEPLOY_KEY', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_SELF_HOSTED_ADMIN_KEY'):
        env.pop(key, None)
    if args and args[0] == '--':
        args = args[1:]
    if not args:
        raise SystemExit('Specify a Convex CLI command after --.')
    if args[0] == 'codegen':
        # This installed CLI does not expose --env-file for codegen. Its
        # documented source accepts explicit credentials; never log this argv.
        command = [str(CLI), *args, '--url', f'http://127.0.0.1:{config["ports"]["cloud"]}', '--admin-key', config['adminKey']]
    else:
        command = [str(CLI), *args, '--env-file', str(env_path)]
    result = subprocess.run(command, cwd=ROOT, env=env, capture_output=capture, text=True)
    if capture:
        if result.returncode:
            raise SystemExit('Administrative CLI failed; no further migration stages were run.')
        return result.stdout
    return result.returncode


def migrate(state):
    """Apply reviewed stages, then prove that replay produces no new records."""
    def run(name, args):
        return json.loads(cli(state, ['run', name, json.dumps(args)], capture=True))
    before = run('migrations:dryRun', {})
    if before['rejects'] or before['warnings'] or before['issues']:
        raise SystemExit('Migration requires explicit issue review; inspect migrations:dryRun.')
    results = []
    for attempt in range(2):
        for stage in before['applyOrder']:
            cursor = None
            while True:
                args = {'stage': stage, 'limit': 50}
                if cursor:
                    args['cursor'] = cursor
                result = run('migrations:applyBatch', args)
                results.append({'pass': attempt + 1, **result})
                if result['rejects'] or (attempt == 1 and result['migrated']):
                    raise SystemExit('Migration rejected records or failed replay idempotency; inspect state before continuing.')
                if result['isDone']:
                    break
                cursor = result['cursor']
    after = run('migrations:dryRun', {})
    if after['rejects'] or after['warnings'] or after['issues'] or before['counts'] != after['counts'] or before['totals'] != after['totals']:
        raise SystemExit('Post-migration audit needs review; original rows remain preserved.')
    report = state / 'migration-verification.json'
    report.write_text(json.dumps({'before': before, 'batches': results, 'after': after}, indent=2) + '\n')
    report.chmod(0o600)
    print(json.dumps({'counts': after['counts'], 'mappings': after['existingMappings'], 'replay_idempotent': True, 'report': str(report)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    clone = commands.add_parser('prepare')
    clone.add_argument('--source', type=Path, required=True, help='Stopped backend state or complete backup')
    clone.add_argument('--destination', type=Path, required=True)
    clone.add_argument('--cloud-port', type=int, default=3250)
    clone.add_argument('--site-port', type=int, default=3251)
    server = commands.add_parser('serve')
    server.add_argument('--state', type=Path, required=True)
    command = commands.add_parser('cli')
    command.add_argument('--state', type=Path, required=True)
    command.add_argument('args', nargs=argparse.REMAINDER)
    migration = commands.add_parser('migrate')
    migration.add_argument('--state', type=Path, required=True)
    options = parser.parse_args()
    if options.command == 'prepare':
        prepare(options.source.resolve(), options.destination.resolve(), options.cloud_port, options.site_port)
    elif options.command == 'serve':
        serve(options.state.resolve())
    elif options.command == 'migrate':
        migrate(options.state.resolve())
    else:
        raise SystemExit(cli(options.state.resolve(), options.args))
