import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { verifyPortablePackage, PortablePackageError } from '../tools/portable-package.mjs';

const publicKey = await crypto.subtle.importKey('raw', Buffer.from(
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex'),
'Ed25519', false, ['verify']);
const options = {
  trustedKeys: [{ keyId: 'test-current-2026', publicKey }], revokedKeyIds: [],
  expectedCompilerRevision: 'c0bef0e',
  supportedRuntimeSemantics: ['GhostFlow/runtime-semantics-v1'],
  supportedRuntimeAbis: ['GhostFlow/context-scan-abi-v5'],
  supportedManifestFormats: ['GhostFlow/control-v10'],
  availableCapabilities: [{ kind: 'actuator', name: 'due', type: 'bool' }],
  expectedBindingRevision: 'virtual-two-output-v1',
  verifyBytecode: async () => true,
};
function signed(scenario) {
  return JSON.parse(execFileSync(process.execPath,
    [new URL('./native-gfb11-periodic-package-fixture.mjs', import.meta.url).pathname, scenario],
    { encoding: 'utf8' }));
}

test('current REF-03-036 GFB11 Periodic source builds and verifies a signed package', async () => {
  const verified = await verifyPortablePackage(signed('valid'), options);
  assert.equal(verified.manifest.format, 'GhostFlow/control-v10');
  assert.equal(verified.manifest.schedules[0].kind, 'periodic');
  assert.equal(verified.manifest.configs[0].type, 'Duration');
});

test('signed GFB11 profile still rejects other schedule kinds', async () => {
  await assert.rejects(() => verifyPortablePackage(signed('wrong-kind'), options),
    error => error instanceof PortablePackageError && error.code === 'unsupported-bytecode-version');
});
