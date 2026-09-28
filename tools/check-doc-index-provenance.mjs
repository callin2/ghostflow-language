#!/usr/bin/env node
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function checkDocIndexProvenance(directory = new URL('./doc-index/', import.meta.url)) {
  const provenance = JSON.parse(fs.readFileSync(new URL('provenance.json', directory), 'utf8'));
  if (provenance.repository !== 'https://github.com/callin2/doc-index' ||
      !/^[a-f0-9]{40}$/.test(provenance.commit) ||
      JSON.stringify(Object.keys(provenance.files).sort()) !== JSON.stringify(['docs-find.mjs', 'docs-index.mjs'])) {
    throw new Error('Invalid doc-index upstream provenance');
  }
  for (const [file, expected] of Object.entries(provenance.files)) {
    const actual = createHash('sha256').update(fs.readFileSync(new URL(file, directory))).digest('hex');
    if (actual !== expected) throw new Error(`Doc-index provenance mismatch: ${file}`);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { checkDocIndexProvenance(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
