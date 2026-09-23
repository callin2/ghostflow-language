import assert from 'node:assert/strict';
import test from 'node:test';
import { LIVE_HISTORY_LIMIT, renderLivePanel } from '../tools/ghostsim-tui.mjs';

const channel = (name, label = name) => ({ name, label, type: 'Bool' });
const profile = (inputs, outputs) => ({ id: 'virtual fixture', inputs, outputs });
const row = (scanId, inputs = {}, requestedVirtualIntent = {}, safeVirtualIntent = {}) => ({
  scanId, logicalTimeMs: scanId * 100, inputs, requestedVirtualIntent, safeVirtualIntent,
});
const visible = frame => frame.replace(/\x1b\[[0-9;]*[A-Za-z]/gu, '');

test('8DI/8RO frame pairs input and output by index in an 80-column screen', () => {
  const selected = profile(
    Array.from({ length: 8 }, (_, i) => channel(`DI${i + 1}`)),
    Array.from({ length: 8 }, (_, i) => channel(`RO${i + 1}`)),
  );
  const bound = new Map([['DI1', 'start'], ['DI3', 'permit_ok'], ['RO1', 'pump']]);
  const scan = row(1, { start: false, permit_ok: true }, { pump: true }, { pump: true });
  const frame = renderLivePanel(selected, bound, scan, [scan], { columns: 80, rows: 24 });
  assert.ok(frame.startsWith('\x1b[H\x1b[2J'));
  const output = visible(frame);
  assert.match(output, /scan 1  time 100 ms  status running/);
  assert.match(output, /physical: unconfirmed/);
  assert.match(output, /DI8/);
  assert.match(output, /RO8/);
  const dataRows = output.split('\n').filter(line => /DI\d|RO\d/.test(line));
  assert.equal(dataRows.length, 8);
  assert.ok(dataRows.every((line, index) => line.includes(`DI${index + 1}`) && line.includes(`RO${index + 1}`)));
  assert.match(dataRows[0], /DI1 start.*OFF.*_.*\|.*RO1 pump.*R:ON.*S:ON.*R:-.*S:-/);
  assert.match(dataRows[2], /DI3 permit_ok.*ON/);
  assert.match(output, /\? unobserved/);
  assert.ok(dataRows.every(line => line.length <= 80));
});

test('selected 2DI/4RO order and labels determine rows without default channels', () => {
  const selected = profile([channel('A', 'Start'), channel('B', 'Stop')],
    [channel('R4', 'Fan'), channel('R1', 'Valve'), channel('R3', 'Pump'), channel('R2', 'Alarm')]);
  const output = visible(renderLivePanel(selected, new Map([['A', 'start'], ['R3', 'pump']]),
    row(0, { start: true }, { pump: true }, { pump: false }), [], { columns: 90, rows: 20 }));
  assert.ok(output.indexOf('A Start') < output.indexOf('B Stop'));
  assert.ok(output.indexOf('R4 Fan') < output.indexOf('R1 Valve'));
  assert.ok(output.indexOf('R1 Valve') < output.indexOf('R3 Pump'));
  assert.ok(output.indexOf('R3 Pump') < output.indexOf('R2 Alarm'));
  assert.doesNotMatch(output, /DI8|RO8/);
  const dataRows = output.split('\n').filter(line => /A Start|B Stop|R[1-4]/.test(line));
  assert.equal(dataRows.length, 4);
  assert.match(dataRows[0], /A Start.*\|.*R4 Fan/);
  assert.match(dataRows[1], /B Stop.*\|.*R1 Valve/);
  assert.match(dataRows[2], /^\s*\|.*R3 Pump.*R:ON.*S:OFF/);
});

test('narrow terminal clips lines and height without splitting Unicode labels', () => {
  const selected = profile([channel('A', '펌프⚡ sensor'), channel('B')],
    [channel('R1'), channel('R2'), channel('R3'), channel('R4')]);
  const output = visible(renderLivePanel(selected, new Map([['A', 'a'], ['R1', 'r']]),
    row(0, { a: true }, { r: true }, { r: false }), [], { columns: 40, rows: 7 }));
  const lines = output.trimEnd().split('\n');
  assert.equal(lines.length, 7);
  assert.ok(lines.every(line => [...line].length <= 40));
  assert.match(output, /rows clipped/);
  assert.doesNotMatch(output, /\ufffd/);
});

test('waveforms show only bounded recent samples and separate requested from safe', () => {
  const selected = profile([channel('DI1')], [channel('RO1')]);
  const bound = new Map([['DI1', 'in'], ['RO1', 'out']]);
  const history = Array.from({ length: LIVE_HISTORY_LIMIT + 5 }, (_, i) =>
    row(i, { in: i % 2 === 0 }, { out: true }, { out: false }));
  const output = visible(renderLivePanel(selected, bound, history.at(-1), history,
    { columns: 100, rows: 12 }));
  assert.match(output, /DI1.*[-_]+.*\|.*RO1.*R:ON.*S:OFF.*R:-+.*S:_+/);
  assert.doesNotMatch(output, /\?{120}/);
});

test('a frame filling the terminal does not scroll past its last row', () => {
  const selected = profile([channel('DI1')], [channel('RO1')]);
  const scan = row(0, { input: true }, { output: true }, { output: true });
  const frame = renderLivePanel(selected, new Map([['DI1', 'input'], ['RO1', 'output']]),
    scan, [scan], { columns: 80, rows: 5 });
  assert.equal(visible(frame).split('\n').length, 5);
  assert.ok(!frame.endsWith('\n'));
});
