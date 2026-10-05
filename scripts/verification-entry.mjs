import {spawnSync} from 'node:child_process';
// Public entrypoints always ask the allocator: foreign parents get their own ID.
// Only the wrapper's guarded internal invocation skips recursion.
export function enterVerification(argv=process.argv.slice(2)) {
 if(argv[0]==='--identity-artifact')return argv.slice(1);
 const result=spawnSync(process.execPath,['scripts/build-language-with-identity.mjs','--verify',...argv],{stdio:'inherit'});
 if(result.error)throw result.error;
 process.exit(result.status??1);
}
