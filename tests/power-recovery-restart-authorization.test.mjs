import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { compileSource } from './helpers/literate-compile.mjs';

const wasm = fs.readFileSync(new URL(
  '../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm',
  import.meta.url,
));

// Contract under test:
// - a reboot creates a new run and resets its monotonic time to zero;
// - `planned_range_active` is a trusted schedule projection, not a wall-clock
//   reading performed by this output gate;
// - only outputs explicitly placed under recovery management by the installation
//   profile require a policy; hazard is never inferred from an output name;
// - `vm.safe` remains core evidence and `effective` is the recovery-gated intent
//   that a physical Driver may attempt to apply.
const source = `control PowerRecoveryOutputs {
  // The schedule layer has already evaluated the trusted 15:00-15:30 Range.
  input planned_range_active, fresh_authorized_start: Bool;
  output irrigation, cutter: Bool;
  irrigation <- planned_range_active;
  cutter <- planned_range_active;
}`;

async function compile() {
  return compileSource(source, { filename: 'power-recovery-outputs.ghost' });
}

test('power recovery resumes explicitly permitted irrigation only for the remaining 15:20-15:30 Range', async t => {
  const artifact = await compile();

  const beforeOutage = await ControlRuntime.instantiateFramed(wasm, artifact);
  t.after(() => beforeOutage.dispose());
  assert.equal(beforeOutage.step({
    // 15:10, before the outage.
    nowMs: 0,
    inputs: { planned_range_active: true, fresh_authorized_start: false },
  }).vm.safe.irrigation, true);

  const recovered = await ControlRuntime.instantiateFramed(wasm, artifact, {
    outputRecovery: {
      cause: { source: 'host-declared', value: 'power-restored' },
      bindings: {
        irrigation: { policy: 'resume-while-requested' },
        cutter: {
          hazard: 'unexpected-motion',
          policy: 'require-new-run-start-edge',
          authorizationInput: 'fresh_authorized_start',
        },
      },
    },
  });
  t.after(() => recovered.dispose());

  const at1520 = recovered.step({
    nowMs: 0,
    inputs: { planned_range_active: true, fresh_authorized_start: false },
  });
  assert.equal(at1520.effective?.irrigation, true,
    'an explicitly resumable output must receive an effective intent while the restored Range remains active');
  assert.equal(at1520.effective?.cutter, false,
    'the same active Range must not restart a cutter whose installation binding requires a fresh start edge');
  assert.deepEqual(at1520.recoveryTrace?.irrigation, {
    cause: { source: 'host-declared', value: 'power-restored' },
    policy: 'resume-while-requested', authorized: true,
  });

  const at1530 = recovered.step({
    nowMs: 10 * 60_000,
    inputs: { planned_range_active: false, fresh_authorized_start: false },
  });
  assert.equal(at1530.effective?.irrigation, false,
    'recovery authorization must not extend the planned Range beyond 15:30');
});

test('power recovery inhibits a hazardous cutter until a fresh authorized start in the new run', async t => {
  const artifact = await compile();
  const recovered = await ControlRuntime.instantiateFramed(wasm, artifact, {
    outputRecovery: {
      cause: { source: 'host-declared', value: 'power-restored' },
      bindings: { cutter: { policy: 'require-new-run-start-edge', authorizationInput: 'fresh_authorized_start' } },
    },
  });
  t.after(() => recovered.dispose());

  const beforeFreshStart = recovered.step({
    // 15:20: the planned Range is active, but this new run has no start authorization.
    nowMs: 0,
    inputs: { planned_range_active: true, fresh_authorized_start: true },
  });
  assert.equal(beforeFreshStart.vm.safe.cutter, true,
    'the core request remains observable separately from the recovery gate');
  assert.equal(beforeFreshStart.effective?.cutter, false,
    'a true input already present on the first post-reboot scan is stale and must not authorize hazardous motion');

  const releasedStart = recovered.step({
    nowMs: 1,
    inputs: { planned_range_active: true, fresh_authorized_start: false },
  });
  assert.equal(releasedStart.effective?.cutter, false,
    'releasing the stale start establishes a new-run baseline but does not authorize motion');

  const afterFreshStart = recovered.step({
    nowMs: 2,
    inputs: { planned_range_active: true, fresh_authorized_start: true },
  });
  assert.equal(afterFreshStart.effective?.cutter, true,
    'a false-to-true authorized start edge in the new run may release the inhibited output');
  assert.deepEqual(afterFreshStart.recoveryTrace?.cutter, {
    cause: { source: 'host-declared', value: 'power-restored' },
    policy: 'require-new-run-start-edge', authorized: true,
  });

  const afterStartPulse = recovered.step({
    nowMs: 3,
    inputs: { planned_range_active: true, fresh_authorized_start: false },
  });
  assert.equal(afterStartPulse.effective?.cutter, true,
    'fresh start authorization must remain valid for the new run after the input pulse ends');
});

test('power recovery fails closed when an explicitly recovery-managed hazardous output lacks a restart policy', async () => {
  const artifact = await compile();

  await assert.rejects(
    ControlRuntime.instantiateFramed(wasm, artifact, {
      outputRecovery: {
        cause: { source: 'host-declared', value: 'power-restored' },
        bindings: { cutter: { hazard: 'unexpected-motion' } },
      },
    }),
    /restart policy is required for recovery-managed output cutter/,
  );
});
