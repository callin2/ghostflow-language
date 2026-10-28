import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GhostFlowRuntime } from '../../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../../runtimes/wasm/framed-runtime.mjs';
import { compileEvidence, inspectModule, mutations, sha256, theoremInput, values } from './bridge.mjs';
import { leanOutcomeMatches as subprocessOutcomeMatches } from '../lean-outcome.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const now = () => new Date().toISOString();
export function leanOutcomeMatches(result, log, expectedSuccess, diagnostic) {
  return subprocessOutcomeMatches(result, log, expectedSuccess, diagnostic)
    && (expectedSuccess || (log.match(/\berror:/g) ?? []).length === 1);
}

async function sourceIdentity() {
  const paths = ['package.json', 'package-lock.json', 'crates/ghostflow-core/src/lib.rs',
    'tests/int32-codec-validation.test.mjs', 'experiments/lean-outcome.mjs'];
  async function walk(path) {
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (/\.(mjs|lean|md)$/.test(entry.name)) paths.push(child);
    }
  }
  await walk('tools'); await walk('experiments/int32-codec-validation'); await walk('runtimes/wasm');
  const files = {};
  for (const path of paths.sort()) files[path] = sha256(await readFile(join(root, path)));
  return { files, sha256: sha256(JSON.stringify(files)) };
}

async function runtimeWitnesses({ evidence, directory, runtimeRoot, runtimeReceipt }) {
  const receiptBytes = await readFile(runtimeReceipt), receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.passed, true, 'runtime receipt must have passed');
  const sources = Object.entries(receipt.sourceSha256).filter(([path]) => /\.rs$|(^|\/)Cargo\.(toml|lock)$/.test(path));
  assert.ok(sources.some(([p]) => p === 'crates/ghostflow-core/src/lib.rs'));
  assert.ok(sources.some(([p]) => p === 'runtimes/wasm/src/lib.rs'));
  for (const [path, hash] of sources) assert.equal(sha256(await readFile(join(root, path))), hash, `runtime source mismatch: ${path}`);
  for (const [kind, from, to] of [
    ['wasm', 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', 'runtime.wasm'],
    ['native', 'target/release/examples/run', 'native-run'],
  ]) {
    await copyFile(join(runtimeRoot, from), join(directory, to));
    assert.equal(sha256(await readFile(join(directory, to))), receipt[kind].sha256, `runtime ${kind} hash`);
  }
  await chmod(join(directory, 'native-run'), 0o755);
  await writeFile(join(directory, 'runtime-receipt.json'), receiptBytes);
  const sensor = evidence.compiled.manifest.sensors[0];
  const csv = `${sensor.valueInput},${sensor.okInput},${sensor.faultInput}\nfalse,true,0\ntrue,true,0\n`;
  await writeFile(join(directory, 'inputs.csv'), csv);
  const observations = [];
  function check(runtime, tick, trace) {
    for (const [i, value] of values.entries()) {
      assert.equal(trace.stateBefore[`s${i}`], value, `${runtime} initial i32 ${i}`);
      assert.equal(trace.stateAfter[`s${i}`], value, `${runtime} retained i32 ${i}`);
      for (const output of [`literal${i}`, `held${i}`]) {
        assert.equal(trace.requested[output], value, `${runtime} requested ${output}`);
        assert.equal(trace.safe[output], value, `${runtime} safe ${output}`);
      }
    }
    observations.push({ runtime, tick, trace });
  }
  const native = spawnSync(join(directory, 'native-run'), [join(directory, 'module.gfb'), join(directory, 'inputs.csv'), '--outcomes'],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 1024*1024 });
  await writeFile(join(directory, 'native.log'), (native.stdout ?? '') + (native.stderr ?? ''));
  assert.equal(native.status, 0, native.error?.message ?? native.stderr);
  const rows = native.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2);
  rows.forEach((r, i) => { assert.equal(r.status, 'OK'); check('native', i, r.trace); });
  const wasm = await readFile(join(directory, 'runtime.wasm'));
  for (const Runtime of [GhostFlowRuntime, FramedGhostFlowRuntime]) {
    const runtime = await Runtime.instantiate(wasm);
    try {
      runtime.load(evidence.compiled.bytes);
      for (const output of evidence.compiled.manifest.outputs) runtime.addCapability('actuator', output.name, 'int');
      runtime.activate();
      for (let i = 0; i < 2; i++) {
        const inputs = [{ name: sensor.valueInput, value: i === 1 }, { name: sensor.okInput, value: true }, { name: sensor.faultInput, value: 0 }];
        if (Runtime === GhostFlowRuntime) {
          runtime.setBool(sensor.valueInput, i === 1); runtime.setBool(sensor.okInput, true); runtime.setNumber(sensor.faultInput, 0);
          runtime.tick(); check('wasm', i, runtime.trace);
        } else check('framed-wasm', i, runtime.scan({ scanId: i, logicalTimeMs: i, inputs }).trace);
      }
    } finally { runtime.dispose(); }
  }
  const mutantObservations = [];
  for (const mutant of mutations(evidence)) {
    const runtime = await GhostFlowRuntime.instantiate(wasm);
    try {
      runtime.load(mutant.bytes);
      for (const output of evidence.compiled.manifest.outputs) runtime.addCapability('actuator', output.name, 'int');
      runtime.activate();
      runtime.setBool(sensor.valueInput, false); runtime.setBool(sensor.okInput, true); runtime.setNumber(sensor.faultInput, 0);
      runtime.tick();
      const record = evidence.records.find(r => r.offset === mutant.offset);
      const output = `${record.kind === 'initial' ? 'held' : 'literal'}${record.index}`;
      const observed = runtime.trace.requested[output];
      assert.notEqual(observed, record.value, 'accepted mutant must disagree with original source integer');
      mutantObservations.push({ name: mutant.name, rustLoaderAccepted: true, runtime: 'wasm',
        output, sourceExpected: record.value, observed, trace: runtime.trace });
    } finally { runtime.dispose(); }
  }
  return { status: 'passed', freshRuntimeBuild: false, runtimeBuildIdentity: receipt.buildIdentity,
    runtimeReceiptSha256: sha256(receiptBytes), checkedRustSources: Object.fromEntries(sources),
    wasmSha256: receipt.wasm.sha256, nativeSha256: receipt.native.sha256,
    nativeExitCode: native.status, observations, mutantObservations, productionCorrespondenceProof: false };
}

