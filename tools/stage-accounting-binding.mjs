import { moduleFingerprint } from './source-trace.mjs';
import { isWellFormedUnicode } from './sha256.mjs';
import { compileSourceSync } from './compile-source.mjs';
import { canonicalJson } from './canonical-json.mjs';

const encoder = new TextEncoder();
const stages = ['requested', 'safe', 'applied', 'confirmed'];

/** Installation mapping is explicit; declared resource and output names may differ. */
export function compileStageAccountingBinding(artifact, { runId, bindings, maxSegments = 256 } = {}) {
  const document = artifact.sourceDocument;
  if (!document || typeof document.text !== 'string') throw new Error('stage accounting requires canonical source');
  const canonical = compileSourceSync(document.text, { filename: document.filename });
  if (canonical.sourceDocument.sha256 !== document.sha256 || canonicalJson(canonical.manifest) !== canonicalJson(artifact.manifest)
    || canonical.bytes.length !== artifact.bytes.length || canonical.bytes.some((byte, index) => byte !== artifact.bytes[index])) {
    throw new Error('stage accounting artifact does not match canonical source');
  }
  const accounts = artifact.manifest.accounting?.bindings;
  if (!Array.isArray(accounts) || !accounts.length || accounts.length > 32
    || accounts.some(account => account.operation !== 'on_time' || account.persistence !== 'durable')
    || artifact.manifest.accounting.constraints.length) throw new Error('stage accounting requires bounded durable on_time observation accounts');
  if (!Number.isInteger(maxSegments) || maxSegments < 1 || maxSegments > 4096) throw new RangeError('maxSegments must be 1..4096');
  if (!Array.isArray(bindings) || !bindings.length || bindings.length > 32) throw new TypeError('explicit resource/output bindings are required');
  const mapping = new Map();
  for (const binding of bindings) {
    if (!binding || Object.keys(binding).sort().join(',') !== 'output,resource'
      || !artifact.manifest.resources?.some(resource => resource.name === binding.resource && resource.type === 'BoolActuator')
      || !artifact.manifest.outputs.some(output => output.name === binding.output && output.type === 'Bool')
      || mapping.has(binding.resource)) throw new Error('invalid or duplicate resource/output accounting binding');
    mapping.set(binding.resource, binding.output);
  }
  const targets = new Set(accounts.map(account => account.evidenceBinding.target));
  if (targets.size !== mapping.size || [...targets].some(target => !mapping.has(target))) throw new Error('accounting binding must cover exactly the declared account resources');
  const parts = [encoder.encode('GSA1')];
  const integer = (value, width) => { const bytes = new Uint8Array(width); const view = new DataView(bytes.buffer);
    if (width === 8) view.setBigUint64(0, value, true); else if (width === 2) view.setUint16(0, value, true); else view.setUint8(0, value); parts.push(bytes); };
  const text = value => {
    if (!isWellFormedUnicode(value)) throw new TypeError('accounting identity must be well-formed text');
    const bytes = encoder.encode(value);
    if (!bytes.length || bytes.length > 128) throw new RangeError('accounting identity must contain 1..128 UTF-8 bytes');
    integer(bytes.length, 2); parts.push(bytes);
  };
  integer(BigInt(`0x${moduleFingerprint(artifact.bytes)}`), 8);
  if (!/^[0-9a-f]{64}$/.test(artifact.sourceDocument?.sha256)) throw new Error('accounting requires canonical source identity');
  parts.push(Uint8Array.from(artifact.sourceDocument.sha256.match(/../g), value => parseInt(value, 16)));
  integer(maxSegments, 2); integer(accounts.length, 1);
  for (const account of accounts) {
    const evidence = account.evidenceBinding, stage = stages.indexOf(evidence.stage);
    if (stage < 0) throw new Error('unknown accounting stage');
    text(account.name); text(evidence.target); text(mapping.get(evidence.target)); integer(stage, 1);
  }
  text(runId);
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
