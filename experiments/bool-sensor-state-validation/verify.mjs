import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, mkdtemp, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileEvidence, theoremInput, admissionInput, sourceAdmissionInput, sha256 } from './bridge.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const now = () => new Date().toISOString();
const oldModels = ['BoolTranslation', 'ByteMachine', 'Serializer', 'DecoderSoundness', 'ModuleEnvelope', 'ModuleLoader', 'SourceReader'];
const sensorModels = ['SensorMachine', 'SensorProfile', 'SensorSourceReader'];
const models = ['SensorStateRecovery', 'SensorStateMachine', 'SensorStateProfile', 'SensorStateSource'];
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
  for (const folder of ['tools', 'runtimes/wasm', 'experiments/bool-sensor-state-validation']) await walk(folder);
  for (const [folder, names] of [['bool-translation-validation', oldModels], ['bool-sensor-validation', sensorModels]]) {
    for (const name of names) {
      const path = `experiments/${folder}/${name}.lean`;
      files[path] = sha256(await readFile(join(root, path)));
    }
  }
  for (const path of ['package-lock.json', 'crates/ghostflow-core/src/lib.rs', 'tests/bool-sensor-state-validation.test.mjs']) {
    files[path] = sha256(await readFile(join(root, path)));
  }
  return { files, sha256: sha256(JSON.stringify(files)) };
}

