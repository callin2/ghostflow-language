import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { buildPortablePackage, verifyPortablePackage, PortablePackageError } from '../tools/portable-package.mjs';

const encode = value => new TextEncoder().encode(canonicalJson(value));
const digest = async bytes => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');

test('signed Int settings preserve exact bounds and reject malformed metadata before source replay', async t => {
  const source = '# Int package\n\n```ghost\ncontrol IntPackage { config count: Int = 0 { min = -2147483648; max = 2147483647; step = 1; access = operator; } }\n```\n';
  const compilation = await compileSource(source, { filename: 'int-settings-package.ghost.md' });
  const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const keyId = 'int-settings-test-key';
  const identity = {
    compilerRevision: 'int-settings-test', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
    runtimeAbi: 'GhostFlow/framed-scan-abi-v1', requiredCapabilities: [], bindingRevision: 'int-settings-test-binding',
  };
  const packaged = await buildPortablePackage(compilation, identity, {
    signers: [{ keyId, privateKey: key.privateKey }], verifyCompilation: compileSource,
  });
  const options = {
    trustedKeys: [{ keyId, publicKey: key.publicKey }], revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision,
    supportedRuntimeSemantics: [identity.runtimeSemantics], supportedRuntimeAbis: [identity.runtimeAbi],
    supportedManifestFormats: ['GhostFlow/control-v2'], availableCapabilities: [],
    expectedBindingRevision: identity.bindingRevision, verifyBytecode: async () => true,
  };
  const verified = await verifyPortablePackage(packaged, options);
  assert.equal(verified.manifest.configs[0].settings.min, -2147483648);
  assert.equal(verified.manifest.configs[0].settings.max, 2147483647);

  const cases = [
    ['fractional default', c => { c.value = 0.5; }, 'value must be a signed i32 Int'],
    ['overflow default', c => { c.value = 2147483648; }, 'value must be a signed i32 Int'],
    ['fractional minimum', c => { c.settings.min = -0.5; }, 'settings.min must be a signed i32 Int'],
    ['underflow minimum', c => { c.settings.min = -2147483649; }, 'settings.min must be a signed i32 Int'],
    ['fractional maximum', c => { c.settings.max = 0.5; }, 'settings.max must be a signed i32 Int'],
    ['overflow maximum', c => { c.settings.max = 2147483648; }, 'settings.max must be a signed i32 Int'],
    ['fractional step', c => { c.settings.step = 0.5; }, 'settings.step must be a signed i32 Int'],
    ['overflow step', c => { c.settings.step = 2147483648; }, 'settings.step must be a signed i32 Int'],
    ['zero step', c => { c.settings.step = 0; }, 'settings range or grid is invalid for Int'],
    ['negative step', c => { c.settings.step = -1; }, 'settings range or grid is invalid for Int'],
    ['inverted range', c => { c.settings.min = 1; c.settings.max = 0; }, 'settings range or grid is invalid for Int'],
    ['default outside range', c => { c.settings.min = 1; }, 'settings range or grid is invalid for Int'],
    ['large-step tolerance hole', c => { c.value = 1; c.settings.min = 0; c.settings.max = 2147483647; c.settings.step = 2147483647; }, 'settings range or grid is invalid for Int'],
    ['maximum off grid', c => { c.settings.min = 0; c.settings.max = 5; c.settings.step = 2; }, 'settings range or grid is invalid for Int'],
    ['missing minimum', c => { delete c.settings.min; }, 'settings.min must be a signed i32 Int'],
    ['unexpected stepType', c => { c.settings.stepType = 'Int'; }, 'settings.stepType is forbidden'],
    ['missing access', c => { delete c.settings.access; }, 'settings.access must be operator or designer'],
    ['invalid access', c => { c.settings.access = 'viewer'; }, 'settings.access must be operator or designer'],
    ['invalid apply policy', c => { c.settings.apply = 'running'; }, 'settings.apply must be stopped'],
    ['empty label', c => { c.settings.label = ''; }, 'settings.label must be a string of 1 to 128 characters'],
    ['non-string label', c => { c.settings.label = 1; }, 'settings.label must be a string of 1 to 128 characters'],
    ['oversized label', c => { c.settings.label = 'x'.repeat(129); }, 'settings.label must be a string of 1 to 128 characters'],
    ['unknown setting field', c => { c.settings.extra = true; }, 'settings.extra is forbidden'],
    ['null settings', c => { c.settings = null; }, 'settings must be an object'],
    ['array settings', c => { c.settings = []; }, 'settings must be an object'],
    ['valid but forged default', c => { c.value = 1; }, null],
    ['valid but forged label', c => { c.settings.label = 'Forged'; }, null],
  ];
  for (const [name, mutate, message] of cases) await t.test(name, async () => {
    const changed = structuredClone(packaged);
    const manifest = JSON.parse(Buffer.from(changed.payload.manifest.contentBase64, 'base64').toString('utf8'));
    mutate(manifest.configs[0]);
    const manifestBytes = encode(manifest);
    changed.payload.manifest.contentBase64 = Buffer.from(manifestBytes).toString('base64');
    changed.payload.manifest.sha256 = await digest(manifestBytes);
    const payload = encode(changed.payload);
    changed.payloadSha256 = await digest(payload);
    changed.signatures = [{ algorithm: 'Ed25519', keyId,
      signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', key.privateKey, payload)).toString('base64') }];
    await assert.rejects(() => verifyPortablePackage(changed, options), error => {
      assert.ok(error instanceof PortablePackageError);
      assert.equal(error.code, message === null ? 'source-map-mismatch' : 'manifest-mismatch');
      if (message === null) assert.equal(error.cause?.message, 'Int configs do not match canonical source lowering');
      else assert.equal(error.message, `manifest.configs[0].${message}`);
      return true;
    });
  });
});
