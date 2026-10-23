import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { compileSource as browserCompile } from '../tools/browser-toolchain.mjs';
import { parseHardwareFrontMatter } from '../tools/hardware-frontmatter.mjs';
import { resolveHardwareProfiles, validateProfileBindings } from '../tools/hardware-profiles.mjs';
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
  assert.deepEqual(result.hardwarePlan.omit, []);
  assert.equal(result.hardwarePlan.bindings.one.channel, 'RO1');
});

// Synthetic contract shape; no customer source, firmware profile, or physical claim.
const twoValveCode = `control TwoValves {
  input modeA, modeB, dtMs: Number;
  input resetA, resetB: Bool;
  input button, aOpened, aClosed, bOpened, bClosed: Bool;
  output RO1, RO2, RO3, RO4, RO5, RO6, faultA, faultB, readyA, readyB, inputReady: Bool;
  state latchedA: Bool = false;
  state latchedB: Bool = false;
  let selectedModeA = case modeA { ok(value) => value; fault(_) => 3.0; };
  let selectedModeB = case modeB { ok(value) => value; fault(_) => 3.0; };
  let clearA = case resetA { ok(value) => value; fault(_) => false; };
  let clearB = case resetB { ok(value) => value; fault(_) => false; };
  let scanDelta = case dtMs { ok(value) => value; fault(_) => 0.0; };
  let aOpen = case aOpened { ok(value) => value; fault(_) => false; };
  let aClose = case aClosed { ok(value) => value; fault(_) => false; };
  let bOpen = case bOpened { ok(value) => value; fault(_) => false; };
  let bClose = case bClosed { ok(value) => value; fault(_) => false; };
  let pressed = case button { ok(value) => value; fault(_) => false; };
  latchedA' = if clearA then false else latchedA || (aOpen && aClose);
  latchedB' = if clearB then false else latchedB || (bOpen && bClose);
  RO1 <- pressed;
  RO2 <- !pressed;
  RO3 <- selectedModeA == 1.0 && !aOpen && !latchedA && scanDelta >= 0.0;
  RO4 <- selectedModeA == 2.0 && !aClose && !latchedA;
  RO5 <- selectedModeB == 1.0 && !bOpen && !latchedB;
  RO6 <- selectedModeB == 2.0 && !bClose && !latchedB;
  faultA <- latchedA;
  faultB <- latchedB;
  readyA <- !latchedA && !(aOpen && aClose);
  readyB <- !latchedB && !(bOpen && bClose);
  inputReady <- pressed;
}`;
const twoValveDefinitions = () => ({
  'two-valve-board@1': { kind: 'board', connections: {}, defaults: {}, channels: {
    ...Object.fromEntries(['button', 'aOpened', 'aClosed', 'bOpened', 'bClosed'].map(name => [name, { role: 'input', type: 'Bool' }])),
    ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`RO${index + 1}`, { role: 'output', type: 'Bool' }])),
  } },
});
const twoValveRequest = () => ({ profile: 'two-valve-board@1', bindings: {
  modeA: 'software:modeA', modeB: 'software:modeB', resetA: 'software:resetA', resetB: 'software:resetB',
  dtMs: 'host:scan-delta-ms', button: 'board.button', aOpened: 'board.aOpened', aClosed: 'board.aClosed',
  bOpened: 'board.bOpened', bClosed: 'board.bClosed',
  ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`RO${index + 1}`, `board.RO${index + 1}`])),
  faultA: 'observation:faultA', faultB: 'observation:faultB', readyA: 'observation:readyA',
  readyB: 'observation:readyB', inputReady: 'observation:inputReady',
} });

test('mixed two-valve provider plan preserves explicit selectors, physical records and executable bytes', async () => {
  const value = twoValveRequest(), profiles = catalog(twoValveDefinitions()), text = source(value, twoValveCode);
  const before = JSON.stringify(profiles);
  const options = { filename: 'two-valves.ghost.md', hardwareProfiles: profiles };
  const result = compileSourceSync(text, options), plan = result.hardwarePlan;
  assert.deepEqual(result.manifest.inputs, []);
  assert.deepEqual(result.manifest.sensors.map(port => port.name),
    ['modeA', 'modeB', 'dtMs', 'resetA', 'resetB', 'button', 'aOpened', 'aClosed', 'bOpened', 'bClosed']);
  assert.deepEqual(plan.bindings.modeA, { provider: 'software', endpoint: 'software:modeA', role: 'input' });
  assert.deepEqual(plan.bindings.dtMs, { provider: 'host', endpoint: 'host:scan-delta-ms', role: 'input' });
  assert.deepEqual(plan.bindings.faultA, { provider: 'observation', endpoint: 'observation:faultA', role: 'output' });
  assert.deepEqual(plan.bindings.aOpened, { instance: 'board', channel: 'aOpened', role: 'input', type: 'Bool' });
  assert.deepEqual(plan.bindings.RO1, { instance: 'board', channel: 'RO1', role: 'output', type: 'Bool' });
  assert.equal(plan.source.sha256, sha256Hex(text));
  assert.equal(result.sourceDocument.text, text);
  assert.equal(JSON.stringify(profiles), before);
  const plain = compileSourceSync(`\`\`\`ghost\n${twoValveCode}\n\`\`\`\n`);
  assert.deepEqual(result.bytes, plain.bytes);
  const browser = await browserCompile(text, options);
  assert.deepEqual(browser.hardwarePlan, plan);
  assert.deepEqual(browser.bytes, result.bytes);
});

