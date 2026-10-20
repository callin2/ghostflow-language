import { canonicalJson } from './canonical-json.mjs';
import { sha256Hex } from './sha256.mjs';

const FORMAT = 'GhostFlow/legacy-scalar-admission-v1';
const POLICY = 'required-current-bool-snapshot';
const PREFIX = '__gf_legacy_admission_v1_';
const SHA = /^[0-9a-f]{64}$/;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const trustedContracts = new WeakSet();

export class LegacyAdmissionError extends Error {
  constructor(code, message) {
    super(message); this.name = 'LegacyAdmissionError'; this.code = code;
    this.status = 422; this.diagnosticCode = 'GF_SEMANTIC';
  }
}
export function fail(message, code = 'legacy_admission_invalid') { throw new LegacyAdmissionError(code, message); }
function exact(value, fields) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) fail('Invalid legacy admission record');
}
export function frozen(value) { for (const child of Object.values(value)) if (child && typeof child === 'object') frozen(child); return Object.freeze(value); }
export function check(record, compiled = false) {
  if (compiled && trustedContracts.has(record)) return record;
  exact(record, ['format','contractVersion','policy','originalSourceSha256','inputs', ...(compiled ? ['sourceSha256','sha256'] : [])]);
  if (record.format !== FORMAT || record.contractVersion !== 1 || record.policy !== POLICY
    || !SHA.test(record.originalSourceSha256) || (compiled && (!SHA.test(record.sourceSha256) || !SHA.test(record.sha256)))) fail('Unsupported legacy admission contract');
  if (!Array.isArray(record.inputs) || !record.inputs.length || record.inputs.length > 128) fail('Invalid legacy admission inputs');
  const names = new Set();
  for (const input of record.inputs) {
    exact(input, ['name','type']);
    if (input.type !== 'Bool' || typeof input.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.name)
      || input.name.startsWith('__gf_') || ['restart_reason','restart_event'].includes(input.name) || names.has(input.name)) fail('Invalid legacy admission input');
    names.add(input.name);
  }
  if (compiled) { const { sha256, ...body } = record; if (sha256Hex(canonicalJson(body)) !== sha256) fail('Legacy admission digest mismatch'); }
  const result = frozen(JSON.parse(canonicalJson(record)));
  if (compiled) trustedContracts.add(result);
  return result;
}

export function bound(record, source) {
  const body = { ...record, sourceSha256: sha256Hex(source) };
  return check({ ...body, sha256: sha256Hex(canonicalJson(body)) }, true);
}

// GFB state headers share this prefix across executable versions 1..21. No VM format changes.
function header(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) fail('Invalid legacy admission bytecode');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let pos = 0;
  const need = n => { if (pos + n > bytes.length) fail('Truncated legacy admission bytecode'); };
  const u8 = () => { need(1); return bytes[pos++]; };
  const u16 = () => { need(2); const n = view.getUint16(pos, true); pos += 2; return n; };
  const str = () => { const n = u16(); need(n); let value; try { value = dec.decode(bytes.subarray(pos, pos + n)); } catch { fail('Invalid bytecode text'); } pos += n; return value; };
  need(6); if (dec.decode(bytes.subarray(0,4)) !== 'GFB1') fail('Legacy admission requires GFB bytecode'); pos = 4;
  const version = u16(); if (version < 1 || version > 21 || version === 17) fail('Unsupported legacy admission bytecode');
  str(); need(4); pos += 4;
  const inputs = []; for (let n = u16(); n > 0; n--) inputs.push({ name: str(), type: u8() });
  const countOffset = pos, stateCount = u16(), states = [];
  if (stateCount > 128) fail('Invalid bytecode state count');
  for (let n = stateCount; n > 0; n--) {
    const name = str(), type = u8(), size = type === 1 ? 1 : type === 2 ? 8 : type === 3 ? 4 : 0;
    if (!size) fail('Invalid bytecode state type'); need(size); const value = bytes.slice(pos,pos+size); pos += size; states.push({ name, type, value });
  }
  return { inputs, states, countOffset, end: pos };
}

