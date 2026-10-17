import { HardwareFrontMatterError } from './hardware-frontmatter.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { sha256Hex, utf8ByteLength } from './sha256.mjs';

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}@[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const forbidden = key => ['__proto__', 'prototype', 'constructor'].includes(key);
const validName = name => NAME.test(name) && !forbidden(name);
const validRef = ref => typeof ref === 'string' && REF.test(ref) && ref.split('@')[1] !== 'latest';
const clone = value => JSON.parse(JSON.stringify(value));

function diagnostics(plan) {
  return (path, message) => {
    let location = plan.locations[path];
    while (!location && path) { path = path.slice(0, path.lastIndexOf('/')); location = plan.locations[path]; }
    throw new HardwareFrontMatterError(plan.source, location ?? { line: 1, column: 1 }, message);
  };
}

function fields(value, allowed, required, fail, path) {
  if (!object(value)) fail(path, 'expected a named object');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(path, `unknown field ${key}`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(path, `missing field ${key}`);
}

export function profileRequest(root, source, locations) {
  const plan = { format: 'GhostFlow/profile-request-v1', source, locations };
  const fail = diagnostics(plan);
  if (Object.hasOwn(root, 'hardware')) fail('/hardware', 'cannot combine hardware and compact profile declarations');
  for (const key of Object.keys(root)) if (!['profile', 'devices', 'bindings'].includes(key)) fail(`/${key}`, `unknown compact front matter field ${key}`);
  if (!validRef(root.profile)) fail('/profile', 'profile must be a fixed id@revision, never latest');
  const devices = Object.hasOwn(root, 'devices') ? root.devices : {};
  if (!object(devices)) fail('/devices', 'devices must be a named object');
  for (const [name, device] of Object.entries(devices)) {
    const path = `/devices/${name}`;
    if (!validName(name) || name === 'board') fail(path, `invalid or reserved device name ${name}`);
    fields(device, ['profile', 'params', 'bus'], ['profile'], fail, path);
    if (!validRef(device.profile)) fail(`${path}/profile`, 'device profile must be a fixed id@revision, never latest');
    if (Object.hasOwn(device, 'params') && !object(device.params)) fail(`${path}/params`, 'params must be a named object');
    if (Object.hasOwn(device, 'bus') && (typeof device.bus !== 'string' || !/^board\.[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(device.bus))) {
      fail(`${path}/bus`, 'bus must name an explicit board connection, for example board.rs485');
    }
  }
  if (!object(root.bindings)) fail('/bindings', 'bindings must be a named object');
  for (const [name, target] of Object.entries(root.bindings)) {
    if (!validName(name)) fail('/bindings', `invalid logical name ${name}`);
    const parts = typeof target === 'string' ? target.split('.') : [];
    if (parts.length !== 2 || !parts.every(validName)) fail(`/bindings/${name}`, 'binding must be device.channel or board.channel');
    if (parts[0] !== 'board' && !Object.hasOwn(devices, parts[0])) fail(`/bindings/${name}`, `unknown device ${parts[0]}`);
  }
  return { ...plan, request: { profile: root.profile, devices, bindings: root.bindings } };
}

// A supplied immutable closure is data, never a resolver with file/network effects.
export function resolveHardwareProfiles(plan, supplied) {
  if (!plan || plan.format !== 'GhostFlow/profile-request-v1') return plan;
  const fail = diagnostics(plan);
  if (!Array.isArray(supplied) || supplied.length === 0 || supplied.length > 128) {
    fail('/profile', 'supply hardwareProfiles with 1..128 pinned profiles to validate this installation');
  }
  const catalog = new Map(), resolved = new Map(), used = new Set(), active = new Set();
  let bytes = 0;
  for (const entry of supplied) {
    fields(entry, ['ref', 'sha256', 'definition'], ['ref', 'sha256', 'definition'], fail, '/profile');
    if (!validRef(entry.ref) || !DIGEST.test(entry.sha256 ?? '')) fail('/profile', 'invalid profile closure identity');
    if (catalog.has(entry.ref)) fail('/profile', `duplicate profile ${entry.ref}`);
    let canonical;
    try { canonical = canonicalJson(entry.definition, { rejectUnsafeIntegers: true, rejectSparseArrays: true }); }
    catch (error) { fail('/profile', `invalid profile ${entry.ref}: ${error.message}`); }
    bytes += utf8ByteLength(canonical);
    if (bytes > 4 * 1024 * 1024) fail('/profile', 'profile closure exceeds 4 MiB');
    if (sha256Hex(canonical) !== entry.sha256) fail('/profile', `profile digest mismatch for ${entry.ref}`);
    // Block prototype-sensitive keys before any merge, including in unused definitions.
    const safe = value => {
      if (!object(value) && !Array.isArray(value)) return;
      for (const [key, child] of Object.entries(value)) {
        if (forbidden(key)) fail('/profile', `unsupported profile key ${key}`);
        safe(child);
      }
    };
    safe(entry.definition);
    catalog.set(entry.ref, clone(entry));
  }
  const merge = (parent, child) => {
    const out = clone(parent);
    for (const [key, value] of Object.entries(child)) {
      out[key] = object(value) && object(out[key]) ? merge(out[key], value) : clone(value);
    }
    return out;
  };
  const lookup = (ref, kind, path) => {
    const entry = catalog.get(ref);
    if (!entry) fail(path, `missing ${kind} profile ${ref}`);
    if (active.has(ref)) fail(path, `profile inheritance cycle at ${ref}`);
    if (entry.definition?.kind !== kind) fail(path, `profile ${ref} requires kind ${kind}`);
    used.add(ref);
    if (resolved.has(ref)) return resolved.get(ref);
    active.add(ref);
    const own = entry.definition;
    let value = own;
    if (Object.hasOwn(own, 'extends')) {
      if (!validRef(own.extends)) fail(path, `profile ${ref} has invalid extends revision`);
      value = merge(lookup(own.extends, kind, path), own);
    }
    active.delete(ref);
    resolved.set(ref, value);
    return value;
  };
  const channelMap = (channels, path) => {
    if (!object(channels)) fail(path, 'profile channels must be a named object');
    for (const [name, channel] of Object.entries(channels)) {
      if (!validName(name)) fail(path, `invalid channel name ${name}`);
      fields(channel, ['role', 'type', 'unit'], ['role', 'type'], fail, path);
      if (!['input', 'output'].includes(channel.role) || typeof channel.type !== 'string' || !channel.type) fail(path, `invalid channel contract ${name}`);
      if (Object.hasOwn(channel, 'unit') && (typeof channel.unit !== 'string' || !channel.unit)) fail(path, `invalid channel unit ${name}`);
    }
  };
  const board = lookup(plan.request.profile, 'board', '/profile');
  fields(board, ['kind', 'extends', 'connections', 'defaults', 'channels'], ['kind', 'connections', 'defaults', 'channels'], fail, '/profile');
  if (!object(board.connections) || !object(board.defaults)) fail('/profile', 'board connections and defaults must be named objects');
  channelMap(board.channels, '/profile');
  const resources = new Map();
  for (const [name, connection] of Object.entries(board.connections)) {
    if (!validName(name)) fail('/profile', `invalid connection name ${name}`);
    fields(connection, ['resource', 'transport', 'protocol', 'settings'], ['resource', 'transport', 'protocol', 'settings'], fail, '/profile');
    for (const key of ['resource', 'transport', 'protocol']) if (typeof connection[key] !== 'string' || !connection[key]) fail('/profile', `invalid connection ${name}.${key}`);
    if (!object(connection.settings)) fail('/profile', `invalid connection ${name}.settings`);
    const contract = canonicalJson(connection);
    if (resources.has(connection.resource) && resources.get(connection.resource) !== contract) fail('/profile', `conflicting aliases for physical resource ${connection.resource}`);
    resources.set(connection.resource, contract);
  }
  const connectionAt = (name, path) => {
    if (typeof name !== 'string' || !name.startsWith('board.') || !Object.hasOwn(board.connections, name.slice(6))) fail(path, `unknown board connection ${name}`);
    return board.connections[name.slice(6)];
  };
  for (const [protocol, name] of Object.entries(board.defaults)) {
    if (connectionAt(name, '/profile').protocol !== protocol) fail('/profile', `default ${name} does not provide protocol ${protocol}`);
  }
  const devices = {}, addresses = new Map();
  for (const [name, request] of Object.entries(plan.request.devices)) {
    const path = `/devices/${name}`, at = `${path}/profile`;
    const profile = lookup(request.profile, 'device', at);
    fields(profile, ['kind', 'extends', 'module', 'requires', 'parameters', 'channels', 'addressParameter'], ['kind', 'module', 'requires', 'parameters', 'channels'], fail, at);
    fields(profile.module, ['id', 'revision', 'sha256'], ['id', 'revision', 'sha256'], fail, at);
    if (typeof profile.module.id !== 'string' || typeof profile.module.revision !== 'string' || !validRef(`${profile.module.id}@${profile.module.revision}`) || !DIGEST.test(profile.module.sha256 ?? '')) fail(at, 'device module must have a fixed id, revision and sha256');
    fields(profile.requires, ['transport', 'protocol', 'settings'], ['transport', 'protocol', 'settings'], fail, at);
    for (const key of ['transport', 'protocol']) if (typeof profile.requires[key] !== 'string' || !profile.requires[key]) fail(at, `invalid requires.${key}`);
    if (!object(profile.requires.settings) || !object(profile.parameters)) fail(at, 'requires.settings and parameters must be objects');
    channelMap(profile.channels, at);
    const params = {}, origins = {};
    for (const key of Object.keys(request.params ?? {})) if (!Object.hasOwn(profile.parameters, key)) fail(`${path}/params/${key}`, `unknown parameter ${key} for ${request.profile}`);
    for (const [key, schema] of Object.entries(profile.parameters)) {
      if (!validName(key)) fail(at, `invalid parameter name ${key}`);
      fields(schema, ['type', 'default', 'minimum', 'maximum', 'enum'], ['type'], fail, at);
      if (!['integer', 'number', 'string', 'boolean'].includes(schema.type)) fail(at, `unsupported parameter type ${schema.type}`);
      const check = (value, location) => {
        if (schema.type === 'integer' ? !Number.isSafeInteger(value) : schema.type === 'number' ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== schema.type) fail(location, `parameter ${key} requires ${schema.type}`);
        for (const bound of ['minimum', 'maximum']) if (Object.hasOwn(schema, bound) && (!['integer', 'number'].includes(schema.type) || !Number.isFinite(schema[bound]))) fail(at, `invalid ${bound} for ${key}`);
        if (schema.minimum > schema.maximum) fail(at, `invalid range for ${key}`);
        if (Object.hasOwn(schema, 'minimum') && value < schema.minimum || Object.hasOwn(schema, 'maximum') && value > schema.maximum) fail(location, `parameter ${key} outside allowed range`);
        if (Object.hasOwn(schema, 'enum')) {
          if (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.some(item => typeof item !== typeof value)) fail(at, `invalid enum for ${key}`);
          if (!schema.enum.includes(value)) fail(location, `parameter ${key} outside allowed enum`);
        }
      };
      if (Object.hasOwn(schema, 'default')) check(schema.default, at);
      const explicit = Object.hasOwn(request.params ?? {}, key);
      if (!explicit && !Object.hasOwn(schema, 'default')) fail(`${path}/params`, `missing required parameter ${key} for ${request.profile}`);
      const value = explicit ? request.params[key] : schema.default;
      check(value, explicit ? `${path}/params/${key}` : at);
      params[key] = value; origins[key] = explicit ? 'source' : 'profile';
    }
    const bus = request.bus ?? board.defaults[profile.requires.protocol];
    if (bus === undefined) fail(`${path}/bus`, `no explicit default connection for ${profile.requires.protocol}; select bus or define it in the board profile`);
    const connection = connectionAt(bus, `${path}/bus`);
    for (const key of ['transport', 'protocol']) if (connection[key] !== profile.requires[key]) fail(`${path}/bus`, `${bus} ${key} ${connection[key]} does not satisfy ${profile.requires[key]}`);
    for (const [key, specification] of Object.entries(profile.requires.settings)) {
      let value = specification;
      if (object(specification)) {
        fields(specification, ['param'], ['param'], fail, at);
        if (typeof specification.param !== 'string' || !Object.hasOwn(params, specification.param)) fail(at, `missing setting parameter ${specification.param}`);
        value = params[specification.param];
      }
      if (!Object.hasOwn(connection.settings, key) || canonicalJson(connection.settings[key]) !== canonicalJson(value)) fail(`${path}/bus`, `${bus} setting ${key} does not satisfy device requirement`);
    }
    if (Object.hasOwn(profile, 'addressParameter')) {
      const key = profile.addressParameter;
      if (typeof key !== 'string' || !Object.hasOwn(params, key) || !['integer', 'string'].includes(profile.parameters[key].type)) fail(at, 'addressParameter must name an integer or string parameter');
      const identity = canonicalJson([connection.resource, connection.protocol, params[key]]);
      if (addresses.has(identity)) fail(`${path}/params/${key}`, `duplicate address ${params[key]} on ${bus}; already used by ${addresses.get(identity)}`);
      addresses.set(identity, name);
    }
    devices[name] = { profile: request.profile, module: clone(profile.module), params, parameterOrigins: origins,
      bus, connection: clone(connection), channels: clone(profile.channels) };
  }
  const bindings = {}, targets = new Set();
  for (const [name, target] of Object.entries(plan.request.bindings)) {
    const [instance, channel] = target.split('.');
    const channels = instance === 'board' ? board.channels : devices[instance].channels;
    if (!Object.hasOwn(channels, channel)) fail(`/bindings/${name}`, `unknown channel ${target}; use the channel contract distributed with its profile`);
    if (targets.has(target)) fail(`/bindings/${name}`, `duplicate channel binding ${target}`);
    targets.add(target);
    bindings[name] = { instance, channel, ...clone(channels[channel]) };
  }
  return { format: 'GhostFlow/profile-resolution-v1', source: plan.source, locations: clone(plan.locations),
    profile: plan.request.profile, profiles: [...used].sort().map(ref => ({ ref, sha256: catalog.get(ref).sha256 })),
    connections: clone(board.connections), devices, bindings };
}

export function validateProfileBindings(plan, manifest) {
  const fail = diagnostics(plan);
  const control = manifest?.format === 'GhostFlow/control-policy-descriptor-v1' ? manifest.control : manifest;
  const ports = new Map([
    ...(control?.sensors ?? []).map(port => [port.name, { ...port, role: 'input' }]),
    ...(control?.outputs ?? []).map(port => [port.name, { ...port, role: 'output' }]),
  ]);
  for (const [name, binding] of Object.entries(plan.bindings)) {
    const port = ports.get(name), path = `/bindings/${name}`;
    if (!port) fail(path, `binding ${name} does not name a declared logical input or output`);
    if (binding.role !== port.role || binding.type !== port.type) fail(path, `binding ${name} requires ${port.role} ${port.type}, got ${binding.role} ${binding.type}`);
    if ((binding.unit ?? null) !== (port.canonicalUnit ?? null)) fail(path, `binding ${name} canonical unit mismatch: expected ${port.canonicalUnit ?? 'none'}`);
  }
  for (const name of ports.keys()) if (!Object.hasOwn(plan.bindings, name)) fail('/bindings', `missing binding for logical port ${name}`);
}
