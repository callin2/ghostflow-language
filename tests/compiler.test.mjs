import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileSource } from '../tools/toolchain.mjs';

const filename = 'examples/irrigation.ghost.md';
const source = fs.readFileSync(new URL('../examples/irrigation.ghost.md', import.meta.url), 'utf8');
const compilation = await compileSource(source, { filename });
assert.equal(compilation.bytes.subarray(0, 4).toString(), 'GFB1');
assert.ok(compilation.bytes.length < 4096, `example bytecode is unexpectedly large: ${compilation.bytes.length}`);

await assert.rejects(
  () => compileSource('control Broken { output pump: Bool; pump <- missing; }', { filename: 'broken.ghost' }),
  /requires a canonical .ghost.md literate source/,
);

console.log(`compiler tests passed (${compilation.bytes.length} byte module)`);
