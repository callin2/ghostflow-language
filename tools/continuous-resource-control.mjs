import { compileSourceSync } from './compile-source.mjs';
import { compileContinuousControlPolicyArtifact } from './control.mjs';
import { extractLiterate } from './literate.mjs';
import { sha256Hex } from './sha256.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { moduleFingerprint, remapSourceTrace } from './source-trace.mjs';
import { emitInteractionSchema } from './interaction-schema.mjs';

const fail = message => { throw new Error(`continuous resource binding: ${message}`); };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) fail('missing or unsupported fields');
}
function identity(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:/-]{1,128}$/.test(value)) fail('invalid identity');
}
class Writer {
  parts = [];
  bytes(value) { this.parts.push(Uint8Array.from(value)); }
  u8(value) { this.bytes([value]); }
  number(value, size) {
    const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
    if (size === 2) view.setUint16(0, value, true);
    else if (size === 4) view.setUint32(0, value, true);
    else view.setFloat64(0, value, true);
    this.bytes(bytes);
  }
  u16(value) { this.number(value, 2); }
  u32(value) { this.number(value, 4); }
  text(value) { const bytes = new TextEncoder().encode(value); if (!bytes.length || bytes.length > 128) fail('identity byte limit'); this.u16(bytes.length); this.bytes(bytes); }
  blob(bytes) { this.u32(bytes.length); this.bytes(bytes); }
  finish() { const bytes = new Uint8Array(this.parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of this.parts) { bytes.set(part, at); at += part.length; } return bytes; }
}

export function compileContinuousResourceControl(compilation, installation) {
  const source = compilation?.sourceDocument;
  if (!source || source.sha256 !== sha256Hex(source.text)) fail('canonical source identity mismatch');
  const descriptor = compileSourceSync(source.text, { filename: source.filename,
    ...(compilation.interactionSourceIdentity ? { interactionSourceIdentity: compilation.interactionSourceIdentity } : {}) });
  if (compilation.manifest?.format !== 'GhostFlow/control-policy-descriptor-v1'
    || sha256Hex(compilation.bytes) !== sha256Hex(descriptor.bytes)
    || canonicalJson(compilation.manifest) !== canonicalJson(descriptor.manifest)) fail('descriptor identity mismatch');
  exact(installation, ['format', 'revision', 'runId', 'sourceDocumentSha256', 'artifactSha256', 'resources']);
  if (installation.format !== 'GhostFlow/resource-constraints-binding-v2') fail('expected typed binding v2');
  identity(installation.revision); identity(installation.runId);
  if (installation.sourceDocumentSha256 !== source.sha256 || installation.artifactSha256 !== sha256Hex(descriptor.bytes)) fail('source/artifact identity mismatch');
  const policies = descriptor.manifest.control.continuousResourcePolicies;
  if (!policies?.length || !Array.isArray(installation.resources) || installation.resources.length !== policies.length) fail('incomplete continuous mappings');
  const names = new Set(), ids = new Set();
  for (const entry of installation.resources) {
    exact(entry, ['name', 'resourceId', 'output', 'type']);
    identity(entry.name); identity(entry.resourceId); identity(entry.output);
    const policy = policies.find(policy => policy.target === entry.name);
    if (!policy || policy.output !== entry.output || entry.type !== 'Percent' || names.has(entry.name) || ids.has(entry.resourceId)) fail('invalid or duplicate typed resource mapping');
    names.add(entry.name); ids.add(entry.resourceId);
  }
  const binding = { ...installation, resources: installation.resources.map(entry => ({ ...entry })).sort((a, b) => compare(a.name, b.name)) };
  const bindingSha256 = sha256Hex(canonicalJson(binding));
  const activation = new Writer(); activation.bytes(new TextEncoder().encode('GFRB')); activation.u16(2);
  for (const value of [binding.revision, binding.runId, bindingSha256, source.sha256]) activation.text(value);
  activation.u16(binding.resources.length);
  for (const entry of binding.resources) { activation.text(entry.name); activation.text(entry.resourceId); activation.text(entry.output); activation.u8(2); }
  const activationBytes = activation.finish();
  const extraction = extractLiterate(source.text, { filename: source.filename });
  const compiled = compileContinuousControlPolicyArtifact(extraction.code, { filename: source.filename,
    envelope(inner, plans) {
      const version = new DataView(inner.buffer, inner.byteOffset).getUint16(4, true);
      if (![1, 2, 3, 4].includes(version)) fail('continuous scalar profile rejects temporal, context and objective/PID composition');
      const writer = new Writer(); writer.bytes(new TextEncoder().encode('GFB1')); writer.u16(25); writer.blob(inner);
      writer.text(source.sha256); writer.text(sha256Hex(descriptor.bytes)); writer.blob(activationBytes);
      writer.u16(plans.length);
      for (const policy of plans) {
        writer.u32(policy.id); writer.text(policy.name); writer.text(policy.target); writer.text(policy.output);
        writer.u8(policy.select === 'max' ? 1 : 0); writer.number(policy.safe, 8);
        for (const entries of [policy.requests, policy.ceilings]) {
          writer.u16(entries.length);
          for (const entry of entries) {
            writer.u32(entry.id); writer.text(entry.name);
            for (const role of ['ok', 'value', 'fault', 'origin']) writer.blob(entry.expressions[role]);
          }
        }
      }
      return writer.finish();
    } });
  const bytes = compiled.bytes; if (bytes.length > 1024 * 1024) fail('module byte limit');
  const scan = new Writer(); scan.bytes(new TextEncoder().encode('GFRS')); scan.u16(2);
  scan.text(bindingSha256); scan.text(binding.runId); scan.text(source.sha256);
  const bytecodeSha256 = sha256Hex(bytes);
  const evidence = { sourceDocumentSha256: source.sha256, descriptorSha256: sha256Hex(descriptor.bytes), bindingSha256, bindingRevision: binding.revision };
  const result = { ...descriptor, bytes, manifest: { ...compiled.manifest, continuousResourcePolicies: policies, format: 'GhostFlow/control-v25', executable: true,
    requiredRuntimeFeatures: ['percent-range-v1'],
    requiredRuntimeContracts: ['continuous-resource-owner-v1', 'bound-resource-every-scan', 'one-registry-for-all-writers'],
    resourceBinding: binding, bytecodeSha256, ...evidence },
    traceMetadata: { ...remapSourceTrace(compiled.traceMetadata, extraction.sourceMap),
      ...(descriptor.traceMetadata?.intentAnchors ? { intentAnchors: descriptor.traceMetadata.intentAnchors, intentLinks: descriptor.traceMetadata.intentLinks } : {}),
      moduleFingerprint: moduleFingerprint(bytes), bytecodeSha256, ...evidence },
    resourceBindingActivation: activationBytes, resourceBindingScan: scan.finish() };
  return { ...result, interactionSchema: result.interactionSourceIdentity ? emitInteractionSchema(result, result.interactionSourceIdentity) : null };
}
