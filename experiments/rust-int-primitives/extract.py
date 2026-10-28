#!/usr/bin/env python3
"""Extract real external i32 methods from ghostflow-core; never build tools."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess

from audit import inspect

ROOT = Path(__file__).resolve().parents[2]
ROOTS = ['i32::checked_add', 'i32::checked_neg']


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--charon', type=Path, required=True)
    p.add_argument('--aeneas', type=Path, required=True)
    p.add_argument('--rustup-home', type=Path, required=True)
    p.add_argument('--miri-sysroot', type=Path, required=True)
    p.add_argument('--target-dir', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--configuration', choices=['broad', 'exact-pattern', 'wildcard'],
                   default='wildcard', help='reproduce historical attempts 1, 2 or 3')
    args = p.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        p.error('use a fresh output directory; prior attempts must be retained')
    env = dict(os.environ, RUSTUP_HOME=str(args.rustup_home.resolve()),
               RUSTUP_TOOLCHAIN='nightly-2026-09-17', RUSTUP_NO_UPDATE_CHECK='1',
               CARGO_TARGET_DIR=str(args.target_dir.resolve()),
               CHARON_MIRI_SYSROOTS=str(args.miri_sysroot.resolve()))
    report = {'status': 'running', 'observedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
              'productionFile': 'crates/ghostflow-core/src/lib.rs',
              'productionSha256': sha(ROOT / 'crates/ghostflow-core/src/lib.rs'),
              'roots': ROOTS, 'steps': []}

    def save():
        temporary = output / 'extraction.json.tmp'
        temporary.write_text(json.dumps(report, indent=2) + '\n')
        os.replace(temporary, output / 'extraction.json')

    def run(label, cmd):
        result = subprocess.run([str(x) for x in cmd], cwd=ROOT, env=env,
                                text=True, capture_output=True)
        record = {'label': label, 'command': [str(x) for x in cmd],
                  'exitCode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}
        report['steps'].append(record)
        (output / (label + '.stdout.log')).write_text(result.stdout)
        (output / (label + '.stderr.log')).write_text(result.stderr)
        save()
        if result.returncode:
            raise RuntimeError(f'{label} exited {result.returncode}; retained raw logs')

    save()
    try:
        filters = []
        if args.configuration != 'broad':
            filters += ['--opaque=core', '--opaque=alloc', '--opaque=std']
        impl_pattern = '_' if args.configuration == 'wildcard' else '{i32}'
        methods = ['checked_add', 'checked_neg']
        if args.configuration != 'broad':
            methods.append('overflowing_neg')
        filters += ['--include=core::num::' + impl_pattern + '::' + name for name in methods]
        if args.configuration == 'wildcard':
            filters.append('--include=core::intrinsics::unlikely')
        run('charon', [args.charon.resolve(), 'cargo', '--preset=aeneas', '--sysroot=miri',
                      '--start-from=' + ','.join(ROOTS), '--extract-opaque-bodies',
                      *filters,
                      '--dest-file=' + str(output / 'IntPrimitives.llbc'),
                      '--', '-p', 'ghostflow-core', '--lib'])
        llbc = json.loads((output / 'IntPrimitives.llbc').read_text())
        if llbc['has_errors']:
            raise RuntimeError('Charon emitted extraction errors')
        (output / 'lean').mkdir(exist_ok=True)
        run('aeneas', [args.aeneas.resolve(), '-backend', 'lean', '-namespace', 'GhostFlowInt',
                      '-emit-json', '-dest', output / 'lean', output / 'IntPrimitives.llbc'])
        report['admission'] = inspect(output)
        report['status'] = report['admission']['status']
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
    report['finishedAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    save()
    print(json.dumps({'status': report['status'], 'receipt': str(output / 'extraction.json'),
                      'error': report.get('error')}))
    return 0 if report['status'] == 'admissible-for-proof' else 1


if __name__ == '__main__':
    raise SystemExit(main())
