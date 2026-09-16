#!/usr/bin/env python3
"""Start Next.js on the configured auth origin, offering to stop a port conflict."""
from pathlib import Path
import os
import sys
from local_ports import ensure_available

ROOT = Path(__file__).resolve().parents[1]
if len(sys.argv) > 1:
    raise SystemExit('Frontend uses port 3000 to match the auth origin; no port overrides are supported.')
ensure_available((3000,))
os.chdir(ROOT)
os.execv(str(ROOT / 'node_modules/.bin/next'), ['next', 'dev', '--port', '3000'])
