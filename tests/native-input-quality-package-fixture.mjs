// New canonical-input revision. Historical portable fixtures remain untouched.
import { compileSourceSync } from '../tools/compile-source.mjs';
import { buildPortablePackage, serializePortablePackage } from '../tools/portable-package.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';

const scenario = process.argv[2] ?? 'valid';
const source = '# Canonical quality acquisition package\n\n```ghost\n' + `control InputQualityPackage {
  input count: Int { valid = -2147483648 .. 2147483647; recover_after = 2 samples; }
  input observation: Bool;
  output total: Int;
  total <- count |> recover(-7);
}` + '\n```\n';
const compilation = compileSourceSync(source, { filename: 'input-quality-package.ghost.md' });
// Existing RFC 8032 public test key; this is fixture signing, not a credential.
const privateDer = Buffer.from('302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
const privateKey = await crypto.subtle.importKey('pkcs8', privateDer, 'Ed25519', false, ['sign']);
const identity = {
  compilerRevision: 'issue531-candidate', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
  runtimeAbi: 'GhostFlow/framed-scan-abi-v1', bindingRevision: 'canonical-input-quality-v1',
  requiredCapabilities: [
    { kind: 'sensor', name: 'count', type: 'int' },
    { kind: 'sensor', name: 'observation', type: 'bool' },
    { kind: 'actuator', name: 'total', type: 'int' },
  ],
};
const signed = await buildPortablePackage(compilation, identity, {
  signers: [{ keyId: 'test-current-2026', privateKey }],
  verifyCompilation: (text, options) => compileSourceSync(text, options),
});
const packageValue = structuredClone(signed);
if (scenario !== 'valid') {
  const manifest = JSON.parse(Buffer.from(packageValue.payload.manifest.contentBase64, 'base64').toString('utf8'));
  const count = manifest.sensors.find(sensor => sensor.name === 'count');
  const observation = manifest.sensors.find(sensor => sensor.name === 'observation');
  if (scenario === 'fractional-bound') count.validMin = 0.5;
  else if (scenario === 'outside-bound') count.validMax = 2147483648;
  else if (scenario === 'exact-filter') { count.filter = 'median'; count.window = 3; }
  else if (scenario === 'recovery') count.recoverSamples = 32;
  else if (scenario === 'bool-range') { observation.validMin = 0.2; observation.validMax = 0.8; }
  else if (scenario === 'optional') observation.optional = 'true';
  else if (scenario === 'partial-identity') count.sampleIdInput = '__gf_sensor_sample_id_count';
  else throw new Error(`unknown input quality scenario: ${scenario}`);
  const manifestBytes = new TextEncoder().encode(canonicalJson(manifest));
  packageValue.payload.manifest.contentBase64 = Buffer.from(manifestBytes).toString('base64');
  packageValue.payload.manifest.sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', manifestBytes)).toString('hex');
  const payloadBytes = new TextEncoder().encode(canonicalJson(packageValue.payload));
  packageValue.payloadSha256 = Buffer.from(await crypto.subtle.digest('SHA-256', payloadBytes)).toString('hex');
  packageValue.signatures = [{ algorithm: 'Ed25519', keyId: 'test-current-2026',
    signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', privateKey, payloadBytes)).toString('base64') }];
}
process.stdout.write(serializePortablePackage(packageValue));
