"""Port checks with explicit, default-no confirmation before terminating listeners."""
import errno
import os
import signal
import socket
import subprocess
import sys
import time


def available(port):
    with socket.socket() as sock:
        # Match server bind semantics: recently closed connections (TIME_WAIT)
        # must not look like a live listener after a clean shutdown.
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(('127.0.0.1', port))
            return True
        except OSError as exc:
            if exc.errno == errno.EADDRINUSE:
                return False
            raise  # Permission errors must not be mistaken for another app.


def listeners(port):
    result = subprocess.run(['lsof', '-nP', f'-iTCP:{port}', '-sTCP:LISTEN', '-t'], capture_output=True, text=True)
    return set(int(line) for line in result.stdout.splitlines() if line.isdigit())


def describe(pid):
    # Never print full command arguments: Convex puts secrets there.
    command = subprocess.run(['ps', '-p', str(pid), '-o', 'comm='], capture_output=True, text=True).stdout.strip()
    cwd = subprocess.run(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'], capture_output=True, text=True).stdout
    directory = next((line[1:] for line in cwd.splitlines() if line.startswith('n')), 'unknown')
    return f'PID {pid}: {command or "unknown executable"}; directory: {directory}'


def ensure_available(ports):
    for port in ports:
        if available(port):
            continue
        pids = listeners(port)
        print(f'Port {port} is already in use.', flush=True)
        for pid in sorted(pids):
            print(describe(pid), flush=True)
        if not pids or not (sys.stdin.isatty() or sys.stdout.isatty()):
            raise SystemExit('No process was stopped. Run in an interactive terminal to choose whether to stop it, or configure different ports.')
        try:
            prompt = f'Stop the above process(es) using port {port} with SIGTERM? [y/N] '
            if sys.stdin.isatty():
                answer = input(prompt)
            else:
                # Bun may pipe stdin while retaining a controlling terminal.
                with open('/dev/tty', 'r+') as terminal:
                    terminal.write(prompt)
                    terminal.flush()
                    answer = terminal.readline()
        except (EOFError, OSError):
            answer = ''
        if answer.strip().lower() not in ('y', 'yes'):
            raise SystemExit('Cancelled; no process was stopped. Choose different ports with local:configure.')
        # Recheck ownership after the prompt. Do not terminate a newly arrived listener.
        if listeners(port) != pids:
            raise SystemExit('The listener changed. Retry to inspect the current process.')
        for pid in pids:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        for _ in range(50):
            if available(port):
                break
            time.sleep(0.1)
        else:
            raise SystemExit('Port is still occupied after SIGTERM. No forced kill was attempted.')
