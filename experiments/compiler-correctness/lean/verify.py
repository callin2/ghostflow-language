#!/usr/bin/env python3
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lean", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    source = root / "ConstraintPreservation.lean"
    evidence = root / "evidence"
    evidence.mkdir(exist_ok=True)
    result = {"scope": "Lean safety-round model and adjacent-deletion checker",
              "productionCompilerProof": False, "status": "running",
              "startedAt": timestamp(), "leanExecutable": args.lean, "results": []}

    def publish():
        temporary = evidence / "verification.json.tmp"
        temporary.write_text(json.dumps(result, indent=2) + "\n")
        temporary.replace(evidence / "verification.json")

    publish()
    try:
        result["proofSha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
        result["verifierSha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        publish()
        version = subprocess.run([args.lean, "--version"], text=True, capture_output=True)
        result["leanVersion"] = {"exitCode": version.returncode,
                                 "stdout": version.stdout, "stderr": version.stderr}
        publish()
        if version.returncode != 0:
            raise RuntimeError(f"Lean version command failed with exit {version.returncode}")
        verify(args.lean, source, evidence, result["results"], publish)
        result["status"] = "passed"
    except BaseException as error:
        result["status"] = "failed"
        result["error"] = {"type": type(error).__name__, "message": str(error)}
        raise
    finally:
        result["finishedAt"] = timestamp()
        publish()
    print(json.dumps(result, indent=2))


def timestamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def verify(lean, source, evidence, results, publish):
    with tempfile.TemporaryDirectory(prefix="gf-constraint-proof-") as temporary:
        directory = Path(temporary)
        environment = {**os.environ, "LEAN_PATH": str(directory)}

        def run(name, text, expected_success, output=None, expected_diagnostic=None):
            target = directory / f"{name}.lean"
            target.write_text(text)
            command = [lean]
            if output:
                command += ["-o", str(directory / output)]
            command += [str(target)]
            started_at = timestamp()
            try:
                process = subprocess.run(command, cwd=directory, env=environment, text=True, capture_output=True)
            except BaseException as error:
                results.append({"name": name, "expectedSuccess": expected_success, "passed": False,
                                "startedAt": started_at, "finishedAt": timestamp(),
                                "processError": {"type": type(error).__name__, "message": str(error)}})
                publish()
                raise
            log = process.stdout + process.stderr
            (evidence / f"{name}.log").write_text(log)
            passed = (process.returncode == 0) == expected_success
            if expected_diagnostic:
                passed = passed and expected_diagnostic in log
            if expected_success:
                passed = passed and "sorryAx" not in log
            results.append({"name": name, "exitCode": process.returncode,
                            "expectedSuccess": expected_success, "passed": passed,
                            "startedAt": started_at, "finishedAt": timestamp(),
                            "stdout": process.stdout, "stderr": process.stderr})
            publish()
            if not passed:
                raise RuntimeError(f"{name}: unexpected Lean result\n{log}")

        original = source.read_text()
        run("ConstraintPreservation", original, True, "ConstraintPreservation.olean")
        prefix = "import ConstraintPreservation\nopen CompilerSafety\n"
        run("AcceptedMixed", prefix + '''
def original : List Constraint := [.requires "a" "b", .requires "a" "b",
  .mutex ["a", "b"], .mutex ["a", "b"], .requiresAny "c" ["a", "b"]]
def compiled : List Constraint := [.requires "a" "b", .mutex ["a", "b"],
  .requiresAny "c" ["a", "b"]]
theorem accepted : check original compiled = true := by decide
theorem preserved (rounds : Nat) (initial : SafetyState) :
  run rounds original initial = run rounds compiled initial :=
  check_run original compiled accepted rounds initial
''', True)
        run("RejectedChangedDependency", prefix + '''
example : check [.requires "a" "b", .requires "a" "b"]
  [.requires "a" "c"] = true := by decide
''', False, expected_diagnostic="tactic 'decide' proved that the proposition")
        run("RejectedNonAdjacent", prefix + '''
example : check [.requires "a" "b", .requires "b" "c", .requires "a" "b"]
  [.requires "a" "b", .requires "b" "c"] = true := by decide
''', False, expected_diagnostic="tactic 'decide' proved that the proposition")
        run("RejectedRemovedRule", prefix + '''
example : check [.requires "a" "b", .mutex ["a", "b"]]
  [.requires "a" "b"] = true := by decide
''', False, expected_diagnostic="tactic 'decide' proved that the proposition")
        needle = "a.blocked n || b.blocked n"
        if original.count(needle) != 1:
            raise RuntimeError("mutation target drifted")
        run("RejectedXorAggregation", original.replace(needle, "a.blocked n != b.blocked n"), False,
            expected_diagnostic="error: unsolved goals")


if __name__ == "__main__":
    main()
