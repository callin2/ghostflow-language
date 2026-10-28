import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { observeSourceTrace } from '../tools/source-trace.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const filename = 'experiments/elapsed-duration-output/fixtures/elapsed-output.ghost.md';
const source = fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
const sourceSha256 = '402c1fee9503382f489cca6317cbcac5a3ab0a9439d65a7cebf27c89c6f30f93';
assert.equal(createHash('sha256').update(source).digest('hex'), sourceSha256);
const artifact = await compileSource(source, { filename });
const sensor = artifact.manifest.sensors[0];
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const native = fileURLToPath(new URL(`../target/release/examples/scan_tape${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
const faultCode = { Good: 0, Disconnected: 0, Stale: 1, Invalid: 2, NotReady: 3 };
const scenarios = [
  {
    name: 'healthy toggles and explicit fault retention',
    steps: [[100, 'Good', false], [105, 'Good', true], [106, 'Good', true],
      [106, 'Good', true], [110, 'Good', false], [115, 'Disconnected', true],
      [116, 'Stale', true], [117, 'Invalid', true], [118, 'NotReady', true],
      [119, 'Good', true], [120, 'Good', false]],
    expected: [
      [false, 0, false, false, 100, 0, null],
      [false, 100, true, true, 105, 5, null],
      [true, 105, true, false, 106, 1, null],
      [false, 106, true, true, 106, 0, null],
      [true, 106, true, true, 106, 4, null],
      [true, 106, true, true, 106, 9, 'Disconnected'],
      [true, 106, true, true, 106, 10, 'Stale'],
      [true, 106, true, true, 106, 11, 'Invalid'],
      [true, 106, true, true, 106, 12, 'NotReady'],
      [true, 106, true, false, 119, 13, null],
      [false, 119, true, false, 119, 1, null],
    ],
  },
  {
    name: 'one millisecond toggles near the exact clock limit',
    steps: [[9007199254740989, 'Good', true], [9007199254740990, 'Good', true],
      [9007199254740991, 'Good', true], [9007199254740991, 'Good', false]],
    expected: [
      [false, 0, false, true, 9007199254740989, 0, null],
      [true, 9007199254740989, true, false, 9007199254740990, 1, null],
      [false, 9007199254740990, true, true, 9007199254740991, 1, null],
      [true, 9007199254740991, true, true, 9007199254740991, 0, null],
    ],
  },
];

for (const scenario of scenarios) {
  test(`fixed elapsed Duration fixture has complete state, output and source-fault correspondence for ${scenario.name}`, async t => {
    assert.equal(artifact.sourceDocument.sha256, sourceSha256);
    assert.ok(artifact.traceMetadata.intentAnchors.some(anchor => anchor.id === 'GF-ELAPSED-DURATION'
      && anchor.status === 'confirmed'));
    const frames = scenario.steps.map(([logicalTimeMs, quality, payload], scanId) => ({
      scanId, logicalTimeMs, inputs: [
        { name: sensor.valueInput, value: payload },
        { name: sensor.okInput, value: quality === 'Good' },
        { name: sensor.faultInput, value: faultCode[quality] },
      ],
    }));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-elapsed-duration-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const modulePath = path.join(directory, 'module.gfb');
    const tapePath = path.join(directory, 'frames.tsv');
    fs.writeFileSync(modulePath, artifact.bytes);
    fs.writeFileSync(tapePath, `${frames.map(frame => [frame.scanId, frame.logicalTimeMs,
      ...frame.inputs.flatMap(({ name, value }) => [name, typeof value === 'boolean' ? 'b' : 'n', value]),
    ].join('\t')).join('\n')}\n`);
    const result = spawnSync(native, [modulePath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const records = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(records.every(record => record.accepted));
    const executions = [['native', records.map(record => record.outcome.trace)]];

    for (const Runtime of [GhostFlowRuntime, FramedGhostFlowRuntime]) {
      const runtime = await Runtime.instantiate(wasm);
      t.after(() => runtime.dispose());
      runtime.load(artifact.bytes);
      runtime.addCapability('actuator', 'relay', 'bool');
      runtime.addCapability('actuator', 'age_ms', 'number');
      runtime.activate();
      const traces = frames.map(frame => {
        if (Runtime === FramedGhostFlowRuntime) return runtime.scan(frame).trace;
        for (const { name, value } of frame.inputs) {
          if (typeof value === 'boolean') runtime.setBool(name, value);
          else runtime.setNumber(name, value);
        }
        runtime.tickAt(frame.logicalTimeMs);
        return runtime.trace;
      });
      executions.push([Runtime.name, traces]);
    }
    for (const entry of ['instantiate', 'instantiateFramed']) {
      const runtime = await ControlRuntime[entry](wasm, artifact);
      t.after(() => runtime.dispose());
      executions.push([`ControlRuntime.${entry}`, scenario.steps.map(([nowMs, quality, value], index) =>
        runtime.step({ nowMs, samples: { trigger: { epoch: 1, id: index + 1, timestampMs: nowMs, quality, value } } }).vm)]);
    }

    for (const [entry, traces] of executions) {
      assert.equal(traces.length, scenario.expected.length, entry);
      for (const [index, trace] of traces.entries()) {
        const [before, sinceBefore, initialized, after, sinceAfter, age, fault] = scenario.expected[index];
        assert.deepEqual(trace.stateBefore,
          { held: before, __gf_timer_since_age: sinceBefore, __gf_timer_initialized_age: initialized }, entry);
        assert.deepEqual(trace.stateAfter,
          { held: after, __gf_timer_since_age: sinceAfter, __gf_timer_initialized_age: true }, entry);
        assert.deepEqual(trace.requested, { relay: after, age_ms: age }, entry);
        assert.deepEqual(trace.safe, { relay: after, age_ms: age }, entry);
        assert.deepEqual(trace.faults, [], entry);
        const events = observeSourceTrace(artifact.traceMetadata, trace).resultEvents;
        assert.ok(events.length > 0, entry);
        for (const event of events) {
          assert.deepEqual({ kind: event.kind, errorType: event.errorType, fault: event.fault,
            origin: event.originDescriptor?.name ?? null, source: event.source },
          { kind: 'recover', errorType: 'SensorFault', fault, origin: fault === null ? null : 'trigger',
            source: { filename, line: 13, column: 26, endLine: 13, endColumn: 33 } }, entry);
        }
      }
    }
  });
}
