import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const vendor=fileURLToPath(new URL('vendor/build_identity.py',import.meta.url));
const pin=JSON.parse(readFileSync(new URL('vendor/BUILD-IDENTITY.json',import.meta.url)));
if(createHash('sha256').update(readFileSync(vendor)).digest('hex')!==pin.sha256)throw Error('Canonical allocator checksum differs');
const pkg=JSON.parse(readFileSync(root+'package.json'));
for(const crate of ['crates/ghostflow-core','crates/ghostflow-package','runtimes/wasm']){
 if(readFileSync(root+crate+'/Cargo.toml','utf8').match(/^version = "([^"]+)"/m)?.[1]!==pkg.version)throw Error('Language artifact base versions differ; require an explicit per-artifact contract');
}
const args=process.argv.slice(2), artifact=args[0]==='--artifact';
if(artifact)args.shift();
const mode=args.shift();
if(!['--wasm','--verify'].includes(mode)||args.some(a=>!['--node-only','--curriculum-only'].includes(a))||args.length>1)throw Error('Unsupported language build entrypoint');
const run=(command,argv)=>{const r=spawnSync(command,argv,{cwd:root,stdio:'inherit',env:process.env});if(r.error)throw r.error;return r.status??1};
if(!artifact){
 process.exit(run('python3',[vendor,'--repo',root,'--base-version',pkg.version,'--',process.execPath,fileURLToPath(import.meta.url),'--artifact',mode,...args]));
}
if(!process.env.FARM_BUILD_CONTEXT||!process.env.FARM_BUILD_IDENTITY_FILE)throw Error('Internal artifact step requires an issued parent context');
const guard=run('python3',[vendor,'--inherit-only','--repo',root,'--base-version',pkg.version,'--',process.execPath,'-e','']);
if(guard)process.exit(guard);
rmSync(root+'build/build-identity.json',{force:true});
const status=mode==='--wasm'?run('cargo',['build','--locked','--offline','-p','ghostflow-wasm','--target','wasm32-unknown-unknown','--release']):run(process.execPath,['tools/verify-language.mjs',...args]);
if(status)process.exit(status);
const identity=JSON.parse(readFileSync(process.env.FARM_BUILD_IDENTITY_FILE));
if(mode==='--wasm'){
 const wasm=readFileSync(root+'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
 mkdirSync(root+'build',{recursive:true});
 writeFileSync(root+'build/build-identity.json',JSON.stringify({identity,wasmSha256:createHash('sha256').update(wasm).digest('hex')},null,2)+'\n');
}
