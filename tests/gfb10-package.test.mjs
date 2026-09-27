import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
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
  return { key, packageValue, options };
}

test('REF-03-036 verifies a genuine pinned GFB10 package through the target loader', async () => {
  const { packageValue, options } = await signedPeriodicPackage();
  const pinnedBytecode = Buffer.from(fixture.payload.bytecode.contentBase64, 'base64');
  let loaderCalls = 0;
  const verified = await verifyPortablePackage(packageValue, {
    ...options,
    verifyBytecode: async bytes => {
      loaderCalls += 1;
      assert.deepEqual(Buffer.from(bytes), pinnedBytecode);
      return true;
    },
  });

  assert.equal(packageValue.payload.bytecode.version, '10');
  assert.equal(packageValue.payload.bytecode.sha256, 'd00203644d730cc0112921d96889ba240de6e8f7255d064a137a54c666d3b17e');
  assert.equal(verified.manifest.format, 'GhostFlow/control-v9');
  assert.equal(loaderCalls, 1);
});

test('pinned GFB10 package requires target bytecode acceptance', async () => {
  const { packageValue, options } = await signedPeriodicPackage();
  let loaderCalls = 0;
  await assert.rejects(
    () => verifyPortablePackage(packageValue, {
      ...options,
      verifyBytecode: async () => {
        loaderCalls += 1;
        return false;
      },
    }),
    error => error instanceof PortablePackageError && error.code === 'bytecode-rejected',
  );
  assert.equal(loaderCalls, 1);
});

test('portable package descriptors continue to reject reserved GFB5 through GFB9', async () => {
  const { key, packageValue, options } = await signedPeriodicPackage();
  for (const version of ['5', '6', '7', '8', '9']) {
    const changed = structuredClone(packageValue);
    changed.payload.bytecode.version = version;
    await resign(changed, key);
    await assert.rejects(
      () => verifyPortablePackage(changed, options),
      error => error instanceof PortablePackageError && error.code === 'unsupported-bytecode-version',
    );
  }
});

test('re-signed malformed GFB10 rejects before the delegated loader', async () => {
  const { key, packageValue, options } = await signedPeriodicPackage();
  const changed = structuredClone(packageValue);
  const bytecode = Buffer.from(changed.payload.bytecode.contentBase64, 'base64').subarray(0, -1);
  const bytecodeSha256 = await digest(bytecode);
  changed.payload.bytecode.contentBase64 = bytecode.toString('base64');
  changed.payload.bytecode.sha256 = bytecodeSha256;
  for (const artifact of ['manifest', 'sourceMap']) {
    const value = JSON.parse(Buffer.from(changed.payload[artifact].contentBase64, 'base64').toString('utf8'));
    value.bytecodeSha256 = bytecodeSha256;
    if (value.traceMetadata) value.traceMetadata.bytecodeSha256 = bytecodeSha256;
    const bytes = encoder.encode(canonicalJson(value));
    changed.payload[artifact].contentBase64 = Buffer.from(bytes).toString('base64');
    changed.payload[artifact].sha256 = await digest(bytes);
  }
  await resign(changed, key);

  await assert.rejects(
    () => verifyPortablePackage(changed, {
      ...options,
      verifyBytecode: async () => assert.fail('malformed GFB10 must reject before the delegated loader'),
    }),
    error => error instanceof PortablePackageError
      && error.code === 'source-map-mismatch'
      && error.cause?.message === 'source trace module fingerprint mismatch',
  );
});
