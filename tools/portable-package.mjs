import { canonicalJson } from './canonical-json.mjs';
import { canonicalUnitFor, isQuantityType } from './quantities.mjs';
import { isTimeType, validateTimeValue } from './time-literals.mjs';
import { isInt32, intSettingsIssue } from './int-settings.mjs';
import { compileControl } from './control.mjs';
import { extractLiterate } from './literate.mjs';
import { equalBytes } from './sha256.mjs';
import { remapSourceTrace, sourceMapRequiresTraceMetadata, verifySourceTraceMetadata } from './source-trace.mjs';

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder('utf-8', { fatal: true });
const PACKAGE_FORMAT = 'GhostFlow/portable-package-v1';
const PAYLOAD_FORMAT = 'GhostFlow/portable-payload-v1';
const SOURCE_FORMAT = 'GhostFlow/source-document-v1';
const SOURCE_MAP_FORMAT = 'GhostFlow/source-map-v1';
const SOURCE_MEDIA_TYPE = 'text/markdown; profile=ghostflow-literate';
const SIGNATURE_ALGORITHM = 'Ed25519';
const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_SIGNED_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_SIGNATURES = 8;
const MAX_CAPABILITIES = 256;

export class PortablePackageError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'PortablePackageError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new PortablePackageError(code, message, cause);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, keys, path) {
  if (!isPlainObject(value)) fail('invalid-schema', `${path} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('unknown-or-missing-field', `${path} must contain exactly: ${expected.join(', ')}`);
  }
  return value;
}

function identifier(value, path) {
  if (typeof value !== 'string' || !ID.test(value)) fail('invalid-identity', `${path} must be a bounded identifier`);
  return value;
}

function ghostName(value, path) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    fail('manifest-mismatch', `${path} must be a GhostFlow name`);
  }
  return value;
}

function sourceFilename(value, path) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 256
      || value.includes('\0') || !value.endsWith('.ghost.md')) {
    fail('noncanonical-source', `${path} must be a bounded .ghost.md filename`);
  }
  return value;
}

function digestValue(value, path) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail('invalid-digest', `${path} must be a lowercase SHA-256 digest`);
  return value;
}

function bytesValue(value, path, maximum = MAX_ARTIFACT_BYTES) {
  if (!(value instanceof Uint8Array)) fail('invalid-bytes', `${path} must be Uint8Array-compatible bytes`);
  if (value.byteLength > maximum) fail('artifact-too-large', `${path} exceeds ${maximum} bytes`);
  return new Uint8Array(value);
}

function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function encodeBase64(bytes) {
  let encoded = '';
  for (let index = 0; index < bytes.byteLength; index += 3) {
    const a = bytes[index];
    const hasB = index + 1 < bytes.byteLength;
    const hasC = index + 2 < bytes.byteLength;
    const b = hasB ? bytes[index + 1] : 0;
    const c = hasC ? bytes[index + 2] : 0;
    encoded += BASE64_ALPHABET[a >>> 2];
    encoded += BASE64_ALPHABET[((a & 3) << 4) | (b >>> 4)];
    encoded += hasB ? BASE64_ALPHABET[((b & 15) << 2) | (c >>> 6)] : '=';
    encoded += hasC ? BASE64_ALPHABET[c & 63] : '=';
  }
  return encoded;
}

function decodeBase64(value, path, maximum = MAX_ARTIFACT_BYTES) {
  if (typeof value !== 'string' || !BASE64.test(value)) fail('invalid-base64', `${path} must be canonical base64`);
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const length = (value.length / 4) * 3 - padding;
  if (length > maximum) fail('artifact-too-large', `${path} exceeds ${maximum} decoded bytes`);
  const decoded = new Uint8Array(length);
  let output = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = BASE64_ALPHABET.indexOf(value[index]);
    const b = BASE64_ALPHABET.indexOf(value[index + 1]);
    const c = value[index + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 2]);
    const d = value[index + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 3]);
    if (output < length) decoded[output++] = (a << 2) | (b >>> 4);
    if (output < length) decoded[output++] = ((b & 15) << 4) | (c >>> 2);
    if (output < length) decoded[output++] = ((c & 3) << 6) | d;
  }
  if (encodeBase64(decoded) !== value) fail('invalid-base64', `${path} must use canonical base64 padding`);
  return decoded;
}

function decodeUtf8(bytes, path) {
  try {
    return UTF8_FATAL.decode(bytes);
  } catch (error) {
    fail('invalid-utf8', `${path} must be well-formed UTF-8`, error);
  }
}

function canonicalBytes(value, path) {
  try {
    return UTF8.encode(canonicalJson(value, { rejectSparseArrays: true, rejectUnsafeIntegers: true }));
  } catch (error) {
    fail('invalid-canonical-json', `${path} cannot be canonically encoded`, error);
  }
}

function parseCanonicalJson(bytes, path) {
  const text = decodeUtf8(bytes, path);
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    fail('invalid-json', `${path} is not valid JSON`, error);
  }
  if (!bytesEqual(canonicalBytes(value, path), bytes)) fail('noncanonical-json', `${path} must contain canonical JSON bytes`);
  return value;
}

function subtleCrypto() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) fail('crypto-unavailable', 'Web Crypto SHA-256 and Ed25519 are required');
  return subtle;
}

async function sha256(bytes) {
  try {
    return hex(new Uint8Array(await subtleCrypto().digest('SHA-256', bytes)));
  } catch (error) {
    if (error instanceof PortablePackageError) throw error;
    fail('crypto-failed', 'SHA-256 failed', error);
  }
}

function capabilityKey(capability) {
  return `${capability.kind}\u0000${capability.name}\u0000${capability.type}`;
}

function manifestCapabilityType(type, path) {
  if (!['Bool', 'Number', 'Percent', 'Duration', 'Int'].includes(type) && !isTimeType(type) && !isQuantityType(type)) {
    fail('manifest-mismatch', `${path} is unsupported`);
  }
  return type === 'Bool' ? 'bool' : type === 'Int' ? 'int' : 'number';
}

function manifestIntConfig(config, path, stream = false) {
  if (config.type !== 'Int') return;
  const requireInt = (value, field) => {
    if (!isInt32(value)) {
      fail('manifest-mismatch', `${path}.${field} must be a signed i32 Int`);
    }
  };
  requireInt(config.value, 'value');
  if (!Object.hasOwn(config, 'settings')) return;
  const settings = config.settings;
  if (!isPlainObject(settings)) fail('manifest-mismatch', `${path}.settings must be an object`);
  const allowed = new Set(stream ? ['min', 'max', 'step', 'access', 'label'] : ['min', 'max', 'step', 'access', 'apply', 'label']);
  for (const field of Object.keys(settings)) if (!allowed.has(field)) fail('manifest-mismatch', `${path}.settings.${field} is forbidden`);
  for (const field of ['min', 'max', 'step']) requireInt(settings[field], `settings.${field}`);
  if (!['operator', 'designer'].includes(settings.access)) fail('manifest-mismatch', `${path}.settings.access must be operator or designer`);
  if (settings.apply !== undefined && settings.apply !== 'stopped') fail('manifest-mismatch', `${path}.settings.apply must be stopped`);
  if (settings.label !== undefined && (typeof settings.label !== 'string' || settings.label.length < 1 || settings.label.length > 128)) {
    fail('manifest-mismatch', `${path}.settings.label must be a string of 1 to 128 characters`);
  }
  if (intSettingsIssue(config.value, settings) !== null) {
    fail('manifest-mismatch', `${path}.settings range or grid is invalid for Int`);
  }
}

function manifestTimeConfig(config, path, stream = false) {
  if (!isTimeType(config.type)) return;
  try { validateTimeValue(config.type, config.value, `${path}.value`); }
  catch (cause) { fail('manifest-mismatch', cause.message); }
  if (!Object.hasOwn(config, 'settings')) return;
  const allowedConfig = new Set(stream
    ? ['id', 'name', 'type', 'value', 'settings', 'initialOffset', 'initialEndOffset']
    : ['name', 'type', 'value', 'settings', 'initialOffset', 'initialEndOffset']);
  for (const field of Object.keys(config)) if (!allowedConfig.has(field)) fail('manifest-mismatch', `${path}.${field} is forbidden`);
  const settings = config.settings;
  if (!isPlainObject(settings)) fail('manifest-mismatch', `${path}.settings must be an object`);
  const allowedSettings = new Set(stream
    ? ['min', 'max', 'step', 'stepType', 'access', 'label']
    : ['min', 'max', 'step', 'stepType', 'access', 'apply', 'label']);
  for (const field of Object.keys(settings)) if (!allowedSettings.has(field)) fail('manifest-mismatch', `${path}.settings.${field} is forbidden`);
  for (const field of ['min', 'max', 'step', 'stepType', 'access']) {
    if (!Object.hasOwn(settings, field)) fail('manifest-mismatch', `${path}.settings.${field} is required`);
  }
  try {
    validateTimeValue(config.type, settings.min, `${path}.settings.min`);
    validateTimeValue(config.type, settings.max, `${path}.settings.max`);
  } catch (cause) { fail('manifest-mismatch', cause.message); }
  const date = config.type === 'Date';
  const maxStep = date ? 2_147_483_647 : Number.MAX_SAFE_INTEGER;
  if (!Number.isInteger(settings.step) || settings.step <= 0 || settings.step > maxStep) fail('manifest-mismatch', `${path}.settings.step must be a positive ${date ? 'Int' : 'Duration'}`);
  if (settings.stepType !== (date ? 'Int' : 'Duration')) fail('manifest-mismatch', `${path}.settings.stepType must be ${date ? 'Int' : 'Duration'}`);
  if (settings.min > settings.max || config.value < settings.min || config.value > settings.max
      || (config.value - settings.min) % settings.step !== 0 || (settings.max - settings.min) % settings.step !== 0) {
    fail('manifest-mismatch', `${path} time settings range or grid is invalid`);
  }
}

function manifestCanonicalUnit(descriptor, path) {
  const hasUnit = Object.hasOwn(descriptor, 'canonicalUnit');
  if (isQuantityType(descriptor.type)) {
    const expected = canonicalUnitFor(descriptor.type);
    if (!hasUnit || descriptor.canonicalUnit !== expected) fail('manifest-mismatch', `${path}.canonicalUnit must be ${expected}`);
  } else if (hasUnit) fail('manifest-mismatch', `${path}.canonicalUnit is forbidden for non-quantity type ${descriptor.type}`);
}

function manifestDisplayUnit(config, path) {
  const hasDisplayUnit = Object.hasOwn(config, 'displayUnit');
  if (config.type === 'Temperature' && Object.hasOwn(config, 'settings')) {
    if (!hasDisplayUnit || (config.displayUnit !== '°C' && config.displayUnit !== 'K')) fail('manifest-mismatch', `${path}.displayUnit must be explicitly °C or K`);
  } else if (hasDisplayUnit) fail('manifest-mismatch', `${path}.displayUnit is forbidden without Temperature settings`);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeCapabilities(value, path, { requireSorted = false } = {}) {
  if (!Array.isArray(value) || value.length > MAX_CAPABILITIES) {
    fail('invalid-capabilities', `${path} must be an array of at most ${MAX_CAPABILITIES} capabilities`);
  }
  const normalized = value.map((capability, index) => {
    exactObject(capability, ['kind', 'name', 'type'], `${path}[${index}]`);
    const result = {
      kind: identifier(capability.kind, `${path}[${index}].kind`),
      name: identifier(capability.name, `${path}[${index}].name`),
      type: capability.type,
    };
    if (!['bool', 'number', 'int'].includes(result.type)) {
      fail('invalid-capabilities', `${path}[${index}].type must be bool, number or int`);
    }
    return result;
  });
  const keys = normalized.map(capabilityKey);
  if (new Set(keys).size !== keys.length) fail('duplicate-capability', `${path} contains a duplicate capability`);
  const sorted = [...normalized].sort((left, right) => compareText(capabilityKey(left), capabilityKey(right)));
  if (requireSorted && sorted.some((item, index) => capabilityKey(item) !== keys[index])) {
    fail('noncanonical-capabilities', `${path} must be sorted by kind, name and type`);
  }
  return sorted;
}

function normalizeIdentity(value, { requireSorted = false } = {}) {
  exactObject(value, ['compilerRevision', 'runtimeSemantics', 'runtimeAbi', 'requiredCapabilities', 'bindingRevision'], 'identity');
  return {
    compilerRevision: identifier(value.compilerRevision, 'identity.compilerRevision'),
    runtimeSemantics: identifier(value.runtimeSemantics, 'identity.runtimeSemantics'),
    runtimeAbi: identifier(value.runtimeAbi, 'identity.runtimeAbi'),
    requiredCapabilities: normalizeCapabilities(value.requiredCapabilities, 'identity.requiredCapabilities', { requireSorted }),
    bindingRevision: identifier(value.bindingRevision, 'identity.bindingRevision'),
  };
}

function validateGfb1(bytes) {
  if (bytes.byteLength < 6 || bytes[0] !== 0x47 || bytes[1] !== 0x46 || bytes[2] !== 0x42 || bytes[3] !== 0x31) {
    fail('invalid-bytecode-format', 'bytecode is not GFB1');
  }
  const version = bytes[4] | (bytes[5] << 8);
  if (![1, 2, 3, 4, 10, 11].includes(version)) fail('unsupported-bytecode-version', 'supported GFB format versions are 1, 2, 3, 4, 10 and 11');
  return String(version);
}

function validateConfigStreamPackageProfile(manifest, version, runtimeAbi) {
  const stream = version === '11';
  if (stream !== (manifest.format === 'GhostFlow/control-v10')
    || stream !== (runtimeAbi === 'GhostFlow/context-scan-abi-v5')) {
    fail('unsupported-runtime-abi', 'GFB11, control-v10 and context-scan-abi-v5 must be selected together');
  }
  if (!stream) return;
  if (!Array.isArray(manifest.configs) || !manifest.configs.length
    || ['schedules','signals','naturalConditions','providers','calendars','objectives','adaptSettings']
      .some(field => manifest[field] !== undefined && (!Array.isArray(manifest[field]) || manifest[field].length))
    || manifest.accounting !== undefined) {
    fail('unsupported-bytecode-version', 'signed GFB11 profile currently requires config-only context execution');
  }
}

function sourceMapEnvelope(compilation) {
  return {
    format: SOURCE_MAP_FORMAT,
    bytecodeSha256: compilation.manifest.bytecodeSha256,
    sourceDocument: compilation.sourceDocument,
    nodes: compilation.sourceMap,
    lines: compilation.extractionMap ?? null,
    traceMetadata: compilation.traceMetadata ?? null,
  };
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

async function checkedDigest(bytes, expected, path) {
  const actual = await sha256(bytes);
  if (expected !== undefined && actual !== digestValue(expected, path)) fail('digest-mismatch', `${path} does not match content`);
  return actual;
}

function validateSigningKey(key, type, path) {
  if (!key || key.type !== type || key.algorithm?.name !== SIGNATURE_ALGORITHM) {
    fail('invalid-signing-key', `${path} must be an Ed25519 ${type} CryptoKey`);
  }
  return key;
}

/** Build a deterministic signed package from a compileSource result and a fresh compiler replay. */
export async function buildPortablePackage(compilation, identityValue, { signers, verifyCompilation } = {}) {
  if (!isPlainObject(compilation)) fail('invalid-compilation', 'compilation must be a compileSource result');
  const document = exactObject(compilation.sourceDocument, ['format', 'kind', 'filename', 'text', 'sha256'], 'compilation.sourceDocument');
  if (document.format !== SOURCE_FORMAT || document.kind !== 'literate') {
    fail('noncanonical-source', 'portable packages require an authoritative .ghost.md literate source');
  }
  sourceFilename(document.filename, 'compilation.sourceDocument.filename');
  const sourceBytes = UTF8.encode(document.text);
  if (sourceBytes.byteLength > MAX_ARTIFACT_BYTES) fail('artifact-too-large', 'source exceeds 1 MiB');
  const sourceSha256 = await checkedDigest(sourceBytes, document.sha256, 'compilation.sourceDocument.sha256');

  const gfbBytes = bytesValue(compilation.bytes, 'compilation.bytes');
  const bytecodeVersion = validateGfb1(gfbBytes);
  const bytecodeSha256 = await checkedDigest(gfbBytes);
  if (!isPlainObject(compilation.manifest)) fail('missing-manifest', 'portable packages require a control manifest');
  if (compilation.manifest.bytecodeSha256 !== bytecodeSha256) fail('digest-mismatch', 'manifest bytecodeSha256 does not match GFB1');
  const manifestBytes = canonicalBytes(compilation.manifest, 'manifest');
  const map = sourceMapEnvelope(compilation);
  const sourceMapBytes = canonicalBytes(map, 'sourceMap');
  for (const [name, bytes] of [['manifest', manifestBytes], ['sourceMap', sourceMapBytes]]) {
    if (bytes.byteLength > MAX_ARTIFACT_BYTES) fail('artifact-too-large', `${name} exceeds 1 MiB`);
  }

  const identity = normalizeIdentity(identityValue);
  validateConfigStreamPackageProfile(compilation.manifest, bytecodeVersion, identity.runtimeAbi);
  if (typeof verifyCompilation !== 'function') {
    fail('compiler-replay-required', 'portable package signing requires a fresh compileSource replay');
  }
  let replay;
  try {
    replay = await verifyCompilation(document.text, {
      filename: document.filename,
      compilerRevision: identity.compilerRevision,
    });
  } catch (error) {
    fail('compiler-replay-failed', 'fresh compiler replay failed', error);
  }
  let replayBytes;
  let replayManifestBytes;
  let replayMapBytes;
  try {
    replayBytes = bytesValue(replay?.bytes, 'compiler replay bytes');
    replayManifestBytes = canonicalBytes(replay?.manifest, 'compiler replay manifest');
    replayMapBytes = canonicalBytes(sourceMapEnvelope(replay), 'compiler replay sourceMap');
  } catch (error) {
    if (error instanceof PortablePackageError) throw error;
    fail('compiler-replay-invalid', 'fresh compiler replay returned an invalid result', error);
  }
  if (!bytesEqual(replayBytes, gfbBytes)
      || !bytesEqual(replayManifestBytes, manifestBytes)
      || !bytesEqual(replayMapBytes, sourceMapBytes)) {
    fail('compilation-mismatch', 'source, GFB1, manifest and source map do not belong to one deterministic compilation');
  }
  const payload = {
    format: PAYLOAD_FORMAT,
    source: {
      format: SOURCE_FORMAT,
      kind: 'literate',
      filename: document.filename,
      mediaType: SOURCE_MEDIA_TYPE,
      sha256: sourceSha256,
      contentBase64: encodeBase64(sourceBytes),
    },
    bytecode: {
      format: 'GFB1',
      version: bytecodeVersion,
      sha256: bytecodeSha256,
      contentBase64: encodeBase64(gfbBytes),
    },
    manifest: {
      format: identifier(compilation.manifest.format, 'manifest.format'),
      sha256: await sha256(manifestBytes),
      contentBase64: encodeBase64(manifestBytes),
    },
    sourceMap: {
      format: SOURCE_MAP_FORMAT,
      sha256: await sha256(sourceMapBytes),
      contentBase64: encodeBase64(sourceMapBytes),
    },
    identity,
  };
  const payloadBytes = canonicalBytes(payload, 'payload');
  if (payloadBytes.byteLength > MAX_SIGNED_PAYLOAD_BYTES) fail('package-too-large', 'signed payload exceeds 4 MiB');

  if (!Array.isArray(signers) || signers.length < 1 || signers.length > MAX_SIGNATURES) {
    fail('signature-count', `signers must contain 1 to ${MAX_SIGNATURES} entries`);
  }
  const normalizedSigners = signers.map((signer, index) => {
    exactObject(signer, ['keyId', 'privateKey'], `signers[${index}]`);
    return {
      keyId: identifier(signer.keyId, `signers[${index}].keyId`),
      privateKey: validateSigningKey(signer.privateKey, 'private', `signers[${index}].privateKey`),
    };
  }).sort((left, right) => compareText(left.keyId, right.keyId));
  if (new Set(normalizedSigners.map(signer => signer.keyId)).size !== normalizedSigners.length) fail('duplicate-signature', 'signer key IDs must be unique');

  const signatures = [];
  for (const signer of normalizedSigners) {
    let signature;
    try {
      signature = new Uint8Array(await subtleCrypto().sign(SIGNATURE_ALGORITHM, signer.privateKey, payloadBytes));
    } catch (error) {
      fail('signature-failed', `failed to sign with ${signer.keyId}`, error);
    }
    signatures.push({ algorithm: SIGNATURE_ALGORITHM, keyId: signer.keyId, signatureBase64: encodeBase64(signature) });
  }
  return deepFreeze({
    format: PACKAGE_FORMAT,
    payload,
    payloadSha256: await sha256(payloadBytes),
    signatures,
  });
}

function expectedString(value, path) {
  return identifier(value, path);
}

function supportedSet(value, path) {
  if (!Array.isArray(value) || value.length < 1) fail('invalid-verifier-options', `${path} must be a non-empty array`);
  return new Set(value.map((item, index) => expectedString(item, `${path}[${index}]`)));
}

async function verifySignatures(signatures, payloadBytes, trustedKeys, revokedKeyIds) {
  if (!Array.isArray(signatures) || signatures.length < 1 || signatures.length > MAX_SIGNATURES) {
    fail('signature-count', `signatures must contain 1 to ${MAX_SIGNATURES} entries`);
  }
  if (!Array.isArray(trustedKeys) || trustedKeys.length < 1) fail('invalid-trust-store', 'trustedKeys must be a non-empty array');
  const keys = new Map();
  for (const [index, record] of trustedKeys.entries()) {
    exactObject(record, ['keyId', 'publicKey'], `trustedKeys[${index}]`);
    const keyId = identifier(record.keyId, `trustedKeys[${index}].keyId`);
    if (keys.has(keyId)) fail('invalid-trust-store', `duplicate trusted key ${keyId}`);
    keys.set(keyId, validateSigningKey(record.publicKey, 'public', `trustedKeys[${index}].publicKey`));
  }
  if (!Array.isArray(revokedKeyIds)) fail('invalid-trust-store', 'revokedKeyIds must be an array');
  const revoked = new Set(revokedKeyIds.map((keyId, index) => identifier(keyId, `revokedKeyIds[${index}]`)));
  const seen = new Set();
  const accepted = [];
  let sawRevoked = false;
  for (const [index, record] of signatures.entries()) {
    exactObject(record, ['algorithm', 'keyId', 'signatureBase64'], `signatures[${index}]`);
    if (record.algorithm !== SIGNATURE_ALGORITHM) fail('unsupported-signature-algorithm', 'only Ed25519 signatures are supported');
    const keyId = identifier(record.keyId, `signatures[${index}].keyId`);
    if (seen.has(keyId)) fail('duplicate-signature', `duplicate signature for ${keyId}`);
    seen.add(keyId);
    const signature = decodeBase64(record.signatureBase64, `signatures[${index}].signatureBase64`, 256);
    if (revoked.has(keyId)) {
      sawRevoked = true;
      continue;
    }
    const publicKey = keys.get(keyId);
    if (!publicKey) continue;
    let valid;
    try {
      valid = await subtleCrypto().verify(SIGNATURE_ALGORITHM, publicKey, signature, payloadBytes);
    } catch (error) {
      fail('signature-verification-failed', `signature verification failed for ${keyId}`, error);
    }
    if (valid) accepted.push(keyId);
  }
  if (accepted.length === 0) {
    if (sawRevoked) fail('signing-key-revoked', 'no active trusted signature remains after revocation');
    fail('untrusted-signature', 'no active trusted signature verifies the payload');
  }
  return accepted.sort();
}

function validateEmbeddedArtifacts(payload) {
  exactObject(payload.source, ['format', 'kind', 'filename', 'mediaType', 'sha256', 'contentBase64'], 'payload.source');
  if (payload.source.format !== SOURCE_FORMAT || payload.source.kind !== 'literate' || payload.source.mediaType !== SOURCE_MEDIA_TYPE) {
    fail('noncanonical-source', 'payload source must be GhostFlow literate Markdown');
  }
  sourceFilename(payload.source.filename, 'payload.source.filename');
  digestValue(payload.source.sha256, 'payload.source.sha256');

  exactObject(payload.bytecode, ['format', 'version', 'sha256', 'contentBase64'], 'payload.bytecode');
  if (payload.bytecode.format !== 'GFB1') fail('invalid-bytecode-format', 'payload bytecode format must be GFB1');
  if (!['1', '2', '3', '4', '10', '11'].includes(payload.bytecode.version)) fail('unsupported-bytecode-version', 'payload bytecode version must be 1, 2, 3, 4, 10 or 11');
  digestValue(payload.bytecode.sha256, 'payload.bytecode.sha256');

  exactObject(payload.manifest, ['format', 'sha256', 'contentBase64'], 'payload.manifest');
  identifier(payload.manifest.format, 'payload.manifest.format');
  digestValue(payload.manifest.sha256, 'payload.manifest.sha256');
  exactObject(payload.sourceMap, ['format', 'sha256', 'contentBase64'], 'payload.sourceMap');
  if (payload.sourceMap.format !== SOURCE_MAP_FORMAT) fail('unsupported-source-map-format', `payload source map must be ${SOURCE_MAP_FORMAT}`);
  digestValue(payload.sourceMap.sha256, 'payload.sourceMap.sha256');

  return {
    sourceBytes: decodeBase64(payload.source.contentBase64, 'payload.source.contentBase64'),
    bytecode: decodeBase64(payload.bytecode.contentBase64, 'payload.bytecode.contentBase64'),
    manifestBytes: decodeBase64(payload.manifest.contentBase64, 'payload.manifest.contentBase64'),
    sourceMapBytes: decodeBase64(payload.sourceMap.contentBase64, 'payload.sourceMap.contentBase64'),
  };
}

/** Verify package trust and host compatibility before exposing its exact GFB1 bytes. */
export async function verifyPortablePackage(packageValue, options = {}) {
  exactObject(packageValue, ['format', 'payload', 'payloadSha256', 'signatures'], 'package');
  if (packageValue.format !== PACKAGE_FORMAT) fail('unsupported-package-format', `package.format must be ${PACKAGE_FORMAT}`);
  digestValue(packageValue.payloadSha256, 'package.payloadSha256');
  exactObject(packageValue.payload, ['format', 'source', 'bytecode', 'manifest', 'sourceMap', 'identity'], 'payload');
  if (packageValue.payload.format !== PAYLOAD_FORMAT) fail('unsupported-payload-format', `payload.format must be ${PAYLOAD_FORMAT}`);
  const identity = normalizeIdentity(packageValue.payload.identity, { requireSorted: true });
  const payloadBytes = canonicalBytes(packageValue.payload, 'payload');
  if (payloadBytes.byteLength > MAX_SIGNED_PAYLOAD_BYTES) fail('package-too-large', 'signed payload exceeds 4 MiB');
  await checkedDigest(payloadBytes, packageValue.payloadSha256, 'package.payloadSha256');

  const acceptedKeyIds = await verifySignatures(
    packageValue.signatures,
    payloadBytes,
    options.trustedKeys,
    options.revokedKeyIds,
  );
  if (identity.compilerRevision !== expectedString(options.expectedCompilerRevision, 'expectedCompilerRevision')) {
    fail('compiler-revision-mismatch', 'package compiler revision does not match the selected compiler release');
  }
  if (!supportedSet(options.supportedRuntimeSemantics, 'supportedRuntimeSemantics').has(identity.runtimeSemantics)) {
    fail('unsupported-runtime-semantics', `unsupported runtime semantics ${identity.runtimeSemantics}`);
  }
  if (!supportedSet(options.supportedRuntimeAbis, 'supportedRuntimeAbis').has(identity.runtimeAbi)) {
    fail('unsupported-runtime-abi', `unsupported runtime ABI ${identity.runtimeAbi}`);
  }
  if (identity.bindingRevision !== expectedString(options.expectedBindingRevision, 'expectedBindingRevision')) {
    fail('binding-revision-mismatch', 'package binding revision does not match the selected installation binding');
  }
  const supportedManifestFormats = supportedSet(options.supportedManifestFormats, 'supportedManifestFormats');
  if (!supportedManifestFormats.has(packageValue.payload.manifest.format)) {
    fail('unsupported-manifest-format', `unsupported manifest format ${packageValue.payload.manifest.format}`);
  }
  const availableCapabilities = normalizeCapabilities(options.availableCapabilities, 'availableCapabilities');
  const available = new Set(availableCapabilities.map(capabilityKey));
  const missing = identity.requiredCapabilities.filter(capability => !available.has(capabilityKey(capability)));
  if (missing.length > 0) fail('missing-capability', `missing required capability ${capabilityKey(missing[0]).replaceAll('\u0000', ':')}`);

  const artifacts = validateEmbeddedArtifacts(packageValue.payload);
  const [sourceSha256, bytecodeSha256, manifestSha256, sourceMapSha256] = await Promise.all([
    sha256(artifacts.sourceBytes), sha256(artifacts.bytecode), sha256(artifacts.manifestBytes), sha256(artifacts.sourceMapBytes),
  ]);
  if (sourceSha256 !== packageValue.payload.source.sha256) fail('source-digest-mismatch', 'source SHA-256 does not match content');
  if (bytecodeSha256 !== packageValue.payload.bytecode.sha256) fail('bytecode-digest-mismatch', 'GFB1 SHA-256 does not match content');
  if (manifestSha256 !== packageValue.payload.manifest.sha256) fail('manifest-digest-mismatch', 'manifest SHA-256 does not match content');
  if (sourceMapSha256 !== packageValue.payload.sourceMap.sha256) fail('source-map-digest-mismatch', 'source map SHA-256 does not match content');
  if (validateGfb1(artifacts.bytecode) !== packageValue.payload.bytecode.version) {
    fail('bytecode-version-mismatch', 'payload bytecode version does not match its GFB header');
  }

  const sourceText = decodeUtf8(artifacts.sourceBytes, 'source');
  const manifest = parseCanonicalJson(artifacts.manifestBytes, 'manifest');
  const sourceMap = parseCanonicalJson(artifacts.sourceMapBytes, 'sourceMap');
  const contextManifest = packageValue.payload.bytecode.version === '10';
  const manifestKeys = ['format', 'name', 'inputs', 'outputs', 'sensors', 'schedules', 'timers', 'signals', 'configs', 'bytecodeSha256'];
  if (contextManifest) {
    for (const key of ['providers', 'calendars', 'naturalConditions', 'accounting', 'resources']) {
      if (Object.hasOwn(manifest, key)) manifestKeys.push(key);
    }
  }
  exactObject(manifest, manifestKeys, 'manifest');
  if (manifest.format !== packageValue.payload.manifest.format) fail('manifest-mismatch', 'manifest format does not match descriptor');
  if (packageValue.payload.bytecode.version === '4' && manifest.format !== 'GhostFlow/control-v4') fail('manifest-mismatch', 'GFB format 4 requires a control-v4 manifest');
  if (contextManifest && manifest.format !== 'GhostFlow/control-v9') fail('manifest-mismatch', 'GFB format 10 requires a control-v9 manifest');
  if (packageValue.payload.bytecode.version === '11' && manifest.format !== 'GhostFlow/control-v10') fail('manifest-mismatch', 'GFB format 11 requires a control-v10 manifest');
  validateConfigStreamPackageProfile(manifest, packageValue.payload.bytecode.version, identity.runtimeAbi);
  ghostName(manifest.name, 'manifest.name');
  if (manifest.bytecodeSha256 !== bytecodeSha256) fail('manifest-mismatch', 'manifest bytecodeSha256 does not match GFB1');
  for (const field of ['inputs', 'outputs', 'sensors', 'schedules', 'timers', 'signals', 'configs']) {
    if (!Array.isArray(manifest[field])) fail('manifest-mismatch', `manifest.${field} must be an array`);
  }
  const manifestPorts = new Map();
  for (const field of ['inputs', 'outputs']) {
    for (const [index, port] of manifest[field].entries()) {
      const portPath = `manifest.${field}[${index}]`;
      if (!isPlainObject(port)) fail('manifest-mismatch', `${portPath} must be an object`);
      exactObject(port, isQuantityType(port.type) ? ['name', 'type', 'canonicalUnit'] : ['name', 'type'], portPath);
      const name = ghostName(port.name, `manifest.${field}[${index}].name`);
      manifestCapabilityType(port.type, `manifest.${field}[${index}].type`);
      manifestCanonicalUnit(port, portPath);
      const key = `${field}\u0000${name}`;
      if (manifestPorts.has(key)) fail('manifest-mismatch', `duplicate manifest ${field} ${name}`);
      manifestPorts.set(key, port.type);
    }
  }
  const expectedCapabilities = new Set([
    ...manifest.inputs.map((input, index) => capabilityKey({
      kind: 'input',
      name: input.name,
      type: manifestCapabilityType(input.type, `manifest.inputs[${index}].type`),
    })),
    ...manifest.outputs.map((output, index) => capabilityKey({
      kind: 'actuator',
      name: output.name,
      type: manifestCapabilityType(output.type, `manifest.outputs[${index}].type`),
    })),
  ]);
  const generatedNames = new Set(manifest.inputs.map(input => input.name));
  const addGenerated = (value, expected, path, { shared = false } = {}) => {
    if (typeof value !== 'string' || value !== expected) fail('manifest-mismatch', `${path} must be ${expected}`);
    if (!shared && generatedNames.has(value)) fail('manifest-mismatch', `${path} collides with another input binding`);
    generatedNames.add(value);
  };
  for (const [index, sensor] of manifest.sensors.entries()) {
    if (!isPlainObject(sensor)) fail('manifest-mismatch', `manifest.sensors[${index}] must be an object`);
    const name = ghostName(sensor.name, `manifest.sensors[${index}].name`);
    const type = manifestCapabilityType(sensor.type, `manifest.sensors[${index}].type`);
    manifestCanonicalUnit(sensor, `manifest.sensors[${index}]`);
    addGenerated(sensor.valueInput, `__gf_sensor_value_${name}`, `manifest.sensors[${index}].valueInput`);
    addGenerated(sensor.okInput, `__gf_sensor_ok_${name}`, `manifest.sensors[${index}].okInput`);
    addGenerated(sensor.faultInput, `__gf_sensor_fault_${name}`, `manifest.sensors[${index}].faultInput`);
    const sampleFields = ['samplePresentInput', 'sampleEpochInput', 'sampleIdInput', 'sampleTimestampInput'];
    if (sampleFields.some(field => Object.hasOwn(sensor, field))) {
      for (const [position, suffix] of ['present', 'epoch', 'id', 'timestamp'].entries()) {
        const field = sampleFields[position];
        addGenerated(sensor[field], `__gf_sensor_sample_${suffix}_${name}`, `manifest.sensors[${index}].${field}`);
      }
    }
    if (sensor.optional !== true) expectedCapabilities.add(capabilityKey({ kind: 'sensor', name, type }));
  }
  for (const [index, signal] of manifest.signals.entries()) {
    if (!isPlainObject(signal)) fail('manifest-mismatch', `manifest.signals[${index}] must be an object`);
    const name = ghostName(signal.name, `manifest.signals[${index}].name`);
    if (signal.kind === 'debounce' || signal.kind === 'hold-last' || signal.kind === 'window') {
      addGenerated(signal.clockInput, '__gf_now_ms', `manifest.signals[${index}].clockInput`, { shared: true });
      if (signal.kind === 'window') addGenerated(signal.timeEpochInput, '__gf_time_epoch', `manifest.signals[${index}].timeEpochInput`, { shared: true });
      continue;
    }
    addGenerated(signal.valueInput, `__gf_signal_value_${name}`, `manifest.signals[${index}].valueInput`);
    addGenerated(signal.okInput, `__gf_signal_ok_${name}`, `manifest.signals[${index}].okInput`);
    addGenerated(signal.faultInput, `__gf_signal_fault_${name}`, `manifest.signals[${index}].faultInput`);
  }
  for (const [index, schedule] of manifest.schedules.entries()) {
    if (!isPlainObject(schedule)) fail('manifest-mismatch', `manifest.schedules[${index}] must be an object`);
    const name = ghostName(schedule.name, `manifest.schedules[${index}].name`);
    if (!contextManifest) addGenerated(schedule.dueInput, `__gf_schedule_due_${name}`, `manifest.schedules[${index}].dueInput`);
  }
  for (const [index, timer] of manifest.timers.entries()) {
    if (!isPlainObject(timer)) fail('manifest-mismatch', `manifest.timers[${index}] must be an object`);
    addGenerated(timer.clockInput, '__gf_now_ms', `manifest.timers[${index}].clockInput`, { shared: true });
  }
  for (const [index, config] of manifest.configs.entries()) {
    if (!isPlainObject(config)) fail('manifest-mismatch', `manifest.configs[${index}] must be an object`);
    manifestCapabilityType(config.type, `manifest.configs[${index}].type`);
    manifestCanonicalUnit(config, `manifest.configs[${index}]`);
    manifestDisplayUnit(config, `manifest.configs[${index}]`);
    const stream = packageValue.payload.bytecode.version === '11';
    if (stream && (!Number.isInteger(config.id) || config.id <= 0 || config.id > 0xffff_ffff)) fail('manifest-mismatch', `manifest.configs[${index}].id must be a positive u32`);
    manifestIntConfig(config, `manifest.configs[${index}]`, stream);
    manifestTimeConfig(config, `manifest.configs[${index}]`, stream);
  }
  if (packageValue.payload.bytecode.version === '11'
      && new Set(manifest.configs.map(config => config.id)).size !== manifest.configs.length) {
    fail('manifest-mismatch', 'GFB11 config IDs must be unique');
  }

  exactObject(sourceMap, ['format', 'bytecodeSha256', 'sourceDocument', 'nodes', 'lines', 'traceMetadata'], 'sourceMap');
  if (sourceMap.format !== SOURCE_MAP_FORMAT || sourceMap.bytecodeSha256 !== bytecodeSha256) {
    fail('source-map-mismatch', 'source map format or GFB1 digest does not match package');
  }
  const mappedDocument = sourceMap.sourceDocument;
  exactObject(mappedDocument, ['format', 'kind', 'filename', 'text', 'sha256'], 'sourceMap.sourceDocument');
  if (mappedDocument.format !== SOURCE_FORMAT
    || mappedDocument.kind !== 'literate'
    || mappedDocument.filename !== packageValue.payload.source.filename
    || mappedDocument.sha256 !== sourceSha256
    || mappedDocument.text !== sourceText) {
    fail('source-map-mismatch', 'source map document does not match the authoritative literate source');
  }
  if (!Array.isArray(sourceMap.nodes) || (sourceMap.lines !== null && !Array.isArray(sourceMap.lines))) {
    fail('source-map-mismatch', 'source map nodes/lines have an unsupported shape');
  }
  if (contextManifest) {
    // The current compiler emits GFB11 for context source. A signed GFB10
    // artifact cannot be reproduced by recompiling it with that compiler.
    // Keep its source map bound to the signed source and bytecode, then require
    // the target's native GFB10 loader below to accept the exact bytes.
    try {
      const extraction = extractLiterate(sourceText, { filename: mappedDocument.filename });
      if (canonicalJson(sourceMap.lines) !== canonicalJson(extraction.sourceMap)) {
        throw new Error('GFB10 extraction map does not match canonical source');
      }
      if (sourceMap.traceMetadata !== null) {
        verifySourceTraceMetadata(sourceMap.traceMetadata, artifacts.bytecode, sourceMap.nodes, {
          sourceDocumentSha256: sourceSha256, bytecodeSha256,
          requireRevisionIdentity: true, sourceDocument: mappedDocument,
          extractionMap: sourceMap.lines, timerDescriptors: manifest.timers,
        });
      }
    } catch (error) {
      fail('source-map-mismatch', 'GFB10 source map does not match signed artifacts', error);
    }
  } else try {
    const extraction = extractLiterate(sourceText, { filename: mappedDocument.filename });
    const replay = compileControl(extraction.code, { filename: mappedDocument.filename });
    if (!equalBytes(replay.bytes, artifacts.bytecode)) throw new Error('canonical source does not reproduce package bytecode');
    if (packageValue.payload.bytecode.version === '11'
        && canonicalJson(manifest.configs) !== canonicalJson(replay.manifest.configs)) {
      throw new Error('config streams do not match canonical source lowering');
    }
    const intConfigs = entries => entries.filter(entry => entry.type === 'Int');
    if (canonicalJson(intConfigs(manifest.configs)) !== canonicalJson(intConfigs(replay.manifest.configs))) {
      throw new Error('Int configs do not match canonical source lowering');
    }
    for (const kind of ['debounce', 'hold-last', 'window']) {
      const descriptors = entries => entries.filter(entry => entry.kind === kind);
      if (canonicalJson(descriptors(manifest.signals)) !== canonicalJson(descriptors(replay.manifest.signals))) {
        throw new Error(`${kind} descriptors do not match canonical source lowering`);
      }
    }
    const windowSources = new Set(replay.manifest.signals
      .filter(signal => signal.kind === 'window')
      .flatMap(signal => signal.sources.map(source => source.name)));
    if (windowSources.size) {
      const sensors = entries => entries.filter(sensor => windowSources.has(sensor.name));
      if (canonicalJson(sensors(manifest.sensors)) !== canonicalJson(sensors(replay.manifest.sensors))) {
        throw new Error('window source sensors do not match canonical source lowering');
      }
    }
    const sampleBindings = entries => entries.map(entry => ({
      name: entry.name,
      ...Object.fromEntries(['samplePresentInput', 'sampleEpochInput', 'sampleIdInput', 'sampleTimestampInput']
        .filter(field => Object.hasOwn(entry, field)).map(field => [field, entry[field]])),
    })).filter(entry => Object.keys(entry).length > 1);
    if (canonicalJson(sampleBindings(manifest.sensors)) !== canonicalJson(sampleBindings(replay.manifest.sensors))) {
      throw new Error('debounce sample bindings do not match canonical source lowering');
    }
    if (sourceMap.traceMetadata === null) {
      if (sourceMapRequiresTraceMetadata(replay.sourceMap) || replay.traceMetadata.resultSites.length) throw new Error('trace metadata is required for this source map');
    } else {
      const continuousTimerNames = new Set(manifest.timers
        .filter(timer => timer?.mode === 'continuous-true')
        .map(timer => timer.name));
      let expectedTimerDependencies;
      let expectedResultSites;
      let expectedSignalBindings;
      let expectedSignalDependencies;
      let expectedWindowSites;
      let expectedWindowDependencies;
      let expectedDerivations;
      let expectedConstraintProof;
      {
        if (continuousTimerNames.size) expectedTimerDependencies = replay.traceMetadata.dependencies.filter(entry => (
          entry.target.field === 'timerValue' && continuousTimerNames.has(entry.target.name)
        ));
        const mappedTrace = remapSourceTrace(replay.traceMetadata, extraction.sourceMap);
        expectedDerivations = mappedTrace.derivations ?? [];
        expectedConstraintProof = mappedTrace.constraintProof ?? null;
        expectedResultSites = mappedTrace.resultSites;
        expectedSignalBindings = mappedTrace.bindings.filter(entry => entry.kind === 'signal');
        const signalStates = new Set(expectedSignalBindings.map(entry => entry.name));
        expectedSignalDependencies = mappedTrace.dependencies.filter(entry => entry.target.field === 'stateAfter' && signalStates.has(entry.target.name));
        expectedWindowSites = mappedTrace.windowSites;
        expectedWindowDependencies = mappedTrace.dependencies.filter(entry => entry.target.field === 'windowTrace'
          || entry.reads.some(read => read.field === 'windowTrace'));
      }
      verifySourceTraceMetadata(sourceMap.traceMetadata, artifacts.bytecode, sourceMap.nodes, {
        sourceDocumentSha256: sourceSha256,
        bytecodeSha256,
        requireRevisionIdentity: true,
        sourceDocument: mappedDocument,
        extractionMap: sourceMap.lines,
        timerDescriptors: manifest.timers,
        expectedTimerDependencies,
        expectedResultSites,
        expectedSignalBindings,
        expectedSignalDependencies,
        expectedWindowSites,
        expectedWindowDependencies,
        expectedDerivations,
        expectedConstraintProof,
      });
    }
  } catch (error) {
    fail('source-map-mismatch', 'source map trace metadata does not match source and GFB1', error);
  }
  const requiredCapabilities = new Set(identity.requiredCapabilities.map(capabilityKey));
  if (requiredCapabilities.size !== expectedCapabilities.size
      || [...expectedCapabilities].some(key => !requiredCapabilities.has(key))) {
    fail('capability-manifest-mismatch', 'manifest inputs, required sensors, outputs and signed capabilities must match exactly');
  }

  if (typeof options.verifyBytecode !== 'function') fail('bytecode-verifier-required', 'a native or WASM GFB1 verifier is required');
  deepFreeze(manifest);
  deepFreeze(sourceMap);
  deepFreeze(identity);
  try {
    const accepted = await options.verifyBytecode(new Uint8Array(artifacts.bytecode), { manifest, sourceMap, identity });
    if (accepted !== true) fail('bytecode-rejected', 'target GFB1 verifier must explicitly accept the package bytecode');
  } catch (error) {
    if (error instanceof PortablePackageError) throw error;
    fail('bytecode-rejected', 'target GFB1 verifier rejected the package bytecode', error);
  }

  return deepFreeze({
    packageFormat: PACKAGE_FORMAT,
    payloadSha256: packageValue.payloadSha256,
    acceptedKeyIds,
    source: { filename: packageValue.payload.source.filename, text: sourceText, sha256: sourceSha256 },
    bytecode: {
      sha256: bytecodeSha256,
      byteLength: artifacts.bytecode.byteLength,
      copy: () => new Uint8Array(artifacts.bytecode),
    },
    manifest,
    sourceMap,
    identity,
  });
}

/** Canonical transport text. Signature bytes are excluded from payloadSha256 by design. */
export function serializePortablePackage(packageValue) {
  return `${canonicalJson(packageValue, { rejectSparseArrays: true, rejectUnsafeIntegers: true })}\n`;
}

export const portablePackageConstants = Object.freeze({
  packageFormat: PACKAGE_FORMAT,
  payloadFormat: PAYLOAD_FORMAT,
  signatureAlgorithm: SIGNATURE_ALGORITHM,
});
