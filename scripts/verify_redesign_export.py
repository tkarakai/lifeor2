#!/usr/bin/env python3
"""Compare private Convex snapshot exports without printing record contents."""
import argparse
from decimal import Decimal
import json
from pathlib import Path
import zipfile


def tables(path):
    with zipfile.ZipFile(path) as archive:
        return {
            name.removesuffix('/documents.jsonl'): [json.loads(line) for line in archive.read(name).decode().splitlines() if line.strip()]
            for name in archive.namelist() if name.endswith('/documents.jsonl')
        }


def verify(before_path, after_path):
    before, after = tables(before_path), tables(after_path)
    errors = []
    preserved = {}
    # Additive migration retains the original identities and descriptive values.
    protected = {
        'entity': ('_id', 'user_id', 'kind', 'display_name'),
        'arrangement': ('_id', 'user_id', 'kind', 'valid_from'),
        'arrangement_role': ('_id', 'arrangement_id', 'entity_id', 'role_name', 'share_json'),
        'event': ('_id', 'user_id', 'kind', 'occurred_at', 'payload_json'),
        'ledger_account': ('_id', 'user_id', 'name', 'type', 'currency'),
        'journal_entry': ('_id', 'user_id', 'event_id', 'memo', 'status'),
        'posting': ('_id', 'je_id', 'account_id', 'currency', 'description'),
        'property': ('_id', 'user_id', 'owner_type', 'owner_id', 'name', 'value_json', 'valid_from', 'valid_to', 'recorded_at'),
        'measurement': ('_id', 'user_id', 'owner_type', 'owner_id', 'name', 'value_json', 'as_of', 'recorded_at'),
        '_components/betterAuth/user': ('_id', 'email', 'name'),
    }
    for name, keys in protected.items():
        indexed = {record['_id']: record for record in after.get(name, [])}
        preserved[name] = 0
        for original in before.get(name, []):
            migrated = indexed.get(original['_id'])
            if migrated is None:
                errors.append(f'{name}: original record missing')
            elif any(original.get(key) != migrated.get(key) for key in keys):
                errors.append(f'{name}: protected original field changed')
            else:
                preserved[name] += 1
    # Check exact decimal conversion for supported source currencies.
    scales = {'USD': 2, 'EUR': 2, 'GBP': 2, 'CAD': 2, 'AUD': 2, 'CHF': 2, 'HUF': 2, 'JPY': 0, 'KWD': 3, 'BHD': 3}
    postings = {record['_id']: record for record in after.get('posting', [])}
    for original in before.get('posting', []):
        migrated = postings.get(original['_id'])
        if not migrated or 'minor_units' not in migrated:
            errors.append('posting: original amount has no converted minor units')
            continue
        scale = scales.get(original['currency'])
        if scale is None:
            errors.append('posting: source currency needs explicit verification scale')
        elif Decimal(str(original['amount'])) * (10 ** scale) != Decimal(str(migrated['minor_units'])):
            errors.append('posting: exact monetary value changed')
    return {'preserved': preserved, 'before_counts': {name: len(rows) for name, rows in before.items()},
            'after_counts': {name: len(rows) for name, rows in after.items()}, 'errors': errors, 'ok': not errors}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    result = verify(args.before, args.after)
    if args.report:
        args.report.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'ok': result['ok'], 'preserved': result['preserved'], 'errors': result['errors']}, indent=2))
    raise SystemExit(0 if result['ok'] else 1)
