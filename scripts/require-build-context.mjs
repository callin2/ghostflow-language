import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
if(!process.env.FARM_BUILD_CONTEXT||!process.env.FARM_BUILD_IDENTITY_FILE)throw Error('Internal artifact build requires allocator-issued context; use npm run build');
const pkg=JSON.parse(readFileSync('package.json'));
const result=spawnSync('python3',['scripts/vendor/build_identity.py','--inherit-only','--repo',process.cwd(),'--base-version',pkg.version,'--',process.execPath,'-e',''],{stdio:'inherit',env:process.env});
if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
