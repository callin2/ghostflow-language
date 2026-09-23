import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';

const exact8192 = `control Limit { fn f(${Array.from({ length: 2045 }, (_, i) => `a${i}: Bool`).join(',')}) -> Bool { true } }`;
const cases = [
  ['identifier', 'foo'], ['number', '1'], ['symbol', ';'],
  ['tagged time literal', 'date`2026-01-01`'], ['JSON string', '"ok"'],
];
function documentWith(token) { return `\`\`\`ghost\n${exact8192}\n${token}\n\`\`\`\n`; }

test('compiler token limit: exactly 8192 tokens remains accepted', async () => {
  const compiled = await compileSource(`\`\`\`ghost\n${exact8192}\n\`\`\`\n`, { filename: 'token-limit-boundary.ghost.md' });
  assert.ok(compiled.bytes.length > 0);
});

for (const [label, token] of cases) {
  test(`compiler token limit: ${label} is the first over-limit token`, async () => {
    const filename = `token-limit-${label.replaceAll(' ', '-')}.ghost.md`;
    await assert.rejects(() => compileSource(documentWith(token), { filename }), error => {
      assert.equal(error.name, 'ControlCompileError');
      assert.equal(error.message, `${filename}:3:1: token limit exceeded (8192)`);
      assert.equal(error.filename, filename);
      assert.equal(error.line, 3);
      assert.equal(error.column, 1);
      return true;
    });
  });
}
