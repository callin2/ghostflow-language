import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,rm,readdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileSourceSync} from '../../tools/compile-source.mjs';
import {leanOutcomeMatches} from '../lean-outcome.mjs';
import {compileEvidence,theoremInput,witnessInput,sha256} from './bridge.mjs';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..'),args=process.argv.slice(2);
const lean=args[args.indexOf('--lean')+1],directory=resolve(args.includes('--evidence-dir')?args[args.indexOf('--evidence-dir')+1]:'build/elapsed-epoch-validation/proof');
await mkdir(directory,{recursive:true});const scratch=await mkdtemp(join(tmpdir(),'ghostflow-epoch-proof-')),now=()=>new Date().toISOString();
const models=[['bool-translation-validation',['BoolTranslation','ByteMachine','Serializer','DecoderSoundness','ModuleEnvelope','ModuleLoader','SourceReader']],
  ['bool-sensor-validation',['SensorMachine','SensorProfile','SensorSourceReader']],
  ['bool-sensor-state-validation',['SensorStateRecovery','SensorStateMachine','SensorStateProfile','SensorStateSource']],
  ['elapsed-epoch-validation',['EpochSource','EpochMachine','EpochModule']]];
const report={status:'running',startedAt:now(),productionCompilerProof:false,
  scope:'Original canonical source and full GFB binding; finite-step adapter for elapsed-state epoch selection and all finite reading/stale/time histories',
  assumptions:['SmallNumberLaws remains explicit; numeric now/since are only passed through',
    'runValue is an adapter with checked final PC and single Value stack, not Rust VM refinement',
    'Duration subtraction, f64 correspondence, atomic production scan commit and physical timing are not proved'],results:[]};
