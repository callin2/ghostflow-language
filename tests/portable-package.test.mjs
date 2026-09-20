import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../tools/canonical-json.mjs';
import {
  buildPortablePackage,
  PortablePackageError,
  serializePortablePackage,
  verifyPortablePackage,
} from '../tools/portable-package.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const nativePath = path.join(root, 'target/release/examples/run' + (process.platform === 'win32' ? '.exe' : ''));
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const encoder = new TextEncoder();
const identity = Object.freeze({
  compilerRevision: 'c0bef0e',
  runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
  runtimeAbi: 'GhostFlow/framed-scan-abi-v1',
  requiredCapabilities: [
    { kind: 'actuator', name: 'pump', type: 'bool' },
    { kind: 'actuator', name: 'valve', type: 'bool' },
    { kind: 'input', name: 'start', type: 'bool' },
    { kind: 'input', name: 'stop', type: 'bool' },
  ],
  bindingRevision: 'virtual-two-output-v1',
});

function hexBytes(value) {
  return Uint8Array.from(value.match(/../g), byte => Number.parseInt(byte, 16));
}

function concat(...parts) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

async function testKey(keyId, seedHex, publicHex) {
  // RFC 8032 seeds/public keys wrapped in the minimal PKCS#8/SPKI DER prefixes.
  const privateDer = concat(hexBytes('302e020100300506032b657004220420'), hexBytes(seedHex));
  const publicDer = concat(hexBytes('302a300506032b6570032100'), hexBytes(publicHex));
  return {
    keyId,
    privateKey: await crypto.subtle.importKey('pkcs8', privateDer, 'Ed25519', false, ['sign']),
    publicKey: await crypto.subtle.importKey('spki', publicDer, 'Ed25519', false, ['verify']),
  };
}

const currentKeyPromise = testKey(
  'test-current-2026',
  '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
);
const nextKeyPromise = testKey(
  'test-next-2027',
  '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
  '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
);

async function fixture() {
  const source = fs.readFileSync(path.join(root, 'examples/tutorial/01-latch.ghost.md'), 'utf8');
  const compilation = await compileSource(source, { filename: '01-latch.ghost.md' });
  const current = await currentKeyPromise;
  const packageValue = await buildPortablePackage(compilation, identity, {
    signers: [{ keyId: current.keyId, privateKey: current.privateKey }],
    verifyCompilation: (text, { filename }) => compileSource(text, { filename }),
  });
  return { compilation, current, packageValue };
}

function verifierOptions(current, verifyBytecode = async () => true) {
  return {
    trustedKeys: [{ keyId: current.keyId, publicKey: current.publicKey }],
    revokedKeyIds: [],
    expectedCompilerRevision: identity.compilerRevision,
    supportedRuntimeSemantics: [identity.runtimeSemantics],
    supportedRuntimeAbis: [identity.runtimeAbi],
    supportedManifestFormats: ['GhostFlow/control-v1'],
    availableCapabilities: identity.requiredCapabilities,
    expectedBindingRevision: identity.bindingRevision,
    verifyBytecode,
  };
}

