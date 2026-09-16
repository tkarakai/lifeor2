#!/usr/bin/env python3
"""Run the saved Convex backend independently of a Convex cloud account."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
from local_ports import ensure_available
from local_processes import Children, project_lock, stop_owned

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.convex' / 'standalone'
CLI = ROOT / 'node_modules' / '.bin' / 'convex'


def setup(source):
    source = Path(source).expanduser().resolve()
    if STATE.exists():
        raise SystemExit('Local state already exists; run bun convex:dev. No data was overwritten.')
    config = json.loads((source / 'config.json').read_text())
    binary = Path.home() / '.cache/convex/binaries' / config['backendVersion'] / 'convex-local-backend'
    if not binary.is_file():
        raise SystemExit(f'Matching backend binary is missing: {binary}')
    if not (source / 'convex_local_backend.sqlite3').is_file():
        raise SystemExit('Source database is missing.')
    STATE.mkdir(parents=True, mode=0o700)
    # SQLite backup also handles any existing WAL. Stop the old deployment first
    # so the separately copied file storage remains consistent with the database.
    with sqlite3.connect(f'file:{source / "convex_local_backend.sqlite3"}?mode=ro', uri=True) as old:
        with sqlite3.connect(STATE / 'convex_local_backend.sqlite3') as new:
            old.backup(new)
    shutil.copytree(source / 'convex_local_storage', STATE / 'convex_local_storage')
    config.update(instanceName=source.name, binary=str(binary), authSecret=secrets.token_urlsafe(48))
    config['ports'] = {'cloud': 3240, 'site': 3241}
    (STATE / 'config.json').write_text(json.dumps(config, indent=2) + '\n')
    (STATE / 'config.json').chmod(0o600)
    configure(3240, 3241)
    print('Copied saved database to .convex/standalone; originals are unchanged.')
    print('Next: bun run convex:dev, then bun dev in another terminal.')


def configure(cloud_port, site_port):
    if cloud_port == site_port or not all(1024 <= p <= 65535 for p in (cloud_port, site_port)):
        raise SystemExit('Choose two distinct ports between 1024 and 65535.')
    config_path = STATE / 'config.json'
    if not config_path.exists():
        raise SystemExit('Run local:setup first. See QUICKSTART.md.')
    config = json.loads(config_path.read_text())
    env = ROOT / '.env.local'
    original = env.read_text() if env.exists() else ''
    backup = STATE / ('configuration-backup-' + str(time.time_ns()))
    backup.mkdir(mode=0o700)
    for name, content in [('config.json', config_path.read_text()), ('env.local', original)]:
        saved = backup / name
        saved.write_text(content)
        saved.chmod(0o600)
    config['ports'] = {'cloud': cloud_port, 'site': site_port}
    config_path.write_text(json.dumps(config, indent=2) + '\n')
    config_path.chmod(0o600)
    values = {
        'CONVEX_SELF_HOSTED_URL': f'http://127.0.0.1:{cloud_port}',
        'CONVEX_SELF_HOSTED_ADMIN_KEY': config['adminKey'],
        'NEXT_PUBLIC_CONVEX_URL': f'http://127.0.0.1:{cloud_port}',
        'NEXT_PUBLIC_CONVEX_SITE_URL': f'http://127.0.0.1:{site_port}',
        'NEXT_PUBLIC_SITE_URL': 'http://localhost:3000',
    }
    remove = set(values) | {'CONVEX_DEPLOYMENT', 'CONVEX_DEPLOY_KEY', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'NEXT_PUBLIC_BETTER_AUTH_URL'}
    lines = [line for line in original.splitlines() if line.split('=', 1)[0].strip() not in remove]
    env.write_text('\n'.join(lines + [f'{key}={value}' for key, value in values.items()]) + '\n')
    env.chmod(0o600)
    print(f'Configured isolated backend on {cloud_port}/{site_port}; database and credentials preserved. Restart Next.js after changing URLs.')


def dev():
    if not (STATE / 'config.json').exists():
        raise SystemExit('Run bun local:setup --from /path/to/saved/deployment first. See QUICKSTART.md.')
    config = json.loads((STATE / 'config.json').read_text())
    if not CLI.exists():
        raise SystemExit('Run bun install first.')
    cloud_port, site_port = config['ports']['cloud'], config['ports']['site']
    backend_url = f'http://127.0.0.1:{cloud_port}'
    ensure_available((cloud_port, site_port))
    backend = None
    watcher = None
    stopping = False
    children = Children(STATE)
    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        backend = children.spawn([
            config['binary'], '--interface', '127.0.0.1', '--port', str(cloud_port),
            '--site-proxy-port', str(site_port), '--instance-name', config['instanceName'],
            '--instance-secret', config['instanceSecret'], '--disable-beacon',
            '--local-storage', str(STATE / 'convex_local_storage'),
            str(STATE / 'convex_local_backend.sqlite3'),
        ], cwd=ROOT, stdout=backend_log, stderr=backend_log)
        for _ in range(100):
            if stopping:
                return
            if backend.poll() is not None:
                raise RuntimeError('Backend exited. See .convex/standalone/backend.log.')
            try:
                with urllib.request.urlopen(backend_url + '/instance_name', timeout=1) as response:
                    if response.read().decode() != config['instanceName']:
                        raise RuntimeError('Unexpected backend instance.')
                break
            except urllib.error.URLError:
                time.sleep(0.1)
        else:
            raise RuntimeError('Backend startup timed out. See .convex/standalone/backend.log.')
        if stopping:
            return
        changes = [{'name': 'BETTER_AUTH_SECRET', 'value': config['authSecret']},
                   {'name': 'SITE_URL', 'value': 'http://localhost:3000'}]
        request = urllib.request.Request(backend_url + '/api/update_environment_variables',
            data=json.dumps({'changes': changes}).encode(),
            headers={'Content-Type': 'application/json', 'Authorization': 'Convex ' + config['adminKey']})
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read()
        env = dict(os.environ)
        for key in ['CONVEX_DEPLOYMENT', 'CONVEX_DEPLOY_KEY']:
            env.pop(key, None)
        env.update(CONVEX_SELF_HOSTED_URL=backend_url, CONVEX_SELF_HOSTED_ADMIN_KEY=config['adminKey'])
        print(f'Isolated Convex ready on {cloud_port} (database) / {site_port} (auth). Login codes appear below.', flush=True)
        if stopping:
            return
        watcher = children.spawn([str(CLI), 'dev', '--tail-logs', 'always'], cwd=ROOT, env=env)
        while not stopping and watcher.poll() is None:
            if backend.poll() is not None:
                raise RuntimeError('Backend exited. See .convex/standalone/backend.log.')
            time.sleep(0.25)
        if not stopping and watcher.returncode:
            raise SystemExit(watcher.returncode)
    except KeyboardInterrupt:
        pass
    finally:
        children.close()
        print('Convex backend and watcher stopped.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    init = commands.add_parser('setup')
    init.add_argument('--from', dest='source', required=True, help='Saved deployment directory containing config.json and SQLite/file storage')
    ports = commands.add_parser('configure')
    ports.add_argument('--cloud-port', type=int, default=3240)
    ports.add_argument('--site-port', type=int, default=3241)
    commands.add_parser('dev')
    commands.add_parser('stop')
    args = parser.parse_args()
    if args.command == 'setup':
        setup(args.source)
    elif args.command == 'configure':
        with project_lock(STATE):
            configure(args.cloud_port, args.site_port)
    elif args.command == 'stop':
        stop_owned(STATE, json.loads((STATE / 'config.json').read_text()))
    else:
        if not STATE.exists():
            raise SystemExit('Run bun local:setup first. See QUICKSTART.md.')
        with project_lock(STATE), (STATE / 'backend.log').open('a') as backend_log:
            dev()
