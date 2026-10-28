import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileSourceSync } from '../../tools/compile-source.mjs';
import { observeSourceTrace, RESULT_FAULT_MEMBERS } from '../../tools/source-trace.mjs';
import { GhostFlowRuntime } from '../../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../../runtimes/wasm/framed-runtime.mjs';
import { sha256 } from './bridge.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function runDifferential({ runtimeRoot, receiptPath, evidenceDir }) {
  const directory = resolve(evidenceDir);
  await mkdir(directory, { recursive: true });
  const receiptBytes = await readFile(receiptPath), receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.passed, true, 'frozen runtime receipt must have passed');
  const rustSources = Object.entries(receipt.sourceSha256).filter(([path]) =>
    /\.rs$|(^|\/)Cargo\.(toml|lock)$/.test(path));
  assert.ok(rustSources.some(([path]) => path === 'crates/ghostflow-core/src/lib.rs'));
  assert.ok(rustSources.some(([path]) => path === 'runtimes/wasm/src/lib.rs'));
  for (const [path, digest] of rustSources) assert.equal(sha256(await readFile(join(root, path))), digest, `runtime source changed: ${path}`);
  const artifacts = [['wasm', 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', 'runtime.wasm'],
    ['native', 'target/release/examples/run', 'native-run']];
  for (const [kind, input, output] of artifacts) {
    const path = join(directory, output);
    await copyFile(join(runtimeRoot, input), path);
    assert.equal(sha256(await readFile(path)), receipt[kind].sha256, `${kind} frozen artifact mismatch`);
    if (kind === 'native') await chmod(path, 0o755);
  }
  await writeFile(join(directory, 'runtime-receipt.json'), receiptBytes);
  const filename = 'experiments/bool-sensor-state-validation/fixtures/toggle.ghost.md';
  const source = await readFile(join(root, filename), 'utf8');
  const wasm = await readFile(join(directory, 'runtime.wasm'));
  const rows = [{ payload: false, ok: true, fault: 0 }, { payload: true, ok: true, fault: 0 },
    { payload: true, ok: true, fault: 0 }, { payload: false, ok: true, fault: 0 }];
  for (let fault = 0; fault < 4; fault++) for (const payload of [false, true]) {
    rows.push({ payload: true, ok: true, fault: 0 }, { payload, ok: false, fault },
      { payload: false, ok: true, fault: 0 });
  }
  const observations = [];
  for (const initial of [false, true]) {
    const compiled = compileSourceSync(source.replace('held: Bool = false', `held: Bool = ${initial}`), { filename });
    const sensor = compiled.manifest.sensors[0], site = compiled.traceMetadata.resultSites[0].site;
    const modulePath = join(directory, `module-${initial}.gfb`), csvPath = join(directory, 'rails.csv');
    await writeFile(modulePath, compiled.bytes);
    await writeFile(csvPath, `${sensor.valueInput},${sensor.okInput},${sensor.faultInput}\n${rows.map(r => `${r.payload},${r.ok},${r.fault}`).join('\n')}\n`);
    function check(runtime, index, old, row, trace) {
      const next = row.ok && row.payload ? !old : old;
      assert.deepEqual(trace.stateBefore, { held: old });
      assert.deepEqual(trace.stateAfter, { held: next });
      assert.deepEqual(trace.requested, { relay: next });
      assert.deepEqual(trace.safe, { relay: next });
      assert.deepEqual(trace.resultTrace, [{ site, choice: row.ok ? 0 : row.fault + 1, origin: row.ok ? 0 : 1 }]);
      const event = observeSourceTrace(compiled.traceMetadata, trace).resultEvents[0];
      assert.equal(event.fault, row.ok ? null : RESULT_FAULT_MEMBERS.SensorFault[row.fault]);
      observations.push({ runtime, initial, index, input: row, stateBefore: old, stateAfter: next,
        requested: trace.requested, events: trace.resultTrace });
      return next;
    }
    const native = spawnSync(join(directory, 'native-run'), [modulePath, csvPath, '--outcomes'], { encoding: 'utf8', timeout: 30000 });
    await writeFile(join(directory, `native-${initial}.log`), (native.stdout ?? '') + (native.stderr ?? ''));
    assert.equal(native.status, 0, native.error?.message ?? native.stderr);
    const nativeRows = native.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(nativeRows.length, rows.length);
    let old = initial;
    nativeRows.forEach((outcome, i) => { old = check('native', i, old, rows[i], outcome.trace); });
    for (const Runtime of [GhostFlowRuntime, FramedGhostFlowRuntime]) {
      const runtime = await Runtime.instantiate(wasm);
      try {
        runtime.load(compiled.bytes); runtime.addCapability('actuator', 'relay', 'bool'); runtime.activate();
        old = initial;
        for (const [i, row] of rows.entries()) {
          let trace;
          if (Runtime === GhostFlowRuntime) {
            runtime.setBool(sensor.valueInput, row.payload); runtime.setBool(sensor.okInput, row.ok);
            runtime.setNumber(sensor.faultInput, row.fault); runtime.tick(); trace = runtime.trace;
          } else trace = runtime.scan({ scanId: i, logicalTimeMs: i, inputs: [
            { name: sensor.valueInput, value: row.payload }, { name: sensor.okInput, value: row.ok },
            { name: sensor.faultInput, value: row.fault },
          ] }).trace;
          old = check(Runtime === GhostFlowRuntime ? 'wasm' : 'framed-wasm', i, old, row, trace);
        }
      } finally { runtime.dispose(); }
    }
  }
  const report = { status: 'passed', at: new Date().toISOString(), freshRuntimeBuild: false,
    runtimeReceiptSha256: sha256(receiptBytes), runtimeBuildIdentity: receipt.buildIdentity,
    checkedRustSources: Object.fromEntries(rustSources), wasmSha256: receipt.wasm.sha256,
    nativeSha256: receipt.native.sha256, observations, productionCorrespondenceProof: false };
  await writeFile(join(directory, 'differential.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

export async function differential(options) {
  const directory = resolve(options.evidenceDir), path = join(directory, 'differential.json');
  await mkdir(directory, { recursive: true });
  const startedAt = new Date().toISOString();
  await writeFile(path, JSON.stringify({ status: 'running', startedAt }) + '\n');
  try {
    const report = { ...await runDifferential(options), startedAt, finishedAt: new Date().toISOString() };
    await writeFile(path, JSON.stringify(report, null, 2) + '\n');
    return report;
  } catch (error) {
    await writeFile(path, JSON.stringify({ status: 'failed', startedAt, finishedAt: new Date().toISOString(),
      error: error.message }, null, 2) + '\n');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [runtimeRoot, receiptPath, evidenceDir] = process.argv.slice(2);
  const report = await differential({ runtimeRoot, receiptPath, evidenceDir });
  console.log(JSON.stringify({ status: report.status, observations: report.observations.length, evidenceDir }));
}
