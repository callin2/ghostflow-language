import assert from 'node:assert/strict';
import test from 'node:test';
import { stringify } from 'yaml';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { compileSource as browserCompile } from '../tools/browser-toolchain.mjs';
import { parseHardwareFrontMatter } from '../tools/hardware-frontmatter.mjs';
import { resolveHardwareProfiles } from '../tools/hardware-profiles.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { sha256Hex } from '../tools/sha256.mjs';

// Contract fixtures, not published board identities or deployable driver binaries.
const pin = { id: 'example-current', revision: '1', sha256: 'a'.repeat(64) };
const channel = { role: 'input', type: 'ElectricalCurrent', unit: 'A' };
const definitions = () => ({
  'example-board@1': {
    kind: 'board',
    connections: { rs485: { resource: 'uart0-transceiver', transport: 'rs485', protocol: 'modbus-rtu', settings: { baudRate: 9600, parity: 'none' } } },
    defaults: { 'modbus-rtu': 'board.rs485' },
    channels: { RO1: { role: 'output', type: 'Bool' }, RO2: { role: 'output', type: 'Bool' } },
  },
  'example-meter@1': {
    kind: 'device', module: pin,
    requires: { transport: 'rs485', protocol: 'modbus-rtu', settings: { baudRate: { param: 'baudRate' }, parity: 'none' } },
    parameters: {
      address: { type: 'integer', default: 1, minimum: 1, maximum: 247 },
      baudRate: { type: 'integer', default: 9600, enum: [9600, 19200] },
      gain: { type: 'number', default: 1, minimum: 0.1 },
      label: { type: 'string', default: 'A' },
      enabled: { type: 'boolean', default: true },
    },
    addressParameter: 'address', channels: { currentA: channel, currentB: channel, currentC: channel },
  },
});
const catalog = (defs = definitions()) => Object.entries(defs).map(([ref, definition]) => ({ ref, definition, sha256: sha256Hex(canonicalJson(definition)) }));
const request = () => ({
  profile: 'example-board@1',
  devices: { meter1: { profile: 'example-meter@1' }, meter2: { profile: 'example-meter@1', params: { address: 2 } } },
  bindings: { a: 'meter1.currentA', b: 'meter2.currentA', one: 'board.RO1', two: 'board.RO2' },
});
const code = 'control Motors { input a, b: ElectricalCurrent; output one, two: Bool; one <- (a |> recover(0A)) >= 100mA; two <- (b |> recover(0A)) >= 0.1A; }';
const source = (value = request(), body = code) => `---\n${stringify(value)}---\n# Intent\nRun each motor when its measured current reaches 0.1 A.\n\n\`\`\`ghost\n${body}\n\`\`\`\n`;
const compile = (value = request(), defs = definitions(), body = code) => compileSourceSync(source(value, body), { filename: 'motors.ghost.md', hardwareProfiles: catalog(defs) });

test('compact two-device source resolves defaults, overrides, shared resource and exact profile identities', async () => {
  const text = source(), profiles = catalog(), before = JSON.stringify(profiles);
  const result = compileSourceSync(text, { filename: 'motors.ghost.md', hardwareProfiles: profiles });
  const plan = result.hardwarePlan;
  assert.equal(plan.format, 'GhostFlow/profile-resolution-v1');
  assert.equal(plan.devices.meter1.params.address, 1);
  assert.equal(plan.devices.meter2.params.address, 2);
  assert.equal(plan.devices.meter1.parameterOrigins.address, 'profile');
  assert.equal(plan.devices.meter2.parameterOrigins.address, 'source');
  assert.equal(plan.devices.meter1.connection.resource, plan.devices.meter2.connection.resource);
  assert.equal(plan.devices.meter1.connection.transport, 'rs485');
  assert.equal(plan.bindings.a.unit, 'A');
  assert.deepEqual(plan.profiles, profiles.map(({ ref, sha256 }) => ({ ref, sha256 })));
  assert.equal(JSON.stringify(profiles), before);
  assert.equal(result.sourceDocument.text, text);
  assert.equal(plan.source.sha256, sha256Hex(text));
  const plain = compileSourceSync(`\`\`\`ghost\n${code}\n\`\`\`\n`);
  assert.deepEqual(result.bytes, plain.bytes);
  const browser = await browserCompile(text, { filename: 'motors.ghost.md', hardwareProfiles: profiles });
  assert.deepEqual(browser.hardwarePlan, plan);
  assert.deepEqual(browser.bytes, result.bytes);
  plan.devices.meter1.params.address = 10;
  assert.equal(plan.devices.meter2.params.address, 2);
  assert.equal(profiles[1].definition.parameters.address.default, 1);
});