export function attachLegacyAdmission(result, source, embedded, ast) {
  const contract = bound(embedded, source), bytes = Uint8Array.from(result.bytes), parsed = header(bytes);
  if (parsed.states.length >= 128 || parsed.states.some(state => state.name.startsWith(PREFIX))) fail('Legacy admission marker capacity exceeded');
  const name = enc.encode(PREFIX + contract.sha256), marker = new Uint8Array(2 + name.length + 2);
  new DataView(marker.buffer).setUint16(0,name.length,true); marker.set(name,2); marker[2+name.length]=1;
  const joined = new Uint8Array(bytes.length + marker.length);
  joined.set(bytes.subarray(0,parsed.end)); joined.set(marker,parsed.end); joined.set(bytes.subarray(parsed.end),parsed.end+marker.length);
  new DataView(joined.buffer).setUint16(parsed.countOffset,parsed.states.length+1,true);
  return { ...result, bytes: joined, manifest: { ...result.manifest, legacyAdmission: contract } };
}

export function validateLegacyAdmission({ bytes, manifest, sourceDocument } = {}) {
  if (!manifest || !Array.isArray(manifest.inputs)) fail('Invalid manifest for legacy admission');
  const hasContract = Object.hasOwn(manifest,'legacyAdmission');
  const raw = manifest.inputs.filter(input => typeof input?.name === 'string' && !input.name.startsWith('__gf_') && !['restart_reason','restart_event'].includes(input.name));
  let parsed = hasContract ? header(bytes) : null;
  // Even metadata-stripped marker artifacts must fail closed.
  let markers = parsed?.states.filter(state => state.name.startsWith(PREFIX)) ?? [];
  if (!parsed && bytes instanceof Uint8Array && bytes.length >= 6) {
    try {
      const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      const base = view.getUint16(4,true) === 22 ? bytes.subarray(10,10+view.getUint32(6,true)) : bytes;
      parsed = header(base); markers = parsed.states.filter(state => state.name.startsWith(PREFIX));
    } catch { /* normal format validation owns unrelated profiles */ }
  }
  if (!hasContract) {
    if (markers.length) fail('Legacy admission marker requires bound metadata');
    return null;
  }
  const contract = check(manifest.legacyAdmission, true);
  if (sha256Hex(bytes) !== manifest.bytecodeSha256 || markers.length !== 1
    || markers[0].name !== PREFIX + contract.sha256 || markers[0].type !== 1 || markers[0].value[0] !== 0
    || parsed.states.at(-1) !== markers[0] || canonicalJson(raw) !== canonicalJson(contract.inputs)) fail('Legacy admission artifact binding mismatch');
  for (const input of contract.inputs) if (parsed.inputs.filter(port => port.name === input.name && port.type === 1).length !== 1) fail('Legacy admission bytecode input mismatch');
  if (sourceDocument !== undefined) {
    const source = typeof sourceDocument === 'string' ? sourceDocument : sourceDocument?.text;
    if (typeof source !== 'string' || sha256Hex(source) !== contract.sourceSha256) fail('Legacy admission source binding mismatch');
  }
  return contract;
}

/** Pure normalization. Call before clocks, producer commits, conditioners or VM entry. */
export function preflightLegacyAdmission(contract, frame) {
  if (!contract) return frame;
  contract = check(contract,true);
  const rejected = () => fail('Legacy input frame was rejected before execution', 'legacy_admission_frame_rejected');
  if (!frame || typeof frame !== 'object') rejected();
  const captured = { ...frame }, nowMs = captured.nowMs;
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) rejected();
  const inputs = captured.inputs ?? {}, samples = captured.samples ?? {};
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) || !samples || typeof samples !== 'object' || Array.isArray(samples)) rejected();
  const normalized = { ...inputs }, remaining = { ...samples };
  for (const input of contract.inputs) {
    const raw = Object.hasOwn(normalized,input.name), sampled = Object.hasOwn(remaining,input.name);
    if (raw === sampled) rejected();
    if (raw) { if (typeof normalized[input.name] !== 'boolean') rejected(); continue; }
    const originalSample = remaining[input.name];
    if (!originalSample || typeof originalSample !== 'object' || Array.isArray(originalSample)) rejected();
    const sample = { ...originalSample };
    if (!sample || typeof sample !== 'object' || Array.isArray(sample)
      || Object.keys(sample).sort().join(',') !== 'epoch,id,quality,timestampMs,value'
      || ![sample.epoch,sample.id,sample.timestampMs].every(value => Number.isSafeInteger(value) && value >= 0)
      || sample.timestampMs > nowMs || !['Good',1].includes(sample.quality) || typeof sample.value !== 'boolean') rejected();
    normalized[input.name] = sample.value; delete remaining[input.name];
  }
  return { ...captured, inputs: normalized, samples: remaining };
}