export async function verify({ lean, evidenceDir, runtimeRoot, runtimeReceipt }) {
  const directory = resolve(evidenceDir), path = join(directory, 'verification.json');
  await mkdir(directory, { recursive: true });
  const report = { schemaVersion: 1, status: 'running', startedAt: now(),
    scope: 'Universal mathematical signed i32 codec; finite production compiler byte and optional reused-runtime observations',
    productionCompilerProof: false, productionRustRefinementProof: false, results: [], mutants: [] };
  const publish = async () => { await writeFile(`${path}.tmp`, JSON.stringify(report, null, 2) + '\n'); await rename(`${path}.tmp`, path); };
  await publish();
  let scratch;
  try {
    assert.ok(lean, '--lean is required');
    report.sourceIdentity = await sourceIdentity();
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    assert.equal(git.status, 0); report.baseCommit = git.stdout.trim();
    const version = spawnSync(lean, ['--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0); assert.match(version.stdout, /version 4\.19\.0/);
    report.lean = { executable: lean, sha256: sha256(await readFile(lean)), version: version.stdout.trim() };
    const deps = spawnSync('npm', ['ls', '--depth=0', '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(deps.status, 0, 'dependency validation failed'); report.dependencies = JSON.parse(deps.stdout);
    scratch = await mkdtemp(join(tmpdir(), 'ghostflow-i32-proof-'));
    async function run(name, content, expectedSuccess, output, diagnostic) {
      const start = now(), source = join(scratch, `${name}.lean`);
      await writeFile(source, content); await writeFile(join(directory, `${name}.lean`), content);
      const child = spawnSync(lean, [...(output ? ['-o', join(scratch, output)] : []), source],
        { cwd: scratch, env: { ...process.env, LEAN_PATH: scratch }, encoding: 'utf8', timeout: 60000, maxBuffer: 4*1024*1024 });
      const log = (child.stdout ?? '') + (child.stderr ?? '');
      await writeFile(join(directory, `${name}.log`), log);
      const passed = leanOutcomeMatches(child, log, expectedSuccess, diagnostic);
      report.results.push({ name, expectedSuccess, expectedDiagnostic: expectedSuccess ? undefined : diagnostic,
        passed, exitCode: child.status, signal: child.signal, error: child.error?.message,
        startedAt: start, finishedAt: now(), inputSha256: sha256(content), logSha256: sha256(log) });
      await publish(); assert.ok(passed, `${name}: unexpected Lean result\n${log}`);
    }
    const model = await readFile(join(here, 'Int32Codec.lean'), 'utf8');
    assert.ok(!/\b(sorry|admit|axiom|native_decide|opaque)\b/.test(model), 'prohibited proof escape');
    await run('Int32Codec', model, true, 'Int32Codec.olean');
    const evidence = compileEvidence();
    await writeFile(join(directory, 'source.ghost.md'), evidence.source);
    await writeFile(join(directory, 'module.gfb'), evidence.compiled.bytes);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(evidence.compiled.manifest, null, 2) + '\n');
    report.compiler = { sourceSha256: sha256(evidence.source), artifactSha256: sha256(evidence.compiled.bytes),
      artifactBytes: evidence.compiled.bytes.length, values, records: evidence.records };
    await run('compiler-witnesses', theoremInput(evidence.compiled.bytes, evidence.records), true);
    for (const mutant of mutations(evidence)) {
      assert.equal(inspectModule(mutant.bytes).length, evidence.records.length, 'mutant must remain structurally admitted');
      await writeFile(join(directory, `${mutant.name}.gfb`), mutant.bytes);
      report.mutants.push({ name: mutant.name, offset: mutant.offset, oldBytes: mutant.oldBytes,
        newBytes: mutant.newBytes, reason: mutant.reason, artifactSha256: sha256(mutant.bytes), structurallyAdmitted: true });
      await run(`reject-${mutant.name}`, mutant.theorem, false, undefined, mutant.diagnostic);
    }
    if (runtimeRoot || runtimeReceipt) {
      assert.ok(runtimeRoot && runtimeReceipt, 'runtime root and receipt are required together');
      report.runtime = await runtimeWitnesses({ evidence, directory, runtimeRoot, runtimeReceipt });
    } else report.runtime = { status: 'not-run', reason: 'runtime reuse paths not supplied' };
    assert.deepEqual(await sourceIdentity(), report.sourceIdentity, 'source changed during verification');
    report.status = 'passed'; return report;
  } catch (error) {
    report.status = 'failed'; report.error = { name: error.name, message: error.message }; throw error;
  } finally {
    report.finishedAt = now(); await publish();
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = { '--lean': 'lean', '--evidence-dir': 'evidenceDir', '--runtime-root': 'runtimeRoot', '--runtime-receipt': 'runtimeReceipt' }, options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    assert.ok(flags[process.argv[i]] && process.argv[i + 1], `invalid argument ${process.argv[i]}`);
    options[flags[process.argv[i]]] = process.argv[i + 1];
  }
  options.evidenceDir ??= join(root, 'build/int32-codec-validation', now().replaceAll(':', '-'));
  try {
    const report = await verify(options);
    console.log(JSON.stringify({ status: report.status, leanInvocations: report.results.length,
      compilerRecords: report.compiler.records.length, runtimeTraces: report.runtime.observations?.length,
      evidence: resolve(options.evidenceDir) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
