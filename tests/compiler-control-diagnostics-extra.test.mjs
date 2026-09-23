import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlCompileError } from '../tools/control.mjs';

const filename = 'control-diagnostic-extra.ghost.md';
const document = code => `# Additional control diagnostics\n\nThe prose is preserved.\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;

async function expectLocatedFailure(name, bad, good, message, inspectValid = () => {}) {
  await test(name, async () => {
    const valid = await compileSource(document(good), { filename });
    assert.ok(valid.bytes.length > 6, 'the adjacent valid document must compile');
    inspectValid(valid);

    assert.equal(bad.split('§').length, 2, 'the rejected source has one location marker');
    const marked = document(bad);
    const at = marked.indexOf('§');
    const before = marked.slice(0, at);
    const line = before.split('\n').length;
    const column = before.length - before.lastIndexOf('\n');
    await assert.rejects(() => compileSource(marked.replace('§', ''), { filename }), error => {
      assert.ok(error instanceof ControlCompileError);
      assert.equal(error.filename, filename);
      assert.equal(error.line, line);
      assert.equal(error.column, column);
      assert.equal(error.message, `${filename}:${line}:${column}: ${message}`);
      return true;
    });
  });
}

await expectLocatedFailure(
  'Result debounce reports its unsupported numeric payload at the source expression',
  'control ResultPayload { sensor level: Number; signal stable = debounce(§level, stable_for: 1s, initial: 0.0); }',
  'control ResultPayload { sensor level: Bool; signal stable = debounce(level, stable_for: 1s, initial: false); }',
  'debounce source must be Bool or a named finite enum',
);

await expectLocatedFailure(
  'finite enum debounce reports a nominally different constant initial value',
  'control EnumInitial { type Mode = Off | On; type Other = Low | High; state mode: Mode = Off; signal stable = debounce(mode, stable_for: 1s, §initial: Low); }',
  'control EnumInitial { type Mode = Off | On; state mode: Mode = Off; signal stable = debounce(mode, stable_for: 1s, initial: Off); }',
  'debounce initial must be a constant Mode',
);

const physicalStateBudget = count => `control PhysicalStateBudget {
  sensor request: Bool { stale_after = 10s; }
  ${Array.from({ length: count }, (_, index) => `signal stable_${index} = debounce(request, stable_for: 1s, initial: false);`).join('\n  ')}
  output stable: Bool;
  stable <- stable_0 |> recover(false);
}`;

await expectLocatedFailure(
  'physical debounce generated histories count toward the state budget',
  `§${physicalStateBudget(19)}`,
  physicalStateBudget(18),
  'state budget exceeded (128)',
  valid => {
    const names = valid.manifest.signals.flatMap(signal => [
      ...Object.values(signal.states),
      ...signal.sources.flatMap(source => Object.values(source.states)),
    ]);
    assert.equal(names.length, 126);
    assert.equal(new Set(names).size, 126, 'all generated state names are distinct');
  },
);

const sampleInputBudget = count => `control SampleInputBudget {
  input ${Array.from({ length: count }, (_, index) => `pad_${index}`).join(', ')}: Bool;
  sensor request: Bool { stale_after = 10s; }
  signal stable_request = debounce(request, stable_for: 1s, initial: false);
  output stable: Bool;
  stable <- stable_request |> recover(false);
}`;

await expectLocatedFailure(
  'allocated physical sample identity fields count toward the input budget',
  `§${sampleInputBudget(121)}`,
  sampleInputBudget(120),
  'input budget exceeded (128)',
  valid => {
    const sensor = valid.manifest.sensors[0];
    const signal = valid.manifest.signals[0];
    const names = [
      ...valid.manifest.inputs.map(input => input.name),
      sensor.valueInput, sensor.okInput, sensor.faultInput,
      sensor.samplePresentInput, sensor.sampleEpochInput, sensor.sampleIdInput, sensor.sampleTimestampInput,
      signal.clockInput,
    ];
    assert.equal(names.length, 128);
    assert.equal(new Set(names).size, 128, 'all authored and generated input names are distinct');
  },
);
