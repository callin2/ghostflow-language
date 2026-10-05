import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,mkdtempSync,rmSync,existsSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=process.cwd();
test('all supported language build entries use pinned allocation without ABI changes',()=>{
 const pkg=JSON.parse(readFileSync('package.json'));
 assert.equal(pkg.scripts['build:wasm'],'node scripts/build-language-with-identity.mjs --wasm');
 assert.match(readFileSync('Makefile','utf8'),/wasm:\n\tnpm run build:wasm/);
 assert.match(readFileSync('tools/verify-language.mjs','utf8'),/const args = enterVerification\(\)/);
 const pin=JSON.parse(readFileSync('scripts/vendor/BUILD-IDENTITY.json'));
 assert.equal(createHash('sha256').update(readFileSync('scripts/vendor/build_identity.py')).digest('hex'),pin.sha256);
});
test('language wrapper binds issued ID to output bytes, burns failures and rejects unguarded artifacts (synthetic compiler)',()=>{
 const temp=mkdtempSync(join(tmpdir(),'language-build-identity-'));const repo=join(temp,'source');
 const run=(cwd,cmd,args,env=process.env)=>execFileSync(cmd,args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 try{
 mkdirSync(repo);run(temp,'git',['init','--bare',join(temp,'authority.git')]);run(repo,'git',['init']);run(repo,'git',['config','user.name','Test']);run(repo,'git',['config','user.email','test@localhost']);run(repo,'git',['remote','add','origin',join(temp,'authority.git')]);
 mkdirSync(join(repo,'scripts/vendor'),{recursive:true});
 for(const p of ['build-language-with-identity.mjs','verification-entry.mjs','require-build-context.mjs','vendor/build_identity.py','vendor/BUILD-IDENTITY.json'])copyFileSync(join(root,'scripts',p),join(repo,'scripts',p));
 writeFileSync(join(repo,'package.json'),JSON.stringify({name:'ghostflow-language',version:'0.1.0'}));
 for(const crate of ['crates/ghostflow-core','crates/ghostflow-package','runtimes/wasm']){mkdirSync(join(repo,crate),{recursive:true});writeFileSync(join(repo,crate,'Cargo.toml'),'[package]\nversion = "0.1.0"\n');}
 const bin=join(temp,'bin');mkdirSync(bin);writeFileSync(join(bin,'cargo'),'#!/usr/bin/env node\nconst fs=require("fs");fs.mkdirSync("target/wasm32-unknown-unknown/release",{recursive:true});fs.writeFileSync("target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm",Buffer.from([0,97,115,109,1,0,0,0]));if(process.env.TEST_FAIL)process.exit(7);');chmodSync(join(bin,'cargo'),0o700);
 run(repo,'git',['add','.']);run(repo,'git',['commit','-m','fixture']);
 const env={...process.env,PATH:bin+':'+process.env.PATH};delete env.FARM_BUILD_CONTEXT;delete env.FARM_BUILD_IDENTITY_FILE;
 const command=['scripts/build-language-with-identity.mjs','--wasm'];run(repo,process.execPath,command,env);
 const first=JSON.parse(readFileSync(join(repo,'build/build-identity.json')));assert.equal(first.identity.buildVersion,'0.1.0-build.1');assert.equal(first.identity.sourceSHA,run(repo,'git',['rev-parse','HEAD']).trim());assert.equal(first.wasmSha256,createHash('sha256').update(readFileSync(join(repo,'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'))).digest('hex'));
 assert.equal(spawnSync(process.execPath,command,{cwd:repo,env:{...env,TEST_FAIL:'1'}}).status,7);assert.equal(existsSync(join(repo,'build/build-identity.json')),false);
 run(repo,process.execPath,command,env);assert.equal(JSON.parse(readFileSync(join(repo,'build/build-identity.json'))).identity.buildNumber,3);
 assert.notEqual(spawnSync(process.execPath,['scripts/build-language-with-identity.mjs','--artifact','--wasm'],{cwd:repo,env}).status,0);
 // Direct public verifier entered under another repository's genuine context
 // must allocate locally. Re-entry under its own context must inherit once.
 mkdirSync(join(repo,'tools'));
 writeFileSync(join(repo,'tools/verify-language.mjs'),"import {enterVerification} from '../scripts/verification-entry.mjs';import {spawnSync} from 'node:child_process';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';enterVerification();await import('../scripts/require-build-context.mjs');mkdirSync('build',{recursive:true});writeFileSync('build/verifier-identity.json',readFileSync(process.env.FARM_BUILD_IDENTITY_FILE));if(!process.env.TEST_NESTED){const r=spawnSync(process.execPath,['tools/verify-language.mjs'],{env:{...process.env,TEST_NESTED:'1'},stdio:'inherit'});process.exit(r.status);}");
 run(repo,'git',['add','.']);run(repo,'git',['commit','-m','verifier routing fixture']);
 const foreign=join(temp,'foreign');mkdirSync(foreign);run(foreign,'git',['init']);run(foreign,'git',['config','user.name','Test']);run(foreign,'git',['config','user.email','test@localhost']);run(foreign,'git',['remote','add','origin',join(temp,'foreign.git')]);run(temp,'git',['init','--bare',join(temp,'foreign.git')]);writeFileSync(join(foreign,'source'),'foreign');run(foreign,'git',['add','.']);run(foreign,'git',['commit','-m','foreign']);
 run(repo,'python3',[join(repo,'scripts/vendor/build_identity.py'),'--repo',foreign,'--base-version','0.9.0','--',process.execPath,'tools/verify-language.mjs'],env);
 const own=JSON.parse(readFileSync(join(repo,'build/verifier-identity.json')));assert.equal(own.baseVersion,'0.1.0');assert.equal(own.buildNumber,4);assert.equal(JSON.parse(run(repo,'git',['--git-dir',join(temp,'authority.git'),'show','build-counter:counter.json'])).buildNumber,4);
 }finally{rmSync(temp,{recursive:true,force:true})}
});