function buildOptions(signers) {
  return {
    signers,
    verifyCompilation: (text, { filename }) => compileSource(text, { filename }),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function digestHex(bytes) {
  const result = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(result, byte => byte.toString(16).padStart(2, '0')).join('');
}

function base64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function resign(packageValue, key) {
  const payloadBytes = encoder.encode(canonicalJson(packageValue.payload));
  packageValue.payloadSha256 = await digestHex(payloadBytes);
  const signature = await crypto.subtle.sign('Ed25519', key.privateKey, payloadBytes);
  packageValue.signatures = [{ algorithm: 'Ed25519', keyId: key.keyId, signatureBase64: base64(signature) }];
  return packageValue;
}

async function expectsCode(action, code) {
  await assert.rejects(action, error => error instanceof PortablePackageError && error.code === code, code);
}

test('GF-TEST-portable-package: deterministic package preserves exact literate, GFB, manifest and source-map identities', async () => {
  const { compilation, current, packageValue } = await fixture();
  const again = await buildPortablePackage(compilation, identity, {
    signers: [{ keyId: current.keyId, privateKey: current.privateKey }],
    verifyCompilation: (text, { filename }) => compileSource(text, { filename }),
  });
  assert.equal(serializePortablePackage(packageValue), serializePortablePackage(again));

  let verifiedBytes;
  const verified = await verifyPortablePackage(packageValue, verifierOptions(current, bytes => {
    verifiedBytes = bytes;
    return true;
  }));
  assert.deepEqual([...verified.bytecode.copy()], [...compilation.bytes]);
  assert.deepEqual([...verifiedBytes], [...compilation.bytes]);
  assert.equal(verified.source.text, compilation.sourceDocument.text);
  assert.equal(verified.source.sha256, compilation.sourceDocument.sha256);
  assert.equal(verified.manifest.bytecodeSha256, packageValue.payload.bytecode.sha256);
  assert.equal(verified.sourceMap.sourceDocument.text, compilation.sourceDocument.text);
  assert.deepEqual(verified.acceptedKeyIds, [current.keyId]);
  const changed = verified.bytecode.copy();
  changed[0] = 0;
  assert.equal(verified.bytecode.copy()[0], 0x47, 'each bytecode copy is detached from verified state');
});

test('GF-TEST-portable-package-intent-map: a re-signed replacement source map still fails strict intent provenance recovery', async () => {
  const source = `<!-- ghostflow:anchor id=GF-INT-PUMP-001 kind=intent status=confirmed origin=user -->
펌프를 켜 주세요.

\`\`\`ghost
control IntentPackage {
  input request: Bool;
  // ghostflow:link id=GF-INT-PUMP-001 relation=implements
  output pump: Bool;
  pump <- request;
}
\`\`\`
`;
  const compilation = await compileSource(source, { filename: 'intent-package.ghost.md' });
  const current = await currentKeyPromise;
  const packageValue = await buildPortablePackage(compilation, identity, buildOptions([
    { keyId: current.keyId, privateKey: current.privateKey },
  ]));
  const candidate = clone(packageValue);
  const map = JSON.parse(Buffer.from(candidate.payload.sourceMap.contentBase64, 'base64').toString('utf8'));
  map.traceMetadata.intentLinks[0].source.line = 999999;
  const mapBytes = encoder.encode(canonicalJson(map));
  candidate.payload.sourceMap.contentBase64 = base64(mapBytes);
  candidate.payload.sourceMap.sha256 = await digestHex(mapBytes);
  await resign(candidate, current);
  await expectsCode(() => verifyPortablePackage(candidate, verifierOptions(current)), 'source-map-mismatch');
});

test('GF-TEST-portable-package-trust: key rotation accepts a new active signer and rejects a solely revoked signer', async () => {
  const { compilation, current } = await fixture();
  const next = await nextKeyPromise;
  const rotated = await buildPortablePackage(compilation, identity, buildOptions([
      { keyId: current.keyId, privateKey: current.privateKey },
      { keyId: next.keyId, privateKey: next.privateKey },
  ]));
  const options = {
    ...verifierOptions(current),
    trustedKeys: [
      { keyId: current.keyId, publicKey: current.publicKey },
      { keyId: next.keyId, publicKey: next.publicKey },
    ],
    revokedKeyIds: [current.keyId],
  };
  const verified = await verifyPortablePackage(rotated, options);
  assert.deepEqual(verified.acceptedKeyIds, [next.keyId]);

  const oldOnly = await buildPortablePackage(compilation, identity, buildOptions([
    { keyId: current.keyId, privateKey: current.privateKey },
  ]));
  await expectsCode(() => verifyPortablePackage(oldOnly, { ...options, trustedKeys: options.trustedKeys }), 'signing-key-revoked');
  await expectsCode(() => verifyPortablePackage(oldOnly, { ...verifierOptions(current), revokedKeyIds: undefined }), 'invalid-trust-store');
});

test('GF-TEST-portable-package-build: signing requires a deterministic compiler replay of the same source and artifacts', async () => {
  const { compilation, current } = await fixture();
  await expectsCode(() => buildPortablePackage(compilation, identity, {
    signers: [{ keyId: current.keyId, privateKey: current.privateKey }],
  }), 'compiler-replay-required');

  const otherSource = fs.readFileSync(path.join(root, 'examples/scheduled-watering.ghost.md'), 'utf8');
  const other = await compileSource(otherSource, { filename: 'scheduled-watering.ghost.md' });
  const mixed = { ...compilation, sourceDocument: other.sourceDocument };
  await expectsCode(() => buildPortablePackage(mixed, identity, buildOptions([
    { keyId: current.keyId, privateKey: current.privateKey },
  ])), 'compilation-mismatch');
});

test('GF-TEST-portable-package-rejection: structure, integrity, trust and host compatibility fail closed before GFB loading', async () => {
  const { current, packageValue } = await fixture();
  const cases = [
    ['unknown package field', 'unknown-or-missing-field', async value => { value.extra = true; }, {}],
    ['unsupported package', 'unsupported-package-format', async value => { value.format = 'GhostFlow/portable-package-v2'; }, {}],
    ['payload tamper', 'digest-mismatch', async value => { value.payload.identity.bindingRevision = 'forged-binding'; }, {}],
    ['signature tamper', 'untrusted-signature', async value => { value.signatures[0].signatureBase64 = `${value.signatures[0].signatureBase64.slice(0, -4)}AAAA`; }, {}],
    ['algorithm negotiation', 'unsupported-signature-algorithm', async value => { value.signatures[0].algorithm = 'ECDSA'; }, {}],
    ['compiler identity', 'compiler-revision-mismatch', async () => {}, { expectedCompilerRevision: 'other-compiler' }],
    ['runtime semantics', 'unsupported-runtime-semantics', async () => {}, { supportedRuntimeSemantics: ['GhostFlow/runtime-semantics-v2'] }],
    ['runtime ABI', 'unsupported-runtime-abi', async () => {}, { supportedRuntimeAbis: ['GhostFlow/framed-scan-abi-v2'] }],
    ['binding', 'binding-revision-mismatch', async () => {}, { expectedBindingRevision: 'other-binding' }],
    ['capability', 'missing-capability', async () => {}, { availableCapabilities: [identity.requiredCapabilities[0]] }],
    ['manifest format', 'unsupported-manifest-format', async () => {}, { supportedManifestFormats: ['GhostFlow/control-v2'] }],
    ['bytecode verifier absent', 'bytecode-verifier-required', async () => {}, { verifyBytecode: undefined }],
  ];
  for (const [label, code, mutate, optionChanges] of cases) {
    const candidate = clone(packageValue);
    await mutate(candidate);
    let reachedBytecode = false;
    const options = { ...verifierOptions(current, async () => { reachedBytecode = true; return true; }), ...optionChanges };
    await expectsCode(() => verifyPortablePackage(candidate, options), code);
    assert.equal(reachedBytecode, false, `${label} must fail before the target loader`);
  }

  const changedSource = clone(packageValue);
  const changedSourceBytes = encoder.encode(`${Buffer.from(changedSource.payload.source.contentBase64, 'base64').toString('utf8')}\n`);
  changedSource.payload.source.contentBase64 = base64(changedSourceBytes);
  await resign(changedSource, current);
  await expectsCode(() => verifyPortablePackage(changedSource, verifierOptions(current)), 'source-digest-mismatch');

  const invalidBase64 = clone(packageValue);
  invalidBase64.payload.source.contentBase64 = '***';
  await resign(invalidBase64, current);
  await expectsCode(() => verifyPortablePackage(invalidBase64, verifierOptions(current)), 'invalid-base64');

  const unsupportedBytecode = clone(packageValue);
  unsupportedBytecode.payload.bytecode.version = '2';
  await resign(unsupportedBytecode, current);
  await expectsCode(() => verifyPortablePackage(unsupportedBytecode, verifierOptions(current)), 'unsupported-bytecode-version');

  const noncanonicalManifest = clone(packageValue);
  const manifest = JSON.parse(Buffer.from(noncanonicalManifest.payload.manifest.contentBase64, 'base64').toString('utf8'));
  const prettyBytes = encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`);
  noncanonicalManifest.payload.manifest.contentBase64 = base64(prettyBytes);
  noncanonicalManifest.payload.manifest.sha256 = await digestHex(prettyBytes);
  await resign(noncanonicalManifest, current);
  await expectsCode(() => verifyPortablePackage(noncanonicalManifest, verifierOptions(current)), 'noncanonical-json');

  const missingManifestCapability = clone(packageValue);
  missingManifestCapability.payload.identity.requiredCapabilities.pop();
  await resign(missingManifestCapability, current);
  await expectsCode(() => verifyPortablePackage(missingManifestCapability, verifierOptions(current)), 'capability-manifest-mismatch');

  const invalidManifest = clone(packageValue);
  const invalidManifestValue = JSON.parse(Buffer.from(invalidManifest.payload.manifest.contentBase64, 'base64').toString('utf8'));
  invalidManifestValue.outputs = 'not-an-array';
  const invalidManifestBytes = encoder.encode(canonicalJson(invalidManifestValue));
  invalidManifest.payload.manifest.contentBase64 = base64(invalidManifestBytes);
  invalidManifest.payload.manifest.sha256 = await digestHex(invalidManifestBytes);
  await resign(invalidManifest, current);
  await expectsCode(() => verifyPortablePackage(invalidManifest, verifierOptions(current)), 'manifest-mismatch');

  const invalidTrace = clone(packageValue);
  const invalidTraceValue = JSON.parse(Buffer.from(invalidTrace.payload.sourceMap.contentBase64, 'base64').toString('utf8'));
  invalidTraceValue.traceMetadata.moduleFingerprint = '0'.repeat(16);
  const invalidTraceBytes = encoder.encode(canonicalJson(invalidTraceValue));
  invalidTrace.payload.sourceMap.contentBase64 = base64(invalidTraceBytes);
  invalidTrace.payload.sourceMap.sha256 = await digestHex(invalidTraceBytes);
  await resign(invalidTrace, current);
  await expectsCode(() => verifyPortablePackage(invalidTrace, verifierOptions(current)), 'source-map-mismatch');
});

test('GF-TEST-portable-package-loader-result: target verification must explicitly return true', async () => {
  const { current, packageValue } = await fixture();
  for (const result of [false, undefined, null, 0, {}]) {
    await expectsCode(
      () => verifyPortablePackage(packageValue, verifierOptions(current, async () => result)),
      'bytecode-rejected',
    );
  }
});

test('GF-TEST-portable-package-loader-context: target verifier cannot mutate signed metadata', async () => {
  const { current, packageValue } = await fixture();
  const verified = await verifyPortablePackage(packageValue, verifierOptions(current, async (_bytes, context) => {
    assert.equal(Object.isFrozen(context.manifest), true);
    assert.equal(Object.isFrozen(context.manifest.outputs), true);
    assert.equal(Object.isFrozen(context.sourceMap), true);
    assert.equal(Object.isFrozen(context.identity), true);
    assert.equal(Object.isFrozen(context.identity.requiredCapabilities), true);
    assert.equal(Reflect.set(context.identity, 'bindingRevision', 'forged-binding'), false);
    assert.equal(Reflect.set(context.manifest.outputs[0], 'name', 'forged-output'), false);
    return true;
  }));
  assert.equal(verified.identity.bindingRevision, identity.bindingRevision);
  assert.equal(verified.manifest.outputs[0].name, 'pump');
});

test('GF-TEST-portable-package-manifest-capabilities: input and required sensor omissions fail closed', async () => {
  const source = `# Required moisture sensor\n\n\`\`\`ghost\ncontrol SensorPump {\n  input enabled: Bool;\n  sensor moisture: Percent;\n  output pump: Bool;\n  let dry = case moisture { ok(value) => value < 30%; fault(_) => false; };\n  pump <- enabled && dry;\n}\n\`\`\`\n`;
  const compilation = await compileSource(source, { filename: 'sensor-pump.ghost.md' });
  const current = await currentKeyPromise;
  const incompleteIdentity = {
    ...identity,
    requiredCapabilities: [{ kind: 'actuator', name: 'pump', type: 'bool' }],
    bindingRevision: 'virtual-sensor-pump-v1',
  };
  const packageValue = await buildPortablePackage(compilation, incompleteIdentity, buildOptions([
    { keyId: current.keyId, privateKey: current.privateKey },
  ]));
  await expectsCode(() => verifyPortablePackage(packageValue, {
    ...verifierOptions(current),
    expectedBindingRevision: incompleteIdentity.bindingRevision,
    availableCapabilities: incompleteIdentity.requiredCapabilities,
  }), 'capability-manifest-mismatch');
});

test('GF-TEST-canonical-json-boundaries: sparse arrays and unsafe integers are rejected deterministically', () => {
  const sparse = [];
  sparse.length = 1;
  const strict = { rejectSparseArrays: true, rejectUnsafeIntegers: true };
  assert.throws(() => canonicalJson(sparse, strict), /sparse arrays/);
  assert.throws(() => canonicalJson({ count: Number.MAX_SAFE_INTEGER + 1 }, strict), /safe range/);
  assert.equal(canonicalJson({ negativeZero: -0 }), '{"negativeZero":0}');
  assert.equal(canonicalJson({ '😄': 'ok', a: '한글' }), '{"a":"한글","😄":"ok"}');
});

test('GF-TEST-portable-package-hosts: one verified package feeds byte-identical GFB1 to native Rust and release WASM', async t => {
  assert.ok(fs.existsSync(nativePath), 'release native loader is required; run npm test first');
  assert.ok(fs.existsSync(wasmPath), 'release WASM loader is required; run npm test first');
  const { compilation, current, packageValue } = await fixture();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-portable-package-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

  const native = await verifyPortablePackage(packageValue, verifierOptions(current, bytes => {
    const modulePath = path.join(temporary, 'program.gfb');
    const inputPath = path.join(temporary, 'inputs.csv');
    fs.writeFileSync(modulePath, bytes);
    fs.writeFileSync(inputPath, 'start,stop\ntrue,false\n');
    const output = execFileSync(nativePath, [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim();
    const outcome = JSON.parse(output);
    assert.equal(outcome.status, 'OK');
    return true;
  }));

  const wasmBytes = fs.readFileSync(wasmPath);
  const wasm = await verifyPortablePackage(packageValue, verifierOptions(current, async bytes => {
    const runtime = await GhostFlowRuntime.instantiate(wasmBytes);
    try {
      runtime.load(bytes);
      runtime.addCapability('actuator', 'pump', 'bool');
      runtime.addCapability('actuator', 'valve', 'bool');
      runtime.activate();
      return true;
    } finally {
      runtime.dispose();
    }
  }));
  assert.deepEqual([...native.bytecode.copy()], [...compilation.bytes]);
  assert.deepEqual([...wasm.bytecode.copy()], [...compilation.bytes]);
  assert.deepEqual([...native.bytecode.copy()], [...wasm.bytecode.copy()]);
});

test('GF-TEST-portable-package-browser: signed package verification does not require Buffer', async () => {
  const { current, packageValue } = await fixture();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
  Object.defineProperty(globalThis, 'Buffer', { configurable: true, value: undefined });
  try {
    const verified = await verifyPortablePackage(packageValue, verifierOptions(current));
    assert.equal(verified.source.filename, '01-latch.ghost.md');
    assert.equal(serializePortablePackage(packageValue).endsWith('\n'), true);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'Buffer', descriptor);
    else delete globalThis.Buffer;
  }
});
