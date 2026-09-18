"""Independent civil-date oracle. Run once immediately before the relative-date suite."""
from datetime import datetime, timedelta, time
from zoneinfo import ZoneInfo
from pathlib import Path
import json
import os
import argparse
import re

parser = argparse.ArgumentParser()
parser.add_argument("--tag", default="")
parser.add_argument("--credentials", default="write-credentials.json")
args = parser.parse_args()
if not re.fullmatch(r"[a-z0-9-]{0,40}", args.tag) or not re.fullmatch(r"[a-z0-9-]+\.json", args.credentials):
    raise SystemExit("Use simple fixture and credential names")
suffix = "-" + args.tag if args.tag else ""

root = Path(__file__).resolve().parents[2] / ".convex/query-evaluation"
path = root / f"relative-calendar-fixture{suffix}.json"
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
if args.credentials == "write-credentials.json":
    person = json.loads((root / "freshness-fixture.json").read_text())["note"]["target"]["id"]
    full_name, first_name = "Robin Hayes", "Robin"
else:
    person = json.loads((root / args.credentials).read_text())["fixture"]["avery"]
    full_name, first_name = "Avery Ellis", "Avery"
result = {
    "localToday": str(today),
    "timezone": "America/Chicago",
    "personId": person,
    "personName": full_name,
    "title": first_name + " dental follow-up",
    "credentials": args.credentials,
    "instants": [
        d.astimezone(ZoneInfo("UTC")).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        for d in instants
    ],
    "localDates": [d.date().isoformat() for d in instants],
}
with path.open("x") as f:
    json.dump(result, f, indent=2)
os.chmod(path, 0o600)
cases = json.loads((Path(__file__).parent / "relative-calendar-cases.json").read_text())
for case in cases:
    case["question"] = case["question"].replace("Robin Hayes", full_name).replace("Robin", first_name)
    case["expected"] = case["expected"].replace("Robin", first_name)
    case["conversation"] = "relative-" + first_name.lower() + suffix
cases_path = root / f"relative-calendar-cases{suffix}.json"
with cases_path.open("x") as f:
    json.dump(cases, f, indent=2)
os.chmod(cases_path, 0o600)
print(json.dumps({**result, "casesPath": str(cases_path)}))
