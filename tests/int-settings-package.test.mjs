import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { buildPortablePackage, verifyPortablePackage, PortablePackageError } from '../tools/portable-package.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { invalidIntSettings, validIntSettings } from './helpers/int-settings-vectors.mjs';

const encode = value => new TextEncoder().encode(canonicalJson(value));
const digest = async bytes => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');

test('signed Int settings preserve exact bounds and reject malformed metadata before source replay', async t => {
  const source = '# Int package\n\n```ghost\ncontrol IntPackage { config count: Int = 0 { min = -2147483648; max = 2147483647; step = 1; access = operator; } }\n```\n';
  const compilation = await compileSource(source, { filename: 'int-settings-package.ghost.md' });
  const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const keyId = 'int-settings-test-key';
  const identity = {
    compilerRevision: 'int-settings-test', runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
    runtimeAbi: 'GhostFlow/context-scan-abi-v5', requiredCapabilities: [], bindingRevision: 'int-settings-test-binding',
  };
  const packaged = await buildPortablePackage(compilation, identity, {
    signers: [{ keyId, privateKey: key.privateKey }], verifyCompilation: compileSource,
  });
  const options = {
    trustedKeys: [{ keyId, publicKey: key.publicKey }], revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision,
    supportedRuntimeSemantics: [identity.runtimeSemantics], supportedRuntimeAbis: [identity.runtimeAbi],
    supportedManifestFormats: ['GhostFlow/control-v10'], availableCapabilities: [],
    expectedBindingRevision: identity.bindingRevision, verifyBytecode: async () => true,
  };
  const verified = await verifyPortablePackage(packaged, options);
  assert.equal(verified.manifest.configs[0].settings.min, -2147483648);
  assert.equal(verified.manifest.configs[0].settings.max, 2147483647);

  for (const { value, min, max, step } of validIntSettings) await t.test(`valid Int grid ${value}/${step}`, async () => {
    const validSource = `# Int package\n\n\`\`\`ghost\ncontrol IntPackage { config count: Int = ${value} { min = ${min}; max = ${max}; step = ${step}; access = operator; } }\n\`\`\`\n`;
    const validCompilation = await compileSource(validSource, { filename: 'int-settings-package.ghost.md' });
    const validPackage = await buildPortablePackage(validCompilation, identity, {
      signers: [{ keyId, privateKey: key.privateKey }], verifyCompilation: compileSource,
    });
    const checked = await verifyPortablePackage(validPackage, options);
    assert.equal(checked.manifest.configs[0].value, value);
    // An empty WASM module fails only after manifest validation has succeeded.
    // Execution at both i32 endpoints is covered by int-settings-artifacts.
    await assert.rejects(() => ControlRuntime.instantiate(new Uint8Array(), validCompilation,
      { context: { bootEpoch: 1, terminalCapacity: 8, bindings: [] } }), WebAssembly.CompileError);
  });

  const cases = [
    ...invalidIntSettings,
    ['missing minimum', c => { delete c.settings.min; }, 'settings.min must be a signed i32 Int'],
    ['missing access', c => { delete c.settings.access; }, 'settings.access must be operator or designer'],
    ['invalid access', c => { c.settings.access = 'viewer'; }, 'settings.access must be operator or designer'],
    ['empty label', c => { c.settings.label = ''; }, 'settings.label must be a string of 1 to 128 characters'],
    ['non-string label', c => { c.settings.label = 1; }, 'settings.label must be a string of 1 to 128 characters'],
    ['oversized label', c => { c.settings.label = 'x'.repeat(129); }, 'settings.label must be a string of 1 to 128 characters'],
    ['null settings', c => { c.settings = null; }, 'settings must be an object'],
    ['array settings', c => { c.settings = []; }, 'settings must be an object'],
    ['valid but forged default', c => { c.value = 1; }, null],
    ['valid but forged label', c => { c.settings.label = 'Forged'; }, null],
  ];
  for (const [name, mutate, message, runtimeMessage, runtimeError] of cases) await t.test(name, async () => {
    const changed = structuredClone(packaged);
    const manifest = JSON.parse(Buffer.from(changed.payload.manifest.contentBase64, 'base64').toString('utf8'));
    mutate(manifest.configs[0]);
    if (runtimeMessage !== undefined) {
      await assert.rejects(() => ControlRuntime.instantiate(new Uint8Array(), {
        bytes: compilation.bytes, manifest,
      }), error => {
        assert.equal(error.constructor, runtimeError);
        const detail = runtimeMessage.replace(/^value must /, 'must ');
        assert.equal(error.message, `config count${detail.startsWith('must ') ? ' ' : '.'}${detail}`);
        return true;
      });
    }
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
      if (message === null) assert.equal(error.cause?.message, 'config streams do not match canonical source lowering');
      else assert.equal(error.message, `manifest.configs[0].${message}`);
      return true;
    });
  });
});
