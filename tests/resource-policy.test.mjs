import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileControl, typeCheckControl } from '../tools/control.mjs';

const sharedPump = `resource pump1: BoolActuator;
resource_policy shared_pump for pump1 {
  lease = session;
  concurrency = 1;
  admission = reserve_all;
  queue = fifo(max: 8, expires_after: 10min, tie: request_id);
  preempt = never;
}`;

test('shared resource policy retains bounded arbitration choices in the checked manifest', () => {
  assert.deepEqual(typeCheckControl(sharedPump).manifest, {
    format: 'GhostFlow/resource-policy-v1',
    resources: [{ name: 'pump1', type: 'BoolActuator' }],
    constraints: [],
    resourcePolicies: [{
      name: 'shared_pump',
      target: 'pump1',
      lease: 'session',
      concurrency: 1,
      admission: 'reserve_all',
      queue: { kind: 'fifo', max: 8, expiresAfterMs: 600_000, tie: 'request_id' },
      preempt: 'never',
    }],
  });
});

test('shared resource policy execution remains fail closed without queue runtime binding', () => {
  assert.throws(() => compileControl(sharedPump), /resource policy execution requires bounded queue and resource runtime binding/);
});

test('shared resource policy requires every explicit field exactly once', () => {
  assert.throws(() => typeCheckControl(sharedPump.replace('  preempt = never;\n', '')), /missing resource policy field preempt/);
  assert.throws(() => typeCheckControl(sharedPump.replace('  lease = session;\n', '  lease = session;\n  lease = session;\n')), /duplicate resource policy field lease/);
});

test('shared resource policy rejects unsupported concurrency queue and preemption choices', () => {
  assert.throws(() => typeCheckControl(sharedPump.replace('concurrency = 1', 'concurrency = 0')), /concurrency must be a positive static Int/);
  assert.throws(() => typeCheckControl(sharedPump.replace('max: 8', 'max: 0')), /queue max must be a positive static Int/);
  assert.throws(() => typeCheckControl(sharedPump.replace('expires_after: 10min', 'expires_after: 0s')), /queue expiry must be a positive Duration/);
  assert.throws(() => typeCheckControl(sharedPump.replace('tie: request_id', 'tie: arrival')), /queue tie must be request_id/);
  assert.throws(() => typeCheckControl(sharedPump.replace('preempt = never', 'preempt = always')), /preempt must be never or higher_authority/);
});

test('explicit reject queue and higher-authority preemption retain cleanup and resume policy', () => {
  const source = sharedPump
    .replace('fifo(max: 8, expires_after: 10min, tie: request_id)', 'reject')
    .replace('never', 'higher_authority(cleanup: required, resume: requeue)');
  const policy = typeCheckControl(source).manifest.resourcePolicies[0];
  assert.deepEqual({ queue: policy.queue, preempt: policy.preempt }, {
    queue: { kind: 'reject' },
    preempt: { kind: 'higher_authority', cleanup: 'required', resume: 'requeue' },
  });
});

test('shared resource policy requires a declared actuator target', () => {
  assert.throws(() => typeCheckControl(sharedPump.replace('for pump1', 'for missing')), /unknown resource missing/);
  assert.throws(() => typeCheckControl(sharedPump.replace('BoolActuator', 'Station')), /resource policy target pump1 must be a BoolActuator/);
});
