import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceIdentity, proofOutcome} from '../elapsed-clock-bounds/verify.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), args = process.argv.slice(2);
const argument = flag => {const i = args.indexOf(flag); assert.ok(i >= 0 && args[i + 1], `${flag} required`); return args[i + 1];};
const lean = resolve(argument('--lean')), dependencyDir = resolve(argument('--dependency-dir'));
const directory = resolve(argument('--evidence-dir')), sha = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(directory, {recursive: true});
const report = {status: 'running', startedAt: new Date().toISOString(), dependencyReuse: true,
  scope: 'Fresh new-model kernel checks after exact source, tool and compiled dependency validation', dependencies: [], results: []};
const publish = async () => {const path = join(directory,'verification.json'); await writeFile(`${path}.tmp`, JSON.stringify(report,null,2)+'\n'); await rename(`${path}.tmp`,path);};
try {
  await publish();
  const checkerPath = fileURLToPath(import.meta.url), checkerHash = sha(await readFile(checkerPath));
  report.checkerSha256 = checkerHash;
  const receipt = await readFile(join(dependencyDir,'verification.json')), prior = JSON.parse(receipt);
  report.priorReceiptSha256 = sha(receipt);
  const base = await sourceIdentity();
  for (const [path, hash] of Object.entries(base.files)) assert.equal(prior.sourceIdentity.files[path], hash, path);
  report.baseSourceIdentity = base;
  assert.equal(sha(await readFile(lean)), prior.lean.executableSha256);
  report.lean = prior.lean;
  const expected = Object.keys(base.files).filter(path => path.endsWith('.lean')).map(path => path.split('/').at(-1).slice(0,-5)).sort();
  const dependencies = prior.results.filter(item => expected.includes(item.name) && item.passed && item.compiledSha256);
  assert.deepEqual(dependencies.map(item => item.name).sort(), expected);
  for (const item of dependencies) {
    const input = await readFile(join(dependencyDir,`${item.name}.lean`)), log = await readFile(join(dependencyDir,`${item.name}.log`));
    const compiled = await readFile(join(dependencyDir,`${item.name}.olean`));
    const path = Object.keys(base.files).find(path => path.endsWith(`/${item.name}.lean`));
    assert.equal(sha(input), base.files[path]); assert.equal(sha(input), item.inputSha256);
    assert.equal(sha(log), item.logSha256); assert.equal(sha(compiled), item.compiledSha256);
    assert.ok(proofOutcome({status:item.exitCode,signal:item.signal,error:item.error},log.toString(),true));
    await writeFile(join(directory,`${item.name}.olean`),compiled);
    report.dependencies.push({name:item.name,inputSha256:item.inputSha256,compiledSha256:item.compiledSha256,logSha256:item.logSha256});
  }
  await publish();
  for (const name of ['DurationSource','DurationMachine','DurationModule']) {
    const source = join(root,'experiments/elapsed-duration-output',`${name}.lean`), input = await readFile(source);
    assert.doesNotMatch(input.toString(),/\b(sorry|admit|axiom|opaque|native_decide)\b|decide\s+\+native/);
    const path = join(directory,`${name}.lean`); await writeFile(path,input);
    const result = spawnSync(lean,['-o',join(directory,`${name}.olean`),path],
      {cwd:directory,env:{...process.env,LEAN_PATH:directory},encoding:'utf8',timeout:180000,maxBuffer:8388608});
    const log = (result.stdout??'')+(result.stderr??''); await writeFile(join(directory,`${name}.log`),log);
    const passed = proofOutcome(result,log,true);
    report.results.push({name,passed,exitCode:result.status,signal:result.signal,error:result.error?.message,
      inputSha256:sha(input),logSha256:sha(log),at:new Date().toISOString()});
    await publish(); assert.ok(passed,log); assert.equal(sha(await readFile(source)),sha(input),'model changed during compilation');
  }
  assert.deepEqual(await sourceIdentity(),base,'dependency inputs changed during execution');
  assert.equal(sha(await readFile(checkerPath)),checkerHash,'checker changed during execution');
  report.status='passed';
} catch(error) {report.status='failed';report.error={name:error.name,message:error.message};process.exitCode=1;}
finally {report.finishedAt=new Date().toISOString();await publish();}
console.log(JSON.stringify({status:report.status,dependencyReuse:true,dependencies:report.dependencies.length,checks:report.results.length,error:report.error?.message}));
