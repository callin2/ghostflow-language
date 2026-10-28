import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, mkdtemp, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileEvidence, theoremInput, admissionInput, sha256 } from './bridge.mjs';
import { cases, machineMutations } from './cases.mjs';
import { differential } from './differential.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const now = () => new Date().toISOString();
const oldModels = ['BoolTranslation', 'ByteMachine', 'Serializer', 'DecoderSoundness', 'ModuleEnvelope', 'ModuleLoader'];
const falseProposition = "tactic 'decide' proved that the proposition";

async function identity() {
  const files = {};
  async function walk(folder) {
    for (const entry of (await readdir(join(root, folder), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(mjs|lean|rs)$/.test(entry.name) || entry.name.endsWith('.ghost.md')) files[path] = sha256(await readFile(join(root, path)));
    }
  }
  for (const folder of ['tools', 'runtimes/wasm', 'experiments/bool-sensor-validation']) await walk(folder);
  for (const name of oldModels) {
    const path = `experiments/bool-translation-validation/${name}.lean`;
    files[path] = sha256(await readFile(join(root, path)));
  }
  for (const path of ['package-lock.json', 'crates/ghostflow-core/src/lib.rs', 'tests/bool-sensor-validation.test.mjs']) {
    files[path] = sha256(await readFile(join(root, path)));
  }
  return { files, sha256: sha256(JSON.stringify(files)) };
}

export async function verify({ lean, evidenceDir, wasmPath, nativePath, runtimeSourceCommit, runtimeVerification }) {
  const directory = resolve(evidenceDir), reportPath = join(directory, 'verification.json');
  await mkdir(directory, { recursive: true });
  const report = { schemaVersion: 1, status: 'running', startedAt: now(), productionCompilerProof: false,
    scope: 'Canonical one Bool input recover(false), full module loading, typed raw-PC execution and Result trace for every admitted reading',
    numberCorrespondence: 'The generic theorem requires SmallNumberLaws. Production f64 is separately observed on the finite admitted domain.',
    results: [] };
  const publish = async () => {
    await writeFile(`${reportPath}.tmp`, JSON.stringify(report, null, 2) + '\n');
    await rename(`${reportPath}.tmp`, reportPath);
  };
  await publish();
  let scratch;
  try {
    assert.ok(lean, '--lean is required');
    report.sourceIdentity = await identity();
    const version = spawnSync(lean, ['--version'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(version.status, 0, 'Lean version check failed');
    assert.match(version.stdout, /version 4\.19\.0/);
    report.lean = { executableSha256: sha256(await readFile(lean)), version: version.stdout.trim() };
    const deps = spawnSync('npm', ['ls', '--depth=0', '--json'], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(deps.status, 0, 'installed dependencies invalid');
    report.dependencies = JSON.parse(deps.stdout);
    scratch = await mkdtemp(join(tmpdir(), 'ghostflow-sensor-proof-'));
    const run = async (name, input, expectedSuccess, diagnostic, output) => {
      const path = join(scratch, `${name}.lean`), startedAt = now();
      assert.doesNotMatch(input, /\b(sorry|admit|axiom|native_decide)\b|decide\s+\+native/);
      await writeFile(path, input);
      const result = spawnSync(lean, [...(output ? ['-o', join(scratch, `${name}.olean`)] : []), path],
        { cwd: scratch, env: { ...process.env, LEAN_PATH: scratch }, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
      const log = (result.stdout ?? '') + (result.stderr ?? '');
      const passed = !result.error && (result.status === 0) === expectedSuccess
        && (!diagnostic || log.includes(diagnostic)) && (!expectedSuccess || !log.includes('sorryAx'));
      await writeFile(join(directory, `${name}.lean`), input);
      await writeFile(join(directory, `${name}.log`), log);
      report.results.push({ name, expectedSuccess, diagnostic, passed, exitCode: result.status, signal: result.signal,
        error: result.error?.message, startedAt, finishedAt: now(), inputSha256: sha256(input), logSha256: sha256(log) });
      await publish();
      assert.ok(passed, `${name}: unexpected Lean result\n${log}`);
    };
    for (const name of oldModels) await run(name, await readFile(join(root, 'experiments/bool-translation-validation', `${name}.lean`), 'utf8'), true, undefined, true);
    const machine = await readFile(join(here, 'SensorMachine.lean'), 'utf8');
    await run('SensorMachine', machine, true, undefined, true);
    await run('SensorProfile', await readFile(join(here, 'SensorProfile.lean'), 'utf8'), true, undefined, true);
    await run('sensor-boundaries', `import SensorProfile\n${cases}`, true);
    const filename = 'experiments/bool-sensor-validation/fixtures/recover-false.ghost.md';
    const source = await readFile(join(root, filename), 'utf8');
    const evidence = compileEvidence(source, filename);
    await writeFile(join(directory, 'compiler-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    await run('actual-canonical-sensor', theoremInput(evidence), true);
    const raw = evidence.bytes, start = raw.length - 47;
    assert.deepEqual(raw.slice(start, start + 4), [3, 1, 0, 30]);
    const findName = text => {
      const buffer = Buffer.from(raw), needle = Buffer.from(text), at = buffer.indexOf(needle);
      assert.ok(at >= 0 && buffer.indexOf(needle, at + 1) === -1, 'mutation name must be unique');
      return at;
    };
    const fields = evidence.metadata.sensors[0].rails;
    const mutations = [
      ['magic', bytes => { bytes[0] = 0; }],
      ['format', bytes => { bytes[4] = 1; }],
      ['input-count', bytes => { bytes[8 + evidence.projection.name.length + 4] = 2; }],
      ...fields.map((name, i) => [`rail-${i}-type`, bytes => { bytes[findName(name) + name.length] = i === 2 ? 1 : 2; }]),
      ['value-rail-name', bytes => { bytes[findName(fields[0]) + fields[0].length - 1] = 120; }],
      ['quality-read-slot', bytes => { bytes[start + 1] = 0; }],
      ['branch-target', bytes => { bytes[start + 4]++; }],
      ['fallback-value', bytes => { bytes[start + 13] = 1; }],
      ['fault-code-increment', bytes => { bytes[start + 27] = 32; }],
      ['number-add-opcode', bytes => { bytes[start + 28] = 13; }],
      ['origin', bytes => { bytes[start + 39] = 32; }],
      ['trace-opcode', bytes => { bytes[start + 40] = 32; }],
      ['result-site', bytes => { bytes[start + 41] = 6; }],
      ['zero-result-site', bytes => { bytes[start + 41] = 0; }],
      ['expression-length', bytes => { bytes[start - 4]++; }],
      ['capability', bytes => { bytes[findName('actuator')] = 120; }],
      ['constraint-count', bytes => { bytes[bytes.length - 2] = 1; }],
      ['trailing-byte', bytes => { bytes.push(0); }],
      ['truncated', bytes => { bytes.pop(); }],
    ];
    for (const [name, edit] of mutations) {
      const bytes = [...raw]; edit(bytes);
      await run(`reject-raw-${name}`, admissionInput(bytes), true);
    }
    for (const [name, edit] of [
      ['site', e => { e.metadata.sites[0].site++; }],
      ['site-node', e => { e.metadata.sites[0].nodeId++; }],
      ['kind', e => { e.metadata.sites[0].kind = 'case'; }],
      ['error-type', e => { e.metadata.sites[0].errorType = 'ClockFault'; }],
      ['origin-tag', e => { e.metadata.sites[0].origins[0].tag++; }],
      ['origin-name', e => { e.metadata.sites[0].origins[0].name = 'other'; }],
      ['sensor-type', e => { e.metadata.sensors[0].type = 'Number'; }],
      ['rail-binding', e => { e.metadata.sensors[0].rails.reverse(); }],
    ]) {
      const changed = structuredClone(evidence); edit(changed);
      await run(`reject-metadata-${name}`, theoremInput(changed), false, falseProposition);
    }
    const changedName = structuredClone(evidence); changedName.bytes[8] = 88;
    await run('reject-original-source-identity', theoremInput(changedName), false, falseProposition);
    changedName.projection.name = `X${changedName.projection.name.slice(1)}`;
    await run('accept-valid-changed-module-name', theoremInput(changedName), true);
    for (const mutation of machineMutations) {
      assert.ok(machine.includes(mutation.before), `${mutation.name} target drift`);
      await run(`reject-machine-${mutation.name}`, machine.replace(mutation.before, mutation.after), false, mutation.diagnostic);
    }
    if (wasmPath || nativePath) {
      assert.ok(wasmPath && nativePath && runtimeSourceCommit && runtimeVerification, 'runtime paths and explicit provenance are required together');
      report.differential = await differential({ source, filename, wasmPath, nativePath,
        evidenceDir: join(directory, 'differential'), provenance: { sourceCommit: runtimeSourceCommit,
          overallVerification: runtimeVerification, identifiedBuild: false } });
    } else report.differential = { status: 'not-run', reason: 'runtime paths were not supplied' };
    assert.deepEqual(await identity(), report.sourceIdentity, 'source changed during verification');
    report.status = 'passed';
    return report;
  } catch (error) {
    report.status = 'failed'; report.error = { name: error.name, message: error.message }; throw error;
  } finally {
    report.finishedAt = now(); await publish();
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = {}, flags = { '--lean': 'lean', '--evidence-dir': 'evidenceDir', '--wasm': 'wasmPath',
    '--native': 'nativePath', '--runtime-source': 'runtimeSourceCommit', '--runtime-verification': 'runtimeVerification' };
  for (let i = 2; i < process.argv.length; i += 2) {
    assert.ok(flags[process.argv[i]] && process.argv[i + 1], `invalid argument ${process.argv[i]}`);
    options[flags[process.argv[i]]] = process.argv[i + 1];
  }
  options.evidenceDir ??= join(root, 'build/bool-sensor-validation');
  try {
    const result = await verify(options);
    console.log(JSON.stringify({ status: result.status, leanInvocations: result.results.length,
      successes: result.results.filter(r => r.exitCode === 0).length,
      expectedRejections: result.results.filter(r => r.exitCode !== 0).length, evidence: resolve(options.evidenceDir) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
