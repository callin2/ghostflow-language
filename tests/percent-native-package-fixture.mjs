import { createHash } from 'node:crypto';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import { buildPortablePackage, serializePortablePackage } from '../tools/portable-package.mjs';

const scenario = process.argv[2] ?? 'valid';
const source = scenario === 'forged'
  ? '# Percent package\n\n```ghost\ncontrol Guard { output pump: Percent; pump <- 50%; }\n```\n'
  : '# Percent package\n\n```ghost\ncontrol Guard { state a: Percent = 90%; output pump: Percent; pump <- a + 20%; }\n```\n';
const identity = {
  compilerRevision: 'c0bef0e', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
  runtimeAbi: 'GhostFlow/framed-scan-abi-v1',
  requiredCapabilities: [{ kind: 'actuator', name: 'pump', type: 'number' }],
  bindingRevision: 'virtual-two-output-v1',
};
const seed = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
const privateKey = await crypto.subtle.importKey('pkcs8',
  Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
  'Ed25519', false, ['sign']);
const compilation = await compileSource(source, { filename: 'percent-package.ghost.md' });
const built = await buildPortablePackage(compilation, identity, {
  signers: [{ keyId: 'test-current-2026', privateKey }],
  verifyCompilation: (text, { filename }) => compileSource(text, { filename }),
});
const result = structuredClone(built);
if (scenario !== 'valid') {
  const manifest = JSON.parse(Buffer.from(result.payload.manifest.contentBase64, 'base64').toString());
  if (scenario === 'missing') delete manifest.requiredRuntimeFeatures;
  else if (scenario === 'forged') manifest.requiredRuntimeFeatures = ['percent-range-v1'];
  else if (scenario === 'unknown') manifest.requiredRuntimeFeatures = ['other-v1'];
  else if (scenario === 'duplicate') manifest.requiredRuntimeFeatures.push('percent-range-v1');
  else if (scenario === 'malformed') manifest.requiredRuntimeFeatures = 'percent-range-v1';
  else throw new Error(`unknown scenario ${scenario}`);
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  result.payload.manifest.contentBase64 = manifestBytes.toString('base64');
  result.payload.manifest.sha256 = createHash('sha256').update(manifestBytes).digest('hex');
  const payloadBytes = Buffer.from(canonicalJson(result.payload));
  result.payloadSha256 = createHash('sha256').update(payloadBytes).digest('hex');
  result.signatures = [{ algorithm: 'Ed25519', keyId: 'test-current-2026',
    signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', privateKey, payloadBytes)).toString('base64') }];
}
process.stdout.write(serializePortablePackage(result));