for (const [name, mutate, pattern] of [
  ['missing scalar', r => { delete r.bindings.resetB; }, /missing binding for logical port resetB/],
  ['missing physical contact', r => { delete r.bindings.bClosed; }, /missing binding for logical port bClosed/],
  ['missing relay output', r => { delete r.bindings.RO6; }, /missing binding for logical port RO6/],
  ['unknown provider', r => { r.bindings.modeA = 'cloud:modeA'; }, /binding must/],
  ['malformed software', r => { r.bindings.modeA = 'software:'; }, /binding must/],
  ['software name mismatch', r => { r.bindings.modeA = 'software:other'; }, /must match logical input modeA/],
  ['software mapped to output', r => { r.bindings.RO1 = 'software:RO1'; }, /Bool or Number logical input/],
  ['host mapped to Bool', r => { r.bindings.resetA = 'host:scan-delta-ms'; r.bindings.dtMs = 'software:dtMs'; }, /Number logical input/],
  ['duplicate host', r => { r.bindings.modeA = 'host:scan-delta-ms'; }, /duplicate channel binding host:scan-delta-ms/],
  ['host malformed', r => { r.bindings.dtMs = 'host:clock'; }, /binding must/],
  ['observation name mismatch', r => { r.bindings.faultA = 'observation:other'; }, /must match logical output faultA/],
  ['observation mapped to input', r => { r.bindings.modeA = 'observation:modeA'; }, /Bool output/],
  ['physical mapping wrong type', r => { r.bindings.modeA = 'board.RO1'; r.bindings.RO1 = 'observation:RO1'; }, /requires input Number/],
  ['physical channel collision', r => { r.bindings.bOpened = 'board.aOpened'; }, /duplicate channel binding/],
  ['physical role mismatch', r => { r.bindings.faultA = 'board.aOpened'; r.bindings.aOpened = 'software:aOpened'; }, /requires output Bool/],
]) test(`mixed provider rejects ${name} at canonical source`, () => {
  const value = twoValveRequest(); mutate(value);
  const text = source(value, twoValveCode);
  assert.throws(() => compileSourceSync(text, { filename: 'two-valves.ghost.md', hardwareProfiles: catalog(twoValveDefinitions()) }), error => {
    assert.match(error.message, pattern);
    assert.equal(error.diagnosticCode, 'GF_HARDWARE');
    assert.equal(error.diagnosticEnvelope.source.sha256, sha256Hex(text));
    assert.ok(error.line >= 2 && error.line < text.split('\n').indexOf('# Intent') + 1);
    if (name === 'duplicate host') assert.equal(text.split('\n')[error.line - 1].slice(error.column - 1), 'host:scan-delta-ms');
    return true;
  });
});

test('virtual providers reject dimensioned ports and wrong output types from the compiler manifest', () => {
  const value = twoValveRequest(), text = source(value, twoValveCode);
  const options = { filename: 'two-valves.ghost.md', hardwareProfiles: catalog(twoValveDefinitions()) };
  const { hardwarePlan, manifest } = compileSourceSync(text, options);
  for (const [name, update, pattern] of [
    ['modeA', port => { port.type = 'Percent'; port.canonicalUnit = '%'; }, /dimensionless Bool or Number/],
    ['modeA', port => { port.canonicalUnit = 'A'; }, /dimensionless Bool or Number/],
    ['dtMs', port => { port.type = 'Duration'; port.canonicalUnit = 'ms'; }, /dimensionless Number/],
    ['dtMs', port => { port.canonicalUnit = 'ms'; }, /dimensionless Number/],
    ['faultA', port => { port.type = 'Number'; }, /Bool output/],
  ]) {
    const altered = structuredClone(manifest);
    const port = [...altered.sensors, ...altered.outputs].find(port => port.name === name);
    update(port);
    assert.throws(() => validateProfileBindings(hardwarePlan, altered), pattern);
  }
  assert.equal(manifest.sensors.find(port => port.name === 'modeA').type, 'Number');
  assert.equal(hardwarePlan.bindings.modeA.type, undefined);
});

