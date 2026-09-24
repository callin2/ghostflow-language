import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { interactionSchemaSha256, validateInteraction } from '../contracts/interaction-v0/validate.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { emitCompletedScanSnapshot } from '../tools/interaction-runtime-snapshot.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));

function sourceFor({ value = 1, min = -2147483648, max = 2147483647, step = 1 } = {}) {
  return `# Int operating setting

<!-- ghostflow:anchor id=GF-INT-SETTINGS kind=intent status=confirmed origin=user -->
Expose the authored Int operating range.

\`\`\`ghost
control IntSettings {
  // ghostflow:link id=GF-INT-SETTINGS relation=implements
  config count: Int = ${value} { min = ${min}; max = ${max}; step = ${step}; access = operator; label = "Count"; }
  output result: Int;
  result <- case count { ok(value) => value; fault(_) => 0; };
}
\`\`\`
`;
}

async function compile(settings = {}) {
  const suffix = String(settings.value ?? 1).replace('-', 'negative-');
  return compileSource(sourceFor(settings), {
    filename: `int-settings-${suffix}.ghost.md`,
    interactionSourceIdentity: {
      documentId: `source.int-settings.${suffix}`,
      revisionId: `revision.int-settings.${suffix}.v1`,
    },
  });
}

async function run(artifact) {
  const runtime = await ControlRuntime.instantiate(wasm, artifact,
    { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } });
  try {
    const completion = runtime.step({ nowMs: 0, contextFacts: {
      clock: { monotonicMs: 0, bootEpoch: 1, wallMs: 0, uncertaintyMs: 0,
        trusted: true, unknownReason: null, sourceRevision: 'int-settings-clock-v1' },
      natural: [], schedules: [], settings: null,
    } });
    return { ...completion, settingsState: runtime.contextSnapshot().state };
  }
  finally { runtime.dispose(); }
}

async function snapshot(artifact, runId = 'int-settings') {
  const completion = await run(artifact);
  return emitCompletedScanSnapshot({
    compilation: artifact,
    runId,
    completion: { kind: 'completed-scan', scanId: 0, logicalTimeMs: 0 },
    trace: completion.vm, settingsState: completion.settingsState,
  });
}

function expectIssue(result, expected) {
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.path === expected.path
    && error.code === expected.code
    && error.message === expected.message), JSON.stringify(result.errors));
}

test('Int setting emits signed range and builtin Int interaction descriptor', async () => {
  const artifact = await compile();
  assert.deepEqual(artifact.manifest.configs[0].settings, {
    min: -2147483648, max: 2147483647, step: 1, access: 'operator', label: 'Count',
  });
  assert.deepEqual(artifact.interactionSchema.descriptors[0].sourceType, { kind: 'builtin', name: 'Int', unit: null });
  assert.deepEqual(artifact.interactionSchema.descriptors[0].constraint, { kind: 'range', min: -2147483648, max: 2147483647, step: 1 });
});

test('actual compiled Int extrema execute in Rust WASM and produce valid setting snapshots', async () => {
  for (const value of [-2147483648, 2147483647]) {
    const artifact = await compile({ value });
    const completion = await run(artifact);
    assert.equal(completion.vm.safe.result, value);
    const observed = await snapshot(artifact, `int-extreme-${value}`);
    assert.deepEqual(observed.observations, [{ descriptorId: 'setting.count', status: 'ready', value }]);
    assert.equal(validateInteraction(artifact.interactionSchema, observed).valid, true);
  }
});

test('snapshot rejects fractional and out-of-i32 Int values at the value-type boundary', async t => {
  const artifact = await compile();
  const valid = await snapshot(artifact, 'int-snapshot-type');
  for (const [name, value] of [['fractional', 1.5], ['below i32', -2147483649], ['above i32', 2147483648]]) {
    await t.test(name, () => {
      const candidate = structuredClone(valid);
      candidate.observations[0].value = value;
      expectIssue(validateInteraction(artifact.interactionSchema, candidate), {
        path: 'snapshot.observations[0].value', code: 'value_type',
        message: 'must be a signed i32 Int from source semantics',
      });
    });
  }
});

test('snapshot uses exact Int modulo and does not accept a floating tolerance near the grid', async () => {
  const artifact = await compile({ value: 0, min: 0, max: 2147483647, step: 2147483647 });
  const valid = await snapshot(artifact, 'int-snapshot-grid');
  const candidate = structuredClone(valid);
  candidate.observations[0].value = 1;
  expectIssue(validateInteraction(artifact.interactionSchema, candidate), {
    path: 'snapshot.observations[0].value', code: 'setting_value',
    message: 'must satisfy the authored range and step',
  });
});

test('Int interaction constraints reject malformed integer and grid metadata', async t => {
  const artifact = await compile();
  const baseSnapshot = await snapshot(artifact, 'int-schema');
  const cases = [
    ['fractional min', c => { c.min = 0.5; }, 'min', 'must be a signed i32 Int'],
    ['underflow min', c => { c.min = -2147483649; }, 'min', 'must be a signed i32 Int'],
    ['fractional max', c => { c.max = 1.5; }, 'max', 'must be a signed i32 Int'],
    ['overflow max', c => { c.max = 2147483648; }, 'max', 'must be a signed i32 Int'],
    ['fractional step', c => { c.step = 0.5; }, 'step', 'must be a positive signed i32 Int'],
    ['zero step', c => { c.step = 0; }, 'step', 'must be a positive signed i32 Int'],
    ['off-grid max', c => { c.min = 0; c.max = 5; c.step = 2; }, 'max', 'must align to step from min'],
  ];
  for (const [name, mutate, field, message] of cases) await t.test(name, () => {
    const schema = structuredClone(artifact.interactionSchema);
    mutate(schema.descriptors[0].constraint);
    const candidate = structuredClone(baseSnapshot);
    candidate.schema.sha256 = interactionSchemaSha256(schema);
    expectIssue(validateInteraction(schema, candidate), {
      path: `schema.descriptors[0].constraint.${field}`, code: 'setting_constraint', message,
    });
  });
});

test('runtime reports the precise malformed Int setting field before instantiation', async t => {
  const artifact = await compile();
  const cases = [
    ['fractional min', m => { m.configs[0].settings.min = 0.5; }, 'config count.settings.min must be a safe integer in [-2147483648, 2147483647]'],
    ['overflow max', m => { m.configs[0].settings.max = 2147483648; }, 'config count.settings.max must be a safe integer in [-2147483648, 2147483647]'],
    ['fractional step', m => { m.configs[0].settings.step = 0.5; }, 'config count.settings.step must be a safe integer in [-2147483648, 2147483647]'],
    ['zero step', m => { m.configs[0].settings.step = 0; }, 'config count.settings.step must be positive'],
    ['unexpected step type', m => { m.configs[0].settings.stepType = 'Int'; }, 'config count.settings.stepType is forbidden for Int'],
  ];
  for (const [name, mutate, message] of cases) await t.test(name, async () => {
    const manifest = structuredClone(artifact.manifest);
    mutate(manifest);
    await assert.rejects(() => ControlRuntime.instantiate(wasm, { ...artifact, manifest }),
      error => error instanceof Error && error.message === message);
  });

  await t.test('off-grid max', async () => {
    const gridArtifact = await compile({ value: 0, min: 0, max: 6, step: 2 });
    const manifest = structuredClone(gridArtifact.manifest);
    manifest.configs[0].settings.max = 5;
    await assert.rejects(() => ControlRuntime.instantiate(wasm, { ...gridArtifact, manifest }),
      error => error instanceof Error && error.message === 'config count.settings.max is not aligned to settings.step from settings.min');
  });
});
