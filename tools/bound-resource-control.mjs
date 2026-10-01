import { compileSourceSync } from './compile-source.mjs';
import { compileBoundControlPolicyArtifact } from './control.mjs';
import { extractLiterate } from './literate.mjs';
import { moduleFingerprint, remapSourceTrace } from './source-trace.mjs';
import { sha256Hex } from './sha256.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { emitInteractionSchema } from './interaction-schema.mjs';
import { validateResourceConstraintBinding } from '../runtimes/node/resource-constraints-binding.mjs';

const fail = message => { throw new Error(`bound resource control: ${message}`); };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
class Writer {
  constructor() { this.parts = []; }
  bytes(value) { this.parts.push(Uint8Array.from(value)); }
  u8(value) { this.bytes([value]); }
  number(value, length, signed = false) {
    const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
    if (length === 2) view.setUint16(0, value, true);
    else if (signed) view.setInt32(0, value, true);
    else view.setUint32(0, value, true);
    this.parts.push(bytes);
  }
  u16(value) { this.number(value, 2); }
  u32(value) { this.number(value, 4); }
  text(value) {
    const bytes = new TextEncoder().encode(value);
    if (!bytes.length || bytes.length > 128) fail('wire identity must contain 1..128 UTF-8 bytes');
    this.u16(bytes.length); this.bytes(bytes);
  }
  blob(bytes) { this.u32(bytes.length); this.bytes(bytes); }
  finish() {
    const result = new Uint8Array(this.parts.reduce((total, part) => total + part.length, 0));
    let at = 0;
    for (const part of this.parts) { result.set(part, at); at += part.length; }
    return result;
  }
}

function predicate(writer, node) {
  switch (node.kind) {
    case 'Bool': writer.u8(0); writer.u8(Number(node.value)); break;
    case 'Int': writer.u8(1); writer.number(node.value, 4, true); break;
    case 'resource-on': writer.u8(2); writer.text(node.resource); break;
    case 'count_on': case 'any_on':
      writer.u8(node.kind === 'count_on' ? 3 : 4); writer.u16(node.resources.length);
      for (const name of node.resources) writer.text(name);
      break;
    case 'implies': writer.u8(5); predicate(writer, node.left); predicate(writer, node.right); break;
    case 'compare':
      writer.u8(6); writer.u8(['==', '!=', '<', '<=', '>', '>='].indexOf(node.op));
      predicate(writer, node.left); predicate(writer, node.right); break;
    default: fail(`unsupported checked predicate ${node.kind}`);
  }
}

/** Source-derived executable policy; installation JSON supplies identities and ports only. */
export function compileBoundResourceControl(compilation, installationBinding) {
  const verified = validateResourceConstraintBinding(compilation, installationBinding);
  const binding = { ...verified,
    resources: [...verified.resources].sort((a, b) => compare(a.name, b.name)),
    modes: [...verified.modes].sort((a, b) => compare(`${a.group}/${a.name}`, `${b.group}/${b.name}`)) };
  const bindingSha256 = sha256Hex(canonicalJson(binding));
  const source = compilation.sourceDocument;
  const descriptor = compileSourceSync(source.text, { filename: source.filename,
    ...(compilation.interactionSourceIdentity ? { interactionSourceIdentity: compilation.interactionSourceIdentity } : {}) });
  const control = descriptor.manifest.control;
  const resources = new Map(binding.resources.map(resource => [resource.name, resource]));
  const declarations = new Map(control.resources.map(resource => [resource.name, resource.type]));
  const safe = new Map();
  for (const group of control.sharedResourceConstraints) {
    if (group.rules.filter(rule => rule.kind === 'exclusive').length > 1) {
      fail(`group ${group.name} requires separate integration for multiple exclusive sets; the executable profile supports one activity set per group`);
    }
    if (!group.outputs.length) fail(`group ${group.name} has no finite protected outputs`);
    for (const entry of group.safe) {
      if (safe.has(entry.resource) && safe.get(entry.resource) !== entry.value) fail(`incompatible authored safe values for ${entry.resource}`);
      safe.set(entry.resource, entry.value);
    }
  }
  const mappedOutputs = binding.resources.filter(resource => resource.output).map(resource => resource.output);
  if (mappedOutputs.length !== control.outputs.length || control.outputs.some(port => !mappedOutputs.includes(port.name))) {
    fail('every output must have one explicit protected resource mapping');
  }
  const activation = new Writer();
  activation.bytes(new TextEncoder().encode('GFRB')); activation.u16(1);
  activation.text(binding.revision); activation.text(bindingSha256);
  activation.u16(binding.resources.length);
  for (const resource of binding.resources) {
    activation.text(resource.name); activation.u8(declarations.get(resource.name) === 'Station' ? 0 : 1);
    activation.text(resource.resourceId);
  }
  const outputs = binding.resources.filter(resource => resource.output);
  activation.u16(outputs.length);
  for (const resource of outputs) { activation.text(resource.output); activation.text(resource.name); }
  activation.u16(binding.modes.length);
  for (const mode of binding.modes) {
    const group = control.sharedResourceConstraints.find(group => group.name === mode.group);
    activation.text(`${mode.group}/${mode.name}`); activation.text(mode.input);
    activation.text(sha256Hex(JSON.stringify([resources.get(group.target).resourceId, mode.group, mode.name])));
  }
  const activationBytes = activation.finish();
  if (activationBytes.length > 65536) fail('binding packet exceeds 64 KiB');
  const scan = new Writer();
  scan.bytes(new TextEncoder().encode('GFRS')); scan.u16(1); scan.text(bindingSha256);
  const extraction = extractLiterate(source.text, { filename: source.filename });
  const compiled = compileBoundControlPolicyArtifact(extraction.code, { filename: source.filename,
    envelope(inner, _manifest, localConstraints) {
      const safeOutputs = Object.fromEntries(outputs.map(resource => [resource.output, safe.get(resource.name)]));
      for (const rule of localConstraints) {
        const values = rule.names.map(name => safeOutputs[name]);
        const valid = rule.kind === 'requires' ? !values[0] || values[1]
          : rule.kind === 'requires-any' ? !values[0] || values.slice(1).some(Boolean)
            : rule.kind === 'mutex' ? values.filter(Boolean).length <= 1 : false;
        if (!valid) fail('authored safe vector conflicts with mandatory local safety');
      }
      const writer = new Writer(); writer.bytes(new TextEncoder().encode('GFB1')); writer.u16(17); writer.blob(inner);
      writer.text(source.sha256); writer.text(sha256Hex(descriptor.bytes)); writer.blob(activationBytes);
      writer.u16(control.sharedResourceConstraints.length);
      for (const group of control.sharedResourceConstraints) {
        writer.text(group.name); writer.text(group.target); writer.u16(group.modes.length);
        for (const mode of group.modes) writer.text(`${group.name}/${mode}`);
        const requirements = group.rules.filter(rule => rule.kind === 'require'); writer.u16(requirements.length);
        for (const rule of requirements) { const encoded = new Writer(); predicate(encoded, rule.predicate); writer.blob(encoded.finish()); }
        writer.u16(group.safe.length);
        for (const entry of group.safe) { writer.text(entry.resource); writer.u8(Number(entry.value)); }
      }
      const result = writer.finish();
      if (result.length > 1024 * 1024) fail('bound module exceeds 1 MiB');
      return result;
    } });
  const bytecodeSha256 = sha256Hex(compiled.bytes);
  const evidence = { sourceDocumentSha256: source.sha256, descriptorSha256: sha256Hex(descriptor.bytes),
    bindingSha256, bindingRevision: binding.revision };
  const result = { ...descriptor, bytes: compiled.bytes,
    manifest: { ...control, format: 'GhostFlow/control-v17', executable: true, bytecodeSha256,
      requiredRuntimeContracts: ['bound-resource-activation', 'bound-resource-every-scan', 'one-registry-for-all-writers'],
      resourceBinding: binding, ...evidence },
    traceMetadata: { ...remapSourceTrace(compiled.traceMetadata, extraction.sourceMap),
      ...(descriptor.traceMetadata?.intentAnchors ? { intentAnchors: descriptor.traceMetadata.intentAnchors,
        intentLinks: descriptor.traceMetadata.intentLinks } : {}),
      moduleFingerprint: moduleFingerprint(compiled.bytes), bytecodeSha256, ...evidence },
    resourceBindingActivation: activationBytes, resourceBindingScan: scan.finish() };
  return { ...result, interactionSchema: descriptor.interactionSourceIdentity
    ? emitInteractionSchema(result, descriptor.interactionSourceIdentity) : null };
}

