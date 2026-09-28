import assert from 'node:assert/strict';
import test from 'node:test';
import { validateScenario } from '../tools/ghostsim.mjs';

const manifest = { inputs: [{ name: 'level', type: 'Percent' }], signals: [], schedules: [] };
function scenario(initialValue, actions = []) {
  return {
    format: 'GhostFlow/scenario-v1', id: 'percent-input',
    initialInputs: [{ name: 'level', type: 'Percent', value: initialValue }],
    keyBindings: [], actions: [...actions, { kind: 'scan', atMs: 0 }],
  };
}

test('accepts finite Percent initial inputs and input actions in the inclusive 0..100 range', () => {
  for (const value of [0, 100, 0.25, 33.5]) {
    assert.doesNotThrow(() => validateScenario(scenario(value), manifest), `initial ${value}`);
    assert.doesNotThrow(() => validateScenario(scenario(50, [{ kind: 'input', name: 'level', type: 'Percent', value }]), manifest), `action ${value}`);
  }
});

test('rejects invalid Percent values for initial inputs and actions', () => {
  for (const value of [-0.01, 100.01, NaN, Infinity, -Infinity, '50']) {
    assert.throws(() => validateScenario(scenario(value), manifest), /invalid Percent value/, `initial ${String(value)}`);
    assert.throws(() => validateScenario(scenario(50, [{ kind: 'input', name: 'level', type: 'Percent', value }]), manifest), /invalid Percent value/, `action ${String(value)}`);
  }
});

test('preserves existing Bool, Int and Number validation and manifest type mismatch checks', () => {
  for (const [type, value] of [['Bool', true], ['Int', -4], ['Number', 1.5]]) {
    const typedManifest = { inputs: [{ name: 'level', type }], signals: [], schedules: [] };
    const typedScenario = scenario(value);
    typedScenario.initialInputs[0].type = type;
    assert.doesNotThrow(() => validateScenario(typedScenario, typedManifest), type);
  }
  const mismatch = scenario(50);
  mismatch.initialInputs[0].type = 'Number';
  assert.throws(() => validateScenario(mismatch, { inputs: [{ name: 'level', type: 'Percent' }], signals: [], schedules: [] }), /type mismatch level/);
});
