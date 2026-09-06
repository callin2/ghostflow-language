import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileControl } from '../tools/control.mjs';
import { extractLiterate } from '../tools/literate.mjs';
import { compileSource, writeArtifact } from '../tools/toolchain.mjs';

const filename = 'mapped.ghost.md';
const markdown = `# A literate control

\`\`\`ghost
control Mapped {
  output pump: Bool = false;
  pump <- false;
}
\`\`\`
`;

const extracted = extractLiterate(markdown, { filename });
const direct = compileControl(extracted.code, { filename });
const result = await compileSource(markdown, { filename });

assert.equal(result.manifest.name, 'Mapped');
assert.equal(result.manifest.bytecodeSha256, createHash('sha256').update(result.bytes).digest('hex'));
assert.deepEqual(result.sourceMap.map(node => node.id), direct.sourceMap.map(node => node.id), 'node IDs are immutable across remapping');

const output = result.sourceMap.find(node => node.kind === 'output');
assert.deepEqual(
  { filename: output.filename, line: output.line, column: output.column },
  { filename, line: 5, column: 3 },
);
assert.deepEqual(
  { filename: output.extracted.filename, line: output.extracted.line, column: output.extracted.column },
  { filename, line: 2, column: 3 },
);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-toolchain-'));
try {
  const artifact = path.join(temporary, 'nested', 'mapped.gfb');
  writeArtifact(result, artifact);
  assert.deepEqual(fs.readFileSync(artifact), result.bytes);
  const manifest = JSON.parse(fs.readFileSync(`${artifact}.manifest.json`, 'utf8'));
  const sourceMap = JSON.parse(fs.readFileSync(`${artifact}.map.json`, 'utf8'));
  assert.equal(manifest.bytecodeSha256, result.manifest.bytecodeSha256);
  assert.deepEqual(sourceMap.nodes, result.sourceMap);
  assert.deepEqual(sourceMap.lines, result.extractionMap);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

const invalid = `# Invalid literate control

\`\`\`ghost
control Invalid {
  output pump: Bool = false;
  pump <- missing;
}
\`\`\`
`;
await assert.rejects(
  () => compileSource(invalid, { filename: 'invalid.ghost.md' }),
  error => error.filename === 'invalid.ghost.md'
    && error.line === 6 && error.column === 11
    && error.message.includes('invalid.ghost.md:6:11: unknown identifier missing'),
);

console.log(`toolchain tests passed (${result.bytes.length} bytes, ${result.sourceMap.length} remapped nodes)`);
