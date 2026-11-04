import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSourceSync } from '../../tools/compile-source.mjs';
import { leanOutcomeMatches } from '../lean-outcome.mjs';
import { compileEvidence, theoremInput, witnessInput, sha256 } from './bridge.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const args = process.argv.slice(2), lean = args[args.indexOf('--lean') + 1];
const directory = resolve(args.includes('--evidence-dir') ? args[args.indexOf('--evidence-dir') + 1] : 'build/two-sensor-provenance');
const now = () => new Date().toISOString();
await mkdir(directory, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), 'ghostflow-pair-proof-'));
const report = { status: 'running', startedAt: now(), productionCompilerProof: false,
  scope: 'Two separately evaluated output expressions over the same six input rails; each run has a fresh trace of capacity one',
  assumptions: ['SmallNumberLaws; production f64 correspondence is not proved',
    'JS AST projection/source-node assignment and file-to-Lean transport are trusted',
    'Whole-scan trace collection and full Rust refinement are not modeled'], results: [] };
const publish = async () => writeFile(join(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
async function identity() {
  const files = {};
  for (const folder of ['tools', 'experiments/two-sensor-provenance']) {
    async function walk(path) {
      for (const e of (await readdir(join(root, path), { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
        const p = join(path, e.name);
        if (e.isDirectory()) await walk(p);
        else if (/\.(lean|mjs)$/.test(e.name) || e.name.endsWith('.ghost.md')) files[p] = sha256(await readFile(join(root,p)));
      }
    }
    await walk(folder);
  }
  for (const n of ['BoolTranslation','ByteMachine','Serializer','DecoderSoundness','ModuleEnvelope','ModuleLoader']) {
    const p = `experiments/bool-translation-validation/${n}.lean`; files[p] = sha256(await readFile(join(root,p)));
  }
  for (const p of ['experiments/bool-sensor-validation/SensorMachine.lean','experiments/bool-sensor-validation/SensorProfile.lean',
    'experiments/bool-sensor-validation/bridge.mjs','experiments/lean-outcome.mjs','package-lock.json',
    'tests/two-sensor-provenance.test.mjs']) files[p] = sha256(await readFile(join(root,p)));
  return { files, sha256: sha256(JSON.stringify(files)) };
}
async function run(name, input, expectedSuccess = true, diagnostic, output = false, targetTheorem) {
  assert.doesNotMatch(input, /\b(sorry|admit|axiom|native_decide)\b|decide\s+\+native/);
  const path = join(scratch, `${name}.lean`); await writeFile(path, input);
  const result = spawnSync(lean, [...(output ? ['-o', join(scratch, `${name}.olean`)] : []), path],
    { cwd: scratch, env: {...process.env, LEAN_PATH: scratch}, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  const log = (result.stdout ?? '') + (result.stderr ?? '');
  let expectedFailureLine;
  if (targetTheorem) {
    const start = input.indexOf(`theorem ${targetTheorem} `); assert.ok(start >= 0);
    const body = input.indexOf(':= by decide', start); assert.ok(body >= 0);
    expectedFailureLine = input.slice(0, body).split('\n').length;
  }
  const passed = leanOutcomeMatches(result, log, expectedSuccess, diagnostic) &&
    (!expectedFailureLine || [...log.matchAll(/\.lean:(\d+):\d+: error:/g)].every(m=>Number(m[1])===expectedFailureLine) &&
      log.includes(`.lean:${expectedFailureLine}:`));
  await writeFile(join(directory, `${name}.lean`), input); await writeFile(join(directory, `${name}.log`), log);
  report.results.push({name, expectedSuccess, diagnostic, targetTheorem, expectedFailureLine, passed, exitCode: result.status, signal: result.signal,
    error: result.error?.message, at: now(), inputSha256: sha256(input), logSha256: sha256(log)});
  await publish(); assert.ok(passed, `${name}: unexpected Lean outcome\n${log}`);
}
try {
  assert.ok(args.includes('--lean'), '--lean required');
  const v = spawnSync(lean, ['--version'], {encoding:'utf8'}); assert.equal(v.status,0); assert.match(v.stdout,/version 4\.19\.0/);
  report.lean = {version:v.stdout.trim(), sha256:sha256(await readFile(lean))};
  report.sourceIdentity = await identity(); await publish();
  for (const n of ['BoolTranslation','ByteMachine','Serializer','DecoderSoundness','ModuleEnvelope','ModuleLoader'])
    await run(n, await readFile(join(root,'experiments/bool-translation-validation',`${n}.lean`),'utf8'),true,undefined,true);
  for (const n of ['SensorMachine','SensorProfile'])
    await run(n,await readFile(join(root,'experiments/bool-sensor-validation',`${n}.lean`),'utf8'),true,undefined,true);
  for (const n of ['SensorPairMachine','PairModule']) await run(n,await readFile(join(here,`${n}.lean`),'utf8'),true,undefined,true);
  const filename = 'experiments/two-sensor-provenance/fixtures/two-recover.ghost.md';
  const source = await readFile(join(root,filename),'utf8'), e = compileEvidence(source, filename);
  await writeFile(join(directory,'compiler-evidence.json'),JSON.stringify(e,null,2)+'\n');
  await writeFile(join(directory,'module.gfb'),Buffer.from(e.bytes));
  await writeFile(join(directory,'original.ghost.md'),source);
  await run('actual-two-sensor',theoremInput(e));
  const falseProposition = "tactic 'decide' proved that the proposition";
  for (const [name, side, edit] of [
    ['left-payload-slot',false,b=>b[e.located.outputs[0].start+7]=3],
    ['left-quality-slot',false,b=>b[e.located.outputs[0].start+1]=4],
    ['left-fault-slot',false,b=>b[e.located.outputs[0].start+25]=5],
    ['left-site',false,b=>b[e.located.outputs[0].start+41]=12],
    ['left-origin',false,b=>b[e.located.outputs[0].start+39]=34],
    ['right-payload-slot',true,b=>b[e.located.outputs[1].start+7]=0],
    ['right-quality-slot',true,b=>b[e.located.outputs[1].start+1]=1],
    ['right-site',true,b=>b[e.located.outputs[1].start+41]=7],
    ['right-origin',true,b=>b[e.located.outputs[1].start+39]=33],
    ['right-fault-slot',true,b=>b[e.located.outputs[1].start+25]=2],
  ]) {
    const bytes = [...e.bytes]; edit(bytes); assert.notDeepEqual(bytes,e.bytes);
    // Payload read mutants need healthy divergent values rather than the fault path.
    let input = witnessInput(bytes,side,name==='right-origin'||name==='right-fault-slot');
    if (name.includes('payload')) input = input.replaceAll('(.fault .stale)', '(.healthy false)');
    await run(`valid-structure-${name}`,input.slice(0,input.indexOf('theorem targetedEquality')));
    await run(`reject-${name}`,input,false,falseProposition,false,'targetedEquality');
  }
  const swapped = source.replace('left_out <- left','left_out <- right').replace('right_out <- right','right_out <- left');
  const swappedBytes = [...compileSourceSync(swapped,{filename}).bytes];
  await writeFile(join(directory,'source-swapped.ghost.md'),swapped);
  for (const side of [false,true]) {
    const input=witnessInput(swappedBytes,side);
    await run(`valid-source-swap-structure-${side}`,input.slice(0,input.indexOf('theorem targetedEquality')));
    await run(`reject-source-swap-${side}`,input,false,falseProposition,false,'targetedEquality');
  }
  for (const [name,edit] of [
    ['site',m=>m.resultSites[0].site=12], ['origin-tag',m=>m.resultSites[0].origins[0].tag=2],
    ['origin-node',m=>m.resultSites[0].origins[0].nodeId=2], ['origin-name',m=>m.resultSites[0].origins[0].name='right'],
  ]) { const changed=structuredClone(e); edit(changed.metadata); await run(`reject-metadata-${name}`,theoremInput(changed,e),false,falseProposition,false,'metadataBinding'); }
  const changedSource=structuredClone(e);changedSource.originalSourceBytes=[...Buffer.from(swapped)];
  await run('reject-original-source-swap',theoremInput(changedSource,e),false,falseProposition,false,'originalBytesBound');
  assert.deepEqual(await identity(),report.sourceIdentity,'source changed during proof');
  report.status='passed';
} catch(error) { report.status='failed'; report.error={name:error.name,message:error.message}; process.exitCode=1; }
finally { report.finishedAt=now(); await publish(); await rm(scratch,{recursive:true,force:true}); }
console.log(JSON.stringify({status:report.status,checks:report.results.length,evidence:directory,error:report.error?.message}));
