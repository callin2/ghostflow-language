import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, mkdtemp, readdir, rename, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {leanOutcomeMatches} from '../lean-outcome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const models = [
  ['bool-translation-validation', ['BoolTranslation', 'ByteMachine', 'Serializer', 'DecoderSoundness', 'ModuleEnvelope', 'ModuleLoader', 'SourceReader']],
  ['bool-sensor-validation', ['SensorMachine', 'SensorProfile', 'SensorSourceReader']],
  ['bool-sensor-state-validation', ['SensorStateRecovery', 'SensorStateMachine', 'SensorStateProfile', 'SensorStateSource']],
  ['elapsed-epoch-validation', ['EpochSource', 'EpochMachine', 'EpochModule']],
  ['elapsed-clock-bounds', ['ClockBounds']],
];

export function proofOutcome(result, log, expectedSuccess, expectedFailureLine) {
  const diagnostic = expectedSuccess ? undefined : "tactic 'decide' proved that the proposition";
  const errorLines = [...log.matchAll(/\.lean:(\d+):\d+: error:/g)].map(match => Number(match[1]));
  const targeted = !expectedFailureLine || errorLines.length > 0 && errorLines.every(line => line === expectedFailureLine);
  return leanOutcomeMatches(result, log, expectedSuccess, diagnostic) && targeted;
}

