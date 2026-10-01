import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Shared by the full verifier and CI handoff: a report cannot choose to omit
// source files. The current frontend pin contains only ghostflow-core under
// crates/, so it produces the same key set as its original verifier.
const SOURCE_ROOTS = [
  'tools', 'crates', 'runtimes/wasm', 'runtimes/node',
  'tests', 'examples', 'docs', 'contracts/integration-v1',
  'contracts/interaction-v0', 'contracts/requirements', 'README.md',
  'AGENTS.md', '.gitignore', 'Cargo.toml', 'Cargo.lock', 'package.json',
  'package-lock.json', 'Makefile',
];

export function verificationSourceHashes(root) {
  const hashes = {};
  function visit(relative) {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`source symlink is outside the export contract: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) {
        if (!['target', 'node_modules', 'build', '.git'].includes(name)) visit(`${relative}/${name}`);
      }
    } else if (stat.isFile()) {
      hashes[relative] = createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
    } else {
      throw new Error(`source must be a regular file: ${relative}`);
    }
  }
  for (const relative of SOURCE_ROOTS) visit(relative);
  // Historical consumer pins predate the calendar adapter. Its presence makes
  // the reviewed offline dataset mandatory in the current source graph.
  if (fs.existsSync(path.join(root, 'runtimes/node/calendar.mjs'))) visit('data/calendars');
  return hashes;
}

export function assertVerificationSources(root, reported) {
  const actual = verificationSourceHashes(root);
  if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(reported ?? {}).sort())) {
    throw new Error('verification source hash set is incomplete or unexpected');
  }
  for (const [relative, digest] of Object.entries(actual)) {
    if (reported[relative] !== digest) throw new Error(`source changed since verification: ${relative}`);
  }
}
