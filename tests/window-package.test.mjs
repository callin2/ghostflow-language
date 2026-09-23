import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { buildPortablePackage, verifyPortablePackage, PortablePackageError } from '../tools/portable-package.mjs';

const encode = value => new TextEncoder().encode(canonicalJson(value));
const digest = async bytes => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
const source = '# Window package\n\n```ghost\ncontrol WindowPackage {\n  sensor temperature: Temperature;\n  signal mean = window_average(temperature, over: 1s, quality: measured, max_age: 500ms);\n}\n```\n';

test('signed window metadata preserves canonical descriptors and rejects re-signed substitutions', async t => {
  const compilation = await compileSource(source, { filename: 'window-package.ghost.md' });
  const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const keyId = 'window-package-test-key';
  const identity = {
    compilerRevision: 'window-package-test', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
    runtimeAbi: 'GhostFlow/framed-scan-abi-v1', requiredCapabilities: [{ kind: 'sensor', name: 'temperature', type: 'number' }], bindingRevision: 'window-test-binding',
  };
  const packaged = await buildPortablePackage(compilation, identity, {
    signers: [{ keyId, privateKey: key.privateKey }], verifyCompilation: compileSource,
  });
  let loaderCalls = 0;
  const options = {
    trustedKeys: [{ keyId, publicKey: key.publicKey }], revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision,
    supportedRuntimeSemantics: [identity.runtimeSemantics], supportedRuntimeAbis: [identity.runtimeAbi],
    supportedManifestFormats: ['GhostFlow/control-v4'], availableCapabilities: identity.requiredCapabilities,
    expectedBindingRevision: identity.bindingRevision,
    // This suite proves package validation order and source/metadata identity.
    // Actual Rust execution is tested separately, not simulated by this callback.
    verifyBytecode: async bytes => {
      loaderCalls++;
      assert.deepEqual(Buffer.from(bytes), Buffer.from(compilation.bytes));
      return true;
    },
  };
  await t.test('valid GFB4 package reaches the delegated loader unchanged', async () => {
    const verified = await verifyPortablePackage(packaged, options);
    assert.equal(packaged.payload.bytecode.version, '4');
    assert.deepEqual(verified.manifest.signals, compilation.manifest.signals);
    assert.equal(loaderCalls, 1);
  });

  const cases = [
    ['changed operation', signal => { signal.operation = 'max'; }],
    ['changed window duration', signal => { signal.overMs = 2000; }],
    ['changed freshness duration', signal => { signal.maxAgeMs = 1000; }],
    ['changed payload type', signal => { signal.payloadType = 'Pressure'; }],
    ['changed slot', signal => { signal.slot = 1; }],
    ['changed site', signal => { signal.site += 1; }],
    ['changed quality', signal => { signal.quality = 'estimated'; }],
    ['changed physical source tag', signal => { signal.sources[0].tag += 1; }],
    ['missing physical sources', signal => { signal.sources = []; }],
    ['unexpected descriptor field', signal => { signal.density = 1; }],
    ['zero duration', signal => { signal.overMs = 0; }],
    ['changed source sensor nominal type', (_, manifest) => {
      manifest.sensors[0].type = 'Pressure'; manifest.sensors[0].canonicalUnit = 'Pa';
    }, 'window source sensors do not match canonical source lowering'],
    ['changed source sensor filter', (_, manifest) => {
      manifest.sensors[0].filter = 'median'; manifest.sensors[0].window = 3;
    }, 'window source sensors do not match canonical source lowering'],
  ];
  for (const [name, mutate, detail = 'window descriptors do not match canonical source lowering'] of cases) await t.test(name, async () => {
    const changed = structuredClone(packaged);
    const manifest = JSON.parse(Buffer.from(changed.payload.manifest.contentBase64, 'base64').toString('utf8'));
    mutate(manifest.signals[0], manifest);
    const bytes = encode(manifest);
    changed.payload.manifest.contentBase64 = Buffer.from(bytes).toString('base64');
    changed.payload.manifest.sha256 = await digest(bytes);
    const payload = encode(changed.payload);
    changed.payloadSha256 = await digest(payload);
    changed.signatures = [{ algorithm: 'Ed25519', keyId,
      signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', key.privateKey, payload)).toString('base64') }];
    const before = loaderCalls;
    await assert.rejects(() => verifyPortablePackage(changed, options), error => {
      assert.ok(error instanceof PortablePackageError);
      assert.equal(error.code, 'source-map-mismatch');
      assert.equal(error.cause?.message, detail);
      return true;
    });
    assert.equal(loaderCalls, before, 'descriptor corruption rejects before the delegated loader');
  });
});
