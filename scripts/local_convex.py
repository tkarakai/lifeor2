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
    config['ports'] = {'cloud': 3210, 'site': 3211}
    (STATE / 'config.json').write_text(json.dumps(config, indent=2) + '\n')
    (STATE / 'config.json').chmod(0o600)
    env = ROOT / '.env.local'
    original = env.read_text() if env.exists() else ''
    (STATE / 'previous.env.local').write_text(original)
    (STATE / 'previous.env.local').chmod(0o600)
    values = {
        'CONVEX_SELF_HOSTED_URL': 'http://127.0.0.1:3210',
        'CONVEX_SELF_HOSTED_ADMIN_KEY': config['adminKey'],
        'NEXT_PUBLIC_CONVEX_URL': 'http://127.0.0.1:3210',
        'NEXT_PUBLIC_CONVEX_SITE_URL': 'http://127.0.0.1:3211',
        'NEXT_PUBLIC_SITE_URL': 'http://localhost:3000',
    }
    remove = set(values) | {'CONVEX_DEPLOYMENT', 'CONVEX_DEPLOY_KEY', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'NEXT_PUBLIC_BETTER_AUTH_URL'}
    lines = [line for line in original.splitlines() if line.split('=', 1)[0].strip() not in remove]
    env.write_text('\n'.join(lines + [f'{key}={value}' for key, value in values.items()]) + '\n')
    env.chmod(0o600)
    print('Copied saved database to .convex/standalone; originals are unchanged.')
    print('Configured .env.local. Next: bun convex:dev, then bun dev in another terminal.')


def dev():
    if not (STATE / 'config.json').exists():
        raise SystemExit('Run bun local:setup --from /path/to/saved/deployment first. See QUICKSTART.md.')
    config = json.loads((STATE / 'config.json').read_text())
    if not CLI.exists():
        raise SystemExit('Run bun install first.')
    # Reject occupied ports before opening the database.
    import socket
    for port in (3210, 3211):
        with socket.socket() as sock:
            try:
                sock.bind(('127.0.0.1', port))
            except OSError as exc:
                raise SystemExit(f'Cannot use localhost:{port}: {exc}. Stop the other backend first.')
    backend = None
    watcher = None
    def stop(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        backend = subprocess.Popen([
            config['binary'], '--interface', '127.0.0.1', '--port', '3210',
            '--site-proxy-port', '3211', '--instance-name', config['instanceName'],
            '--instance-secret', config['instanceSecret'], '--disable-beacon',
            '--local-storage', str(STATE / 'convex_local_storage'),
            str(STATE / 'convex_local_backend.sqlite3'),
        ], cwd=ROOT, stdout=backend_log, stderr=backend_log)
        for _ in range(100):
            if backend.poll() is not None:
                raise RuntimeError('Backend exited. See .convex/standalone/backend.log.')
            try:
                with urllib.request.urlopen('http://127.0.0.1:3210/instance_name', timeout=1) as response:
                    if response.read().decode() != config['instanceName']:
                        raise RuntimeError('Unexpected backend instance.')
                break
            except urllib.error.URLError:
                time.sleep(0.1)
        else:
            raise RuntimeError('Backend startup timed out. See .convex/standalone/backend.log.')
        changes = [{'name': 'BETTER_AUTH_SECRET', 'value': config['authSecret']},
                   {'name': 'SITE_URL', 'value': 'http://localhost:3000'}]
        request = urllib.request.Request('http://127.0.0.1:3210/api/update_environment_variables',
            data=json.dumps({'changes': changes}).encode(),
            headers={'Content-Type': 'application/json', 'Authorization': 'Convex ' + config['adminKey']})
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read()
        env = dict(os.environ)
        for key in ['CONVEX_DEPLOYMENT', 'CONVEX_DEPLOY_KEY']:
            env.pop(key, None)
        env.update(CONVEX_SELF_HOSTED_URL='http://127.0.0.1:3210', CONVEX_SELF_HOSTED_ADMIN_KEY=config['adminKey'])
        print('Standalone Convex ready on 3210 (database) / 3211 (auth). Login codes appear below.', flush=True)
        watcher = subprocess.Popen([str(CLI), 'dev', '--tail-logs', 'always'], cwd=ROOT, env=env)
        while watcher.poll() is None:
            if backend.poll() is not None:
                raise RuntimeError('Backend exited. See .convex/standalone/backend.log.')
            time.sleep(0.25)
        if watcher.returncode:
            raise SystemExit(watcher.returncode)
    except KeyboardInterrupt:
        pass
    finally:
        for proc in [watcher, backend]:
            if proc is not None and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    init = commands.add_parser('setup')
    init.add_argument('--from', dest='source', required=True, help='Saved deployment directory containing config.json and SQLite/file storage')
    commands.add_parser('dev')
    args = parser.parse_args()
    if args.command == 'setup':
        setup(args.source)
    else:
        if not STATE.exists():
            raise SystemExit('Run bun local:setup first. See QUICKSTART.md.')
        with (STATE / 'backend.log').open('a') as backend_log:
            dev()
