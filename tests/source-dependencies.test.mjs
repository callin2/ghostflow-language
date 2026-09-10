import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { observeSourceTrace } from '../tools/source-trace.mjs';
import { compileSource } from '../tools/toolchain.mjs';

function dependencyEntries(compilation) {
  return compilation.traceMetadata.dependencies.map(({ target, reads }) => ({ target, reads }));
}

function dependenciesFor(compilation, field, name) {
  const match = compilation.traceMetadata.dependencies.find(entry => entry.target.field === field && entry.target.name === name);
  assert.ok(match, `missing dependency target ${field}.${name}`);
  return new Set(match.reads.map(read => `${read.field}.${read.name}`));
}

function assertDependencyShape(compilation) {
  for (const dependency of compilation.traceMetadata.dependencies) {
    assert.deepEqual(Object.keys(dependency).sort(), ['reads', 'target']);
    assert.deepEqual(Object.keys(dependency.target).sort(), ['field', 'name']);
    assert.ok(['stateAfter', 'requested'].includes(dependency.target.field));
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
  running' = DI1 && DI2 && running;
  output RO1: Bool;
  RO1 <- running';
}`;

test('self-hold dependencies map next state and requested intent to lowered fields', async () => {
  const compiled = await compileSource(selfHold, { filename: 'self-hold.ghost' });
  // Stable predecessor pin 2c875407: dependency metadata must not alter this GFB.
  assert.equal(createHash('sha256').update(compiled.bytes).digest('hex'), 'ffb94d0ee7e78cd0a012b986cecfe7cfdab57d3d9d51365b51a0c6d0f9b5a591');
  assertDependencyShape(compiled);
  assert.deepEqual(dependenciesFor(compiled, 'requested', 'RO1'), new Set(['stateAfter.running']));
  assert.deepEqual(dependenciesFor(compiled, 'stateAfter', 'running'), new Set([
    'inputs.DI1', 'inputs.DI2', 'stateBefore.running',
  ]));
});

test('static branches and expanded function/let dependencies include every lowered read', async () => {
  const branch = await compileSource(`control Branches {
    input DI1, DI2, DI3: Bool;
    output RO1: Bool;
    RO1 <- if DI1 then DI2 else DI3;
  }`, { filename: 'branches.ghost' });
  assert.deepEqual(dependenciesFor(branch, 'requested', 'RO1'), new Set(['inputs.DI1', 'inputs.DI2', 'inputs.DI3']));

  const expanded = await compileSource(`fn both(left: Bool, right: Bool) -> Bool { left && right }
control Expanded {
  input DI1, DI2: Bool;
  let permit = DI2;
  output RO1: Bool;
  RO1 <- both(DI1, permit);
}`, { filename: 'expanded.ghost' });
  assert.deepEqual(dependenciesFor(expanded, 'requested', 'RO1'), new Set(['inputs.DI1', 'inputs.DI2']));
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
  };
  const observed = observeSourceTrace(compiled.traceMetadata, trace);
  assert.deepEqual(observed.dependencies, compiled.traceMetadata.dependencies);
});
