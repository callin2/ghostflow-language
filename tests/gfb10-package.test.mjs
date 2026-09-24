import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import {
  buildPortablePackage,
  PortablePackageError,
  verifyPortablePackage,
} from '../tools/portable-package.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url)))
  .cases.find(entry => entry.id === 'REF-03-036');
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
  const compilation = await compileSource(fixture.source, { filename: fixture.filename });
  const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const identity = {
    compilerRevision: 'gfb10-package-test',
    runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
    runtimeAbi: 'GhostFlow/context-scan-abi-v1',
    requiredCapabilities: [{ kind: 'actuator', name: 'due', type: 'bool' }],
    bindingRevision: 'gfb10-package-test-binding',
  };
  const packageValue = await buildPortablePackage(compilation, identity, {
    signers: [{ keyId: 'gfb10-package-test-key', privateKey: key.privateKey }],
    verifyCompilation: compileSource,
  });
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
  return { compilation, identity, key, packageValue, options };
}

test('REF-03-036 builds and verifies as a structurally replayed GFB10 package', async () => {
  const { compilation, packageValue, options } = await signedPeriodicPackage();
  let loaderCalls = 0;
  const verified = await verifyPortablePackage(packageValue, {
    ...options,
    verifyBytecode: async bytes => {
      loaderCalls += 1;
      assert.deepEqual(Buffer.from(bytes), Buffer.from(compilation.bytes));
      return true;
    },
  });

  assert.equal(packageValue.payload.bytecode.version, '10');
  assert.equal(verified.manifest.format, 'GhostFlow/control-v9');
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
      && error.cause?.message === 'canonical source does not reproduce package bytecode',
  );
});