test('onboard-only program needs just profile and bindings', () => {
  const result = compile({ profile: 'example-board@1', bindings: { one: 'board.RO1' } }, definitions(), 'control Onboard { output one: Bool; one <- false; }');
  assert.deepEqual(result.hardwarePlan.devices, {});
  assert.equal(result.hardwarePlan.profiles.length, 1);
});

test('fixed profile inheritance preserves unspecified defaults and records parent digests', () => {
  const defs = definitions();
  defs['installation@1'] = { kind: 'board', extends: 'example-board@1', channels: { RO3: { role: 'output', type: 'Bool' } } };
  defs['calibrated@2'] = { kind: 'device', extends: 'example-meter@1', parameters: { gain: { default: 1.25 } } };
  const value = request(); value.profile = 'installation@1'; value.devices.meter1.profile = 'calibrated@2';
  const plan = compile(value, defs).hardwarePlan;
  assert.equal(plan.devices.meter1.params.gain, 1.25);
  assert.equal(plan.devices.meter1.params.address, 1);
  assert.deepEqual(plan.profiles.map(p => p.ref), ['calibrated@2', 'example-board@1', 'example-meter@1', 'installation@1']);
});

for (const [name, mutate, pattern] of [
  ['implicit duplicate addresses', r => { delete r.devices.meter2.params; }, /duplicate address 1/],
  ['out-of-range address', r => { r.devices.meter2.params.address = 248; }, /outside allowed range/],
  ['fractional address', r => { r.devices.meter2.params.address = 1.5; }, /requires integer/],
  ['wrong parameter type', r => { r.devices.meter2.params.address = '2'; }, /requires integer/],
  ['unknown generic parameter', r => { r.devices.meter2.params.adress = 2; }, /unknown parameter adress/],
  ['baud conflict', r => { r.devices.meter2.params.baudRate = 19200; }, /setting baudRate/],
  ['unknown instance', r => { r.bindings.a = 'missing.currentA'; }, /unknown device/],
  ['unknown channel', r => { r.bindings.a = 'meter1.ampere'; }, /unknown channel/],
  ['duplicate channel', r => { r.bindings.b = 'meter1.currentA'; }, /duplicate channel/],
  ['missing logical binding', r => { delete r.bindings.b; }, /missing binding/],
  ['undeclared logical port', r => { r.bindings.extra = 'meter1.currentB'; }, /declared logical/],
  ['unknown device field', r => { r.devices.meter1.baude = 9600; }, /unknown field/],
  ['reserved board device', r => { r.devices.board = { ...r.devices.meter1 }; }, /reserved device/],
  ['unknown root field', r => { r.device = {}; }, /unknown compact front matter field/],
  ['null devices', r => { r.devices = null; }, /devices must/],
  ['floating revision', r => { r.devices.meter1.profile = 'example-meter@latest'; }, /fixed id@revision/],
  ['missing profile', r => { delete r.profile; }, /fixed id@revision/],
  ['missing bindings', r => { delete r.bindings; }, /bindings must/],
  ['unknown bus', r => { r.devices.meter1.bus = 'board.missing'; }, /unknown board connection/],
  ['mixed legacy and compact', r => { r.hardware = {}; }, /cannot combine/],
]) test(`rejects ${name} with canonical source location`, () => {
  const value = request(); mutate(value); const text = source(value);
  assert.throws(() => compile(value), error => {
    assert.match(error.message, pattern);
    assert.equal(error.diagnosticCode, 'GF_HARDWARE');
    assert.equal(error.diagnosticEnvelope.source.sha256, sha256Hex(text));
    assert.ok(error.line >= 2 && error.line < text.split('\n').indexOf('# Intent') + 1);
    return true;
  });
});