/** Reconstruct both executable bytes and source metadata before accepting a saved artifact. */
export function verifyBoundResourceCompilation(compilation) {
  if (compilation?.manifest?.format !== 'GhostFlow/control-v17') fail('expected an executable bound resource control');
  const source = compilation.sourceDocument;
  const { executable: _flag, ...binding } = compilation.manifest.resourceBinding;
  const checked = compileBoundResourceControl(compileSourceSync(source.text, { filename: source.filename,
    ...(compilation.interactionSourceIdentity ? { interactionSourceIdentity: compilation.interactionSourceIdentity } : {}) }), binding);
  if (sha256Hex(compilation.bytes) !== checked.manifest.bytecodeSha256
    || canonicalJson(compilation.manifest) !== canonicalJson(checked.manifest)
    || canonicalJson(compilation.interactionSchema ?? null) !== canonicalJson(checked.interactionSchema)) {
    fail('artifact or source metadata differs from its canonical source and binding');
  }
  return checked;
}

/** Link actual core decisions to canonical authored groups, never infer enforcement from metadata. */
export function observeBoundResourceTrace(compilation, trace) {
  const checked = verifyBoundResourceCompilation(compilation);
  const manifest = checked.manifest;
  if (manifest?.format !== 'GhostFlow/control-v17'
    || sha256Hex(compilation.bytes) !== manifest.bytecodeSha256
    || trace?.module !== moduleFingerprint(compilation.bytes)
    || !Array.isArray(trace.resourceTrace)
    || trace.resourceTrace.length !== manifest.sharedResourceConstraints.length) {
    fail('source/artifact/decision identity mismatch');
  }
  const names = new Set();
  return trace.resourceTrace.map(decision => {
    const group = manifest.sharedResourceConstraints.find(group => group.name === decision.group);
    if (!group || names.has(group.name) || decision.bindingHash !== manifest.bindingSha256
      || decision.sourceHash !== manifest.sourceDocumentSha256 || decision.descriptorHash !== manifest.descriptorSha256) {
      fail('source/binding/decision identity mismatch');
    }
    names.add(group.name);
    const requirements = group.rules.filter(rule => rule.kind === 'require');
    if (decision.failedRule !== undefined && decision.failedRule !== null
      && (!Number.isInteger(decision.failedRule) || !requirements[decision.failedRule])) fail('decision refers to an unknown mandatory rule');
    return { group: group.name, source: group.source,
      ...(requirements[decision.failedRule] ? { ruleSource: requirements[decision.failedRule].source } : {}),
      evidence: 'executed', decision };
  });
}
