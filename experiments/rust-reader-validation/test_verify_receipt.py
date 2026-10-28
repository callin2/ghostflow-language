"""Regression checks for receipt publication without Lean or Aeneas dependencies."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


VERIFY = Path(__file__).with_name('verify.py')


HARNESS = r'''import importlib.util, json, os, sys
from pathlib import Path
verifier_path, mode, root_s, output_s = sys.argv[1:]
root, output = Path(root_s), Path(output_s)
root.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location("verify_under_test", verifier_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.HERE, module.ROOT = root, root
module.digest = lambda path: "fixture-hash"
(root / "src.rs").write_text("fixture")
(root / "ReaderFoundation.lean").write_text("def generated := 0\n")
(root / "ReaderFoundationProof.lean").write_text("theorem fixture : True := by trivial\n")
(root / "translation.json").write_text("{}")
extraction = root / "extraction"
(extraction / "lean-foundation").mkdir(parents=True)
(extraction / "lean-foundation/translation.json").write_text("{}")
(extraction / "lean-foundation/ReaderFoundation.lean").write_text("fixture")
(extraction / "ReaderFoundation.llbc").write_text(json.dumps({
    "has_errors": False,
    "translated": {"options": {"start_from": ["crate::Reader::new", "crate::Reader::finished"]},
                   "target_information": [{"key": "x86_64-apple-darwin", "value": {"target_pointer_size": 8}}]}
}))
provenance = {"productionFile": "src.rs", "productionSha256": "fixture-hash",
    "generatedSha256": "fixture-hash", "llbcSha256": "fixture-hash",
    "aeneasCommit": "aeneas", "charonCommit": "charon",
    "startFrom": ["crate::Reader::new", "crate::Reader::finished"]}
if mode == "ordinary-failure":
    provenance["productionSha256"] = "mismatch"
(root / "provenance.json").write_text(json.dumps(provenance))
if mode == "interrupted":
    def external(*_args, **_kwargs):
        receipt = json.loads((output / "verification.json").read_text())
        assert receipt["status"] == "running", receipt
        os._exit(77)
    module.run = external
sys.argv = ["verify.py", "--lean", str(root / "lean"), "--aeneas", str(root / "aeneas"),
            "--extraction-dir", str(extraction), "--output", str(output)]
sys.exit(module.main())
'''


class ReceiptPublicationTest(unittest.TestCase):
    def run_child(self, mode, root, output):
        harness = root / 'harness.py'
        harness.write_text(HARNESS)
        return subprocess.run([sys.executable, str(harness), str(VERIFY), mode,
                               str(root / 'fixtures'), str(output)],
                              capture_output=True, text=True)

    def test_interruption_replaces_old_passed_receipt_before_external_work(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'out'
            output.mkdir()
            receipt = output / 'verification.json'
            receipt.write_text('{"status":"passed"}\n')

            child = self.run_child('interrupted', root, output)

            self.assertEqual(child.returncode, 77, child.stderr)
            self.assertEqual(json.loads(receipt.read_text())['status'], 'running')

    def test_ordinary_failure_replaces_old_passed_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'out'
            output.mkdir()
            receipt = output / 'verification.json'
            receipt.write_text('{"status":"passed"}\n')

            child = self.run_child('ordinary-failure', root, output)

            self.assertEqual(child.returncode, 1, child.stdout + child.stderr)
            self.assertEqual(json.loads(receipt.read_text())['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
