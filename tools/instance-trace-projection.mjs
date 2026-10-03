import {compileSource} from './toolchain.mjs';
import {canonicalJson} from './canonical-json.mjs';
import {observeSourceTrace} from './source-trace.mjs';
import {sha256Hex} from './sha256.mjs';
import {parseControl} from './control.mjs';
import {extractLiterate} from './literate.mjs';

const clone = value => structuredClone(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const fail = message => {throw new Error(`instance trace projection ${message}`);};
function freeze(value) {
  if (value !== null && typeof value === 'object') {for (const child of Object.values(value)) freeze(child);Object.freeze(value);}
  return value;
}
function text(value, label, limit) {
  if (typeof value !== 'string' || !value.isWellFormed() || value.trim().length === 0 || value.length > limit) fail(`${label} must be non-empty bounded text`);
  if (/[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must not contain control characters`);
  return value;
}
function equal(left, right, label) {if (canonicalJson(left) !== canonicalJson(right)) fail(`${label} provenance mismatch`);}
function authoredNodes(sourceDocument, sourceClosure) {
  const nodes = new Map();
  for (const document of [sourceDocument, ...sourceClosure.documents]) {
    const ast = parseControl(extractLiterate(document.text, {filename: document.filename}).code, {filename: document.filename});
    for (const declaration of ast.body) nodes.set(`${document.filename}\0${declaration.id}`, declaration);
  }
  return nodes;
}

/** Source-bound projection only: execution remains in the shared Rust core. */
export async function activateInstanceTraceProjection(artifact, presentation) {
  artifact = clone(artifact);presentation = clone(presentation);
  const {sourceDocument, sourceClosure, manifest, traceMetadata, sourceMap, bytes} = artifact ?? {};
  if (!plain(sourceDocument) || sourceDocument.format !== 'GhostFlow/source-document-v1'
    || sourceDocument.kind !== 'literate' || typeof sourceDocument.filename !== 'string'
    || typeof sourceDocument.text !== 'string' || sha256Hex(sourceDocument.text) !== sourceDocument.sha256) fail('source document content hash mismatch');
  if (!(bytes instanceof Uint8Array) || !plain(manifest) || sha256Hex(bytes) !== manifest.bytecodeSha256) fail('manifest bytecode provenance mismatch');
  if (!plain(sourceClosure) || sourceClosure.format !== 'GhostFlow/source-closure-v1'
    || !Array.isArray(sourceClosure.documents) || !Array.isArray(sourceClosure.instances)) fail('source closure metadata is malformed');
  for (const document of sourceClosure.documents) {
    if (!plain(document) || typeof document.text !== 'string' || sha256Hex(document.text) !== document.sha256) fail('source closure document content hash mismatch');
  }
  const rebuilt = await compileSource(sourceDocument.text, {filename: sourceDocument.filename,
    sourceClosure: sourceClosure.documents.map(({filename, revision, text}) => ({filename, revision, text}))});
  if (sha256Hex(rebuilt.bytes) !== sha256Hex(bytes)) fail('compiled bytecode provenance mismatch');
  for (const [label, received, expected] of [['manifest', manifest, rebuilt.manifest], ['source closure', sourceClosure, rebuilt.sourceClosure],
    ['source trace metadata', traceMetadata, rebuilt.traceMetadata], ['source map', sourceMap, rebuilt.sourceMap]]) equal(received, expected, label);

  if (!plain(presentation) || Object.keys(presentation).some(key => !['presentationRevision', 'labels'].includes(key))
    || !plain(presentation.labels)) fail('presentation labels metadata is malformed');
  const instanceIds = sourceClosure.instances.map(instance => instance.instance).sort();
  if (!instanceIds.length || new Set(instanceIds).size !== instanceIds.length) fail('source closure instance identity mismatch');
  if (canonicalJson(Object.keys(presentation.labels).sort()) !== canonicalJson(instanceIds)) fail('presentation labels must target exact compiled instance identities');
  const labels = new Map(instanceIds.map(id => [id, text(presentation.labels[id], `${id} label`, 64)]));
  const presentationRevision = text(presentation.presentationRevision, 'presentation revision', 128);
  const nodes = new Map(sourceMap.map(node => [node.id, node]));
  const authored = authoredNodes(sourceDocument, sourceClosure);
  const activation = freeze({format: 'GhostFlow/instance-trace-projection-activation-v1', sourceDocumentSha256: sourceDocument.sha256,
    bytecodeSha256: manifest.bytecodeSha256, manifestSha256: sha256Hex(canonicalJson(manifest)),
    sourceClosureSha256: sha256Hex(canonicalJson(sourceClosure)), traceMetadataSha256: sha256Hex(canonicalJson(traceMetadata)),
    instanceIds, presentationRevision, presentations: instanceIds.map(instanceId => ({instanceId, displayName: labels.get(instanceId), presentationRevision}))});

  function projectTrace(trace) {
    if (trace?.module !== traceMetadata.moduleFingerprint) fail('trace identity does not match activated compiled instance identities');
    const observation = observeSourceTrace(traceMetadata, trace);
    const entries = observation.bindings.map(binding => {
      const node = nodes.get(binding.nodeId);
      if (!node) fail('trace binding has no source map owner');
      if (node.instance && !labels.has(node.instance)) fail('trace binding has unknown instance identity');
      const declaration = authored.get(`${node.filename}\0${node.definitionNodeId ?? node.id}`);
      const local = declaration?.name ?? (node.instance ? null : binding.name);
      if (typeof local !== 'string' || local.startsWith('__gf_') || /^instance_\d+_/u.test(local)) fail('trace binding has no public authored symbol');
      return {instanceId: node.instance ?? null, displayName: node.instance ? labels.get(node.instance) : null,
        key: node.instance ? `${node.instance}.${local}` : local, nodeId: binding.nodeId, kind: binding.kind,
        source: {filename: node.filename, line: node.line, column: node.column}, authoredSymbol: local, observations: binding.observations};
    });
    entries.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);
    return freeze(clone({format: 'GhostFlow/instance-trace-projection-v1', presentationRevision,
      sourceDocumentSha256: activation.sourceDocumentSha256, bytecodeSha256: activation.bytecodeSha256,
      sourceObservationFormat: traceMetadata.format, entries, constraints: observation.constraints, resultEvents: observation.resultEvents,
      windowEvents: observation.windowEvents, heldEvents: observation.heldEvents}));
  }
  return Object.freeze({format: 'GhostFlow/instance-trace-projection-owner-v1', activation, projectTrace});
}
