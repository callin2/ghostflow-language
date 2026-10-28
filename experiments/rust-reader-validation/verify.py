#!/usr/bin/env python3
"""Check frozen extraction, kernel proofs, axiom audit and semantic mutations.

Uses an already-built Aeneas library; never builds or installs dependencies.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
THEOREMS = ['new_exact', 'new_valid', 'finished_exact', 'finished_terminates',
            'cursor_eq_length_iff_remaining_empty', 'finished_remaining',
            'invalid_cursor_counterexample']


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(args, cwd, env=None):
    p = subprocess.run([str(x) for x in args], cwd=cwd, env=env,
                       text=True, capture_output=True, timeout=180)
    return {'command': [str(x) for x in args], 'exitCode': p.returncode,
            'stdout': p.stdout, 'stderr': p.stderr}


def write_report(path, report):
    """Publish a complete receipt atomically so interrupted runs cannot look passed."""
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(report, indent=2) + '\n')
    os.replace(temporary, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lean', type=Path, required=True)
    parser.add_argument('--aeneas', type=Path, required=True,
                        help='frozen Aeneas checkout with built backends/lean')
    parser.add_argument('--extraction-dir', type=Path, required=True,
                        help='contains ReaderFoundation.llbc and lean-foundation/')
    parser.add_argument('--output', type=Path,
                        default=ROOT / 'build/rust-reader-foundation-proof')
    args = parser.parse_args()
    args.lean = args.lean.resolve()
    args.aeneas = args.aeneas.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / 'verification.json'
    report = {'status': 'running', 'observedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
              'checks': [], 'scope': 'actual production Reader.new and Reader.finished extraction only',
              'limits': ['No Reader.take/u16 or complete loader equivalence proof.',
                         'Host 64-bit extraction; no ESP32 target or hardware claim.',
                         'Rust compiler, Charon/Aeneas translation and standard-library model correctness remain trusted.',
                         'remaining is the list-remainder representation; ModuleLoader.lean is not imported.']}
    write_report(report_path, report)
    try:
        provenance = json.loads((HERE / 'provenance.json').read_text())
        report['provenance'] = provenance
        assert digest(ROOT / provenance['productionFile']) == provenance['productionSha256'], 'production source drift'
        assert digest(HERE / 'ReaderFoundation.lean') == provenance['generatedSha256'], 'generated source drift'
        assert digest(args.extraction_dir / 'lean-foundation/ReaderFoundation.lean') == provenance['generatedSha256'], 'original extraction mismatch'
        assert (HERE / 'translation.json').read_bytes() == (args.extraction_dir / 'lean-foundation/translation.json').read_bytes(), 'translation metadata mismatch'
        assert digest(args.extraction_dir / 'ReaderFoundation.llbc') == provenance['llbcSha256'], 'LLBC mismatch'
        llbc = json.loads((args.extraction_dir / 'ReaderFoundation.llbc').read_text())
        assert llbc['has_errors'] is False, 'extraction has errors'
        assert llbc['translated']['options']['start_from'] == provenance['startFrom'], 'extraction roots mismatch'
        targets = llbc['translated']['target_information']
        assert len(targets) == 1 and targets[0]['key'] == 'x86_64-apple-darwin' and targets[0]['value']['target_pointer_size'] == 8, 'extraction target mismatch'
        report['extractionTarget'] = targets[0]
        for path, expected in [(args.aeneas, provenance['aeneasCommit']),
                               (args.aeneas / 'charon', provenance['charonCommit'])]:
            check = run(['git', 'rev-parse', 'HEAD'], path)
            assert check['exitCode'] == 0 and check['stdout'].strip() == expected, 'toolchain checkout mismatch'
        version = run([args.lean, '--version'], ROOT)
        assert version['exitCode'] == 0 and 'version 4.35.0,' in version['stdout'], 'Lean version mismatch'
        report['lean'] = {**version, 'sha256': digest(args.lean)}
        backend = args.aeneas / 'backends/lean'
        library = backend / '.lake/build/lib/lean'
        assert (library / 'Aeneas.olean').is_file(), 'Aeneas library not yet built; no build was started'
        dependencies = [library] + sorted((backend / '.lake/packages').glob('*/.lake/build/lib/lean'))
        report['library'] = {'AeneasOleanSha256': digest(library / 'Aeneas.olean'),
                             'searchPaths': [str(p) for p in dependencies],
                             'lakeManifestSha256': digest(backend / 'lake-manifest.json')}
        for name in ['ReaderFoundation.lean', 'ReaderFoundationProof.lean']:
            source = (HERE / name).read_text()
            assert not re.search(r'\b(sorry|admit|axiom|native_decide)\b', source), 'forbidden proof escape'
        report['sourceHashes'] = {p.name: digest(p) for p in HERE.iterdir() if p.is_file()}
        generated = (HERE / 'ReaderFoundation.lean').read_text()
        proof = (HERE / 'ReaderFoundationProof.lean').read_text()

        def check(label, generated_text, proof_text, expect_success):
            directory = output / label
            directory.mkdir(exist_ok=True)
            (directory / 'ReaderFoundation.lean').write_text(generated_text)
            (directory / 'ReaderFoundationProof.lean').write_text(proof_text)
            env = dict(os.environ, LEAN_PATH=os.pathsep.join(str(p) for p in [directory] + dependencies))
            compiled = run([args.lean, '-o', 'ReaderFoundation.olean', 'ReaderFoundation.lean'], directory, env)
            assert compiled['exitCode'] == 0, f'{label}: generated module did not compile: {compiled}'
            result = run([args.lean, 'ReaderFoundationProof.lean'], directory, env)
            report['checks'].append({'name': label, 'expectedSuccess': expect_success,
                                     'generatedCompilation': compiled, 'proof': result})
            (directory / 'proof.log').write_text(result['stdout'] + result['stderr'])
            if expect_success:
                assert result['exitCode'] == 0, f'{label}: proof failed'
            else:
                assert result['exitCode'] != 0 and 'error:' in result['stdout'], f'{label}: false proposition not rejected'
                assert 'unknown module' not in result['stdout'], f'{label}: rejection was an import failure'
            return result['stdout']

        audit = check('baseline', generated, proof, True)
        allowed = {'propext', 'Classical.choice', 'Quot.sound'}
        for theorem in THEOREMS:
            match = re.search(r"'GhostFlowReader.Foundation\." + theorem + r"' (does not depend on any axioms|depends on axioms: \[([^\]]*)\])", audit, re.S)
            assert match, f'missing axiom audit: {theorem}'
            axioms = {x.strip() for x in (match.group(2) or '').split(',') if x.strip()}
            assert axioms <= allowed, f'unapproved axioms in {theorem}: {axioms}'
        report['allowedLogicalAxioms'] = sorted(allowed)
        assert generated.count('«at» := 0#usize') == 1
        check('mutant-new-starts-at-one', generated.replace('«at» := 0#usize', '«at» := 1#usize'), proof, False)
        assert generated.count('ok (self.at = i)') == 1
        check('mutant-finished-inverted', generated.replace('ok (self.at = i)', 'ok (!(self.at = i))'), proof, False)
        invalid_claim = '''import ReaderFoundationProof
open Aeneas Aeneas.Std GhostFlowReader GhostFlowReader.Foundation
example : Reader.finished invalidReader = Result.ok (decide (remaining invalidReader = [])) := by
  simp [finished_exact, invalidReader, remaining]
'''
        # This claim uses the baseline theorem module, compiled locally for this check.
        baseline = output / 'baseline'
        env = dict(os.environ, LEAN_PATH=os.pathsep.join(str(p) for p in [baseline] + dependencies))
        compiled = run([args.lean, '-o', 'ReaderFoundationProof.olean', 'ReaderFoundationProof.lean'], baseline, env)
        assert compiled['exitCode'] == 0, 'baseline theorem module compilation failed'
        (baseline / 'InvalidCursorClaim.lean').write_text(invalid_claim)
        invalid = run([args.lean, 'InvalidCursorClaim.lean'], baseline, env)
        report['checks'].append({'name': 'invalid-cursor-without-premise', 'expectedSuccess': False, 'proof': invalid})
        assert invalid['exitCode'] != 0 and 'error:' in invalid['stdout'] and 'unknown module' not in invalid['stdout'], 'invalid cursor claim not semantically rejected'
        report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
    finally:
        report['finishedAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        write_report(report_path, report)
    print(json.dumps({'status': report['status'], 'report': str(report_path), 'error': report.get('error')}))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
