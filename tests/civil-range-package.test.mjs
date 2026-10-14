import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { verifyPortablePackage } from '../tools/portable-package.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { civilRangeFixture, publicKeyBytes, rangeIdentity } from './native-civil-range-package-fixture.mjs';

const publicKey = await crypto.subtle.importKey('raw', publicKeyBytes, 'Ed25519', false, ['verify']);
const options = {
  trustedKeys: [{ keyId: 'test-current-2026', publicKey }], revokedKeyIds: [],
  expectedCompilerRevision: rangeIdentity.compilerRevision,
  supportedRuntimeSemantics: [rangeIdentity.runtimeSemantics],
  supportedRuntimeAbis: [rangeIdentity.runtimeAbi, 'GhostFlow/framed-scan-abi-v1'],
  supportedManifestFormats: ['GhostFlow/control-v21', 'GhostFlow/control-v10'],
  availableCapabilities: [...rangeIdentity.requiredCapabilities, { kind: 'sensor', name: 'request', type: 'bool' }],
  expectedBindingRevision: rangeIdentity.bindingRevision,
};
for (const scenario of ['valid', 'lifecycle-valid', 'predicate-valid', 'lifecycle-predicate-valid', 'operators-valid', 'lifecycle-operators-valid', 'predicate-result-valid', 'lifecycle-predicate-result-valid']) {
  test(`signed civil Range ${scenario} reaches real owner WASM`, async t => {
    const candidate = await civilRangeFixture(scenario);
    let reached = false;
    const verified = await verifyPortablePackage(candidate, { ...options, verifyBytecode: async (bytes, { manifest }) => {
      const runtime = await ControlRuntime.instantiateFramed(fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url)), { bytes, manifest }, {
        context: { bootEpoch: 1, terminalCapacity: 128, bindings: [] },
        ...(manifest.lifecycle ? { restart: { reasonOrdinal: 4, eventPending: true } } : {}),
      });
      t.after(() => runtime.dispose()); reached = true; return true;
    } });
    assert.equal(reached, true);
    assert.equal(verified.manifest.format, 'GhostFlow/control-v21');
    assert.deepEqual(verified.identity.requiredCapabilities, candidate.payload.identity.requiredCapabilities);
    assert.equal(candidate.payload.bytecode.version, scenario.startsWith('lifecycle-') ? '22' : '21');
  });
}
for (const prefix of ['', 'lifecycle-']) {
  for (const name of ['wrong-zone', 'wrong-slots', 'wrong-duration', 'wrong-site', 'wrong-name', 'wrong-gap', 'wrong-dst', 'wrong-when', 'wrong-cancel', 'missing-schedule', 'duplicate-schedule', 'extra-policy', 'wrong-format', 'wrong-abi', 'wrong-header', 'extra-config', 'predicate-tamper', 'predicate-result-tamper']) {
    test(`re-signed civil Range ${prefix}${name} rejects before target loader`, async () => {
      const candidate = await civilRangeFixture(prefix + name);
      await assert.rejects(verifyPortablePackage(candidate, { ...options, verifyBytecode: () => assert.fail('tampered owner projection reached target loader') }));
    });
  }
}