export async function verify({ lean, evidenceDir }) {
  const directory = resolve(evidenceDir), reportPath = join(directory, 'verification.json');
  await mkdir(directory, { recursive: true });
  const report = { schemaVersion: 1, status: 'running', startedAt: now(), productionCompilerProof: false,
    scope: 'Original bounded canonical source, raw module loader, recovery/state opcode execution and all finite input histories',
    assumptions: ['SmallNumberLaws for numeric operations', 'file-to-Lean literal transport and Lean foundations'],
    unproved: ['Rust/model and f64 correspondence', 'general compiler and source parser correctness',
      'natural-language intent interpretation', 'hardware and product acceptance'], results: [] };
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
    scratch = await mkdtemp(join(tmpdir(), 'ghostflow-sensor-state-proof-'));
    const run = async (name, input, expectedSuccess = true, diagnostic, output = false) => {
      const path = join(scratch, `${name}.lean`), startedAt = now();
      assert.doesNotMatch(input, /\b(sorry|admit|axiom|native_decide)\b|decide\s+\+native/);
      await writeFile(path, input);
      const result = spawnSync(lean, [...(output ? ['-o', join(scratch, `${name}.olean`)] : []), path],
        { cwd: scratch, env: { ...process.env, LEAN_PATH: scratch }, encoding: 'utf8', timeout: 600000, maxBuffer: 4 * 1024 * 1024 });
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
    for (const [folder, names] of [['bool-translation-validation', oldModels], ['bool-sensor-validation', sensorModels], ['bool-sensor-state-validation', models]]) {
      for (const name of names) await run(name, await readFile(join(root, 'experiments', folder, `${name}.lean`), 'utf8'), true, undefined, true);
    }
    const filename = 'experiments/bool-sensor-state-validation/fixtures/toggle.ghost.md';
    const bytes = await readFile(join(root, filename)), source = bytes.toString('utf8');
    assert.ok(Buffer.from(source).equals(bytes), 'original source must round-trip UTF-8');
    const evidence = compileEvidence(source, filename);
    await writeFile(join(directory, 'compiler-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    await run('actual-original-source', theoremInput(evidence, bytes));
    await run('machine-boundaries', `import SensorStateMachine
open BoolTranslation.SensorMachine BoolTranslation.SensorStateMachine
example : rawTrace naturalNumbers transitionCode outputCode false [] = some [] := by decide
example : rawTrace naturalNumbers transitionCode outputCode false
  [⟨.healthy true, false⟩, ⟨.fault .stale, true⟩, ⟨.healthy false, true⟩, ⟨.healthy true, false⟩] =
  some [⟨true, true, [⟨7,0,0⟩]⟩, ⟨true, true, [⟨7,2,1⟩]⟩,
        ⟨true, true, [⟨7,0,0⟩]⟩, ⟨false, false, [⟨7,0,0⟩]⟩] := by decide
example : step naturalNumbers [5,0,0] [] [.bool true] none 1 ⟨0,[],[]⟩ = none := by decide
example : step naturalNumbers [4,1,0] [] [.bool true] none 1 ⟨0,[],[]⟩ = none := by decide
example : step naturalNumbers [10] [] [] none 1 ⟨0,[.number 1],[]⟩ = none := by decide
example : step naturalNumbers [56,7,0,0,0] [] [] none 1
  ⟨0,[.number 0,.number 0,.bool true],[⟨7,0,0⟩]⟩ = none := by decide
`);
    for (const [name, edit] of [
      ['initial-true', s => s.replace('held: Bool = false', 'held: Bool = true')],
      ['renamed-module', s => s.replace('SensorToggle', 'RenamedToggle')],
      ['renamed-input', s => s.replaceAll('trigger', 'switch_bit')],
      ['renamed-state', s => s.replaceAll('held', 'memory_bit')],
      ['renamed-output', s => s.replaceAll('relay', 'output_bit')],
      ['trivia', s => s.replace('  input trigger:', '\t// comment\n  input trigger:')],
    ]) {
      const changed = edit(source), compiled = compileEvidence(changed, filename);
      await run(`accepts-${name}`, theoremInput(compiled, Buffer.from(changed)));
      if (name !== 'trivia') await run(`rejects-colluding-${name}`, theoremInput(compiled, bytes), false, falseProposition);
    }
    const rejectedSources = [
      ['recovery-true', s => s.replace('recover(false)', 'recover(true)')],
      ['wrong-input', s => s.replace('(trigger |>', '(other |>')],
      ['wrong-state-yes', s => s.replace('!held', '!other')],
      ['candidate-in-transition', s => s.replace('!held', "!held'")],
      ['old-output', s => s.replace("relay <- held'", 'relay <- held')],
      ['wrong-output', s => s.replace('relay <-', 'other <-')],
      ['extra-input', s => s.replace('input trigger:', 'input extra: Bool; input trigger:')],
      ['reordered-declaration', s => s.replace('  input trigger: Bool;\n  state held: Bool = false;', '  state held: Bool = false;\n  input trigger: Bool;')],
      ['initial-expression', s => s.replace('held: Bool = false', 'held: Bool = !true')],
      ['extra-code-fence', s => `${s}\n\`\`\`ghost\ncontrol Other {}\n\`\`\`\n`],
      ['name-collision', s => s.replaceAll('held', 'trigger')],
    ];
    for (const [name, edit] of rejectedSources) {
      const changed = edit(source);
      assert.notEqual(changed, source, `${name}: mutation drift`);
      await run(`source-rejects-${name}`, sourceAdmissionInput(Buffer.from(changed), false));
      await run(`original-proof-rejects-${name}`, theoremInput(evidence, Buffer.from(changed)), false, falseProposition);
    }
    for (const [name, edit] of [
      ['site', e => e.metadata.sites[0].site++],
      ['site-node', e => e.metadata.sites[0].nodeId++],
      ['origin', e => e.metadata.sites[0].origins[0].tag++],
      ['origin-node', e => e.metadata.sites[0].origins[0].nodeId++],
      ['origin-name', e => { e.metadata.sites[0].origins[0].name = 'other'; }],
      ['kind', e => { e.metadata.sites[0].kind = 'case'; }],
      ['error-domain', e => { e.metadata.sites[0].errorType = 'ClockFault'; }],
      ['rails', e => e.metadata.sensors[0].rails.reverse()],
      ['sensor-type', e => { e.metadata.sensors[0].type = 'Number'; }],
      ['projection-initial', e => { e.projection.initial = true; }],
      ['projection-state', e => { e.projection.state = 'other'; }],
      ['projection-site', e => e.projection.site++],
    ]) {
      const changed = structuredClone(evidence); edit(changed);
      await run(`rejects-metadata-or-projection-${name}`, theoremInput(changed, bytes), false, falseProposition);
    }
    const raw = evidence.bytes, codeStart = Buffer.from(raw).indexOf(Buffer.from([3,1,0,30,6,0,3,0,0,31]));
    assert.ok(codeStart > 0);
    const stateStart = Buffer.from(raw).indexOf(Buffer.from(evidence.projection.state));
    assert.ok(stateStart > 4);
    assert.equal(raw[stateStart + evidence.projection.state.length], 1);
    const changedInitial = structuredClone(evidence);
    changedInitial.bytes[stateStart + evidence.projection.state.length + 1] = 1;
    await run('raw-initial-rejects-original-source', theoremInput(changedInitial, bytes), false, falseProposition);
    for (const [name, edit] of [
      ['state-type', a => { a[stateStart + evidence.projection.state.length] = 2; }],
      ['state-count', a => { a[stateStart - 4] = 2; }],
      ['transition-target', a => { a[codeStart - 6] = 1; }],
      ['expression-length', a => { a[codeStart - 4]++; }],
      ['quality-slot', a => { a[codeStart + 1] = 0; }],
      ['recovery-fallback', a => { a[codeStart + 13] = 1; }],
      ['fault-increment', a => { a[codeStart + 27] = 32; }],
      ['origin', a => { a[codeStart + 39] = 32; }],
      ['site', a => { a[codeStart + 41] = 5; }],
      ['old-state-slot', a => { a[codeStart + 49] = 1; }],
      ['state-negation', a => { a[codeStart + 51] = 32; }],
      ['state-branch', a => { a[codeStart + 46] = 6; }],
      ['candidate-output', a => { a[a.length - 5] = 4; }],
      ['trailing', a => a.push(0)],
      ['truncated', a => a.pop()],
    ]) {
      const changed = [...raw]; edit(changed);
      await run(`raw-rejects-${name}`, admissionInput(changed));
    }
    const reader = await readFile(join(here, 'SensorStateSource.lean'), 'utf8');
    const wrongAllocator = reader.replace('structure ParsedSource where',
      'def wrongFresh : SensorSourceReader.Parser Nat := do\n  let id ← fresh\n  let _ ← fresh\n  pure id\n\nstructure ParsedSource where')
      .replaceAll('← fresh', '← wrongFresh')
      .replace('let id ← wrongFresh\n  let _ ← wrongFresh', 'let id ← fresh\n  let _ ← fresh');
    await run('rejects-source-node-allocation', wrongAllocator + theoremInput(evidence, bytes).replace(/^import SensorStateSource\n/, ''), false, falseProposition);
    const machine = await readFile(join(here, 'SensorStateRecovery.lean'), 'utf8') +
      (await readFile(join(here, 'SensorStateMachine.lean'), 'utf8')).replace(/^import SensorStateRecovery\n/, '');
    for (const [name, before, after] of [
      ['candidate-reads-old', 'let value ← next[i]?', 'let value ← before[i]?'],
      ['state-negation', 'stack := .bool (!value) :: rest', 'stack := .bool value :: rest'],
    ]) {
      assert.ok(machine.includes(before), `${name}: machine mutation drift`);
      await run(`rejects-machine-${name}`, machine.replace(before, after), false, "tactic 'rfl' failed");
    }
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
  const options = {}, flags = { '--lean': 'lean', '--evidence-dir': 'evidenceDir' };
  for (let i = 2; i < process.argv.length; i += 2) {
    assert.ok(flags[process.argv[i]] && process.argv[i + 1], `invalid argument ${process.argv[i]}`);
    options[flags[process.argv[i]]] = process.argv[i + 1];
  }
  options.evidenceDir ??= join(root, 'build/bool-sensor-state-validation');
  try {
    const result = await verify(options);
    console.log(JSON.stringify({ status: result.status, leanInvocations: result.results.length,
      successes: result.results.filter(r => r.exitCode === 0).length,
      expectedRejections: result.results.filter(r => r.exitCode !== 0).length, evidence: resolve(options.evidenceDir) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
