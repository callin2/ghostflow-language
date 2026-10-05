import test from 'node:test';
import assert from 'node:assert/strict';
import { compileControl } from '../tools/control.mjs';

const lifecycle = `control RestartControl {
  type RestartReason = PowerOn | Brownout | Watchdog | Software | Unknown;
  input restart_reason: RestartReason;
  input restart_event: Bool;
  output recover: Bool;
  recover <- restart_event;
}`;

test('reserved restart declarations emit checked lifecycle metadata and GFB descriptor', () => {
  const result = compileControl(lifecycle);
  assert.deepEqual(result.manifest.lifecycle, {
    format: 'GhostFlow/lifecycle-v1',
    restartReasonInput: 'restart_reason',
    restartReasonMembers: [
      { name: 'PowerOn', value: 0 }, { name: 'Brownout', value: 1 },
      { name: 'Watchdog', value: 2 }, { name: 'Software', value: 3 }, { name: 'Unknown', value: 4 },
    ],
    restartEventInput: 'restart_event',
  });
  assert.equal(new DataView(result.bytes.buffer, result.bytes.byteOffset).getUint16(4, true), 21);
});

test('restart lifecycle rejects partial or changed reserved declarations', () => {
  for (const source of [
    lifecycle.replace('PowerOn | Brownout | Watchdog | Software | Unknown', 'PowerOn | Brownout'),
    lifecycle.replace('input restart_event: Bool;', 'input restart_event: Number;'),
    lifecycle.replace('input restart_reason: RestartReason;', 'input other_reason: RestartReason;'),
  ]) assert.throws(() => compileControl(source), /RestartReason|restart lifecycle/);
});

test('runtime-owned lifecycle ports coexist with ordinary typed acquisition without sensor coercion', () => {
  const result = compileControl(lifecycle.replace('output recover: Bool;', `input request: Bool;
    input count: Int;
    input reading?: Temperature;
    output total: Int;
    total <- count |> recover(-7);
    output recover: Bool;`).replace('recover <- restart_event;', 'recover <- restart_event && (request |> recover(false));'));
  assert.deepEqual(result.manifest.inputs.map(x => [x.name, x.type]), [['restart_reason', 'RestartReason'], ['restart_event', 'Bool']]);
  assert.deepEqual(result.manifest.sensors.map(x => [x.name, x.type, x.optional === true]), [
    ['request', 'Bool', false], ['count', 'Int', false], ['reading', 'Temperature', true],
  ]);
  assert.ok(result.manifest.lifecycle);
});

test('runtime-owned restart declarations reject optionality and acquisition conditioning', () => {
  for (const source of [
    lifecycle.replace('restart_event: Bool;', 'restart_event?: Bool;'),
    lifecycle.replace('restart_event: Bool;', 'restart_event: Bool { recover_after = 2 samples; }'),
    lifecycle.replace('restart_reason: RestartReason;', 'restart_reason?: RestartReason;'),
  ]) assert.throws(() => compileControl(source), /runtime-owned restart inputs/);
  assert.throws(() => compileControl(lifecycle.replace('recover <- restart_event;', 'recover <- restart_event |> recover(false);')), /Result/);
  assert.throws(() => compileControl('control ExternalEnum { type Reason = First | Second; input reason: Reason; }'), /supported scalar payload/);
});
