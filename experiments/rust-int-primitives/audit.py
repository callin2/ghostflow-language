#!/usr/bin/env python3
"""Reject extraction artifacts lacking real root bodies or containing proof escapes."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re

METHODS = {'checked_add', 'checked_neg'}
RUST_NAMES = {'core::num::{i32}::' + x for x in METHODS}


def inspect(directory):
    directory = Path(directory)
    llbc = json.loads((directory / 'IntPrimitives.llbc').read_text())
    translated = llbc['translated']
    roots = [f for f in translated['fun_decls'] if f and f['item_meta']['started_from']]
    root_bodies = {f['item_meta']['name'][-1]['Ident'][0]: {
        'defId': f['def_id'], 'isLocal': f['item_meta']['is_local'],
        'opacity': f['item_meta']['opacity'],
        'structured': isinstance(f['body'], dict) and 'Structured' in f['body']}
        for f in roots}
    metadata = json.loads((directory / 'lean/translation.json').read_text())
    generated = (directory / 'lean/IntPrimitives.lean').read_text()
    annotations = set(re.findall(r'@\[rust_fun "([^"\n]+)"\]', generated))
    emitted = {f['rust_name'] for f in metadata['functions'] if not f['is_opaque']} & annotations
    escapes = re.findall(r'^.*\b(?:axiom|sorry|admit|native_decide)\b.*$', generated, re.M)
    reasons = []
    if llbc['has_errors']:
        reasons.append('Charon reported errors')
    if set(root_bodies) != METHODS or not all(
            x['opacity'] == 'Transparent' and x['structured'] for x in root_bodies.values()):
        reasons.append('selected external roots lack transparent Structured LLBC bodies')
    missing = sorted(RUST_NAMES - emitted)
    if missing:
        reasons.append('selected actual roots absent from non-opaque Lean translation')
    if escapes:
        reasons.append('generated Lean contains unapproved declarations')
    return {'status': 'rejected' if reasons else 'admissible-for-proof',
            'observedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            'llbcHasErrors': llbc['has_errors'], 'rootBodies': root_bodies,
            'missingLeanRoots': missing, 'unapprovedDeclarations': escapes,
            'reasons': reasons, 'targetInformation': translated['target_information'],
            'sha256': {str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
                       for p in sorted(directory.rglob('*')) if p.is_file()
                       and p.name not in {'admission.json', 'admission.json.tmp'}}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    report = inspect(args.directory)
    temporary = args.directory / 'admission.json.tmp'
    temporary.write_text(json.dumps(report, indent=2) + '\n')
    os.replace(temporary, args.directory / 'admission.json')
    print(json.dumps({'status': report['status'], 'reasons': report['reasons']}))
    return 0 if report['status'] == 'admissible-for-proof' else 1


if __name__ == '__main__':
    raise SystemExit(main())
