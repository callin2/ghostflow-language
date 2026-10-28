"""Admission guard regressions using synthetic artifacts; no Rust/kernel proof."""
from contextlib import redirect_stdout
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import audit
import extract


def fixture(directory):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'lean').mkdir(exist_ok=True)
    roots = [{'def_id': i, 'item_meta': {'started_from': True, 'is_local': False,
              'name': [{'Ident': [name, 0]}], 'opacity': 'Transparent'},
              'body': {'Structured': {}}} for i, name in enumerate(sorted(audit.METHODS))]
    (directory / 'IntPrimitives.llbc').write_text(json.dumps({'has_errors': False,
        'translated': {'fun_decls': roots, 'target_information': []}}))
    (directory / 'lean/translation.json').write_text(json.dumps({'functions': [
        {'rust_name': name, 'is_opaque': False} for name in sorted(audit.RUST_NAMES)]}))
    (directory / 'lean/IntPrimitives.lean').write_text('\n'.join(
        '@[rust_fun "' + name + '"]\ndef ' + name.split('::')[-1] + ' := 0'
        for name in sorted(audit.RUST_NAMES)))


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name) / 'artifacts'
        fixture(self.directory)

    def test_corrupt_or_missing_llbc_replaces_old_success(self):
        for malformed in [True, False]:
            with self.subTest(malformed=malformed):
                llbc = self.directory / 'IntPrimitives.llbc'
                if malformed:
                    llbc.write_text('{bad-json')
                else:
                    llbc.unlink()
                receipt = self.directory / 'admission.json'
                receipt.write_text(json.dumps({'status': 'admissible-for-proof'}))
                result = subprocess.run([sys.executable, str(Path(audit.__file__)),
                                         str(self.directory)], text=True, capture_output=True)
                self.assertEqual(result.returncode, 1)
                report = json.loads(receipt.read_text())
                self.assertEqual(report['status'], 'failed')
                self.assertTrue(report['finishedAt'].endswith('Z'))
                self.assertTrue(report['reasons'])

    def test_running_is_published_before_inspection(self):
        receipt = self.directory / 'admission.json'
        receipt.write_text(json.dumps({'status': 'admissible-for-proof'}))

        def interrupted(_directory):
            self.assertEqual(json.loads(receipt.read_text())['status'], 'running')
            raise ValueError('interrupted inspection')

        with patch.object(sys, 'argv', ['audit.py', str(self.directory)]), \
                patch.object(audit, 'inspect', side_effect=interrupted), redirect_stdout(io.StringIO()):
            self.assertEqual(audit.main(), 1)
        self.assertEqual(json.loads(receipt.read_text())['status'], 'failed')

    def test_receipt_and_temporary_rewrites_do_not_change_artifact_hashes(self):
        before = audit.inspect(self.directory)['sha256']
        for name in ['extraction.json', 'extraction.json.tmp', 'admission.json', 'admission.json.tmp']:
            (self.directory / name).write_text('first receipt')
        after = audit.inspect(self.directory)['sha256']
        self.assertEqual(before, after)
        (self.directory / 'extraction.json').write_text('final receipt with embedded admission')
        self.assertEqual(after, audit.inspect(self.directory)['sha256'])
        self.assertEqual(set(after), {'IntPrimitives.llbc', 'lean/IntPrimitives.lean',
                                     'lean/translation.json'})

    def test_unproved_declarations_and_proof_escapes_are_rejected(self):
        lean = self.directory / 'lean/IntPrimitives.lean'
        baseline = lean.read_text()
        self.assertEqual(audit.inspect(self.directory)['status'], 'admissible-for-proof')
        for declaration in ['axiom hidden : Nat', 'constant hidden : Nat',
                            'opaque hidden : Nat', 'def hidden := sorryAx Nat true',
                            'def hidden := by sorry', 'def hidden := by admit',
                            'example : True := by native_decide']:
            with self.subTest(declaration=declaration):
                lean.write_text(baseline + '\n' + declaration)
                self.assertEqual(audit.inspect(self.directory)['status'], 'rejected')

    def extraction_with_mock_tools(self, mutate_source):
        root = Path(self.temporary.name) / 'repository'
        source = root / 'crates/ghostflow-core/src/lib.rs'
        source.parent.mkdir(parents=True)
        source.write_text('unchanged production fixture')
        charon, aeneas = root / 'charon', root / 'aeneas'
        charon.write_text('mock Charon binary')
        aeneas.write_text('mock Aeneas binary')
        output = root / 'output'
        commands = []

        def run(command, **_kwargs):
            commands.append(command)
            fixture(output)
            if Path(command[0]).resolve() == aeneas.resolve() and mutate_source:
                source.write_text('changed during extraction')
            return subprocess.CompletedProcess(command, 0, '', '')

        argv = ['extract.py', '--charon', str(charon), '--aeneas', str(aeneas),
                '--rustup-home', str(root), '--miri-sysroot', str(root),
                '--target-dir', str(root / 'target'), '--output', str(output)]
        with patch.object(extract, 'ROOT', root), patch.object(sys, 'argv', argv), \
                patch.object(extract.subprocess, 'run', side_effect=run), redirect_stdout(io.StringIO()):
            result = extract.main()
        report = json.loads((output / 'extraction.json').read_text())
        self.assertIn('--locked', commands[0])
        self.assertIn('--offline', commands[0])
        self.assertEqual(report['inputSha256Before']['charon'], hashlib.sha256(charon.read_bytes()).hexdigest())
        self.assertEqual(set(report['inputSha256Before']),
                         {'production', 'charon', 'aeneas', 'extractHelper', 'auditHelper'})
        self.assertEqual(report['admission']['sha256'], audit.inspect(output)['sha256'])
        return result, report

    def test_mock_extraction_records_stable_inputs_and_hashes(self):
        result, report = self.extraction_with_mock_tools(False)
        self.assertEqual(result, 0)
        self.assertTrue(report['inputsUnchanged'])
        self.assertEqual(report['inputSha256Before'], report['inputSha256After'])

    def test_source_change_rejects_mock_extraction(self):
        result, report = self.extraction_with_mock_tools(True)
        self.assertEqual(result, 1)
        self.assertEqual(report['status'], 'failed')
        self.assertFalse(report['inputsUnchanged'])


if __name__ == '__main__':
    unittest.main()
