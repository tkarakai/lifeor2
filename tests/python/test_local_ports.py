import errno
import sys
import socket
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import local_ports as ports

class PortTests(unittest.TestCase):
    def test_free_port_does_not_inspect_or_stop(self):
        with patch.object(ports, 'available', return_value=True), patch.object(ports, 'listeners') as inspect:
            ports.ensure_available([3240])
            inspect.assert_not_called()

    def test_noninteractive_never_kills(self):
        with patch.object(ports, 'available', return_value=False), patch.object(ports, 'listeners', return_value={123}), patch.object(ports, 'describe', return_value='test listener'), patch('sys.stdin.isatty', return_value=False), patch('os.kill') as kill:
            with self.assertRaises(SystemExit): ports.ensure_available([3240])
            kill.assert_not_called()

    def test_decline_never_kills(self):
        with patch.object(ports, 'available', return_value=False), patch.object(ports, 'listeners', return_value={123}), patch.object(ports, 'describe', return_value='test listener'), patch('sys.stdin.isatty', return_value=True), patch('builtins.input', return_value=''), patch('os.kill') as kill:
            with self.assertRaises(SystemExit): ports.ensure_available([3240])
            kill.assert_not_called()

    def test_changed_listener_never_kills(self):
        with patch.object(ports, 'available', return_value=False), patch.object(ports, 'listeners', side_effect=[{123},{456}]), patch.object(ports, 'describe', return_value='test listener'), patch('sys.stdin.isatty', return_value=True), patch('builtins.input', return_value='yes'), patch('os.kill') as kill:
            with self.assertRaises(SystemExit): ports.ensure_available([3240])
            kill.assert_not_called()

    def test_confirmation_gracefully_stops_exact_listener(self):
        with patch.object(ports, 'available', side_effect=[False,True]), patch.object(ports, 'listeners', return_value={123}), patch.object(ports, 'describe', return_value='test listener'), patch('sys.stdin.isatty', return_value=True), patch('builtins.input', return_value='yes'), patch('os.kill') as kill:
            ports.ensure_available([3240])
            kill.assert_called_once_with(123, ports.signal.SIGTERM)

    def test_recently_closed_connection_does_not_block_restart(self):
        with socket.socket() as server:
            server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            server.bind(('127.0.0.1', 0))
            port = server.getsockname()[1]
            server.listen()
            with socket.create_connection(('127.0.0.1', port)) as client:
                accepted, _ = server.accept()
                accepted.close()
                client.recv(1)
        self.assertTrue(ports.available(port))

    def test_permission_error_is_not_a_conflict(self):
        with patch('socket.socket') as sock:
            sock.return_value.__enter__.return_value.bind.side_effect=PermissionError(errno.EACCES, 'denied')
            with self.assertRaises(PermissionError): ports.available(3240)

if __name__ == '__main__': unittest.main()
