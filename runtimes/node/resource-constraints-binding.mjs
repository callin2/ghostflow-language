import { compileSourceSync } from '../../tools/compile-source.mjs';
import { sha256Hex } from '../../tools/sha256.mjs';

const FORMAT = 'GhostFlow/resource-constraints-binding-v1';
const fail = message => { throw new Error(`resource constraint binding: ${message}`); };
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    fail(`${label} has missing or unsupported fields`);
  }
}
function name(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || value.length > 128) fail(`invalid ${label}`);
  return value;
}
function identity(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:/-]{1,128}$/.test(value)) fail(`invalid ${label}`);
  return value;
}
function list(value, label) {
  if (!Array.isArray(value) || value.length > 128) fail(`${label} must be a finite array of at most 128 entries`);
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** Validate logical installation mapping only. This neither activates nor enforces a policy. */
export function validateResourceConstraintBinding(compilation, binding) {
  if (compilation?.manifest?.format !== 'GhostFlow/control-policy-descriptor-v1') fail('expected a checked control policy descriptor');
  const source = compilation.sourceDocument;
  if (!source || typeof source.text !== 'string' || typeof source.filename !== 'string') fail('missing canonical source identity');
  const sourceHash = sha256Hex(source.text), artifactHash = sha256Hex(compilation.bytes);
  if (source.sha256 !== sourceHash || compilation.manifest.sourceDocumentSha256 !== sourceHash
    || compilation.manifest.bytecodeSha256 !== artifactHash) fail('source or artifact identity mismatch');
  // A caller cannot replace checked rule/type metadata while retaining its digest.
  const checked = compileSourceSync(source.text, { filename: source.filename });
  if (sha256Hex(checked.bytes) !== artifactHash) fail('descriptor differs from the canonical source');
  const control = checked.manifest.control;
  exact(binding, ['format', 'revision', 'sourceDocumentSha256', 'artifactSha256', 'resources', 'modes'], 'binding');
  if (binding.format !== FORMAT) fail('unsupported binding format');
  identity(binding.revision, 'binding revision');
  if (binding.sourceDocumentSha256 !== sourceHash || binding.artifactSha256 !== artifactHash) fail('binding source or artifact identity mismatch');
  const groups = control.sharedResourceConstraints;
  const declarations = new Map(control.resources.map(resource => [resource.name, resource.type]));
  const outputs = new Map(control.outputs.map(output => [output.name, output.type]));
  const inputs = new Map(control.inputs.map(input => [input.name, input.type]));
  const required = new Set(groups.flatMap(group => [group.target, ...group.outputs]));
  const resourceMap = new Map(), stableIds = new Set(), outputNames = new Set();
  for (const entry of list(binding.resources, 'resources')) {
    name(entry?.name, 'resource alias');
    const type = declarations.get(entry.name);
    if (!required.has(entry.name)) fail(`unexpected resource binding ${entry.name}`);
    if (resourceMap.has(entry.name)) fail(`duplicate resource binding ${entry.name}`);
    exact(entry, type === 'Station' ? ['name', 'resourceId'] : ['name', 'resourceId', 'output'], 'resource mapping');
    identity(entry.resourceId, 'stable resource identity');
    if (stableIds.has(entry.resourceId)) fail('distinct aliases cannot disguise the same stable resource identity');
    stableIds.add(entry.resourceId);
    if (type !== 'Station') {
      name(entry.output, 'output port');
      if (type !== 'BoolActuator' || outputs.get(entry.output) !== 'Bool') fail(`resource ${entry.name} requires a Bool output port`);
      if (outputNames.has(entry.output)) fail('one output port cannot disguise distinct resources');
      outputNames.add(entry.output);
    }
    resourceMap.set(entry.name, { ...entry });
  }
  for (const alias of required) if (!resourceMap.has(alias)) fail(`missing resource binding ${alias}`);
  const requiredModes = new Set(groups.flatMap(group => group.modes.map(mode => `${group.name}/${mode}`)));
  const modeMap = new Map();
  for (const entry of list(binding.modes, 'modes')) {
    exact(entry, ['group', 'name', 'input'], 'mode mapping');
    name(entry.group, 'constraint group'); name(entry.name, 'mode alias'); name(entry.input, 'mode input');
    const key = `${entry.group}/${entry.name}`;
    if (!requiredModes.has(key)) fail(`unexpected mode binding ${key}`);
    if (modeMap.has(key)) fail(`duplicate mode binding ${key}`);
    if (inputs.get(entry.input) !== 'Bool') fail(`mode ${key} requires a Bool input port`);
    if ([...modeMap.values()].some(mode => mode.group === entry.group && mode.input === entry.input)) {
      fail('distinct exclusive modes must not share one input port');
    }
    modeMap.set(key, { ...entry });
  }
  for (const key of requiredModes) if (!modeMap.has(key)) fail(`missing mode binding ${key}`);
  return freeze({ format: FORMAT, revision: binding.revision, sourceDocumentSha256: sourceHash, artifactSha256: artifactHash,
    executable: false, resources: [...resourceMap.values()], modes: [...modeMap.values()] });
}
