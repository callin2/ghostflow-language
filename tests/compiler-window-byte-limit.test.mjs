import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlCompileError } from '../tools/control.mjs';

const nested = count => `${'twice('.repeat(count)}x + 0.1 + 0.1${')'.repeat(count)}`;
const source = count => `# Audit

\`\`\`ghost
fn twice(x: Number) -> Number { x + x }
fn huge(x: Number) -> Number { ${nested(count)} }
control Audit {
  sensor s: Number;
  signal inner = window_average(s, over: 1s, quality: measured, max_age: 1s);
  signal outer = window_average(inner |> map(huge), over: 1s, quality: measured, max_age: 1s);
}
\`\`\`\n`;

test('window expression byte limit accepts seven nested transforms', async () => {
  const artifact = await compileSource(source(7), { filename: 'nested-audit.ghost.md' });
  assert.ok(artifact.bytes.byteLength > 0);
});

test('window expression byte limit rejects eight nested transforms at the authored control', async () => {
  await assert.rejects(() => compileSource(source(8), { filename: 'nested-audit.ghost.md' }), error => {
    assert.equal(error.constructor, ControlCompileError);
    assert.equal(error.filename, 'nested-audit.ghost.md');
    assert.equal(error.line, 6);
    assert.equal(error.column, 1);
    assert.equal(error.message, 'nested-audit.ghost.md:6:1: GFB1 lowering rejected control: strategy resource limit exceeded');
    return true;
  });
});