for (const [name, mutate, pattern] of [
  ['no default despite one available bus', d => { d['example-board@1'].defaults = {}; }, /no explicit default/],
  ['no RS485 transport', d => { d['example-board@1'].connections.rs485.transport = 'uart'; }, /transport uart/],
  ['wrong protocol', d => { d['example-meter@1'].requires.protocol = 'other'; }, /no explicit default/],
  ['different parity', d => { d['example-board@1'].connections.rs485.settings.parity = 'even'; }, /setting parity/],
  ['required parameter has no default', d => { delete d['example-meter@1'].parameters.gain.default; }, /missing required parameter gain/],
  ['invalid default', d => { d['example-meter@1'].parameters.address.default = 0; }, /outside allowed range/],
  ['wrong channel role', d => { d['example-meter@1'].channels.currentA = { ...channel, role: 'output' }; }, /requires input/],
  ['wrong channel type', d => { d['example-meter@1'].channels.currentA = { ...channel, type: 'Number' }; }, /requires input ElectricalCurrent/],
  ['wrong canonical unit', d => { d['example-meter@1'].channels.currentA = { ...channel, unit: 'mA' }; }, /canonical unit mismatch/],
  ['missing module pin', d => { delete d['example-meter@1'].module; }, /missing field module/],
  ['missing parent', d => { d['example-meter@1'].extends = 'missing@1'; }, /missing device profile/],
  ['inheritance kind change', d => { d['example-meter@1'].extends = 'example-board@1'; }, /requires kind device/],
  ['inheritance cycle', d => { d['example-meter@1'].extends = 'example-meter@1'; }, /inheritance cycle/],
]) test(`rejects provider ${name}`, () => {
  const defs = definitions(); mutate(defs);
  assert.throws(() => compile(request(), defs), pattern);
});

test('explicit bus selection works without a default, aliases cannot bypass address conflict', () => {
  const defs = definitions(), value = request();
  defs['example-board@1'].defaults = {};
  value.devices.meter1.bus = value.devices.meter2.bus = 'board.rs485';
  assert.equal(compile(value, defs).hardwarePlan.devices.meter1.bus, 'board.rs485');
  defs['example-board@1'].connections.alias = structuredClone(defs['example-board@1'].connections.rs485);
  value.devices.meter2.bus = 'board.alias'; value.devices.meter2.params.address = 1;
  assert.throws(() => compile(value, defs), /duplicate address/);
  defs['example-board@1'].connections.alias.settings.baudRate = 19200;
  assert.throws(() => compile(value, defs), /conflicting aliases/);
});

test('profile closure must be supplied, pinned, authentic to its digest and structurally bounded', () => {
  const text = source(), plan = parseHardwareFrontMatter(text);
  assert.throws(() => compileSourceSync(text), /supply hardwareProfiles/);
  const profiles = catalog(); profiles[0].definition.defaults = {};
  assert.throws(() => resolveHardwareProfiles(plan, profiles), /digest mismatch/);
  assert.throws(() => resolveHardwareProfiles(plan, [...catalog(), catalog()[0]]), /duplicate profile/);
  assert.throws(() => resolveHardwareProfiles(plan, Array(129).fill(catalog()[0])), /1..128/);
  const defs = definitions(); defs['example-board@1'].channels = JSON.parse('{"__proto__": {"role":"output","type":"Bool"}}');
  assert.throws(() => resolveHardwareProfiles(plan, catalog(defs)), /unsupported profile key/);
});

test('YAML protections and exact override locations apply to compact syntax', () => {
  for (const replacement of ['&a 2', '*a', '!!int 2', '.inf']) {
    assert.throws(() => parseHardwareFrontMatter(source().replace('address: 2', `address: ${replacement}`)), /YAML|JSON-compatible/);
  }
  const value = request(); value.devices.meter2.params.address = 999;
  const text = source(value);
  assert.throws(() => compile(value), error => {
    assert.equal(text.split('\n')[error.line - 1].slice(error.column - 1), '999');
    return true;
  });
  assert.equal(parseHardwareFrontMatter(source().replaceAll('\n', '\r\n')).source.sha256, sha256Hex(source().replaceAll('\n', '\r\n')));
});
