import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rename, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileEvidence, sha256, theoremInput, validateArtifact, wireBytes } from './bridge.mjs';
import { pcTheoremInput } from './pc-bridge.mjs';
import { pcErrorCases, pcMutations } from './pc-cases.mjs';
import { serializerTheoremInput } from './serializer-bridge.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const now = () => new Date().toISOString();
const fixtureNames = ['snapshot-branches', 'boolean-literals', 'wide-branch'];
const falseProposition = "tactic 'decide' proved that the proposition";

async function sourceIdentity() {
  const paths = ['package.json', 'package-lock.json', 'crates/ghostflow-core/src/lib.rs',
    'tests/bool-translation-validation.test.mjs'];
  async function walk(path) {
    for (const entry of (await readdir(join(root, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.name.endsWith('.mjs') || entry.name.endsWith('.lean') || entry.name.endsWith('.ghost.md')) paths.push(child);
    }
  }
  await walk('tools');
  await walk(relative(root, here));
  const files = {};
  for (const path of paths.sort()) files[path] = sha256(await readFile(join(root, path)));
  return { files, sha256: sha256(JSON.stringify(files)) };
}

export async function verify({ lean, evidenceDir }) {
  const directory = resolve(evidenceDir), reportPath = join(directory, 'verification.json');
  await mkdir(directory, { recursive: true });
  const report = { schemaVersion: 1, status: 'running', startedAt: now(), productionCompilerProof: false,
    scope: 'Bool translation, simultaneous tick, byte-PC execution and bounded serialization/recovery, all valuations', results: [], artifacts: [] };
  const publish = async () => {
    await writeFile(`${reportPath}.tmp`, JSON.stringify(report, null, 2) + '\n');
    await rename(`${reportPath}.tmp`, reportPath);
  };
  await publish();
  let scratch;
  try {
    requireArgument(lean, '--lean is required');
    report.sourceIdentity = await sourceIdentity();
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    assert.equal(git.status, 0, 'git identity unavailable');
    report.baseCommit = git.stdout.trim();
    const version = spawnSync(lean, ['--version'], { encoding: 'utf8', timeout: 30000 });
    report.lean = { executable: lean, exitCode: version.status, version: version.stdout, error: version.error?.message };
    assert.equal(version.status, 0, 'Lean version check failed');
    requireArgument(version.stdout.includes('version 4.19.0'), 'proof requires Lean 4.19.0');
    report.lean.executableSha256 = sha256(await readFile(lean));
    const dependencies = spawnSync('npm', ['ls', '--depth=0', '--json'], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(dependencies.status, 0, 'installed dependency check failed');
    report.dependencies = { exitCode: dependencies.status, tree: JSON.parse(dependencies.stdout),
      lockfileSha256: report.sourceIdentity.files['package-lock.json'] };
    scratch = await mkdtemp(join(tmpdir(), 'ghostflow-bool-proof-'));
    const model = await readFile(join(here, 'BoolTranslation.lean'), 'utf8');
    requireArgument(!/\b(sorry|axiom|native_decide)\b/.test(model), 'prohibited proof escape');
    const run = async (name, content, expectedSuccess, diagnostic, output) => {
      const path = join(scratch, `${name}.lean`), start = now();
      await writeFile(path, content);
      const result = spawnSync(lean, [...(output ? ['-o', join(scratch, output)] : []), path],
        { cwd: scratch, env: { ...process.env, LEAN_PATH: scratch }, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
      const log = (result.stdout ?? '') + (result.stderr ?? '');
      const passed = !result.error && (result.status === 0) === expectedSuccess
        && (!diagnostic || log.includes(diagnostic)) && (!expectedSuccess || !log.includes('sorryAx'));
      await writeFile(join(directory, `${name}.lean`), content);
      await writeFile(join(directory, `${name}.log`), log);
      report.results.push({ name, expectedSuccess, expectedDiagnostic: diagnostic, passed,
        exitCode: result.status, signal: result.signal, processError: result.error?.message,
        startedAt: start, finishedAt: now(), inputSha256: sha256(content), logSha256: sha256(log) });
      await publish();
      assert.ok(passed, `${name}: unexpected Lean outcome\n${log}`);
    };
    await run('BoolTranslation', model, true, undefined, 'BoolTranslation.olean');
    const pcModel = await readFile(join(here, 'ByteMachine.lean'), 'utf8');
    requireArgument(!/\b(sorry|axiom|native_decide)\b/.test(pcModel), 'prohibited PC proof escape');
    await run('ByteMachine', pcModel, true, undefined, 'ByteMachine.olean');
    await run('pc-runtime-errors', `import ByteMachine\n${pcErrorCases}`, true);
    const serializerModel = await readFile(join(here, 'Serializer.lean'), 'utf8');
    requireArgument(!/\b(sorry|axiom|native_decide)\b/.test(serializerModel), 'prohibited serializer proof escape');
    const { serializerCases, serializerMutations } = await import('./serializer-cases.mjs');
    await run('Serializer', serializerModel, true, undefined, 'Serializer.olean');
    await run('serializer-boundaries', `import Serializer\n${serializerCases}`, true);
    const compiled = [];
    for (const name of fixtureNames) {
      const filename = `experiments/bool-translation-validation/fixtures/${name}.ghost.md`;
      const evidence = await compileEvidence(await readFile(join(root, filename), 'utf8'), filename);
      compiled.push(evidence);
      const serialized = JSON.stringify(evidence, null, 2) + '\n';
      await writeFile(join(directory, `${name}.json`), serialized);
      await writeFile(join(directory, `${name}.gfb`), Uint8Array.from(evidence.artifact.bytes));
      report.artifacts.push({ fixture: filename, sourceSha256: evidence.source.sha256,
        artifactSha256: evidence.artifact.sha256, bridgeEvidenceSha256: sha256(serialized) });
      await run(name, theoremInput(evidence), true);
      await run(`${name}-pc`, pcTheoremInput(evidence), true);
      await run(`${name}-serializer`, serializerTheoremInput(evidence), true);
    }
    for (const mutation of pcMutations) {
      assert.ok(pcModel.includes(mutation.before), `${mutation.name} target drifted`);
      await run(mutation.name, pcModel.replaceAll(mutation.before, mutation.after) + pcErrorCases, false, mutation.diagnostic);
    }
    for (const mutation of serializerMutations) {
      assert.ok(serializerModel.includes(mutation.before), `${mutation.name} target drifted`);
      await run(mutation.name, serializerModel.replaceAll(mutation.before, mutation.after) + serializerCases, false, mutation.diagnostic);
    }
    await run('rejected-pc-candidate-absent', 'import ByteMachine\nopen BoolTranslation BoolTranslation.ByteMachine\nexample : inScope (.next 0 rfl : Expr true) ⟨0, 1, false⟩ = true := by decide\n', false, falseProposition);
    await run('rejected-pc-state-bound', 'import ByteMachine\nopen BoolTranslation BoolTranslation.ByteMachine\nexample : inScope (.previous 1 : Expr false) ⟨0, 1, false⟩ = true := by decide\n', false, falseProposition);
    const wrongCounts = structuredClone(compiled[0]);
    wrongCounts.decoded.states.pop();
    await run('rejected-pc-header-count', pcTheoremInput(wrongCounts), false, falseProposition);
    const mutate = async (name, index, edit) => {
      const changed = structuredClone(compiled[index]);
      edit(changed);
      await run(name, theoremInput(changed), false, falseProposition);
    };
    const rebind = (evidence, entry) => evidence.artifact.bytes.splice(entry.offset, entry.length, ...wireBytes(entry.wire));
    await mutate('rejected-false-offset', 0, e => {
      const entry = e.decoded.outputs[2]; entry.wire.falseOffset[0]++; rebind(e, entry);
    });
    await mutate('rejected-jump-offset', 0, e => {
      const entry = e.decoded.outputs[2]; entry.wire.jumpOffset[0]++; rebind(e, entry);
    });
    await mutate('rejected-old-to-next', 0, e => {
      const entry = e.decoded.outputs[0]; entry.wire.opcode = 5; rebind(e, entry);
    });
    await mutate('rejected-transition-next', 0, e => {
      const entry = e.decoded.transitions[0]; entry.wire.opcode = 5; rebind(e, entry);
    });
    await mutate('rejected-state-index', 0, e => {
      const entry = e.decoded.transitions[0]; entry.wire.low = 0; rebind(e, entry);
    });
    await mutate('rejected-literal', 1, e => {
      const entry = e.decoded.outputs[1]; entry.wire.raw = 0; rebind(e, entry);
    });
    await mutate('rejected-stale-source', 0, e => { e.projection.outputs[0].expression.index = 1; });
    await mutate('rejected-trailing-expression-byte', 0, e => { e.decoded.outputs[0].length++; });
    await run('rejected-transition-phase', 'import BoolTranslation\nopen BoolTranslation\nexample : Expr false := .next 0 rfl\n', false, 'type mismatch');
    await run('rejected-omitted-expression', 'import BoolTranslation\nopen BoolTranslation\nexample : checkList ([.literal true] : List (Expr false)) [] = true := by decide\n', false, falseProposition);
    const reversed = model.replace('if b then run y env else run n env', 'if b then run n env else run y env');
    assert.notEqual(reversed, model, 'branch mutation target drifted');
    await run('rejected-reversed-runtime-branch', reversed, false, 'unsolved goals');
    const [beforeTick, tickRest] = model.split('def byteTick');
    const snapshotMutation = tickRest.replace('let outputEnv := { env with next := updated env.previous targets values }',
      'let outputEnv := { env with previous := updated env.previous targets values, next := updated env.previous targets values }');
    assert.notEqual(snapshotMutation, tickRest, 'snapshot mutation target drifted');
    await run('rejected-overwritten-old-snapshot', `${beforeTick}def byteTick${snapshotMutation}`, false, 'unsolved goals');
    const sequential = `def runSequential : List Wire → List Nat → Env → Option (List Bool)
  | [], [], _ => some []
  | w :: ws, target :: rest, env => do
    let value ← run w env
    let tail ← runSequential ws rest { env with previous := fun i => if i = target then value else env.previous i }
    pure (value :: tail)
  | _, _, _ => none

`;
    const sequentialTick = tickRest.replace('let values ← runList transitions env', 'let values ← runSequential transitions targets env');
    assert.notEqual(sequentialTick, tickRest, 'sequential mutation target drifted');
    await run('rejected-sequential-transitions', `${beforeTick}${sequential}def byteTick${sequentialTick}`, false, 'unsolved goals');
    const admission = (name, change, expected) => {
      const bytes = Uint8Array.from(compiled[0].artifact.bytes), modified = change(bytes) ?? bytes;
      assert.throws(() => validateArtifact(compiled[0].projection, modified), expected);
      report.results.push({ name, passed: true, expectedSuccess: false, expectedDiagnostic: expected.source,
        observedAt: now(), bytesSha256: sha256(modified) });
    };
    admission('rejected-format-21', bytes => { bytes[4] = 21; }, /unsupported GFB format/);
    admission('rejected-format-2', bytes => { bytes[4] = 2; }, /unsupported GFB format/);
    admission('rejected-unknown-opcode', bytes => { bytes[compiled[0].decoded.outputs[0].offset] = 255; }, /unsupported expression opcode/);
    admission('rejected-truncated-module', bytes => bytes.slice(0, -1), /truncated bytes/);
    admission('rejected-trailing-module', bytes => Uint8Array.from([...bytes, 0]), /trailing bytes/);
    admission('rejected-module-name', bytes => { bytes[8] = 88; }, /module name differs from source/);
    admission('rejected-initial-state', bytes => { bytes[compiled[0].decoded.states[0].initialOffset] ^= 1; }, /initial values differ from source/);
    admission('rejected-state-type', bytes => { bytes[compiled[0].decoded.states[0].typeOffset] = 2; }, /non-Bool state/);
    admission('rejected-swapped-targets', bytes => {
      bytes[compiled[0].decoded.transitions[0].targetOffset] = 1;
      bytes[compiled[0].decoded.transitions[1].targetOffset] = 0;
    }, /transition targets must cover state declaration order/);
    admission('rejected-duplicate-target', bytes => { bytes[compiled[0].decoded.transitions[1].targetOffset] = 0; }, /duplicate transition/);
    admission('rejected-expression-length', bytes => { bytes[compiled[0].decoded.outputs[0].offset - 4]++; }, /unsupported expression opcode|truncated bytes|expression must produce/);
    assert.deepEqual(await sourceIdentity(), report.sourceIdentity, 'source changed during verification');
    report.status = 'passed';
    return report;
  } catch (error) {
    report.status = 'failed';
    report.error = { name: error.name, message: error.message };
    throw error;
  } finally {
    report.finishedAt = now();
    await publish();
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}

function requireArgument(condition, message) { if (!condition) throw new Error(message); }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (key !== '--lean' && key !== '--evidence-dir') throw new Error(`Unknown argument ${key}`);
    options[key === '--lean' ? 'lean' : 'evidenceDir'] = process.argv[i + 1];
  }
  options.evidenceDir ??= join(root, 'build/bool-translation-validation');
  try {
    const result = await verify(options);
    console.log(JSON.stringify({ status: result.status, results: result.results.length, evidence: resolve(options.evidenceDir) }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
