"""Lifecycle for project-owned child process groups (macOS/POSIX)."""
import contextlib
import fcntl
import json
import os
import signal
import subprocess
import time


def identity(pid):
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart=', '-o', 'comm='], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else ''


@contextlib.contextmanager
def project_lock(state):
    with (state / 'runner.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('This project already has a running backend supervisor. Use bun run convex:stop first.')
        yield


class Children:
    def __init__(self, state):
        self.path = state / 'processes.json'
        self.children = []
        self.records = []

    def spawn(self, *args, **kwargs):
        # A signal handler only sets a flag, so it cannot interrupt Popen/registration.
        proc = subprocess.Popen(*args, start_new_session=True, **kwargs)
        self.children.append(proc)
        self.records.append({'pid': proc.pid, 'identity': identity(proc.pid)})
        self.path.write_text(json.dumps({'supervisor': {'pid': os.getpid(), 'identity': identity(os.getpid())}, 'children': self.records}))
        self.path.chmod(0o600)
        return proc

    def close(self):
        # Repeated Ctrl-C/SIGTERM must not interrupt cleanup.
        previous = {sig: signal.signal(sig, signal.SIG_IGN) for sig in (signal.SIGINT, signal.SIGTERM)}
        try:
            for proc in reversed(self.children):
                terminate_group(proc.pid)
            for proc in self.children:
                proc.wait()
            self.children.clear()
            self.path.unlink(missing_ok=True)
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)


def group_alive(pid):
    result = subprocess.run(['ps', '-axo', 'pgid=,stat='], capture_output=True, text=True, check=True)
    return any(parts[0] == str(pid) and not parts[1].startswith('Z')
               for line in result.stdout.splitlines() if len(parts := line.split()) == 2)


def terminate_group(pid):
    if not group_alive(pid):
        return
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    for _ in range(100):
        if not group_alive(pid):
            return
        time.sleep(0.05)
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def matching(record):
    return bool(record.get('identity')) and identity(record['pid']) == record['identity']


def stop_owned(state, config):
    path = state / 'processes.json'
    records = json.loads(path.read_text()) if path.exists() else {}
    supervisor = records.get('supervisor', {})
    if matching(supervisor):
        os.kill(supervisor['pid'], signal.SIGTERM)
        for _ in range(300):
            if not matching(supervisor):
                break
            time.sleep(0.05)
        else:
            raise SystemExit('Supervisor has not stopped. Retry after cleanup finishes.')
    for record in records.get('children', []):
        if matching(record) and os.getpgid(record['pid']) == record['pid']:
            terminate_group(record['pid'])
    # Recover a backend orphaned by older runners without a PID file. Match its
    # exact database argument and executable, not just its port or instance name.
    import shlex
    result = subprocess.run(['ps', '-axo', 'pid=,args='], capture_output=True, text=True, check=True)
    database = str(state / 'convex_local_backend.sqlite3')
    for line in result.stdout.splitlines():
        try:
            pid_text, command = line.strip().split(None, 1)
            args = shlex.split(command)
        except ValueError:
            continue
        if args and args[0] == config['binary'] and database in args:
            pid = int(pid_text)
            before = identity(pid)
            if not before:
                continue
            os.kill(pid, signal.SIGTERM)
            for _ in range(100):
                if identity(pid) != before:
                    break
                time.sleep(0.05)
            else:
                raise SystemExit(f'Project backend PID {pid} did not stop; no unrelated process was killed.')
    path.unlink(missing_ok=True)
    print('Project Convex processes stopped (or already stopped).')
