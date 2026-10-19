import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { buildPortablePackage, PortablePackageError, verifyPortablePackage } from '../tools/portable-package.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const filename = 'window-derived-package.ghost.md';
const source = `# Signed nested windows

This complete document is the authoritative control source.

\`\`\`ghost
control SignedNestedWindows {
  input reading: Number;
  signal inner = window_average(reading, over: 2ms, quality: measured, max_age: 2ms);
  signal outer = window_max(inner, over: 10ms, quality: measured, max_age: 10ms);
  output maximum: Number;
  maximum <- outer |> recover(-1.0);
}
\`\`\`
`;

const encode = value => Buffer.from(canonicalJson(value));

async function replaceRecordAndResign(candidate, recordName, mutate, keyId, privateKey) {
  const record = candidate.payload[recordName];
  const value = JSON.parse(Buffer.from(record.contentBase64, 'base64').toString('utf8'));
  mutate(value);
  const content = encode(value);
  record.contentBase64 = content.toString('base64');
  record.sha256 = sha256Hex(content);
  const payload = encode(candidate.payload);
  candidate.payloadSha256 = sha256Hex(payload);
  candidate.signatures = [{
    algorithm: 'Ed25519', keyId,
    signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', privateKey, payload)).toString('base64'),
  }];
}

test('signed nested-window package pins manifest and source-trace evidence dependencies before loading', async t => {
  const compilation = await compileSource(source, { filename });
  const [inner, outer] = compilation.manifest.signals;
  const expectedUpstream = [{ name: inner.name, site: inner.site, slot: inner.slot }];
  assert.equal(compilation.sourceDocument.kind, 'literate');
  assert.equal(compilation.sourceDocument.filename, filename);
  assert.equal(compilation.sourceDocument.text, source);
  assert.deepEqual(outer.upstreamWindows, expectedUpstream);
  assert.deepEqual(compilation.traceMetadata.windowSites[1].upstreamWindows, expectedUpstream);

  const key = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const keyId = 'window-derived-package-test-key';
  const identity = {
    compilerRevision: 'window-derived-package-test',
    runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
    runtimeAbi: 'GhostFlow/framed-scan-abi-v1',
    bindingRevision: 'window-derived-package-v1',
    requiredCapabilities: [
      { kind: 'sensor', name: 'reading', type: 'number' },
      { kind: 'actuator', name: 'maximum', type: 'number' },
    ],
  };
  const packaged = await buildPortablePackage(compilation, identity, {
    signers: [{ keyId, privateKey: key.privateKey }], verifyCompilation: compileSource,
  });
  let loaderCalls = 0;
  const options = {
    trustedKeys: [{ keyId, publicKey: key.publicKey }], revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision,
    supportedRuntimeSemantics: [identity.runtimeSemantics], supportedRuntimeAbis: [identity.runtimeAbi],
    supportedManifestFormats: [compilation.manifest.format], availableCapabilities: identity.requiredCapabilities,
    expectedBindingRevision: identity.bindingRevision,
    verifyBytecode: async bytes => {
      loaderCalls += 1;
      assert.deepEqual(Buffer.from(bytes), Buffer.from(compilation.bytes));
      return true;
    },
  };

  await t.test('authentic package preserves the complete literate source and reaches the loader once', async () => {
    const verified = await verifyPortablePackage(packaged, options);
    assert.equal(verified.source.filename, filename);
    assert.equal(verified.source.text, source);
    assert.deepEqual(verified.manifest.signals[1].upstreamWindows, expectedUpstream);
    assert.equal(loaderCalls, 1);
  });

  const manifestCases = [
    ['manifest dependency removal', value => { delete value.signals[1].upstreamWindows; }],
    ['manifest dependency slot substitution', value => { value.signals[1].upstreamWindows[0].slot = 1; }],
    ['manifest dependency site substitution', value => { value.signals[1].upstreamWindows[0].site += 1; }],
    ['manifest dependency name substitution', value => { value.signals[1].upstreamWindows[0].name = 'outer'; }],
  ];
  const sourceMapCases = [
    ['source trace dependency removal', value => { delete value.traceMetadata.windowSites[1].upstreamWindows; }],
    ['source trace dependency slot substitution', value => { value.traceMetadata.windowSites[1].upstreamWindows[0].slot = 1; }],
    ['source trace dependency site substitution', value => { value.traceMetadata.windowSites[1].upstreamWindows[0].site += 1; }],
    ['source trace dependency name substitution', value => { value.traceMetadata.windowSites[1].upstreamWindows[0].name = 'outer'; }],
    ['consumer dependency removal', value => {
      const reads = value.traceMetadata.dependencies.find(entry => entry.target.field === 'windowTrace' && entry.target.name === 'outer').reads;
      reads.splice(reads.findIndex(read => read.field === 'windowTrace' && read.name === 'inner'), 1);
    }],
    ['consumer dependency rebind', value => {
      const read = value.traceMetadata.dependencies.find(entry => entry.target.field === 'windowTrace' && entry.target.name === 'outer')
        .reads.find(candidate => candidate.field === 'windowTrace' && candidate.name === 'inner');
      read.name = 'outer';
    }],
  ];

  for (const [recordName, name, mutate] of [...manifestCases.map(entry => ['manifest', ...entry]),
    ...sourceMapCases.map(entry => ['sourceMap', ...entry])]) {
    await t.test(name, async () => {
      const candidate = structuredClone(packaged);
      await replaceRecordAndResign(candidate, recordName, mutate, keyId, key.privateKey);
      await assert.rejects(() => verifyPortablePackage(candidate, options), error => {
        assert.ok(error instanceof PortablePackageError);
        assert.equal(error.code, 'source-map-mismatch');
        assert.match(error.cause?.message ?? '', /window|evidence|dependencies/i);
        return true;
      });
      assert.equal(loaderCalls, 1, 'semantic substitutions reject before the delegated target loader');
    });
  }
});