const publish=async()=>{const p=join(directory,'verification.json');await writeFile(`${p}.tmp`,JSON.stringify(report,null,2)+'\n');await rename(`${p}.tmp`,p);};
async function identity(){const files={};async function walk(p){for(const e of(await readdir(join(root,p),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const f=join(p,e.name);if(e.isDirectory())await walk(f);else if(/\.(mjs|lean)$/.test(e.name)||e.name.endsWith('.ghost.md'))files[f]=sha256(await readFile(join(root,f)));}}
  await walk('tools');await walk('experiments/elapsed-epoch-validation');
  for(const[dir,names]of models)if(dir!=='elapsed-epoch-validation')for(const n of names){const p=`experiments/${dir}/${n}.lean`;files[p]=sha256(await readFile(join(root,p)));}
  for(const p of ['experiments/lean-outcome.mjs','experiments/bool-sensor-state-validation/bridge.mjs','package-lock.json','tests/elapsed-epoch-validation.test.mjs'])files[p]=sha256(await readFile(join(root,p)));
  return {files,sha256:sha256(JSON.stringify(files))};}
async function run(name,input,expectedSuccess=true,diagnostic,output=false,targetTheorem){
  assert.doesNotMatch(input,/\b(sorry|admit|axiom|opaque|native_decide)\b|decide\s+\+native/);
  const path=join(scratch,`${name}.lean`);await writeFile(path,input);
  const r=spawnSync(lean,[...(output?['-o',join(scratch,`${name}.olean`)]:[]),path],{cwd:scratch,env:{...process.env,LEAN_PATH:scratch},encoding:'utf8',timeout:180000,maxBuffer:8388608});
  const log=(r.stdout??'')+(r.stderr??'');let expectedFailureLine;
  if(targetTheorem){const start=input.indexOf(`theorem ${targetTheorem} `);assert.ok(start>=0);const body=input.indexOf(':= by decide',start);assert.ok(body>=0);expectedFailureLine=input.slice(0,body).split('\n').length;}
  const passed=leanOutcomeMatches(r,log,expectedSuccess,diagnostic)&&(!expectedFailureLine||log.includes(`.lean:${expectedFailureLine}:`)&&[...log.matchAll(/\.lean:(\d+):\d+: error:/g)].every(m=>Number(m[1])===expectedFailureLine));
  await writeFile(join(directory,`${name}.lean`),input);await writeFile(join(directory,`${name}.log`),log);
  report.results.push({name,expectedSuccess,diagnostic,targetTheorem,expectedFailureLine,passed,exitCode:r.status,signal:r.signal,error:r.error?.message,at:now(),inputSha256:sha256(input),logSha256:sha256(log)});
  await publish();assert.ok(passed,`${name}: unexpected Lean outcome\n${log}`);
}
try{
  await publish();
  assert.ok(args.includes('--lean'),'--lean required');const version=spawnSync(lean,['--version'],{encoding:'utf8'});assert.equal(version.status,0);assert.match(version.stdout,/version 4\.19\.0/);
  report.lean={version:version.stdout.trim(),sha256:sha256(await readFile(lean))};report.sourceIdentity=await identity();await publish();
  for(const[dir,names]of models)for(const n of names)await run(n,await readFile(join(root,'experiments',dir,`${n}.lean`),'utf8'),true,undefined,true);
  const filename='experiments/elapsed-epoch-validation/fixtures/elapsed-toggle.ghost.md',source=await readFile(join(root,filename),'utf8'),e=compileEvidence(source,filename);
  await writeFile(join(directory,'compiler-evidence.json'),JSON.stringify(e,null,2)+'\n');await writeFile(join(directory,'module.gfb'),Buffer.from(e.bytes));await writeFile(join(directory,'original.ghost.md'),source);
  await run('actual-elapsed-epoch',theoremInput(e));
  for(const[name,variant]of[['renamed-timer',source.replace('timer age =','timer epoch =')],['initially-true',source.replace('held: Bool = false','held: Bool = true')]])
    await run(`actual-${name}`,theoremInput(compileEvidence(variant,filename)));
  const falseProposition="tactic 'decide' proved that the proposition",start=e.located.transitions[1].start;
  for(const[name,edit,witness]of[
    ['first-clock-slot',b=>b[start+8]=2,{}],
    ['first-uses-old-since',b=>{b[start+7]=4;b[start+8]=1;},{}],
    ['guard-uses-held',b=>b[start+1]=0,{initialized:true}],
    ['compare-uses-initialized',b=>b[start+72]=2,{initialized:true}],
    ['retained-uses-clock',b=>{b[start+78]=3;b[start+79]=3;},{initialized:true}],
    ['changed-uses-old-since',b=>{b[start+84]=4;b[start+85]=1;},{initialized:true,reading:'(.healthy true)'}],
    ['fault-fallback-true',b=>b[start+26]=1,{initialized:true,reading:'(.fault .stale)'}],
    ['duplicate-site',b=>b[start+54]=8,{initialized:true,reading:'(.fault .stale)'}],
    ['initialized-stays-false',b=>b[e.located.transitions[2].start+1]=0,{}],
  ]){const changed=structuredClone(e);edit(changed.bytes);assert.notDeepEqual(changed.bytes,e.bytes);const input=witnessInput(changed,witness);await run(`valid-${name}`,input.slice(0,input.indexOf('theorem targetedEquality')));await run(`reject-${name}`,input,false,falseProposition,false,'targetedEquality');}
  const fallbackSource=source.replace('recover(false)','recover(true)'),changed=structuredClone(e);changed.bytes=[...compileSourceSync(fallbackSource,{filename}).bytes];
  const input=witnessInput(changed,{initialized:true,reading:'(.fault .invalid)'});await run('valid-source-fallback-module',input.slice(0,input.indexOf('theorem targetedEquality')));await run('reject-source-fallback-module',input,false,falseProposition,false,'targetedEquality');
  for(const[name,edit]of[
    ['timer-node',e=>e.metadata.bindings.find(b=>b.generated).nodeId++],
    ['generated-role',e=>e.metadata.bindings.find(b=>b.generated).generated.role='initialized'],
    ['generated-name',e=>e.metadata.bindings.find(b=>b.generated).name='held'],
    ['tracked-state',e=>e.manifest.timers[0].state='relay'],
    ['clock-input',e=>e.manifest.timers[0].clockInput='other'],
    ['recovery-origin',e=>e.metadata.resultSites[0].origins[0].tag=2],
  ]){const changed=structuredClone(e);edit(changed);await run(`reject-metadata-${name}`,theoremInput(changed),false,falseProposition,false,'metadataBinding');}
  for(const[name,changedSource]of[['fallback-true',fallbackSource],['wrong-tracked-state',source.replace('elapsed(held)','elapsed(trigger)')],['missing-timer',source.replace('  timer age = elapsed(held);','')]]){const changed=structuredClone(e);changed.originalSourceBytes=[...Buffer.from(changedSource)];await run(`reject-source-${name}`,theoremInput(changed),false,falseProposition,false,'exactSourceRead');}
  const nonzero=structuredClone(e);nonzero.bytes[e.located.states[1].start]=1;
  await run('reject-nonzero-number-initial',theoremInput(nonzero).split('theorem structurallyParsed')[0]+`theorem rejectsNonzero : (EpochModule.readRaw parsedSource artifactBytes).isNone = true := by decide\n`);
  const trailing=structuredClone(e);trailing.bytes.push(0);
  const originalInput=theoremInput(e).replace(JSON.stringify(e.bytes),JSON.stringify(trailing.bytes));
  await run('reject-trailing-module-byte',originalInput.split('theorem structurallyParsed')[0]+`theorem rejectsTrailing : EpochModule.moduleTrace naturalNumbers parsedSource artifactBytes [] = none := by decide\n`);
  assert.deepEqual(await identity(),report.sourceIdentity,'proof inputs changed during verification');report.status='passed';
}catch(error){report.status='failed';report.error={name:error.name,message:error.message};process.exitCode=1;}
finally{report.finishedAt=now();await publish();await rm(scratch,{recursive:true,force:true});}
console.log(JSON.stringify({status:report.status,checks:report.results.length,evidence:directory,error:report.error?.message}));
