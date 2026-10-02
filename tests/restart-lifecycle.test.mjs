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
  assert.equal(new DataView(result.bytes.buffer, result.bytes.byteOffset).getUint16(4, true), 19);
});

test('restart lifecycle rejects partial or changed reserved declarations', () => {
  for (const source of [
    lifecycle.replace('PowerOn | Brownout | Watchdog | Software | Unknown', 'PowerOn | Brownout'),
    lifecycle.replace('input restart_event: Bool;', 'input restart_event: Number;'),
    lifecycle.replace('input restart_reason: RestartReason;', 'input other_reason: RestartReason;'),
  ]) assert.throws(() => compileControl(source), /RestartReason|restart lifecycle/);
});
