import { parseDocument, isMap, isSeq, isScalar, isAlias, LineCounter } from 'yaml';
import { isWellFormedUnicode, sha256Hex, utf8ByteLength } from './sha256.mjs';

const SCHEMA = 'GhostFlow/hardware-v1';
const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/;
const PIN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const pointer = (path, key) => `${path}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;

export class HardwareFrontMatterError extends Error {
  constructor(source, location, message) {
    super(`${source.filename}:${location.line}:${location.column}: ${message}`);
    this.name = 'HardwareFrontMatterError';
    Object.assign(this, location, { filename: source.filename, diagnosticCode: 'GF_HARDWARE' });
    this.diagnosticEnvelope = { format: 'GhostFlow/diagnostics-v1', source, diagnostics: [{
      code: 'GF_HARDWARE', severity: 'error', message,
      span: { file: source.filename, start: { line: location.line, column: location.column } },
    }] };
  }
}

/** A source-bound declaration plan; no driver code, provider defaults or hardware effects. */
export function parseHardwareFrontMatter(source, { filename = 'program.ghost.md' } = {}) {
  if (!isWellFormedUnicode(source) || utf8ByteLength(source) > 1024 * 1024) throw new TypeError('hardware source must be well-formed UTF-8 within 1 MiB');
  if (!isWellFormedUnicode(filename) || !filename || filename.includes('\0')) throw new TypeError('invalid hardware source filename');
  const lines = source.split(/\r\n|\r|\n/);
  if (lines[0] !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'));
  // The literate extractor owns unclosed ordinary front matter diagnostics.
  if (end < 0) return null;
  const text = lines.slice(1, end).join('\n');
  const counter = new LineCounter();
  const document = parseDocument(text, { lineCounter: counter, uniqueKeys: true, strict: true, version: '1.2' });
  // Ordinary historical front matter remains non-executable prose, even when not YAML.
  if (!isMap(document.contents) || !document.contents.items.some(pair => isScalar(pair.key) && pair.key.value === 'hardware')) return null;
  const identity = { filename, sha256: sha256Hex(source) };
  const locations = {};
  const locate = node => {
    const start = counter.linePos(node?.range?.[0] ?? 0);
    const finish = counter.linePos(node?.range?.[1] ?? node?.range?.[0] ?? 0);
    return { filename, line: start.line + 1, column: start.col, endLine: finish.line + 1, endColumn: finish.col };
  };
  const fail = (node, message) => { throw new HardwareFrontMatterError(identity, locate(node), message); };
  if (document.errors.length || document.warnings.length) {
    const error = document.errors[0] ?? document.warnings[0];
    fail({ range: error.pos }, `invalid hardware YAML: ${error.message}`);
  }
  let count = 0;
  const data = (node, path = '', depth = 0) => {
    if (++count > 20_000 || depth > 64) fail(node, 'hardware YAML structure limit exceeded');
    locations[path] = locate(node);
    if (!node) return null;
    if (isAlias(node) || node.anchor || node.tag) fail(node, 'YAML aliases, anchors and explicit tags are not supported');
    if (isMap(node)) {
      const out = {};
      for (const pair of node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || pair.key.tag || pair.key.anchor) fail(pair.key, 'YAML mapping keys must be plain strings');
        const key = pair.key.value;
        if (['<<', '__proto__', 'constructor', 'prototype'].includes(key)) fail(pair.key, `unsupported YAML key ${key}`);
        if (Object.hasOwn(out, key)) fail(pair.key, `duplicate YAML key ${key}`);
        out[key] = data(pair.value, pointer(path, key), depth + 1);
      }
      return out;
    }
    if (isSeq(node)) return node.items.map((item, index) => data(item, pointer(path, index), depth + 1));
    if (!isScalar(node) || !['string', 'number', 'boolean'].includes(typeof node.value) && node.value !== null
      || typeof node.value === 'number' && !Number.isFinite(node.value)) fail(node, 'hardware YAML values must be JSON-compatible data');
    return node.value;
  };
  const root = data(document.contents);
  const at = path => locations[path] ?? locations['/hardware'];
  const invalid = (path, message) => { throw new HardwareFrontMatterError(identity, at(path), message); };
  const object = (value, path, keys, required = keys) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, `${path} must be an object`);
    for (const key of Object.keys(value)) if (!keys.includes(key)) invalid(pointer(path, key), `unknown hardware field ${key}`);
    for (const key of required) if (!Object.hasOwn(value, key)) invalid(path, `missing hardware field ${key}`);
  };
  const string = (value, path, pattern = PIN) => { if (typeof value !== 'string' || !pattern.test(value)) invalid(path, `invalid hardware string at ${path}`); };
  const pin = (value, path) => {
    object(value, path, ['id', 'revision', 'sha256']);
    string(value.id, `${path}/id`); string(value.revision, `${path}/revision`);
    if (value.revision === 'latest') invalid(`${path}/revision`, 'hardware revision must be pinned, never latest');
    string(value.sha256, `${path}/sha256`, DIGEST);
  };
  const record = (value, path, check) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, `${path} must be a named object`);
    for (const [key, item] of Object.entries(value)) { string(key, path, NAME); check(item, pointer(path, key)); }
  };
  const config = (value, path) => { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, `${path} must be an object; provider schema validation is required at deployment`); };
  const hardware = root.hardware;
  object(hardware, '/hardware', ['schema', 'profile', 'modules', 'buses', 'instances', 'bindings']);
  if (hardware.schema !== SCHEMA) invalid('/hardware/schema', `hardware schema must be ${SCHEMA}`);
  pin(hardware.profile, '/hardware/profile');
  record(hardware.modules, '/hardware/modules', pin);
  record(hardware.buses, '/hardware/buses', (bus, path) => {
    object(bus, path, ['service', 'config']); string(bus.service, `${path}/service`); config(bus.config, `${path}/config`);
  });
  record(hardware.instances, '/hardware/instances', (instance, path) => {
    object(instance, path, ['module', 'role', 'config']); string(instance.module, `${path}/module`, NAME);
    if (!Object.hasOwn(hardware.modules, instance.module)) invalid(`${path}/module`, `missing hardware module ${instance.module}`);
    if (!['input', 'output'].includes(instance.role)) invalid(`${path}/role`, 'hardware role must be input or output');
    config(instance.config, `${path}/config`);
  });
  object(hardware.bindings, '/hardware/bindings', ['inputs', 'outputs']);
  for (const [group, role] of [['inputs', 'input'], ['outputs', 'output']]) {
    const channels = new Set();
    record(hardware.bindings[group], `/hardware/bindings/${group}`, (binding, path) => {
      object(binding, path, ['instance', 'channel']); string(binding.instance, `${path}/instance`, NAME); string(binding.channel, `${path}/channel`);
      const instance = hardware.instances[binding.instance];
      if (!instance) invalid(`${path}/instance`, `missing hardware instance ${binding.instance}`);
      if (instance.role !== role) invalid(`${path}/instance`, `hardware binding requires ${role} instance`);
      const channel = JSON.stringify([binding.instance, binding.channel]);
      if (channels.has(channel)) invalid(path, 'duplicate hardware instance/channel binding');
      channels.add(channel);
    });
  }
  return { format: 'GhostFlow/hardware-plan-v1', source: identity, hardware, locations };
}

/** Validate declared bindings against compiler-authored logical ports, never guessed types. */
export function validateHardwareBindings(plan, manifest) {
  if (!plan) return;
  const control = manifest?.format === 'GhostFlow/control-policy-descriptor-v1' ? manifest.control : manifest;
  const inputs = new Set((control?.sensors ?? []).map(input => input.name));
  const outputs = new Set((control?.outputs ?? []).map(output => output.name));
  for (const [group, ports] of [['inputs', inputs], ['outputs', outputs]]) {
    for (const name of Object.keys(plan.hardware.bindings[group])) if (!ports.has(name)) {
      throw new HardwareFrontMatterError(plan.source, plan.locations[pointer(`/hardware/bindings/${group}`, name)],
        `hardware ${group} binding ${name} does not name a declared logical ${group === 'inputs' ? 'input' : 'output'}`);
    }
  }
}
