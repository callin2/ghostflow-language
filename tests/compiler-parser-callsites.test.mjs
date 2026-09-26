import assert from 'node:assert/strict';
import test from 'node:test';
import { ControlCompileError } from '../tools/control.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const document = code => `# Parser callsite diagnostic

\`\`\`ghost
${code}
\`\`\`
`;

function marked(markedCode) {
  const offset = markedCode.indexOf('§');
  assert.notEqual(offset, -1, 'case requires one marker');
  assert.equal(markedCode.indexOf('§', offset + 1), -1, 'case has multiple markers');
  const before = markedCode.slice(0, offset);
  const lines = before.split('\n');
  return { code: markedCode.replace('§', ''), line: lines.length + 3, column: lines.at(-1).length + 1 };
}

const cases = [
  {
    id: 'repeated-port-name-after-comma',
    bad: 'control Bad { input first, §: Bool; }',
    good: 'control Good { input first, second: Bool; }',
    message: 'expected input name',
  },
  {
    id: 'repeated-enum-member-after-pipe',
    bad: 'control Bad { type Mode = Off | §; }',
    good: 'control Good { type Mode = Off | On; }',
    message: 'expected enum member',
  },
  {
    id: 'result-payload-type-after-generic-open',
    bad: 'control Bad { fn pass(value: Result<§, SensorFault>) -> Bool { false } }',
    good: 'control Good { fn pass(value: Result<Bool, SensorFault>) -> Bool { false } }',
    message: 'expected type name',
  },
  {
    id: 'repeated-mutex-name-after-comma',
    bad: 'control Bad { output first, second: Bool; first <- false; second <- false; mutex(first, §); }',
    good: 'control Good { output first, second: Bool; first <- false; second <- false; mutex(first, second); }',
    message: 'expected mutex output',
  },
];

for (const entry of cases) test(`parser callsite: ${entry.id}`, async () => {
  const filename = `${entry.id}.ghost.md`;
  await assert.doesNotReject(() => compileSource(document(entry.good), { filename: `valid-${filename}` }));
  const failure = marked(entry.bad);
  await assert.rejects(() => compileSource(document(failure.code), { filename }), error => {
    assert.ok(error instanceof ControlCompileError);
    assert.equal(error.filename, filename);
    assert.equal(error.line, failure.line);
    assert.equal(error.column, failure.column);
    assert.equal(error.message, `${filename}:${failure.line}:${failure.column}: ${entry.message}`);
    return true;
  });
});