export async function sourceIdentity() {
  const files = {};
  async function walk(folder) {
    for (const entry of (await readdir(join(root, folder), {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(mjs|lean)$/.test(entry.name) || entry.name.endsWith('.ghost.md')) files[path] = sha256(await readFile(join(root, path)));
    }
  }
  for (const folder of ['tools', 'experiments/elapsed-epoch-validation', 'experiments/elapsed-clock-bounds']) await walk(folder);
  for (const [folder, names] of models) {
    for (const name of names) {
      const path = `experiments/${folder}/${name}.lean`;
      files[path] = sha256(await readFile(join(root, path)));
    }
  }
  for (const path of ['experiments/lean-outcome.mjs', 'experiments/bool-sensor-state-validation/bridge.mjs',
    'package-lock.json', 'tests/elapsed-clock-bounds.test.mjs', 'crates/ghostflow-core/src/lib.rs',
    'crates/ghostflow-core/src/scan.rs', 'runtimes/wasm/control-runtime.mjs', 'runtimes/wasm/framed-runtime.mjs']) {
    files[path] = sha256(await readFile(join(root, path)));
  }
  return {files, sha256: sha256(JSON.stringify(files))};
}

export async function verify({lean, evidenceDir}) {
  const directory = resolve(evidenceDir), path = join(directory, 'verification.json');
  await mkdir(directory, {recursive: true});
  const report = {schemaVersion: 1, status: 'running', startedAt: now(), productionCompilerProof: false,
    scope: 'Clock and mathematical elapsed bounds over the existing source-bound full-module epoch execution history',
    assumptions: ['AcceptedFrom models nonnegative monotonic integer clocks at most 2^53-1; public JS/Rust clock admission refinement is not proved',
      'Existing naturalNumbers and natural_laws instantiate the unchanged epoch machine; no f64 operation is evaluated by the bounds theorem'],
    unproved: ['Production f64 subtraction and Rust/model correspondence', 'General compiler and source parser correctness',
      'Actual Duration output expression execution, production scan commit and physical timing'], results: []};
  const publish = async () => {
    await writeFile(`${path}.tmp`, JSON.stringify(report, null, 2) + '\n');
    await rename(`${path}.tmp`, path);
  };
  let scratch;
  try {
    await publish();
    assert.ok(lean, '--lean is required');
    const version = spawnSync(lean, ['--version'], {encoding: 'utf8', timeout: 30000});
    assert.equal(version.status, 0, 'Lean version probe failed');
    assert.equal(version.signal, null);
    assert.equal(version.error, undefined);
    assert.match(version.stdout, /version 4\.19\.0/);
    report.lean = {version: version.stdout.trim(), executableSha256: sha256(await readFile(lean))};
    report.sourceIdentity = await sourceIdentity();
    await publish();
    scratch = await mkdtemp(join(tmpdir(), 'ghostflow-clock-bounds-'));
    async function run(name, input, {expectedSuccess = true, targetTheorem, output = false} = {}) {
      assert.doesNotMatch(input, /\b(sorry|admit|axiom|opaque|native_decide)\b|decide\s+\+native/);
      const inputPath = join(scratch, `${name}.lean`), startedAt = now();
      await writeFile(inputPath, input);
      const args = [...(output ? ['-o', join(scratch, `${name}.olean`)] : []), inputPath];
      const result = spawnSync(lean, args, {cwd: scratch, env: {...process.env, LEAN_PATH: scratch},
        encoding: 'utf8', timeout: 180000, maxBuffer: 8388608});
      const log = (result.stdout ?? '') + (result.stderr ?? '');
      let expectedFailureLine;
      if (targetTheorem) {
        const start = input.indexOf(`theorem ${targetTheorem} `);
        assert.ok(start >= 0, 'missing target theorem');
        const body = input.indexOf(':= by decide', start);
        assert.ok(body >= 0, 'missing target proof');
        expectedFailureLine = input.slice(0, body).split('\n').length;
      }
      const passed = proofOutcome(result, log, expectedSuccess, expectedFailureLine);
      await writeFile(join(directory, `${name}.lean`), input);
      await writeFile(join(directory, `${name}.log`), log);
      let compiledSha256;
      if (passed && output) {
        const compiled = await readFile(join(scratch, `${name}.olean`));
        compiledSha256 = sha256(compiled);
        await writeFile(join(directory, `${name}.olean`), compiled);
      }
      report.results.push({name, expectedSuccess, targetTheorem, expectedFailureLine, passed,
        exitCode: result.status, signal: result.signal, error: result.error?.message, startedAt, finishedAt: now(),
        inputSha256: sha256(input), logSha256: sha256(log), compiledSha256});
      await publish();
      assert.ok(passed, `${name}: unexpected Lean outcome\n${log}`);
    }
    for (const [folder, names] of models) {
      for (const name of names) await run(name, await readFile(join(root, 'experiments', folder, `${name}.lean`), 'utf8'), {output: true});
    }
    const {compileEvidence, theoremInput, sampleInput, targetedFailure, fixture} = await import('./bridge.mjs');
    const sourceBytes = await readFile(join(root, fixture)), source = sourceBytes.toString('utf8');
    assert.ok(Buffer.from(source).equals(sourceBytes), 'original UTF-8 transport changed');
    const evidence = compileEvidence(source, fixture);
    await writeFile(join(directory, 'compiler-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    await writeFile(join(directory, 'module.gfb'), Buffer.from(evidence.bytes));
    await writeFile(join(directory, 'original.ghost.md'), sourceBytes);
    await run('actual-original-source-bounds', theoremInput(evidence));
    for (const [name, changed] of [['initial-true', source.replace('held: Bool = false', 'held: Bool = true')],
      ['renamed-timer', source.replace('timer age =', 'timer epoch =')]]) {
      await run(`actual-${name}-bounds`, theoremInput(compileEvidence(changed, fixture)));
    }
    const bound = 'TraceBounds (EpochModule.initial naturalNumbers parsedSource) sampleInputs sampleObservations';
    const views = expected => `snapshotViews (EpochModule.initial naturalNumbers parsedSource) sampleInputs sampleObservations = some ${expected}`;
    for (const [name, inputs, proposition] of [
      ['empty', '[]', bound],
      ['equal-clock', '[⟨.healthy false, false, 29⟩, ⟨.healthy true, true, 29⟩]', bound],
      ['max-clock', '[⟨.healthy false, false, 0⟩, ⟨.healthy false, true, 9007199254740991⟩]', bound],
      ['max-difference', '[⟨.healthy false, false, 0⟩, ⟨.healthy false, true, 9007199254740991⟩]', views('[(0,0), (9007199254740991,9007199254740991)]')],
      ['change-snapshots', '[⟨.healthy false, false, 11⟩, ⟨.healthy true, true, 29⟩]', views('[(0,0), (18,0)]')],
      ['retain-snapshots', '[⟨.healthy false, false, 11⟩, ⟨.fault .stale, true, 29⟩]', views('[(0,0), (18,18)]')],
      ['three-second-change', '[⟨.healthy false, false, 1000⟩, ⟨.healthy true, true, 4000⟩]', views('[(0,0), (3000,0)]')],
    ]) await run(`accept-${name}`, sampleInput(evidence, inputs, proposition));
    for (const [name, inputs, proposition] of [
      ['backward-clock-bound', '[⟨.healthy false, false, 29⟩, ⟨.healthy false, true, 11⟩]', bound],
      ['over-max-clock-bound', '[⟨.healthy false, false, 9007199254740992⟩]', bound],
      ['candidate-as-expression', '[⟨.healthy false, false, 11⟩, ⟨.healthy true, true, 29⟩]', views('[(0,0), (0,0)]')],
      ['old-as-committed', '[⟨.healthy false, false, 11⟩, ⟨.healthy true, true, 29⟩]', views('[(0,0), (18,18)]')],
      ['first-expression-initialized', '[⟨.healthy false, false, 29⟩]', views('[(29,0)]')],
      ['retained-as-reset', '[⟨.healthy false, false, 11⟩, ⟨.fault .stale, true, 29⟩]', views('[(0,0), (18,0)]')],
    ]) {
      const input = sampleInput(evidence, inputs, proposition);
      await run(`valid-${name}-connection`, input.slice(0, input.indexOf('theorem targetedBound')));
      await run(`reject-${name}`, targetedFailure(input, 'targetedBound'), {expectedSuccess: false, targetTheorem: 'targetedBound'});
    }
    for (const [name, mutate, targetTheorem] of [
      ['source-recovery', e => { e.originalSourceBytes = [...Buffer.from(source.replace('recover(false)', 'recover(true)'))]; }, 'exactSourceRead'],
      ['artifact-clock-slot', e => { e.bytes[e.located.transitions[1].start + 8] = 2; }, 'codeBinding'],
      ['metadata-clock', e => { e.manifest.timers[0].clockInput = 'other'; }, 'metadataBinding'],
    ]) {
      const changed = structuredClone(evidence);
      mutate(changed);
      await run(`reject-${name}`, targetedFailure(theoremInput(changed), targetTheorem), {expectedSuccess: false, targetTheorem});
    }
    assert.deepEqual(await sourceIdentity(), report.sourceIdentity, 'proof inputs changed during verification');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = {name: error.name, message: error.message};
  } finally {
    report.finishedAt = now();
    await publish();
    if (scratch) await rm(scratch, {recursive: true, force: true});
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), leanAt = args.indexOf('--lean'), evidenceAt = args.indexOf('--evidence-dir');
  const report = await verify({lean: leanAt < 0 ? undefined : args[leanAt + 1],
    evidenceDir: evidenceAt < 0 ? join(root, 'build/elapsed-clock-bounds/proof') : args[evidenceAt + 1]});
  console.log(JSON.stringify({status: report.status, checks: report.results.length, error: report.error?.message}));
  if (report.status !== 'passed') process.exitCode = 1;
}
