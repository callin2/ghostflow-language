import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { compileSourceSync } from '../../tools/compile-source.mjs';
import { RESULT_FAULT_MEMBERS, observeSourceTrace } from '../../tools/source-trace.mjs';
import { GhostFlowRuntime } from '../../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../../runtimes/wasm/framed-runtime.mjs';
import { ControlRuntime } from '../../runtimes/wasm/control-runtime.mjs';
import { sha256 } from './bridge.mjs';

export async function differential({ source, filename, wasmPath, nativePath, evidenceDir, provenance }) {
  const compiled = compileSourceSync(source, { filename });
  const wasm = await readFile(wasmPath), nativeBytes = await readFile(nativePath);
  const sensor = compiled.manifest.sensors[0], output = compiled.manifest.outputs[0].name;
  const site = compiled.traceMetadata.resultSites[0];
  assert.deepEqual(RESULT_FAULT_MEMBERS.SensorFault, ['Disconnected', 'Stale', 'Invalid', 'NotReady']);
  const rows = [];
  for (const payload of [false, true]) rows.push({ payload, ok: true, fault: 0, output: payload, choice: 0, origin: 0 });
  for (let fault = 0; fault < 4; fault++) for (const payload of [false, true]) {
    rows.push({ payload, ok: false, fault, output: false, choice: fault + 1, origin: 1 });
  }
  const directory = resolve(evidenceDir);
  await mkdir(directory, { recursive: true });
  const modulePath = join(directory, 'module.gfb'), csvPath = join(directory, 'rails.csv');
  await writeFile(modulePath, compiled.bytes);
  await writeFile(csvPath, `${sensor.valueInput},${sensor.okInput},${sensor.faultInput}\n${rows.map(r => `${r.payload},${r.ok},${r.fault}`).join('\n')}\n`);
  const native = spawnSync(resolve(nativePath), [modulePath, csvPath, '--outcomes'], { encoding: 'utf8', timeout: 30000 });
  await writeFile(join(directory, 'native.log'), (native.stdout ?? '') + (native.stderr ?? ''));
  assert.equal(native.status, 0, native.stderr || native.error?.message);
  const nativeRows = native.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(nativeRows.length, rows.length);
  const observed = [];
  let rawBoundaryChecks = 0;
  function check(label, row, trace) {
    assert.deepEqual(trace.requested, { [output]: row.output });
    assert.deepEqual(trace.safe, trace.requested);
    assert.deepEqual(trace.resultTrace, [{ site: site.site, choice: row.choice, origin: row.origin }]);
    const event = observeSourceTrace(compiled.traceMetadata, trace).resultEvents[0];
    assert.equal(event.fault, row.ok ? null : RESULT_FAULT_MEMBERS.SensorFault[row.fault]);
    assert.equal(event.originDescriptor?.name ?? null, row.ok ? null : sensor.name);
    observed.push({ runtime: label, rails: row, result: trace.resultTrace[0], requested: trace.requested });
  }
  nativeRows.forEach((result, i) => check('native', rows[i], result.trace));
  for (const Runtime of [GhostFlowRuntime, FramedGhostFlowRuntime]) {
    const runtime = await Runtime.instantiate(wasm);
    try {
      runtime.load(compiled.bytes); runtime.addCapability('actuator', output, 'bool'); runtime.activate();
      for (const [i, row] of rows.entries()) {
        let trace;
        if (Runtime === GhostFlowRuntime) {
          runtime.setBool(sensor.valueInput, row.payload); runtime.setBool(sensor.okInput, row.ok);
          runtime.setNumber(sensor.faultInput, row.fault); runtime.tick(); trace = runtime.trace;
        } else trace = runtime.scan({ scanId: i, logicalTimeMs: i, inputs: [
          { name: sensor.valueInput, value: row.payload }, { name: sensor.okInput, value: row.ok },
          { name: sensor.faultInput, value: row.fault },
        ] }).trace;
        check(Runtime === GhostFlowRuntime ? 'wasm' : 'framed-wasm', row, trace);
      }
      if (Runtime === GhostFlowRuntime) {
        assert.throws(() => runtime.setNumber(sensor.okInput, 1), /type/i);
        rawBoundaryChecks++;
        for (const invalid of [NaN, Infinity, -Infinity]) {
          assert.throws(() => runtime.setNumber(sensor.faultInput, invalid), /finite/);
          rawBoundaryChecks++;
        }
        runtime.setBool(sensor.valueInput, true); runtime.setBool(sensor.okInput, false);
        runtime.setNumber(sensor.faultInput, 0.5);
        assert.throws(() => runtime.tick(), /result-trace-out-of-range/);
        rawBoundaryChecks++;
        for (const outsideDomain of [-1, 4]) {
          runtime.setBool(sensor.valueInput, true); runtime.setBool(sensor.okInput, false);
          runtime.setNumber(sensor.faultInput, outsideDomain); runtime.tick();
          assert.throws(() => observeSourceTrace(compiled.traceMetadata, runtime.trace), /origin mismatch|domain mismatch/);
          rawBoundaryChecks++;
        }
      }
    } finally { runtime.dispose(); }
  }
  let qualityBoundaryChecks = 0;
  for (const framed of [false, true]) {
    const runtime = await (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate).call(ControlRuntime, wasm, compiled);
    try {
      let id = 0;
      for (const row of rows) {
        id++;
        const quality = row.ok ? 'Good' : RESULT_FAULT_MEMBERS.SensorFault[row.fault];
        const result = runtime.step({ nowMs: id, samples: { [sensor.name]: { epoch: 1, id, timestampMs: id, quality, value: row.payload } } });
        check(framed ? 'canonical-framed' : 'canonical-wasm', row, result.vm);
      }
      for (const quality of ['Unknown', -1, 5, 0.5, NaN]) {
        id++;
        assert.throws(() => runtime.step({ nowMs: id, samples: { [sensor.name]: { epoch: 1, id, timestampMs: id, quality, value: false } } }), /quality is unsupported/);
        qualityBoundaryChecks++;
      }
      for (const value of [0, 1, 'false', NaN]) {
        id++;
        assert.throws(() => runtime.step({ nowMs: id, samples: { [sensor.name]: { epoch: 1, id, timestampMs: id, quality: 'Good', value } } }), /must be boolean/);
        qualityBoundaryChecks++;
      }
    } finally { runtime.dispose(); }
  }
  return { status: 'passed', provenance, artifactSha256: sha256(compiled.bytes),
    wasmSha256: sha256(wasm), nativeSha256: sha256(nativeBytes), rawRailExecutions: observed.filter(x => ['native', 'wasm', 'framed-wasm'].includes(x.runtime)).length,
    canonicalQualityExecutions: observed.filter(x => x.runtime.startsWith('canonical-')).length,
    rawBoundaryChecks, qualityBoundaryChecks, observed,
    at: new Date().toISOString(), productionCorrespondenceProof: false };
}
