import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';

const compile = code => compileSource(`# Hold last compiler\n\n\`\`\`ghost\n${code}\n\`\`\`\n`, { filename: 'hold-last-control.ghost.md' });

test('hold_last emits a bounded typed descriptor and exact private state contract', async () => {
  const artifact = await compile(`control HoldTemperature {
    input temperature: Temperature;
    signal usable = hold_last(temperature, for_at_most: 2min, quality: measured);
    output ready: Bool;
    ready <- true;
  }`);
  const sensor = artifact.manifest.sensors[0];
  const tag = artifact.sourceMap.find(node => node.kind === 'sensor').id;
  assert.deepEqual(artifact.manifest.signals, [{
    kind: 'hold-last', name: 'usable', payloadType: 'Temperature', errorType: 'SensorFault',
    quality: 'measured', forAtMostMs: 120000, clockInput: '__gf_now_ms', sourceMode: 'sample',
    sources: [{ name: 'temperature', tag, states: {
      lastEpoch: `__gf_hold_last_source_epoch_usable_${tag}`,
      lastId: `__gf_hold_last_source_id_usable_${tag}`,
    } }],
    states: {
      available: '__gf_hold_last_available_usable', value: '__gf_hold_last_value_usable',
      heldSourceTag: '__gf_hold_last_held_source_tag_usable', heldEpoch: '__gf_hold_last_held_epoch_usable',
      heldId: '__gf_hold_last_held_id_usable', heldTimestamp: '__gf_hold_last_held_timestamp_usable',
      held: '__gf_hold_last_held_usable', age: '__gf_hold_last_age_usable',
      maskedFaultPresent: '__gf_hold_last_masked_fault_present_usable',
      maskedFaultCode: '__gf_hold_last_masked_fault_code_usable',
      maskedFaultOrigin: '__gf_hold_last_masked_fault_origin_usable',
    },
  }]);
  assert.deepEqual({
    present: sensor.samplePresentInput, epoch: sensor.sampleEpochInput,
    id: sensor.sampleIdInput, timestamp: sensor.sampleTimestampInput,
  }, {
    present: '__gf_sensor_sample_present_temperature', epoch: '__gf_sensor_sample_epoch_temperature',
    id: '__gf_sensor_sample_id_temperature', timestamp: '__gf_sensor_sample_timestamp_temperature',
  });
});

test('hold_last supports finite payloads and preserves physical lineage through a pointwise map', async () => {
  const artifact = await compile(`control HeldMode {
    type Mode = Off | On;
    fn mode(value: Bool) -> Mode { if value then On else Off }
    input request: Bool;
    signal usable = hold_last(request |> map(mode), for_at_most: 1s, quality: measured);
    output on: Bool;
    on <- case usable { ok(value) => value == On; fault(_) => false; };
  }`);
  assert.equal(artifact.manifest.signals[0].payloadType, 'Mode');
  assert.deepEqual(artifact.manifest.signals[0].members, ['Off', 'On']);
  assert.equal(artifact.manifest.signals[0].sources[0].name, 'request');
});
