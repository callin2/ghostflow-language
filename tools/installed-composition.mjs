import { parseControl } from './control.mjs';
import { extractLiterate } from './literate.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { sha256Hex } from './sha256.mjs';

const fail = message => { throw new Error(`installed composition: ${message}`); };
const astOf = document => parseControl(extractLiterate(document.text, { filename: document.filename }).code,
  { filename: document.filename });

/** Derive routes from the compiler-verified artifact, never from generated names. */
export function installedCompositionRoutes(artifact) {
  const root = astOf(artifact.sourceDocument);
  if (root.body.some(node => !['sensor', 'input', 'output', 'instance', 'connect'].includes(node.kind))) {
    fail('root requires direct instance port connections');
  }
  const instances = new Map(artifact.sourceClosure.instances.map(instance => [instance.instance, instance]));
  if ([...instances.keys()].some(instance => instance.includes('.'))) fail('nested instances are unsupported');
  const documents = new Map(artifact.sourceClosure.documents.map(document => [document.filename, document]));
  const source = (instance, definitionNodeId, document) => {
    const node = artifact.sourceMap.find(node => node.instance === instance && node.definitionNodeId === definitionNodeId);
    if (!node) fail('source node is missing');
    return { nodeId: node.id, definitionNodeId, filename: node.filename, sourceSha256: document.sha256,
      line: node.line, column: node.column, endLine: node.endLine, endColumn: node.endColumn };
  };
  const inputs = [], outputs = [];
  for (const connection of root.body.filter(node => node.kind === 'connect')) {
    const input = connection.sink.instance !== null && connection.source.instance === null;
    const output = connection.sink.instance === null && connection.source.instance !== null;
    if (!input && !output) fail('only direct root input to instance input and instance output to root output routes are supported');
    const endpoint = input ? connection.sink : connection.source;
    const rootPort = (input ? connection.source : connection.sink).port;
    const instance = instances.get(endpoint.instance);
    const document = documents.get(instance?.filename);
    if (!document) fail('instance definition is missing');
    const port = astOf(document).body.find(node => input ? node.kind === 'sensor' && node.name === endpoint.port
      : node.kind === 'output' && node.names.includes(endpoint.port));
    if (!port) fail('instance port requires a conditioned sensor or Bool output');
    if (input && !artifact.manifest.sensorInstances.some(sensor => sensor.instance === endpoint.instance
      && sensor.port === endpoint.port && sensor.sourceSensor === rootPort)) fail('instance sensor route mismatch');
    const route = { rootPort, instance: endpoint.instance, port: endpoint.port,
      definition: { filename: document.filename, revision: document.revision, sha256: document.sha256 },
      connection: source(null, connection.id, artifact.sourceDocument),
      declaration: source(endpoint.instance, port.id, document) };
    (input ? inputs : outputs).push(route);
  }
  if (inputs.length !== artifact.manifest.sensorInstances.length
    || outputs.length !== artifact.manifest.outputs.length
    || artifact.manifest.sensors.some(sensor => !inputs.some(route => route.rootPort === sensor.name))) {
    fail('every installed input and output requires a direct instance route');
  }
  return { sourceSha256: artifact.sourceDocument.sha256,
    sourceClosureSha256: sha256Hex(canonicalJson(artifact.sourceClosure)), inputs, outputs };
}
