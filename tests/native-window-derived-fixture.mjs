import { canonicalJson } from '../tools/canonical-json.mjs';
import { buildPortablePackage, serializePortablePackage } from '../tools/portable-package.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const encoder = new TextEncoder();
const source = `# Native derived windows

\`\`\`ghost
control DerivedWindowPackage {
  sensor probe: Number;
  signal inner = window_average(probe, over: 2ms, quality: measured, max_age: 2ms);
  signal outer = window_average(inner, over: 10ms, quality: measured, max_age: 10ms);
  output pump: Bool;
  pump <- (outer |> recover(-1.0)) > 0.0;
}
\`\`\`\n`;
const scenario = process.argv[2] ?? 'valid';
const privateDer = Uint8Array.from('302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'.match(/../g), x => Number.parseInt(x, 16));
const privateKey = await crypto.subtle.importKey('pkcs8', privateDer, 'Ed25519', false, ['sign']);
const identity = {
  compilerRevision: 'c0bef0e', runtimeSemantics: 'GhostFlow/runtime-semantics-v1', runtimeAbi: 'GhostFlow/framed-scan-abi-v1', bindingRevision: 'virtual-two-output-v1',
  requiredCapabilities: [{ kind: 'actuator', name: 'pump', type: 'bool' }, { kind: 'sensor', name: 'probe', type: 'number' }],
};
const compilation = await compileSource(source, { filename: 'native-window-derived.ghost.md' });
const packageValue = await buildPortablePackage(compilation, identity, {
  signers: [{ keyId: 'test-current-2026', privateKey }],
  verifyCompilation: (text, { filename }) => compileSource(text, { filename }),
});

if (scenario === 'valid') {
  process.stdout.write(serializePortablePackage(packageValue));
  process.exit(0);
}
const candidate = JSON.parse(JSON.stringify(packageValue));
const manifest = JSON.parse(Buffer.from(candidate.payload.manifest.contentBase64, 'base64').toString('utf8'));
const outer = manifest.signals.find(signal => signal.name === 'outer');
if (!outer) throw new Error('outer window descriptor missing');
if (scenario === 'dependency-removed') delete outer.upstreamWindows;
else if (scenario === 'dependency-empty') outer.upstreamWindows = [];
else if (scenario === 'dependency-null') outer.upstreamWindows = null;
else if (scenario === 'dependency-object') outer.upstreamWindows = {};
else if (scenario === 'dependency-site') outer.upstreamWindows = [{ ...outer.upstreamWindows[0], site: outer.upstreamWindows[0].site + 1 }];
else if (scenario === 'dependency-slot') outer.upstreamWindows = [{ ...outer.upstreamWindows[0], slot: outer.upstreamWindows[0].slot + 1 }];
else if (scenario === 'dependency-negative-slot') outer.upstreamWindows = [{ ...outer.upstreamWindows[0], slot: -1 }];
// Stay inside canonical JSON's safe-integer domain to reach the slot binding guard.
else if (scenario === 'dependency-huge-slot') outer.upstreamWindows = [{ ...outer.upstreamWindows[0], slot: 2 ** 16 }];
else if (scenario === 'dependency-negative-site') outer.upstreamWindows = [{ ...outer.upstreamWindows[0], site: -1 }];
else if (scenario === 'dependency-huge-site') outer.upstreamWindows = [{ ...outer.upstreamWindows[0], site: 2 ** 32 }];
else if (scenario === 'dependency-name') outer.upstreamWindows = [{ ...outer.upstreamWindows[0], name: `${outer.upstreamWindows[0].name}_forged` }];
else if (scenario === 'dependency-unknown-key') outer.upstreamWindows = [{ ...outer.upstreamWindows[0], extra: true }];
else throw new Error(`unknown scenario: ${scenario}`);
const manifestBytes = encoder.encode(canonicalJson(manifest));
candidate.payload.manifest.contentBase64 = Buffer.from(manifestBytes).toString('base64');
candidate.payload.manifest.sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', manifestBytes)).toString('hex');
const payloadBytes = encoder.encode(canonicalJson(candidate.payload));
candidate.payloadSha256 = Buffer.from(await crypto.subtle.digest('SHA-256', payloadBytes)).toString('hex');
candidate.signatures = [{ algorithm: 'Ed25519', keyId: 'test-current-2026', signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', privateKey, payloadBytes)).toString('base64') }];
process.stdout.write(serializePortablePackage(candidate));
