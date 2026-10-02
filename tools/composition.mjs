import { parseControl, compileComposedControl, validateCompositionStructure, ControlCompileError } from './control.mjs';
import { extractLiterate } from './literate.mjs';
import { sha256Hex, isWellFormedUnicode, utf8ByteLength } from './sha256.mjs';

// POSIX logical locators work identically in browsers and CLI supplied closures.
export function resolveDocument(importer, locator) {
  const parts = `${importer.slice(0, importer.lastIndexOf('/') + 1)}${locator}`.split('/');
  const result = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..' && result.length && result.at(-1) !== '..') result.pop();
    else result.push(part);
  }
  return `${importer.startsWith('/') || locator.startsWith('/') ? '/' : ''}${result.join('/')}`;
}
const fail = (loc, text, code) => { throw new ControlCompileError(text, loc, code); };
const typeKey = type => JSON.stringify(type, (key, value) => key === 'loc' ? undefined : value);
const simpleKinds = new Set(['input', 'output', 'parameter', 'state', 'let', 'next', 'connection', 'instance', 'connect', 'sensor', 'function']);

/** Verify the complete supplied closure, then compose ASTs without generating source. */
export function compileComposition(source, filename, supplied) {
  if (!Array.isArray(supplied) || supplied.length > 128) throw new Error('sourceClosure must be an array of at most 128 documents');
  const documents = new Map();
  let total = utf8ByteLength(source);
  for (const document of supplied) {
    if (!document || typeof document.filename !== 'string' || !document.filename.endsWith('.ghost.md')
        || !isWellFormedUnicode(document.filename) || document.filename.includes('\0')
        || typeof document.revision !== 'string' || !document.revision.trim() || document.revision === 'latest'
        || !isWellFormedUnicode(document.text)) throw new Error('invalid sourceClosure document');
    const size = utf8ByteLength(document.text); total += size;
    if (size > 1024 * 1024 || total > 8 * 1024 * 1024) throw new Error('sourceClosure byte limit exceeded');
    const key = resolveDocument('', document.filename);
    if (documents.has(key) || key === resolveDocument('', filename)) throw new Error(`duplicate sourceClosure document ${key}`);
    documents.set(key, { filename: key, revision: document.revision, text: document.text, sha256: sha256Hex(document.text) });
  }
  const units = new Map(), active = new Set(), used = new Set();
  function visit(text, name) {
    const key = resolveDocument('', name);
    if (active.has(key)) throw new Error(`executable import cycle at ${key}`);
    if (units.has(key)) return units.get(key);
    const extraction = extractLiterate(text, { filename: name });
    let ast;
    try { ast = parseControl(extraction.code, { filename: name }); }
    catch (error) { error.diagnosticCode = 'GF_PARSE'; throw error; }
    validateCompositionStructure(ast);
    const unit = { ast, extraction, imports: new Map(), filename: name };
    units.set(key, unit); active.add(key);
    for (const entry of ast.imports) {
      const target = resolveDocument(name, entry.locator), document = documents.get(target);
      if (!document) fail(entry.locatorLoc, `missing imported document ${entry.locator} in sourceClosure`, 'GF_IMPORT');
      // A closing edge to an active definition is a structural cycle even
      // when its circular content pin cannot match. Reject before identity
      // checks so the authored back edge retains the specific cycle reason.
      if (active.has(target)) fail(entry.loc, `executable import cycle at ${entry.locator}`, 'GF_IMPORT');
      if (document.revision !== entry.revision) fail(entry.loc, `import revision mismatch for ${entry.locator}`, 'GF_IMPORT');
      if (document.sha256 !== entry.sha256) fail(entry.digestLoc,
        `import sha256 digest mismatch for ${entry.locator}: expected ${entry.sha256}, actual ${document.sha256}`, 'GF_IMPORT');
      used.add(target); unit.imports.set(entry.name, visit(document.text, target));
    }
    active.delete(key); return unit;
  }
  const root = visit(source, filename);
  let nextId = 1, expanded = 0, transformed = 0;
  const sourceNodes = [], instances = [], compositionChecks = [];
  const sensorBindings = new Map();
  const allBodies = [];
  function instantiate(unit, path, argumentsList = [], callerTransform = value => value) {
    if (++expanded > 128) fail(unit.ast.loc, 'composition instance limit exceeded');
    if (path && (unit.extraction.anchors.length || unit.extraction.linkDirectives.length)) fail(unit.ast.loc,
      'imported intent links require instance-qualified intent metadata');
    for (const node of unit.ast.body) if (!simpleKinds.has(node.kind)) fail(node.loc, `composition of ${node.kind} requires its instance contract`);
    const prefix = path ? `instance_${path.split('.').map(part => `${part.length}_${part}`).join('_')}_` : '';
    const names = new Map(), ports = new Map(), outputs = new Map(), inputs = new Map(), ids = new Map();
    for (const node of unit.ast.body) {
      for (const name of node.names ?? (node.name ? [node.name] : [])) names.set(name, `${prefix}${name}`);
      if (node.kind === 'input' || node.kind === 'output') for (const name of node.names) ports.set(name, { kind: node.kind, type: node.type });
      if (node.kind === 'sensor') ports.set(node.name, { kind: 'sensor', type: node.type, optional: node.optional });
      if (node.kind === 'connection') outputs.set(node.name, node.value);
    }
    for (const node of unit.ast.sourceNodes) {
      const id = nextId++; ids.set(node.id, id);
      sourceNodes.push({ ...node, id, instance: path || null, definitionNodeId: node.id });
    }
    const parameters = new Map(unit.ast.body.filter(node => node.kind === 'parameter').map(node => [node.name, node]));
    const overrides = new Map();
    for (const arg of argumentsList) {
      if (!parameters.has(arg.name)) fail(arg.loc, `unknown instance argument ${arg.name}`);
      overrides.set(arg.name, callerTransform(arg.value));
    }
    const children = new Map();
    for (const node of unit.ast.body.filter(node => node.kind === 'instance').sort((a, b) => a.name.localeCompare(b.name))) {
      children.set(node.name, instantiate(unit.imports.get(node.alias), path ? `${path}.${node.name}` : node.name, node.arguments, transform));
    }
    const resolving = new Set();
    function output(name) {
      if (resolving.has(name)) fail(unit.ast.loc, `combinational port cycle at ${path}.${name}`);
      if (!outputs.has(name)) fail(unit.ast.loc, `missing output definition ${path}.${name}`);
      resolving.add(name);
      const expr = outputs.get(name), result = typeof expr === 'function' ? expr() : transform(expr);
      resolving.delete(name); return result;
    }
    function transform(value, locals = new Set()) {
      if (!value || typeof value !== 'object') return value;
      if (++transformed > 65_536) fail(unit.ast.loc, 'composition expression expansion limit exceeded');
      if (Array.isArray(value)) return value.map(child => transform(child, locals));
      if (value.kind === 'function') {
        return { ...value, id: ids.get(value.id), name: names.get(value.name),
          body: transform(value.body, new Set(value.params.map(param => param.name))) };
      }
      if (value.kind === 'case') return { ...value, id: ids.get(value.id),
        value: transform(value.value, locals), branches: value.branches.map(branch => ({ ...branch,
          body: transform(branch.body, new Set([...locals, ...(branch.binding ? [branch.binding] : [])])) })) };
      if (value.kind === 'reference' && !locals.has(value.name) && ports.get(value.name)?.kind === 'input' && path) {
        const provider = inputs.get(value.name);
        if (!provider) fail(value.loc, `missing required input ${path}.${value.name}`);
        return provider();
      }
      const result = {};
      for (const [key, child] of Object.entries(value)) {
        if (key === 'loc') result[key] = child;
        else if (key === 'id') result[key] = ids.get(child) ?? child;
        else if (key === 'name' && value.kind && names.has(child) && !locals.has(child)) result[key] = names.get(child);
        else if (key === 'names') result[key] = child.map(name => names.get(name) ?? name);
        else result[key] = transform(child, locals);
      }
      return result;
    }
    for (const connection of unit.ast.body.filter(node => node.kind === 'connect')) {
      const endpoint = (entry, direction) => {
        const owner = entry.instance ? children.get(entry.instance) : { ports };
        const port = owner.ports.get(entry.port);
        if (!port || port.kind !== direction && !(direction === 'input' && port.kind === 'sensor')) fail(entry.loc, `unknown ${direction} port ${entry.path}`);
        return { owner, port };
      };
      const sink = endpoint(connection.sink, connection.sink.instance ? 'input' : 'output');
      const origin = endpoint(connection.source, connection.source.instance ? 'output' : 'input');
      if (typeKey(sink.port.type) !== typeKey(origin.port.type)) fail(connection.sink.loc, `port type mismatch for ${connection.sink.path}`);
      if (sink.port.kind === 'sensor' || origin.port.kind === 'sensor') {
        if (sink.port.kind !== 'sensor' || origin.port.kind !== 'sensor' || !connection.sink.instance || connection.source.instance)
          fail(connection.sink.loc, 'sensor connection requires a root sensor source and an instance sensor sink');
        if (sink.port.optional !== origin.port.optional)
          fail(connection.sink.loc, `sensor sample contract mismatch for ${connection.sink.path}`);
        sink.owner.inputs.set(connection.sink.port, { sensor: names.get(connection.source.port), loc: connection.sink.loc });
        continue;
      }
      const provider = connection.source.instance
        ? () => origin.owner.output(connection.source.port)
        : () => transform({ kind: 'reference', id: connection.id, loc: connection.source.loc, name: connection.source.port });
      if (connection.sink.instance) sink.owner.inputs.set(connection.sink.port, provider);
      else outputs.set(connection.sink.port, provider);
    }
    const deferred = () => {
      if (path) for (const [name, port] of ports) if (['input', 'sensor'].includes(port.kind) && !inputs.has(name)) fail(unit.ast.loc, `missing required input ${path}.${name}`);
      const body = [];
      for (const node of unit.ast.body) {
        if (['instance', 'connect', 'connection'].includes(node.kind) || (path && ['input', 'output'].includes(node.kind))) continue;
        const copy = transform(node);
        if (node.kind === 'sensor' && path) sensorBindings.set(copy.name, { sourceSensor: inputs.get(node.name).sensor, instance: path, port: node.name, loc: inputs.get(node.name).loc });
        if (node.kind === 'parameter' && overrides.has(node.name)) copy.value = overrides.get(node.name);
        body.push(copy);
      }
      // Validate every output, even when no parent consumes it.
      for (const [name, port] of ports) if (port.kind === 'output') {
        const value = output(name);
        compositionChecks.push({ value, type: port.type });
        if (!path) {
          const existing = unit.ast.body.find(node => (node.kind === 'connection' && node.name === name) || (node.kind === 'connect' && node.sink.path === name));
          body.push({ kind: 'connection', id: ids.get(existing.id), name, value, loc: existing.loc });
        }
      }
      return body;
    };
    allBodies.push(deferred);
    if (path) instances.push({ instance: path, filename: unit.filename, definition: unit.ast.name });
    return { ports, inputs, output };
  }
  instantiate(root, '');
  const body = allBodies.flatMap(resolve => resolve());
  const ast = { ...root.ast, imports: [], body, sourceNodes, compositionChecks };
  const result = compileComposedControl(ast, filename);
  if (sensorBindings.size) {
    const publicSource = name => {
      const visited = new Set();
      while (sensorBindings.has(name)) {
        if (visited.has(name)) fail(root.ast.loc, 'sensor connection cycle');
        visited.add(name); name = sensorBindings.get(name).sourceSensor;
      }
      return name;
    };
    const byName = new Map(result.manifest.sensors.map(sensor => [sensor.name, sensor]));
    result.manifest.sensorInstances = result.manifest.sensors.filter(sensor => sensorBindings.has(sensor.name))
      .map(sensor => {
        const { loc, ...binding } = sensorBindings.get(sensor.name);
        const sourceSensor = publicSource(sensor.name), source = byName.get(sourceSensor);
        if (!source || source.sampleMs !== sensor.sampleMs || !!source.optional !== !!sensor.optional)
          fail(loc, `sensor sample contract mismatch for ${binding.instance}.${binding.port}`);
        return { ...sensor, ...binding, sourceSensor };
      });
    result.manifest.sensors = result.manifest.sensors.filter(sensor => !sensorBindings.has(sensor.name));
  }
  const closure = { format: 'GhostFlow/source-closure-v1', documents: [...used].sort().map(key => documents.get(key)), instances };
  return { result, closure, units };
}