test('existing scalar manifest inputs can use explicit software and host providers but not physical channels', () => {
  const value = twoValveRequest(), text = source(value, twoValveCode);
  const requestPlan = parseHardwareFrontMatter(text, { filename: 'two-valves.ghost.md' });
  const plan = resolveHardwareProfiles(requestPlan, catalog(twoValveDefinitions()));
  const manifest = structuredClone(compileSourceSync(`\`\`\`ghost\n${twoValveCode}\n\`\`\`\n`).manifest);
  const scalarNames = new Set(['modeA', 'modeB', 'dtMs', 'resetA', 'resetB']);
  manifest.inputs = manifest.sensors.filter(port => scalarNames.has(port.name)).map(({ name, type }) => ({ name, type }));
  manifest.sensors = manifest.sensors.filter(port => !scalarNames.has(port.name));
  validateProfileBindings(plan, manifest);
  const physical = structuredClone(plan);
  physical.bindings.modeA = { instance: 'board', channel: 'aOpened', role: 'input', type: 'Bool' };
  assert.throws(() => validateProfileBindings(physical, manifest), /physical channel cannot bind scalar input modeA/);
});

test('omit rejects bindings to omitted board input or output providers', () => {
  const defs = definitions();
  defs['example-board@1'].channels.IN1 = { role: 'input', type: 'Bool' };
  for (const [selector, channel, role] of [
    ['board.inputs', 'IN1', 'input'],
    ['board.outputs', 'RO1', 'output'],
  ]) {
    const value = { profile: 'example-board@1', omit: [selector], bindings: { port: `board.${channel}` } };
    assert.throws(() => compile(value, defs, `control Onboard { ${role} port: Bool; }`), /binding targets omitted board provider/);
  }
});

test('documented RS485 input and 8-channel relay example resolves addresses 1, 2, 3 and all outputs', async () => {
  const text = readFileSync(new URL('../examples/hardware/rs485-current-relay.ghost.md', import.meta.url), 'utf8');
  const defs = definitions();
  const board = structuredClone(defs['example-board@1']);
  board.connections.rs485.settings = { baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 };
  const relay = {
    kind: 'device', module: { ...pin, id: 'example-rs485-relay-8ch', sha256: 'b'.repeat(64) },
    requires: { transport: 'rs485', protocol: 'modbus-rtu', settings: { baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 } },
    parameters: { address: { type: 'integer', minimum: 1, maximum: 247 } },
    addressParameter: 'address',
    channels: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`RO${index + 1}`, { role: 'output', type: 'Bool' }])),
  };
  const profiles = catalog({ 'ess3h32@1': board, 'jsy-mk-333@1': defs['example-meter@1'], 'ryr408b@1': relay });
  const options = { filename: 'rs485-current-relay.ghost.md', hardwareProfiles: profiles };
  const result = compileSourceSync(text, options), plan = result.hardwarePlan;
  assert.deepEqual(Object.values(plan.devices).map(d => d.params.address), [1, 2, 3]);
  assert.equal(new Set(Object.values(plan.devices).map(d => d.connection.resource)).size, 1);
  assert.equal(plan.devices.relay.connection.settings.baudRate, 9600);
  assert.notEqual(plan.devices.relay.module.id, plan.devices.meter1.module.id);
  assert.deepEqual(result.manifest.outputs.map(p => p.name), ['motor1Run', 'motor2Run', ...Array.from({ length: 6 }, (_, index) => `auxiliary${index + 3}`)]);
  assert.deepEqual(Object.values(plan.bindings).filter(b => b.role === 'output').map(b => [b.instance, b.channel, b.type]),
    Array.from({ length: 8 }, (_, index) => ['relay', `RO${index + 1}`, 'Bool']));
  assert.equal(result.sourceDocument.text, text);
  assert.deepEqual((await browserCompile(text, options)).hardwarePlan, plan);
  assert.throws(() => compileSourceSync(text.replace('address: 3', 'address: 1'), options), /duplicate address 1/);
  assert.throws(() => compileSourceSync(text.replace('relay.RO8', 'relay.RO9'), options), /unknown channel relay.RO9/);
  const wrong = structuredClone(profiles);
  wrong[2].definition.requires.settings.baudRate = 19200;
  wrong[2].sha256 = sha256Hex(canonicalJson(wrong[2].definition));
  assert.throws(() => compileSourceSync(text, { ...options, hardwareProfiles: wrong }), /setting baudRate/);
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
  ['non-array omit', r => { r.omit = 'board.inputs'; }, /omit must be an array/],
  ['unknown omit selector', r => { r.omit = ['board.relays']; }, /omit supports only board\.inputs and board\.outputs/],
  ['duplicate omit selector', r => { r.omit = ['board.outputs', 'board.outputs']; }, /duplicate omission board\.outputs/],
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
