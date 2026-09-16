import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from local_processes import Children, project_lock, matching

class LifecycleTests(unittest.TestCase):
    def test_stale_pid_is_not_owned(self):
        self.assertFalse(matching({'pid': os.getpid(), 'identity': 'old process'}))

    def test_project_lock_blocks_duplicate_runner(self):
        with tempfile.TemporaryDirectory() as directory:
            with project_lock(Path(directory)):
                with self.assertRaises(SystemExit):
                    with project_lock(Path(directory)): pass

    def test_cleanup_ignores_repeated_interrupts_and_reaps_child(self):
        with tempfile.TemporaryDirectory() as directory:
            children = Children(Path(directory))
            proc = children.spawn([sys.executable, '-c', 'import time; time.sleep(60)'])
            # Trigger signals during termination, reproducing the user's traceback.
            import local_processes
            real_terminate = local_processes.terminate_group
            def interrupted(pid):
                os.kill(os.getpid(), signal.SIGINT)
                os.kill(os.getpid(), signal.SIGTERM)
                real_terminate(pid)
            with patch.object(local_processes, 'terminate_group', side_effect=interrupted):
                children.close()
            self.assertIsNotNone(proc.poll())
            self.assertFalse((Path(directory) / 'processes.json').exists())

    def test_cleanup_stops_descendants(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            code = "import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); open(sys.argv[1],'w').write(str(p.pid)); time.sleep(60)"
            children = Children(state)
            children.spawn([sys.executable, '-c', code, str(state / 'descendant')])
            try:
                for _ in range(100):
                    if (state / 'descendant').exists(): break
                    time.sleep(.02)
                pid = int((state / 'descendant').read_text())
                children.close()
                result = subprocess.run(['ps', '-p', str(pid), '-o', 'stat='], capture_output=True, text=True)
                self.assertTrue(not result.stdout.strip() or result.stdout.strip().startswith('Z'))
            finally:
                children.close()

if __name__ == '__main__': unittest.main()
