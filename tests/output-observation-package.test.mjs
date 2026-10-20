import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { compileSource } from '../tools/compile-source.mjs';
import { buildPortablePackage, verifyPortablePackage } from '../tools/portable-package.mjs';

const encoder = new TextEncoder();
const digest = async bytes => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
const source = '# Observe\n\n```ghost\ncontrol Observe { output pump: Bool; output alarm: Bool; pump <- true; alarm <- output_status(pump) == OutputPending; }\n```\n';
const compilation = await compileSource(source, { filename: 'observe.ghost.md' });
const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
const identity = {
  compilerRevision: 'observation-test', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
  runtimeAbi: 'GhostFlow/framed-scan-abi-v1', bindingRevision: 'test-binding',
  requiredCapabilities: ['alarm', 'pump'].map(name => ({ kind: 'actuator', name, type: 'bool' })),
};
const packageValue = await buildPortablePackage(compilation, identity, {
  signers: [{ keyId: 'test', privateKey: key.privateKey }],
  verifyCompilation: (text, { filename }) => compileSource(text, { filename }),
  onDiagnostic: () => {},
});
function options(verifyBytecode = () => true) {
  return {
    trustedKeys: [{ keyId: 'test', publicKey: key.publicKey }],
    revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision,
    supportedRuntimeSemantics: [identity.runtimeSemantics], supportedRuntimeAbis: [identity.runtimeAbi],
    supportedManifestFormats: ['GhostFlow/control-v22', 'GhostFlow/control-v1'],
    availableCapabilities: identity.requiredCapabilities, expectedBindingRevision: identity.bindingRevision,
    verifyBytecode,
  };
}
async function tamperManifest(change) {
  const candidate = structuredClone(packageValue);
  const manifest = JSON.parse(Buffer.from(candidate.payload.manifest.contentBase64, 'base64'));
  change(manifest);
  candidate.payload.manifest.format = manifest.format;
  const bytes = encoder.encode(canonicalJson(manifest));
  candidate.payload.manifest.sha256 = await digest(bytes);
  candidate.payload.manifest.contentBase64 = Buffer.from(bytes).toString('base64');
  const payload = encoder.encode(canonicalJson(candidate.payload));
  candidate.payloadSha256 = await digest(payload);
  candidate.signatures[0].signatureBase64 = Buffer.from(await crypto.subtle.sign('Ed25519', key.privateKey, payload)).toString('base64');
  return candidate;
}

test('output observation packages require explicit host admission and preserve scalar bytecode', async () => {
  let accepted = 0;
  const verified = await verifyPortablePackage(packageValue, options(() => { accepted++; return true; }));
  assert.equal(accepted, 1);
  assert.equal(verified.manifest.format, 'GhostFlow/control-v22');
  assert.ok([1, 2, 3, 4].includes(Number(packageValue.payload.bytecode.version)));
  assert.ok(!identity.requiredCapabilities.some(capability => capability.name.startsWith('__gf_output_')));
  await assert.rejects(verifyPortablePackage(packageValue, { ...options(), supportedManifestFormats: ['GhostFlow/control-v1'] }), { code: 'unsupported-manifest-format' });
});

test('resigned output observation substitutions and manifest downgrades fail before target admission', async () => {
  const changes = [
    manifest => { delete manifest.outputObservations; },
    manifest => { manifest.outputObservations = []; },
    manifest => { manifest.outputObservations.push({ ...manifest.outputObservations[0] }); },
    manifest => { manifest.outputObservations[0].extra = true; },
    manifest => { manifest.outputObservations[0].faultInput = 'forged'; },
    manifest => { manifest.outputObservations[0].output = 'missing'; },
    manifest => { manifest.inputs.push({ name: '__gf_output_pump_status', type: 'Number' }); },
    manifest => { manifest.format = 'GhostFlow/control-v1'; delete manifest.outputObservations; },
    manifest => {
      const descriptor = manifest.outputObservations[0];
      descriptor.output = 'alarm';
      for (const role of ['status', 'health', 'completion', 'fault']) descriptor[`${role}Input`] = `__gf_output_alarm_${role}`;
    },
  ];
  for (const change of changes) {
    let loaded = false;
    const candidate = await tamperManifest(change);
    await assert.rejects(verifyPortablePackage(candidate, options(() => { loaded = true; return true; })), error => ['manifest-mismatch', 'source-map-mismatch', 'unknown-or-missing-field'].includes(error.code));
    assert.equal(loaded, false);
  }
});
