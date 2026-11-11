import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import {
  PortablePackageError,
  verifyPortablePackage,
} from '../tools/portable-package.mjs';

// Produced by the compiler at d7bd012, before config streams changed this case to GFB11.
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/gfb10-periodic-package-payload.json', import.meta.url)));
const encoder = new TextEncoder();

async function digest(bytes) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
}

async function resign(packageValue, key) {
  const payloadBytes = encoder.encode(canonicalJson(packageValue.payload));
  packageValue.payloadSha256 = await digest(payloadBytes);
  packageValue.signatures = [{
    algorithm: 'Ed25519',
    keyId: 'gfb10-package-test-key',
    signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', key.privateKey, payloadBytes)).toString('base64'),
  }];
}

async function signedPeriodicPackage() {
  const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const packageValue = { format: 'GhostFlow/portable-package-v1', payload: structuredClone(fixture.payload) };
  await resign(packageValue, key);
  const identity = packageValue.payload.identity;
  const options = {
    trustedKeys: [{ keyId: 'gfb10-package-test-key', publicKey: key.publicKey }],
    revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision,
    supportedRuntimeSemantics: [identity.runtimeSemantics],
    supportedRuntimeAbis: [identity.runtimeAbi],
    supportedManifestFormats: ['GhostFlow/control-v9'],
    availableCapabilities: identity.requiredCapabilities,
    expectedBindingRevision: identity.bindingRevision,
  };
  return { packageValue, options };
}

test('a genuine historical GFB10 package cannot reach the target loader', async () => {
  const { packageValue, options } = await signedPeriodicPackage();
  assert.equal(packageValue.payload.bytecode.version, '10');
  assert.equal(packageValue.payload.bytecode.sha256, 'd00203644d730cc0112921d96889ba240de6e8f7255d064a137a54c666d3b17e');
  await assert.rejects(verifyPortablePackage(packageValue, {
    ...options,
    verifyBytecode: () => assert.fail('retired GFB10 must not reach the target loader'),
  }), error => error instanceof PortablePackageError && error.code === 'unsupported-bytecode-version');
});

test('the production WASM loader rejects original GFB10 bytes', async () => {
  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  const runtime = await GhostFlowRuntime.instantiate(wasm);
  try {
    const historical = Buffer.from(fixture.payload.bytecode.contentBase64, 'base64');
    assert.equal(historical.readUInt16LE(4), 10);
    assert.throws(() => runtime.load(historical), /unsupported GFB format/);
  } finally {
    runtime.dispose();
  }
});
