import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlCompileError } from '../tools/control.mjs';
import { cases, moduleBoundaryCases } from './fixtures/compiler-semantic-diagnostics.mjs';

const filename = 'semantic-diagnostic.ghost.md';
const document = code => `# Semantic diagnostics\n\nOriginal prose stays outside the code.\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;

for (const { id, bad, good, message, classification } of cases) {
  test(`GF-DIAG-semantic-${id}: ${classification}; exact public diagnostic and valid neighbor`, async () => {
    assert.equal(bad.split('§').length, 2, 'each fixture marks exactly one diagnostic position');
    assert.equal(good.includes('§'), false);
    const valid = await compileSource(document(good), { filename });
    assert.ok(valid.bytes.length > 6, 'neighbor must compile through the public canonical document API');
    const marked = document(bad), at = marked.indexOf('§');
    const before = marked.slice(0, at), line = before.split('\n').length, column = before.length - before.lastIndexOf('\n');
    await assert.rejects(() => compileSource(marked.replace('§', ''), { filename }), error => {
      assert.ok(error instanceof ControlCompileError, `expected ControlCompileError, received ${error?.constructor?.name}`);
      assert.equal(error.filename, filename);
      assert.equal(error.line, line);
      assert.equal(error.column, column);
      assert.equal(error.message, `${filename}:${line}:${column}: ${message}`);
      return true;
    });
  });
}

// Artifact-envelope rejection occurs after compilation and has no AST source owner.
// Keep its exact plain Error contract separate from located language diagnostics.
for (const { id, bad, good, message, validByteLength } of moduleBoundaryCases) {
  test(`GF-DIAG-semantic-${id}: exact public artifact boundary and valid neighbor`, async () => {
    const valid = await compileSource(document(good), { filename });
    assert.equal(valid.bytes.byteLength, validByteLength);
    assert.ok(validByteLength <= 1024 * 1024);
    await assert.rejects(() => compileSource(document(bad), { filename }), error => {
      assert.equal(error.constructor, Error);
      assert.equal(error.message, message);
      assert.equal(error.filename, undefined);
      assert.equal(error.line, undefined);
      assert.equal(error.column, undefined);
      return true;
    });
  });
}
