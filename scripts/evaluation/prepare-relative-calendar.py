"""Independent civil-date oracle. Run once immediately before the relative-date suite."""
from datetime import datetime, timedelta, time
from zoneinfo import ZoneInfo
from pathlib import Path
import json
import os

root = Path(__file__).resolve().parents[2] / ".convex/query-evaluation"
path = root / "relative-calendar-fixture.json"
if path.exists():
    raise SystemExit("Fixture exists. Inspect prior results; do not blindly replay writes.")
tz = ZoneInfo("America/Chicago")
today = datetime.now(tz).date()
tuesday = today + timedelta(days=(1 - today.weekday()) % 7 or 7)
instants = [
    datetime.combine(tuesday, time(15), tz),
    datetime.combine(tuesday + timedelta(days=2), time(15), tz),
    datetime.combine(today + timedelta(days=1), time(10, 30), tz),
]
person = json.loads((root / "freshness-fixture.json").read_text())["note"]["target"]["id"]
result = {
    "localToday": str(today),
    "timezone": "America/Chicago",
    "personId": person,
    "title": "Robin dental follow-up",
    "instants": [
        d.astimezone(ZoneInfo("UTC")).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        for d in instants
    ],
    "localDates": [d.date().isoformat() for d in instants],
}
with path.open("x") as f:
    json.dump(result, f, indent=2)
os.chmod(path, 0o600)
print(json.dumps(result))
