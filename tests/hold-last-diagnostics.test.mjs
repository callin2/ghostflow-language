import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlCompileError } from '../tools/control.mjs';

const filename = 'hold-last-diagnostic.ghost.md';
const document = code => `# Hold last diagnostics\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const wrap = body => `control HoldDiagnostic { ${body} }`;
const good = wrap('sensor reading: Bool; signal usable = hold_last(reading, for_at_most: 1s, quality: measured);');
const cases = [
  ['missing source', wrap('signal usable = §hold_last(for_at_most: 1s, quality: measured);'), 'hold_last requires hold_last(source, for_at_most: Duration, quality: measured)'],
  ['duplicate duration', wrap('sensor reading: Bool; signal usable = hold_last(reading, for_at_most: 1s, §for_at_most: 2s, quality: measured);'), 'duplicate hold_last argument for_at_most'],
  ['missing quality', wrap('sensor reading: Bool; signal usable = §hold_last(reading, for_at_most: 1s);'), 'hold_last requires hold_last(source, for_at_most: Duration, quality: measured)'],
  ['unknown quality', wrap('sensor reading: Bool; signal usable = hold_last(reading, for_at_most: 1s, §quality: estimated);'), 'hold_last quality must be measured'],
  ['raw source', wrap('input reading: Bool; signal usable = hold_last(§reading, for_at_most: 1s, quality: measured);'), 'hold_last source must be Result<T, SensorFault>'],
  ['wrong error enum', wrap('let reading: Result<Bool, ClockFault> = fault(ClockUnknown); signal usable = hold_last(§reading, for_at_most: 1s, quality: measured);'), 'hold_last source must be Result<T, SensorFault>'],
  ['unsourced result', wrap('let reading: Result<Bool, SensorFault> = ok(true); signal usable = §hold_last(reading, for_at_most: 1s, quality: measured);'), 'hold_last measured source requires physical sample lineage'],
  ['zero duration', wrap('sensor reading: Bool; signal usable = hold_last(reading, §for_at_most: 0s, quality: measured);'), 'hold_last for_at_most must be a positive constant Duration'],
  ['dynamic duration', wrap('sensor reading: Bool; input delay: Duration; signal usable = hold_last(reading, §for_at_most: delay, quality: measured);'), 'hold_last for_at_most must be a positive constant Duration'],
];

for (const [name, bad, message] of cases) test(`hold_last diagnostic: ${name}`, async () => {
  assert.ok((await compileSource(document(good), { filename })).bytes.length > 6);
  const marked = document(bad), at = marked.indexOf('§'), before = marked.slice(0, at);
  const line = before.split('\n').length, column = before.length - before.lastIndexOf('\n');
  await assert.rejects(() => compileSource(marked.replace('§', ''), { filename }), error => {
    assert.ok(error instanceof ControlCompileError);
    assert.equal(error.filename, filename); assert.equal(error.line, line); assert.equal(error.column, column);
    assert.equal(error.message, `${filename}:${line}:${column}: ${message}`);
    return true;
  });
});

test('hold_last diagnostic: nine single-root holds fit and ten exceed the state budget', async () => {
  const source = count => `control HoldStateBudget { sensor reading: Bool; ${Array.from({ length: count }, (_, index) =>
    `signal held_${index} = hold_last(reading, for_at_most: 1s, quality: measured);`).join(' ')} output value: Bool; value <- held_0 |> recover(false); }`;
  const valid = await compileSource(document(source(9)), { filename });
  const privateStates = valid.manifest.signals.flatMap(signal => [
    ...Object.values(signal.states), ...signal.sources.flatMap(root => Object.values(root.states)),
  ]);
  assert.equal(privateStates.length, 117); assert.equal(new Set(privateStates).size, 117);
  const marked = document(`§${source(10)}`), at = marked.indexOf('§'), before = marked.slice(0, at);
  const line = before.split('\n').length, column = before.length - before.lastIndexOf('\n');
  await assert.rejects(() => compileSource(marked.replace('§', ''), { filename }), error => {
    assert.ok(error instanceof ControlCompileError);
    assert.equal(error.filename, filename); assert.equal(error.line, line); assert.equal(error.column, column);
    assert.equal(error.message, `${filename}:${line}:${column}: state budget exceeded (128)`);
    return true;
  });
});
