import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/compile-source.mjs';
import { buildPortablePackage, PortablePackageError } from '../tools/portable-package.mjs';
import { atSource } from './helpers/at-source.mjs';

test('At executable artifacts remain outside the current signed package profile', async () => {
  const compilation = await compileSource(atSource(), { filename: 'at-package.ghost.md' });
  assert.equal(new DataView(compilation.bytes.buffer, compilation.bytes.byteOffset).getUint16(4, true), 14);
  assert.equal(compilation.manifest.format, 'GhostFlow/control-v13');
  let replayed = false;
  await assert.rejects(() => buildPortablePackage(compilation, {
    compilerRevision: 'at-package-test',
    runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
    runtimeAbi: 'GhostFlow/context-scan-abi-v5',
    requiredCapabilities: [
      { kind: 'input', name: 'allow', type: 'bool' },
      { kind: 'actuator', name: 'alarm', type: 'bool' },
    ],
    bindingRevision: 'at-package-test',
  }, {
    signers: [],
    verifyCompilation: async (...args) => { replayed = true; return compileSource(...args); },
  }), error => error instanceof PortablePackageError && error.code === 'unsupported-bytecode-version');
  assert.equal(replayed, false, 'unsupported execution must be rejected before signing replay');
});
