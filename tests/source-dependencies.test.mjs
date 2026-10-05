import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { observeSourceTrace } from '../tools/source-trace.mjs';
import { compileSource } from './helpers/literate-compile.mjs';

function dependencyEntries(compilation) {
  return compilation.traceMetadata.dependencies.map(({ target, reads }) => ({ target, reads }));
}

test('issue 531 trace and composition historical sources retain exact pre-input revision identities', () => {
  const bytes = fs.readFileSync(new URL('./fixtures/history/trace-contract-before-input-531.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '0d5d8fa567f23a4d4eeac4c2ee631cc9b4c2e34acce83e4a8de5a465b54a8eca');
  const archive = JSON.parse(bytes);
  assert.equal(archive.revision, 'c8a5d37ac09230a9011291a3ae3b053d1bc22773');
  assert.equal(archive.files.length, 17);
  for (const file of archive.files) {
    const source = gunzipSync(Buffer.from(file.gzipBase64, 'base64'));
    assert.equal(createHash('sha256').update(source).digest('hex'), file.sha256, file.path);
  }
  const historicalDependencies = gunzipSync(Buffer.from(archive.files.find(file => file.path === 'tests/source-dependencies.test.mjs').gzipBase64, 'base64')).toString('utf8');
  assert.ok(historicalDependencies.includes('273976e0bcc83bad8401b679026403c5ff236478eff6e9562e2b9940c8e6af39'), 'historical GFB3 digest is independent of the new typed-quality revision');
});

function dependenciesFor(compilation, field, name) {
  const match = compilation.traceMetadata.dependencies.find(entry => entry.target.field === field && entry.target.name === name);
  assert.ok(match, `missing dependency target ${field}.${name}`);
  return new Set(match.reads.map(read => `${read.field}.${read.name}`));
}

function assertDependencyShape(compilation) {
  for (const dependency of compilation.traceMetadata.dependencies) {
    assert.deepEqual(Object.keys(dependency).sort(), ['reads', 'target']);
    assert.deepEqual(Object.keys(dependency.target).sort(), ['field', 'name']);
    assert.ok(['stateAfter', 'requested', 'timerValue'].includes(dependency.target.field));
    assert.match(dependency.target.name, /^[A-Za-z_][A-Za-z0-9_]*$/);
    for (const read of dependency.reads) {
      assert.deepEqual(Object.keys(read).sort(), ['field', 'name']);
      assert.ok(['inputs', 'stateBefore', 'stateAfter'].includes(read.field));
      assert.match(read.name, /^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  }
}

const selfHold = `control SelfHold {
  input DI1, DI2: Bool;
  state running: Bool = false;
  running' = (DI1 |> recover(false)) && (DI2 |> recover(false)) && running;
  output RO1: Bool;
  RO1 <- running';
}`;

test('self-hold dependencies map next state and requested intent to lowered fields', async () => {
  const compiled = await compileSource(selfHold, { filename: 'self-hold.ghost' });
  // This explicit input revision has typed-quality rails; the historical GFB3
  // identity is pinned independently below, never refreshed to these new bytes.
  assert.equal(createHash('sha256').update(compiled.bytes).digest('hex'), '2228c16de8ecae1b7a192e338441c9ff3db22bde530b0d456d61249ec683c435');
  assertDependencyShape(compiled);
  assert.deepEqual(dependenciesFor(compiled, 'requested', 'RO1'), new Set(['stateAfter.running']));
  assert.deepEqual(dependenciesFor(compiled, 'stateAfter', 'running'), new Set([
    'inputs.__gf_sensor_ok_DI1', 'inputs.__gf_sensor_value_DI1', 'inputs.__gf_sensor_fault_DI1', 'inputs.__gf_sensor_ok_DI2', 'inputs.__gf_sensor_value_DI2', 'inputs.__gf_sensor_fault_DI2', 'stateBefore.running',
  ]));
});

test('static branches and expanded function/let dependencies include every lowered read', async () => {
  const branch = await compileSource(`control Branches {
    input DI1, DI2, DI3: Bool;
    output RO1: Bool;
    RO1 <- if (DI1 |> recover(false)) then (DI2 |> recover(false)) else (DI3 |> recover(false));
  }`, { filename: 'branches.ghost' });
  assert.deepEqual(dependenciesFor(branch, 'requested', 'RO1'), new Set(['inputs.__gf_sensor_ok_DI1', 'inputs.__gf_sensor_value_DI1', 'inputs.__gf_sensor_fault_DI1', 'inputs.__gf_sensor_ok_DI2', 'inputs.__gf_sensor_value_DI2', 'inputs.__gf_sensor_fault_DI2', 'inputs.__gf_sensor_ok_DI3', 'inputs.__gf_sensor_value_DI3', 'inputs.__gf_sensor_fault_DI3']));

  const expanded = await compileSource(`fn both(left: Bool, right: Bool) -> Bool { left && right }
control Expanded {
  input DI1, DI2: Bool;
  let permit = DI2 |> recover(false);
  output RO1: Bool;
  RO1 <- both((DI1 |> recover(false)), permit);
}`, { filename: 'expanded.ghost' });
  assert.deepEqual(dependenciesFor(expanded, 'requested', 'RO1'), new Set(['inputs.__gf_sensor_ok_DI1', 'inputs.__gf_sensor_value_DI1', 'inputs.__gf_sensor_fault_DI1', 'inputs.__gf_sensor_ok_DI2', 'inputs.__gf_sensor_value_DI2', 'inputs.__gf_sensor_fault_DI2']));
});

test('implicit state hold and generated timer dependencies remain explicit without fake source mappings', async () => {
  const held = await compileSource(`control ImplicitHold {
    state running: Bool = false;
    output RO1: Bool;
    RO1 <- running;
  }`, { filename: 'implicit-hold.ghost' });
  assert.deepEqual(dependenciesFor(held, 'stateAfter', 'running'), new Set(['stateBefore.running']));
  assert.deepEqual(dependenciesFor(held, 'requested', 'RO1'), new Set(['stateBefore.running']));

  const timed = await compileSource(`control GeneratedTimer {
    input DI1: Bool;
    state running: Bool = false;
    timer age = elapsed(running);
    output RO1: Bool;
    RO1 <- running;
  }`, { filename: 'generated-timer.ghost' });
  assertDependencyShape(timed);
  const timer = timed.manifest.timers.find(entry => entry.name === 'age');
  assert.ok(timer, 'official timer manifest entry exists');
  const generatedSince = `__gf_timer_since_${timer.name}`;
  const generatedInitialized = `__gf_timer_initialized_${timer.name}`;
  assert.deepEqual(dependenciesFor(timed, 'requested', 'RO1'), new Set(['stateBefore.running']));
  assert.deepEqual(dependenciesFor(timed, 'stateAfter', generatedSince), new Set([
    'inputs.__gf_now_ms', `stateBefore.${generatedInitialized}`,
    `stateBefore.${generatedSince}`, 'stateBefore.running',
  ]));
  assert.deepEqual(dependenciesFor(timed, 'stateAfter', generatedInitialized), new Set());
  assert.deepEqual(dependenciesFor(timed, 'timerValue', timer.name), new Set([
    'inputs.__gf_now_ms', `stateBefore.${generatedInitialized}`, `stateBefore.${generatedSince}`,
  ]));
  assert.ok(timed.traceMetadata.dependencies.every(entry => !('source' in entry) && !('source' in entry.target)));
});

test('literate remap and observation retain static dependency metadata', async () => {
  const markdown = ['# Source dependencies', '', '```ghost', selfHold, '```', ''].join('\n');
  const compiled = await compileSource(markdown, { filename: 'dependencies.ghost.md' });
  const direct = await compileSource(selfHold, { filename: 'dependencies.ghost' });
  assert.deepEqual(dependencyEntries(compiled), dependencyEntries(direct));
  assert.ok(compiled.traceMetadata.bindings.every(entry => entry.source.filename === 'dependencies.ghost.md'));

  const trace = {
    module: compiled.traceMetadata.moduleFingerprint,
    inputs: {}, stateBefore: {}, stateAfter: {}, requested: {}, safe: {},
    safetyTrace: { format: 'GhostFlow/safety-trace-v1', constraints: [] },
    resultTrace: [],
  };
  const observed = observeSourceTrace(compiled.traceMetadata, trace);
  assert.deepEqual(observed.dependencies, compiled.traceMetadata.dependencies);
});
