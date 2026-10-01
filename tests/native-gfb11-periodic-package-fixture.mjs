import fs from 'node:fs';
import { compileSource } from '../tools/toolchain.mjs';
import { buildPortablePackage, serializePortablePackage } from '../tools/portable-package.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';

const scenario = process.argv[2] ?? 'valid';
const cases = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url), 'utf8')).cases;
const reference = cases.find(item => item.id === 'REF-03-036');
if (!reference) throw new Error('REF-03-036 is missing');
const compilation = await compileSource(reference.source, { filename: reference.filename });
const privateDer = Buffer.from('302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
const privateKey = await crypto.subtle.importKey('pkcs8', privateDer, 'Ed25519', false, ['sign']);
const identity = {
  compilerRevision: 'c0bef0e', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
  runtimeAbi: 'GhostFlow/context-scan-abi-v5',
  requiredCapabilities: [{ kind: 'actuator', name: 'due', type: 'bool' }],
  bindingRevision: 'virtual-two-output-v1',
};
const signed = await buildPortablePackage(compilation, identity, {
  signers: [{ keyId: 'test-current-2026', privateKey }],
  verifyCompilation: (source, options) => compileSource(source, options),
});
const packageValue = structuredClone(signed);
if (scenario !== 'valid') {
  const manifest = JSON.parse(Buffer.from(packageValue.payload.manifest.contentBase64, 'base64').toString('utf8'));
  const schedule = manifest.schedules[0];
  if (scenario === 'missing-schedule') manifest.schedules = [];
  else if (scenario === 'duplicate-schedule') manifest.schedules.push(structuredClone(schedule));
  else if (scenario === 'wrong-site') schedule.site += 1;
  else if (scenario === 'wrong-name') schedule.name = 'other';
  else if (scenario === 'wrong-config-id') schedule.every.configId += 1;
  else if (scenario === 'wrong-config-name') schedule.every.config = 'other';
  else if (scenario === 'wrong-initial') schedule.every.initialMs += 1;
  else if (scenario === 'wrong-anchor') schedule.anchor.instantMs += 1;
  else if (scenario === 'wrong-gap') schedule.policy.gapMs += 1;
  else if (scenario === 'wrong-clock') schedule.policy.clock = 'untrusted';
  else if (scenario === 'wrong-when') schedule.policy.when = 'false';
  else if (scenario === 'extra-policy') schedule.policy.extra = true;
  else if (scenario === 'wrong-kind') schedule.kind = 'daily';
  else if (scenario === 'extra-signal') manifest.signals.push({ kind: 'window', name: 'extra' });
  else throw new Error(`unknown GFB11 Periodic fixture scenario: ${scenario}`);
  const manifestBytes = new TextEncoder().encode(canonicalJson(manifest));
  packageValue.payload.manifest.contentBase64 = Buffer.from(manifestBytes).toString('base64');
  packageValue.payload.manifest.sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', manifestBytes)).toString('hex');
  const payloadBytes = new TextEncoder().encode(canonicalJson(packageValue.payload));
  packageValue.payloadSha256 = Buffer.from(await crypto.subtle.digest('SHA-256', payloadBytes)).toString('hex');
  packageValue.signatures = [{
    algorithm: 'Ed25519', keyId: 'test-current-2026',
    signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', privateKey, payloadBytes)).toString('base64'),
  }];
}
process.stdout.write(serializePortablePackage(packageValue));
