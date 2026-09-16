import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

MODULE_PATH = Path(__file__).resolve().parents[2] / 'scripts' / 'verify_redesign_export.py'
SPEC = importlib.util.spec_from_file_location('verify_redesign_export', MODULE_PATH)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class ExportVerificationTests(unittest.TestCase):
    def compare(self, before, after):
        with tempfile.TemporaryDirectory() as directory:
            paths = []
            for name, data in [('before', before), ('after', after)]:
                path = Path(directory) / (name + '.zip')
                with zipfile.ZipFile(path, 'w') as archive:
                    for table, rows in data.items():
                        archive.writestr(table + '/documents.jsonl', '\n'.join(json.dumps(row) for row in rows))
                paths.append(path)
            return module.verify(*paths)

    def test_additive_fields_preserve_identities_but_owner_changes_fail(self):
        row = {'_id': 'e1', 'user_id': 'alice', 'kind': 'Person', 'display_name': 'Alice'}
        self.assertTrue(self.compare({'entity': [row]}, {'entity': [{**row, 'revision': 1}]})['ok'])
        self.assertFalse(self.compare({'entity': [row]}, {'entity': [{**row, 'user_id': 'bob'}]})['ok'])

    def test_missing_original_record_fails(self):
        self.assertFalse(self.compare({'entity': [{'_id': 'e1'}]}, {'entity': []})['ok'])

    def test_money_conversion_must_preserve_fractional_cents_exactly(self):
        base = {'_id': 'p1', 'je_id': 'j1', 'account_id': 'a1', 'currency': 'USD', 'description': ''}
        original = {**base, 'amount': 1.01}
        self.assertTrue(self.compare({'posting': [original]}, {'posting': [{**base, 'minor_units': 101}]})['ok'])
        self.assertFalse(self.compare({'posting': [original]}, {'posting': [{**base, 'minor_units': 100}]})['ok'])
        self.assertFalse(self.compare({'posting': [{**original, 'amount': 1.001}]}, {'posting': [{**base, 'minor_units': 100}]})['ok'])


if __name__ == '__main__':
    unittest.main()
