import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const document = code => `# Int operating setting\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;

const intSource = document(`control IntSettings {
  config count: Int = -2 { min = -5; max = 10; step = 3; access = operator; label = "Count"; }
  output selected: Int;
  selected <- case count { ok(value) => value; fault(_) => 0; };
}`);

function position(source, marker, occurrence = 1) {
  let index = -1;
  for (let seen = 0; seen < occurrence; seen += 1) index = source.indexOf(marker, index + 1);
  assert.notEqual(index, -1, `missing marker ${marker}`);
  const lines = source.slice(0, index).split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

async function rejectsLocated({ code, marker, detail, filename }) {
  const source = document(code);
  const expected = position(source, marker);
  await assert.rejects(() => compileSource(source, { filename }), error => {
    assert.equal(error.name, 'ControlCompileError');
    assert.equal(error.filename, filename);
    assert.equal(error.line, expected.line);
    assert.equal(error.column, expected.column);
    assert.equal(error.message, `${filename}:${expected.line}:${expected.column}: ${detail}`);
    return true;
  });
}

test('Int operating config emits exact signed metadata without a speculative step type', async () => {
  const artifact = await compileSource(intSource, { filename: 'int-settings.ghost.md' });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v10');
  assert.deepEqual(artifact.manifest.configs, [{
    name: 'count',
    type: 'Int',
    id: artifact.manifest.configs[0].id,
    value: -2,
    settings: { min: -5, max: 10, step: 3, access: 'operator', label: 'Count' },
    initialOffset: artifact.manifest.configs[0].initialOffset,
    initialEndOffset: artifact.manifest.configs[0].initialEndOffset,
  }]);
  assert.equal(Number.isInteger(artifact.manifest.configs[0].settings.step), true);
  assert.equal(Object.hasOwn(artifact.manifest.configs[0].settings, 'stepType'), false);
});

test('one signed Int stream updates the same artifact and preserves the authored initial', async () => {
  const artifact = await compileSource(intSource, { filename: 'int-settings.ghost.md' });
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await ControlRuntime.instantiate(wasm, artifact,
    { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } });
  try {
    const state = runtime.contextSnapshot().state;
    const clock = monotonicMs => ({ monotonicMs, bootEpoch: 1, wallMs: monotonicMs,
      uncertaintyMs: 0, trusted: true, unknownReason: null, sourceRevision: 'int-clock-v1' });
    const facts = (monotonicMs, settings = null) => ({ clock: clock(monotonicMs), natural: [], schedules: [], settings });
    assert.equal(runtime.step({ nowMs: 0, contextFacts: facts(0) }).vm.safe.selected, -2);
    assert.equal(runtime.step({ nowMs: 1, contextFacts: facts(1, {
      programFingerprint: state.programFingerprint, eventId: 'int-max', baseRevision: 0, position: 2,
      origin: 'operatorEdit', changes: [{ configId: artifact.manifest.configs[0].id,
        result: { ok: true, type: 'Int', value: 10 } }],
    }) }).vm.safe.selected, 10);
    assert.equal(runtime.contextSnapshot().state.settingsRevision, 1);
    assert.equal(artifact.manifest.configs[0].value, -2);
  } finally { runtime.dispose(); }
});

test('signed 32-bit endpoint literals survive compilation without precision loss', async () => {
  const source = document(`control IntEndpoints {
  config count: Int = -2147483648 { min = -2147483648; max = 2147483647; step = 1; access = operator; }
  output selected: Int;
  selected <- case count { ok(value) => value; fault(_) => 0; };
}`);
  const before = await compileSource(source, { filename: 'int-endpoints.ghost.md' });
  assert.equal(before.manifest.configs[0].value, -2147483648);
  assert.equal(before.manifest.configs[0].settings.max, 2147483647);
});

test('compiler rejects invalid Int setting literals at exact authored locations', async t => {
  const cases = [
    {
      id: 'fractional initial',
      code: 'control Bad { config count: Int = 1.5 { min = 0; max = 5; step = 1; access = operator; } }',
      marker: '1.5',
      detail: 'Int literal must be a whole decimal numeral without a decimal point or exponent',
    },
    {
      id: 'initial above i32',
      code: 'control Bad { config count: Int = 2147483648 { min = 0; max = 2147483647; step = 1; access = operator; } }',
      marker: '2147483648',
      detail: 'Int literal is outside -2147483648..2147483647',
    },
    {
      id: 'fractional min',
      code: 'control Bad { config count: Int = 1 { min = 0.5; max = 5; step = 1; access = operator; } }',
      marker: 'config',
      detail: 'Int setting must use a whole decimal literal',
    },
    {
      id: 'max above i32',
      code: 'control Bad { config count: Int = 1 { min = 0; max = 2147483648; step = 1; access = operator; } }',
      marker: 'config',
      detail: 'Int setting is outside -2147483648..2147483647',
    },
    {
      id: 'zero step',
      code: 'control Bad { config count: Int = 1 { min = 0; max = 5; step = 0; access = operator; } }',
      marker: 'config',
      detail: 'numeric config requires valid min, max and positive step',
    },
    {
      id: 'negative step',
      code: 'control Bad { config count: Int = 1 { min = 0; max = 5; step = -1; access = operator; } }',
      marker: 'config',
      detail: 'numeric config requires valid min, max and positive step',
    },
    {
      id: 'exact grid mismatch',
      code: 'control Bad { config count: Int = 1 { min = 0; max = 2147483647; step = 2147483647; access = operator; } }',
      marker: '1',
      detail: 'config initial value is not aligned to settings.step from settings.min',
    },
    {
      id: 'max exact grid mismatch',
      code: 'control Bad { config count: Int = 0 { min = 0; max = 5; step = 2; access = operator; } }',
      marker: 'config',
      detail: 'Int config max is not aligned to settings.step from settings.min',
    },
  ];
  for (const item of cases) await t.test(item.id, () => rejectsLocated({
    ...item,
    filename: `int-${item.id.replaceAll(' ', '-')}.ghost.md`,
  }));
});

test('misaligned Int emission becomes SettingsInvalid while malformed Int packets are rejected', async () => {
  const artifact = await compileSource(intSource, { filename: 'int-settings.ghost.md' });
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await ControlRuntime.instantiate(wasm, artifact,
    { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } });
  try {
    const fingerprint = runtime.contextSnapshot().state.programFingerprint;
    const facts = (monotonicMs, value) => ({
      clock: { monotonicMs, bootEpoch: 1, wallMs: monotonicMs, uncertaintyMs: 0,
        trusted: true, unknownReason: null, sourceRevision: 'int-clock-v1' },
      natural: [], schedules: [], settings: value === null ? null : {
        programFingerprint: fingerprint, eventId: `int-${monotonicMs}`, baseRevision: 0,
        position: monotonicMs + 1, origin: 'operatorEdit', changes: [{ configId: artifact.manifest.configs[0].id,
          result: { ok: true, type: 'Int', value } }],
      },
    });
    runtime.step({ nowMs: 0, contextFacts: facts(0, null) });
    for (const value of [1.5, -2147483649, 2147483648, Number.POSITIVE_INFINITY, '1']) {
      assert.throws(() => runtime.step({ nowMs: 1, contextFacts: facts(1, value) }), /settings|Int|integer|i32/i);
      assert.equal(runtime.contextSnapshot().state.settingsRevision, 0);
    }
    const row = runtime.step({ nowMs: 1, contextFacts: facts(1, 0) });
    assert.equal(row.vm.safe.selected, 0);
    assert.deepEqual(runtime.contextSnapshot().state.settings[0].result,
      { ok: false, fault: 'SettingsInvalid' });
  } finally { runtime.dispose(); }
});

test('REF-05-108 succeeds through ghostc check and build', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-int-setting-'));
  try {
    const input = path.join(directory, 'config-int-valid.ghost.md');
    const output = path.join(directory, 'config-int-valid.gfb');
    fs.writeFileSync(input, document(`control IntSettings {
  config count: Int = 1 { min = 0; max = 5; step = 1; access = operator; }
}`));
    const checked = spawnSync(process.execPath, ['tools/ghostc.mjs', '--check', input], { cwd: root, encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(fs.existsSync(output), false);
    const built = spawnSync(process.execPath, ['tools/ghostc.mjs', input, output], { cwd: root, encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    assert.ok(fs.statSync(output).size > 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
