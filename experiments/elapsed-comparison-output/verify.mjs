import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, mkdtemp, readdir, rename, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceIdentity as baseIdentity} from '../elapsed-duration-output/verify.mjs';
import {proofOutcome} from '../elapsed-clock-bounds/verify.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex'), now = () => new Date().toISOString();
const models = [
  ['bool-translation-validation', ['BoolTranslation','ByteMachine','Serializer','DecoderSoundness','ModuleEnvelope','ModuleLoader','SourceReader']],
  ['bool-sensor-validation', ['SensorMachine','SensorProfile','SensorSourceReader']],
  ['bool-sensor-state-validation', ['SensorStateRecovery','SensorStateMachine','SensorStateProfile','SensorStateSource']],
  ['elapsed-epoch-validation', ['EpochSource','EpochMachine','EpochModule']],
  ['elapsed-clock-bounds', ['ClockBounds']],
  ['elapsed-duration-output', ['DurationSource','DurationMachine','DurationModule']],
  ['elapsed-comparison-output', ['ComparisonSource','ComparisonMachine','ComparisonModule']],
];

export async function sourceIdentity() {
  const files = {...(await baseIdentity()).files};
  async function walk(folder) {
    for (const entry of (await readdir(join(root, folder), {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(lean|mjs)$/.test(entry.name) || entry.name.endsWith('.ghost.md')) files[path] = sha256(await readFile(join(root, path)));
    }
  }
  await walk('experiments/elapsed-comparison-output');
  const test = 'tests/elapsed-comparison-output.test.mjs'; files[test] = sha256(await readFile(join(root, test)));
  const sorted = Object.fromEntries(Object.entries(files).sort(([a],[b]) => a.localeCompare(b)));
  return {files: sorted, sha256: sha256(JSON.stringify(sorted))};
}

export async function verify({lean, evidenceDir}) {
  const directory = resolve(evidenceDir), receipt = join(directory, 'verification.json');
  await mkdir(directory, {recursive: true});
  const report = {schemaVersion: 1, status: 'running', startedAt: now(), dependencyReuse: false, productionCompilerProof: false,
    scope: 'Actual original source and complete two-Bool-output GFB admission; elapsed >= 3000 observations over all accepted histories in a Nat comparison model',
    assumptions: ['AcceptedFrom is the modeled public clock contract, not a proved JS/Rust admission refinement',
      'Opcode20 delegates to unchanged DurationMachine Nat subtraction; unchanged EpochMachine executes the state transitions',
      'Only exact binary64 encodings of 3000 and counterexample 3001 are mapped to Nat constants; no general f64 decoder theorem',
      'Opcode17 >= and counterexample opcode16 > compare Nats; production byte encodings are bound, numeric correspondence is assumed',
      'Output runValue has code.length+1 fuel, exact terminal PC and singleton stack; it is not actual Rust VM refinement'],
    unproved: ['General f64 decoding, subtraction, comparison and Rust/model correspondence', 'General compiler or source parser correctness',
      'Actual Rust loader admission of every mutated model artifact', 'Production scan commit, scheduler and physical relay timing'], results: []};
  const publish = async () => {await writeFile(`${receipt}.tmp`, JSON.stringify(report,null,2)+'\n'); await rename(`${receipt}.tmp`, receipt);};
  let scratch;
  try {
    await publish(); assert.ok(lean, '--lean is required');
    const version = spawnSync(lean, ['--version'], {encoding: 'utf8', timeout: 30000});
    assert.equal(version.status, 0, 'Lean version probe failed'); assert.equal(version.signal, null); assert.equal(version.error, undefined);
    assert.match(version.stdout, /version 4\.19\.0/);
    report.lean = {version: version.stdout.trim(), executableSha256: sha256(await readFile(lean))};
    report.sourceIdentity = await sourceIdentity(); await publish();
    scratch = await mkdtemp(join(tmpdir(), 'ghostflow-comparison-output-'));
    async function run(name, input, {output = false, expectedSuccess = true, targetTheorem} = {}) {
      assert.doesNotMatch(input, /\b(sorry|admit|axiom|opaque|native_decide)\b|decide\s+\+native/);
      const path = join(scratch, `${name}.lean`), startedAt = now(); await writeFile(path, input);
      const result = spawnSync(lean, [...(output ? ['-o', join(scratch, `${name}.olean`)] : []), path],
        {cwd: scratch, env: {...process.env, LEAN_PATH: scratch}, encoding: 'utf8', timeout: 180000, maxBuffer: 8388608});
      const log = (result.stdout ?? '') + (result.stderr ?? '');
      let expectedFailureLine;
      if (targetTheorem) {const start = input.indexOf(`theorem ${targetTheorem} `); assert.ok(start >= 0);
        const proof = input.indexOf(':= by decide', start); assert.ok(proof >= 0); expectedFailureLine = input.slice(0, proof).split('\n').length;}
      const passed = proofOutcome(result, log, expectedSuccess, expectedFailureLine);
      await writeFile(join(directory, `${name}.lean`), input); await writeFile(join(directory, `${name}.log`), log);
      let compiledSha256;
      if (passed && output) {const compiled = await readFile(join(scratch, `${name}.olean`)); compiledSha256 = sha256(compiled); await writeFile(join(directory, `${name}.olean`), compiled);}
      report.results.push({name, expectedSuccess, targetTheorem, expectedFailureLine, passed, exitCode: result.status, signal: result.signal,
        error: result.error?.message, startedAt, finishedAt: now(), inputSha256: sha256(input), logSha256: sha256(log), compiledSha256});
      await publish(); assert.ok(passed, `${name}: unexpected Lean outcome\n${log}`);
    }
    for (const [folder, names] of models) for (const name of names)
      await run(name, await readFile(join(root, 'experiments', folder, `${name}.lean`), 'utf8'), {output: true});
    const {compileEvidence, fixture, theoremInput, observationInput, replaceComparison, targetedFailure} = await import('./bridge.mjs');
    const bytes = await readFile(join(root, fixture)), source = bytes.toString('utf8');
    assert.ok(Buffer.from(source).equals(bytes), 'UTF-8 transport changed');
    const evidence = compileEvidence(source);
    await writeFile(join(directory, 'compiler-evidence.json'), JSON.stringify(evidence,null,2)+'\n');
    await writeFile(join(directory, 'module.gfb'), Buffer.from(evidence.bytes)); await writeFile(join(directory, 'original.ghost.md'), bytes);
    await run('actual-original-comparison', theoremInput(evidence));
    for (const [name, changed] of [['initial-true', source.replace('held: Bool = false', 'held: Bool = true')],
      ['renamed-output', source.replaceAll('expired', 'ready')],
      ['renamed-timer', source.replace('timer age =', 'timer epoch =').replace('expired <- age >=', 'expired <- epoch >=')]])
      await run(`actual-${name}`, theoremInput(compileEvidence(changed)));
    for (const [name, inputs, values] of [
      ['empty', '[]', []],
      ['first-nonzero-clock', '[⟨.healthy true,false,4000⟩]', [false]],
      ['threshold-neighbors', '[⟨.healthy false,false,1000⟩,⟨.healthy false,false,3999⟩,⟨.healthy false,false,4000⟩,⟨.healthy false,false,4001⟩]', [false,false,true,true]],
      ['reset-snapshot', '[⟨.healthy false,false,1000⟩,⟨.healthy true,true,4000⟩,⟨.healthy false,false,4001⟩,⟨.healthy false,false,6999⟩,⟨.healthy false,false,7000⟩]', [false,true,false,false,true]],
      ['same-clock', '[⟨.healthy false,false,4000⟩,⟨.healthy true,true,4000⟩,⟨.healthy false,false,4000⟩]', [false,false,false]],
      ['maximum-difference', '[⟨.healthy false,false,0⟩,⟨.healthy false,true,9007199254740991⟩]', [false,true]],
      ['maximum-origin', '[⟨.healthy true,false,9007199254740989⟩,⟨.healthy true,true,9007199254740990⟩,⟨.healthy false,true,9007199254740991⟩]', [false,false,false]],
      ['fault-and-stale', '[⟨.healthy false,false,1000⟩,⟨.fault .stale,true,3999⟩,⟨.fault .invalid,false,4000⟩,⟨.healthy true,true,4001⟩,⟨.fault .stale,false,4002⟩]', [false,false,true,true,false]],
    ]) await run(`observe-${name}`, observationInput(evidence, inputs, values));
    const code = evidence.located.outputs[1].bytes;
    const reset = '[⟨.healthy false,false,1000⟩,⟨.healthy true,true,4000⟩]';
    const witnesses = [
      ['greater-only', c => {c[26] = 16; return c;}, reset, [false,false]],
      ['literal-3001', c => {c[23] = 114; return c;}, reset, [false,false]],
      ['reversed-comparison-operands', c => [...c.slice(17,26),...c.slice(0,17),17],
        '[⟨.healthy false,false,1000⟩,⟨.healthy false,false,4001⟩]', [true,false]],
      ['candidate-since', c => {c[9] = 5; return c;}, reset, [false,false]],
      ['candidate-initialized', c => {c[0] = 5; return c;}, '[⟨.healthy false,false,4000⟩]', [true]],
      ['inverted-initialized-branch', c => [...c.slice(0,3),10,...c.slice(3)],
        '[⟨.healthy false,false,4000⟩,⟨.healthy false,false,7000⟩]', [true,false]],
    ];
    for (const [name, change, inputs, values] of witnesses) {
      const changed = replaceComparison(evidence, change([...code]));
      const input = observationInput(changed, inputs, values, true);
      await run(`valid-model-counterexample-${name}`, input.slice(0, input.indexOf('theorem targetedEquality')));
      await run(`reject-semantic-${name}`, targetedFailure(input, 'targetedEquality'), {expectedSuccess: false, targetTheorem: 'targetedEquality'});
    }
    for (const [name, change, target] of [
      ['output-type', e => {e.manifest.outputs[1].type = 'Duration';}, 'metadataBinding'],
      ['output-connection-node', e => {e.metadata.bindings.find(b => b.name === 'expired' && b.kind === 'connection').nodeId++;}, 'metadataBinding'],
      ['candidate-dependency', e => {e.metadata.dependencies.find(d => d.target.name === 'expired').reads[0].field = 'stateAfter';}, 'metadataBinding'],
      ['source-wrong-timer', e => {e.originalSourceBytes = [...Buffer.from(source.replace('expired <- age >=', 'expired <- held >='))];}, 'exactSourceRead'],
      ['source-collision', e => {e.originalSourceBytes = [...Buffer.from(source.replaceAll('expired', 'relay'))];}, 'exactSourceRead'],
      ['source-operator', e => {e.originalSourceBytes = [...Buffer.from(source.replace('age >= 3000ms', 'age > 3000ms'))];}, 'exactSourceRead'],
      ['source-threshold', e => {e.originalSourceBytes = [...Buffer.from(source.replace('3000ms', '3001ms'))];}, 'exactSourceRead'],
      ['relay-physical-type', e => {e.bytes[e.located.outputs[0].start - 5] = 2;}, 'structurallyParsed'],
      ['comparison-physical-type', e => {e.bytes[e.located.outputs[1].start - 5] = 2;}, 'structurallyParsed'],
      ['initial-timer-state', e => {e.bytes[e.located.states[2].start] = 1;}, 'structurallyParsed'],
      ['transition-clock-slot', e => {e.bytes[e.located.transitions[1].start + 8] = 2;}, 'codeBinding'],
      ['capability-type', e => {const caps = e.located.capabilities; e.bytes[caps.start + caps.bytes.length - 4] = 2;}, 'structurallyParsed'],
    ]) {
      const changed = structuredClone(evidence); change(changed);
      if (target === 'metadataBinding') {
        const input = theoremInput(changed).split('theorem metadataBinding')[0] +
          'theorem rejectsChangedMetadata : ComparisonModule.observeModule parsedSource artifactBytes actualMetadata [] = none := by decide\n';
        await run(`valid-metadata-rejection-${name}`, input);
      }
      await run(`reject-${name}`, targetedFailure(theoremInput(changed), target), {expectedSuccess: false, targetTheorem: target});
    }
    const trailing = structuredClone(evidence); trailing.bytes.push(0);
    const trailingInput = theoremInput(evidence).split('theorem structurallyParsed')[0]
      .replace(JSON.stringify(evidence.bytes), JSON.stringify(trailing.bytes));
    await run('reject-trailing-module-byte', trailingInput +
      'theorem rejectsTrailing : ComparisonModule.moduleTrace parsedSource artifactBytes [] = none := by decide\n');
    assert.deepEqual(await sourceIdentity(), report.sourceIdentity, 'proof inputs changed during execution');
    report.status = 'passed';
  } catch (error) {report.status = 'failed'; report.error = {name: error.name, message: error.message};}
  finally {report.finishedAt = now(); await publish(); if (scratch) await rm(scratch, {recursive: true, force: true});}
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), leanAt = args.indexOf('--lean'), evidenceAt = args.indexOf('--evidence-dir');
  const report = await verify({lean: leanAt < 0 ? undefined : args[leanAt + 1],
    evidenceDir: evidenceAt < 0 ? join(root, 'build/elapsed-comparison-output/proof') : args[evidenceAt + 1]});
  console.log(JSON.stringify({status: report.status, checks: report.results.length, error: report.error?.message}));
  if (report.status !== 'passed') process.exitCode = 1;
}
