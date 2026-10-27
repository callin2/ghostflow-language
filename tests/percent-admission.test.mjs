import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import { buildPortablePackage, PortablePackageError, verifyPortablePackage } from '../tools/portable-package.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasmPath = fileURLToPath(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const source = '# Percent admission\n\n```ghost\ncontrol Guard { state a: Percent = 90%; output pump: Percent; pump <- a + 20%; }\n```\n';
const identity = {
  compilerRevision: 'percent-test', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
  runtimeAbi: 'GhostFlow/framed-scan-abi-v1',
  requiredCapabilities: [{ kind: 'actuator', name: 'pump', type: 'number' }],
  bindingRevision: 'virtual-percent-v1',
};
const seed = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
const publicBytes = Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encoded = value => Buffer.from(canonicalJson(value));
const keyPair = Promise.all([
  crypto.subtle.importKey('pkcs8', Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), 'Ed25519', false, ['sign']),
  crypto.subtle.importKey('spki', Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicBytes]), 'Ed25519', false, ['verify']),
]);

async function fixture() {
  const compilation = await compileSource(source, { filename: 'percent-admission.ghost.md' });
  const [privateKey, publicKey] = await keyPair;
  const packageValue = await buildPortablePackage(compilation, identity, {
    signers: [{ keyId: 'test-percent', privateKey }],
    verifyCompilation: (text, { filename }) => compileSource(text, { filename }),
  });
  return { compilation, packageValue, privateKey, publicKey };
}

function options(publicKey, supportedRuntimeFeatures) {
  return {
    trustedKeys: [{ keyId: 'test-percent', publicKey }], revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision,
    supportedRuntimeSemantics: [identity.runtimeSemantics],
    supportedRuntimeAbis: [identity.runtimeAbi],
    supportedManifestFormats: ['GhostFlow/control-v1', 'GhostFlow/control-v4'],
    availableCapabilities: identity.requiredCapabilities,
    expectedBindingRevision: identity.bindingRevision,
    ...(supportedRuntimeFeatures ? { supportedRuntimeFeatures } : {}),
    verifyBytecode: async () => true,
  };
}

async function resign(packageValue, privateKey, manifest) {
  const candidate = structuredClone(packageValue);
  const bytes = encoded(manifest);
  candidate.payload.manifest.sha256 = digest(bytes);
  candidate.payload.manifest.contentBase64 = bytes.toString('base64');
  const payloadBytes = encoded(candidate.payload);
  candidate.payloadSha256 = digest(payloadBytes);
  candidate.signatures = [{ algorithm: 'Ed25519', keyId: 'test-percent',
    signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', privateKey, payloadBytes)).toString('base64') }];
  return candidate;
}

async function rejectsCode(action, code) {
  await assert.rejects(action, error => error instanceof PortablePackageError && error.code === code);
}

test('guarded Percent package requires an admitted feature and actual VM load', async () => {
  const { compilation, packageValue, publicKey } = await fixture();
  assert.deepEqual(compilation.manifest.requiredRuntimeFeatures, ['percent-range-v1']);
  await rejectsCode(() => verifyPortablePackage(packageValue, options(publicKey)), 'unsupported-runtime-feature');
  const verified = await verifyPortablePackage(packageValue, options(publicKey, ['percent-range-v1']));
  assert.deepEqual(verified.manifest.requiredRuntimeFeatures, ['percent-range-v1']);
  const runtime = await ControlRuntime.instantiate(fs.readFileSync(wasmPath),
    { bytes: verified.bytecode.copy(), manifest: verified.manifest });
  runtime.dispose();
});

test('guarded feature declaration rejects malformed, unknown, duplicate and forged metadata', async () => {
  const { compilation, packageValue, privateKey, publicKey } = await fixture();
  for (const value of [[], 'percent-range-v1', ['unknown-v1'], ['percent-range-v1', 'percent-range-v1']]) {
    const manifest = { ...compilation.manifest, requiredRuntimeFeatures: value };
    const candidate = await resign(packageValue, privateKey, manifest);
    await rejectsCode(() => verifyPortablePackage(candidate, options(publicKey, ['percent-range-v1'])), 'manifest-mismatch');
    await assert.rejects(() => ControlRuntime.instantiate(fs.readFileSync(wasmPath),
      { bytes: compilation.bytes, manifest }), /requiredRuntimeFeatures|required runtime feature/);
  }
  const { requiredRuntimeFeatures: _removed, ...manifest } = compilation.manifest;
  const candidate = await resign(packageValue, privateKey, manifest);
  await rejectsCode(() => verifyPortablePackage(candidate, options(publicKey, ['percent-range-v1'])), 'source-map-mismatch');
});

test('direct control activation binds feature declarations to loaded bytecode', async () => {
  const guarded = await compileSource(source, { filename: 'percent-admission.ghost.md' });
  const plain = await compileSource('# Plain\n\n```ghost\ncontrol Plain { output pump: Number; pump <- 28.0; }\n```\n',
    { filename: 'plain-percent.ghost.md' });
  assert.ok(plain.bytes.includes(60), 'ordinary Number payload contains the guard opcode byte');
  const { requiredRuntimeFeatures: _removed, ...stripped } = guarded.manifest;
  const added = { ...plain.manifest, requiredRuntimeFeatures: ['percent-range-v1'] };
  const wasm = fs.readFileSync(wasmPath);
  for (const instantiate of [ControlRuntime.instantiate, ControlRuntime.instantiateFramed]) {
    const accepted = await instantiate(wasm, plain);
    accepted.dispose();
    await assert.rejects(() => instantiate(wasm, { bytes: guarded.bytes, manifest: stripped }),
      /requiredRuntimeFeatures does not match loaded bytecode/);
    await assert.rejects(() => instantiate(wasm, { bytes: plain.bytes, manifest: added }),
      /requiredRuntimeFeatures does not match loaded bytecode/);
  }
});

test('unguarded Percent package keeps the old manifest shape', async () => {
  const plain = await compileSource('# Plain\n\n```ghost\ncontrol Plain { output pump: Percent; pump <- 50%; }\n```\n',
    { filename: 'plain-percent.ghost.md' });
  assert.equal(Object.hasOwn(plain.manifest, 'requiredRuntimeFeatures'), false);
  const [privateKey, publicKey] = await keyPair;
  const built = await buildPortablePackage(plain, identity, {
    signers: [{ keyId: 'test-percent', privateKey }],
    verifyCompilation: (text, { filename }) => compileSource(text, { filename }),
  });
  const forged = await resign(built, privateKey,
    { ...plain.manifest, requiredRuntimeFeatures: ['percent-range-v1'] });
  await rejectsCode(() => verifyPortablePackage(forged, options(publicKey, ['percent-range-v1'])), 'source-map-mismatch');
});
