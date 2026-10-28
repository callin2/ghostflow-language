import { compileSourceSync } from './compile-source.mjs';
import { extractLiterate } from './literate.mjs';
import { parseControl } from './control.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { equalBytes, sha256Hex } from './sha256.mjs';

const fail = message => { throw new Error(`interaction composition: ${message}`); };

/** Private projection from exact replayed compiler identities, never encoded names. */
export function composedInteraction(compilation) {
  const source = compilation.sourceDocument;
  const replay = compileSourceSync(source.text, { filename: source.filename,
    sourceClosure: compilation.sourceClosure.documents });
  if (!equalBytes(compilation.bytes, replay.bytes)) fail('bytecode differs from canonical closure');
  for (const field of ['sourceClosure', 'sourceMap', 'traceMetadata', 'manifest']) {
    if (canonicalJson(compilation[field]) !== canonicalJson(replay[field])) fail(`${field} differs from canonical closure`);
  }
  const documents = new Map(replay.sourceClosure.documents.map(document => [document.filename, document]));
  const instances = replay.sourceClosure.instances.map(entry => {
    const document = documents.get(entry.filename);
    return { instance: entry.instance, definition: { filename: document.filename,
      revision: document.revision, sha256: document.sha256 } };
  });
  const units = new Map([source, ...documents.values()].map(document => {
    const extraction = extractLiterate(document.text, { filename: document.filename });
    return [document.filename, { extraction, ast: parseControl(extraction.code, { filename: document.filename }) }];
  }));
  const entries = [];
  for (const node of replay.sourceMap) {
    if (!['config', 'state', 'timer'].includes(node.kind)) continue;
    const unit = units.get(node.filename);
    const item = unit.ast.body.find(item => item.id === node.definitionNodeId);
    if (!item || item.kind !== node.kind) fail('definition node is missing');
    const config = replay.manifest.configs?.find(config => config.id === node.id);
    if (node.kind === 'config' && !config?.settings) continue;
    const binding = replay.traceMetadata.bindings.find(binding => binding.nodeId === node.id);
    const runtimeName = config?.name ?? (item.kind === 'timer' ? binding?.generated?.declaration : binding?.name);
    if (!runtimeName) fail('runtime binding is missing');
    const intent = node.instance === null ? replay.traceMetadata
      : replay.traceMetadata.compositionIntent?.instances.find(entry => entry.instance === node.instance);
    const links = (intent?.links ?? intent?.intentLinks ?? []).filter(link => link.nodeId === node.id && link.nodeKind === node.kind);
    const sourceNode = { id: node.id, definitionNodeId: node.definitionNodeId, kind: node.kind,
      source: Object.fromEntries(['filename', 'line', 'column', 'endLine', 'endColumn'].map(key => [key, node[key]])) };
    entries.push({ item, node, config, runtimeName, links, unit, sourceNode,
      instance: node.instance, enums: new Map(unit.ast.body.filter(item => item.kind === 'enum').map(item => [item.name, item.members])) });
  }
  return { entries, composition: { sourceClosureSha256: sha256Hex(canonicalJson(replay.sourceClosure)), instances } };
}
