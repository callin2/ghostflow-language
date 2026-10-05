import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPortablePackage, serializePortablePackage } from '../tools/portable-package.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import { QUANTITY_TYPES, QUANTITY_UNITS } from '../tools/quantities.mjs';

// This new fixture revision explicitly chooses zero on acquisition fault; legacy payload snapshots remain fixed.
const quantityZero = type => '0' + QUANTITY_UNITS.find(unit => unit.type === type).suffix;
const root = fileURLToPath(new URL('../', import.meta.url));
const encoder = new TextEncoder();

function hexBytes(value) {
  return Uint8Array.from(value.match(/../g), byte => Number.parseInt(byte, 16));
}

function concat(...parts) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

const privateDer = concat(
  hexBytes('302e020100300506032b657004220420'),
  hexBytes('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'),
);
const privateKey = await crypto.subtle.importKey('pkcs8', privateDer, 'Ed25519', false, ['sign']);
const identity = {
  compilerRevision: 'c0bef0e',
  runtimeSemantics: 'GhostFlow/runtime-semantics-v1',
  runtimeAbi: 'GhostFlow/framed-scan-abi-v1',
  requiredCapabilities: [
    { kind: 'actuator', name: 'pump', type: 'bool' },
    { kind: 'actuator', name: 'valve', type: 'bool' },
    { kind: 'sensor', name: 'start', type: 'bool' },
    { kind: 'sensor', name: 'stop', type: 'bool' },
  ],
  bindingRevision: 'virtual-two-output-v1',
};
const scenario = process.argv[2] ?? 'valid';
const adaptScenario=scenario.startsWith('adapt-');
const quantityScenario = scenario.startsWith('quantity-');
const timeScenario = scenario.startsWith('time-');
const resultScenario = scenario.startsWith('result-');
const debounceScenario = scenario.startsWith('debounce-');
const holdScenario = scenario.startsWith('hold-');
const intSettingsScenario = scenario.startsWith('int-settings-');
const windowScenario = scenario.startsWith('window-');
const gfb10Scenario = scenario.startsWith('gfb10-');
if (gfb10Scenario) {
  const pinned = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/gfb10-periodic-package-payload.json'), 'utf8'));
  const candidate = { format: 'GhostFlow/portable-package-v1', payload: pinned.payload };
  if (scenario !== 'gfb10-valid') {
    const manifest = JSON.parse(Buffer.from(candidate.payload.manifest.contentBase64, 'base64').toString('utf8'));
    if (scenario === 'gfb10-periodic-anchor') manifest.schedules[0].anchor.instantMs += 1;
    else if (scenario === 'gfb10-periodic-policy-missing') delete manifest.schedules[0].policy.clock;
    else throw new Error(`unknown GFB10 scenario: ${scenario}`);
    const bytes = encoder.encode(canonicalJson(manifest));
    candidate.payload.manifest.contentBase64 = Buffer.from(bytes).toString('base64');
    candidate.payload.manifest.sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  }
  const payloadBytes = encoder.encode(canonicalJson(candidate.payload));
  candidate.payloadSha256 = Buffer.from(await crypto.subtle.digest('SHA-256', payloadBytes)).toString('hex');
  candidate.signatures = [{
    algorithm: 'Ed25519', keyId: 'test-current-2026',
    signatureBase64: Buffer.from(await crypto.subtle.sign('Ed25519', privateKey, payloadBytes)).toString('base64'),
  }];
  process.stdout.write(serializePortablePackage(candidate));
  process.exit(0);
}
const configTimerScenario = scenario === 'config-timer-valid';
if (intSettingsScenario || timeScenario || quantityScenario || configTimerScenario) identity.runtimeAbi = 'GhostFlow/context-scan-abi-v5';
if (configTimerScenario) identity.requiredCapabilities = [
  { kind: 'actuator', name: 'pump', type: 'bool' },
  { kind: 'sensor', name: 'start', type: 'bool' },
];
const windowSource = `control WindowPackage {
  fn above(value: Temperature) -> Bool { value > 280K }
  input probe: Temperature;
  signal average = window_average(probe, over: 1s, quality: measured, max_age: 500ms);
  signal minimum = window_min(probe, over: 1s, quality: measured, max_age: 500ms);
  signal maximum = window_max(probe, over: 1s, quality: measured, max_age: 500ms);
  signal rate = window_rate(probe, over: 1s, quality: measured, max_age: 500ms);
  output pump: Bool;
  pump <- average |> map(above) |> recover(false);
}`;
const intSettingsSource = intSettingsScenario ? `control IntSettingsPackage {
  config minimum: Int = -2147483648 { min = -2147483648; max = 2147483647; step = 1; access = operator; }
  config maximum: Int = 2147483647 { min = -2147483648; max = 2147483647; step = 1; access = operator; }
  config wide: Int = 2147483646 { min = -2147483648; max = 2147483646; step = 2147483647; access = operator; }
  config exact: Int = 0 { min = 0; max = 2147483647; step = 2147483647; access = operator; }
  config plain: Int = 0;
  output count: Int;
  count <- case wide { ok(value) => value; fault(_) => 0; };
}` : null;
const holdSource = scenario.startsWith('hold-basic-') ? `control HoldPackage {
  input probe: Number;
  input backup: Number;
  input start: Bool;
  signal measured = hold_last(if (start |> recover(false)) then probe else backup, for_at_most: 2s, quality: measured);
  output measuredResult, finiteResult, booleanResult, integerResult: Bool;
  measuredResult <- true; finiteResult <- true; booleanResult <- true; integerResult <- true;
}` : holdScenario ? `control HoldPackage {
  type Mode = Off | On;
  fn mode(value: Number) -> Mode { if value > 0.0 then On else Off }
  fn hot(value: Number) -> Bool { value > 0.0 }
  fn count(value: Number) -> Int { int_trunc(value) }
  input probe: Number;
  input backup: Number;
  input start: Bool;
  let selected = if (start |> recover(false)) then probe else backup;
  signal measured = hold_last(selected, for_at_most: 2s, quality: measured);
  signal finite = hold_last(probe |> map(mode), for_at_most: 2s, quality: measured);
  signal boolean = hold_last(probe |> map(hot), for_at_most: 2s, quality: measured);
  signal integer = hold_last(probe |> map(count), for_at_most: 2s, quality: measured);
  output measuredResult, finiteResult, booleanResult, integerResult: Bool;
  measuredResult <- case measured { ok(value) => value > 0.0; fault(_) => false; };
  finiteResult <- case finite { ok(value) => value == On; fault(_) => false; };
  booleanResult <- case boolean { ok(value) => value; fault(_) => false; };
  integerResult <- case integer { ok(value) => value > 0; fault(_) => false; };
}` : null;
const debounceSource = debounceScenario ? `control DebouncePackage {
  type Mode = Off | On;
  fn mode(value: Bool) -> Mode { if value then On else Off }
  input probe: Bool;
  input backup: Bool;
  input start: Bool;
  let desired = if (start |> recover(false)) then On else Off;
  signal raw = debounce(start |> recover(false), stable_for: 2s, initial: false);
  signal finite = debounce(desired, stable_for: 2s, initial: Off);
  signal measured = debounce((if (start |> recover(false)) then probe else backup) |> map(mode), stable_for: 2s, initial: Off);
  output rawResult, finiteResult, measuredResult: Bool;
  rawResult <- raw;
  finiteResult <- finite == On;
  measuredResult <- case measured { ok(value) => value == On; fault(_) => false; };
}` : null;
const resultSource = resultScenario ? `control SensorResult {
  input probe: Percent;
  signal stable = hysteresis(probe, on_below: 30%, off_above: 40%, initial: false);
  output dry, held: Bool;
  dry <- case probe { ok(value) => value < 30%; fault(_) => false; };
  held <- case stable { ok(value) => value; fault(_) => false; };
}` : null;
const timeTypes = ['Date', 'TimeOfDay', 'DateTime'];
const timeSource = timeScenario ? `control Times {
  ${timeTypes.map((type, index) => `input input_${index}: ${type}; output output_${index}: ${type}; output_${index} <- input_${index} |> recover(${type === 'Date' ? 'date`1970-01-01`' : type === 'TimeOfDay' ? 'time`00:00:00`' : 'datetime`1970-01-01T00:00:00Z`'});`).join('\n')}
  config firstDate: Date = date\`1970-01-01\` { min = date\`1970-01-01\`; max = date\`9999-12-31\`; step = 1; access = operator; label = "Date"; }
  config lastDate: Date = date\`9999-12-31\`;
  config firstTime: TimeOfDay = time\`00:00:00\` { min = time\`00:00:00\`; max = time\`23:59:59.999\`; step = 1ms; access = operator; label = "Time"; }
  config lastTime: TimeOfDay = time\`23:59:59.999\`;
  config firstInstant: DateTime = datetime\`1970-01-01T00:00:00Z\` { min = datetime\`1970-01-01T00:00:00Z\`; max = datetime\`9999-12-31T23:59:59.999Z\`; step = 1ms; access = operator; label = "Instant"; }
  config lastInstant: DateTime = datetime\`9999-12-31T23:59:59.999Z\`;
}` : null;
const quantitySource = quantityScenario ? `control Quantities {
  ${QUANTITY_TYPES.map((type, index) => `input input_${index}: ${type}; output output_${index}: ${type}; output_${index} <- case input_${index} { ok(value) => value; fault(_) => ${quantityZero(type)}; };`).join('\n')}
  input enabled: Bool;
  input probe: Temperature;
  config threshold: Temperature = 25°C;
  config plain: Number = 1.0;
}` : null;
// Codec-only fixtures use authored healthy constants; acquisition uses Result-bearing profile 4.
// The previous source revision is retained in fixtures/history/package-before-input-531.json.
const profileSource = {
  'profile-1': 'control Compact { let start = true; let stop = false; output pump, valve: Bool; pump <- start; valve <- start; }',
  'profile-2': 'control Integer { let start = true; let stop = false; state count: Int = 7; output pump: Int; output valve: Bool; pump <- count; valve <- start; }',
  'profile-3': 'control IntegerBranch { let start = true; let stop = false; state count: Int = 7; output pump: Int; output valve: Bool; pump <- if start then count else 0; valve <- start; }',
}[scenario];
let source = configTimerScenario
  ? fs.readFileSync(path.join(root, 'examples/authoring/corpus/setting-corrected.ghost.md'), 'utf8')
  : (profileSource || quantitySource || timeSource || resultSource || debounceSource || holdSource || intSettingsSource || windowScenario) ? `# Package profile\n\n\`\`\`ghost\n${profileSource || quantitySource || timeSource || resultSource || debounceSource || holdSource || intSettingsSource || windowSource}\n\`\`\`\n`
  : fs.readFileSync(path.join(root, 'examples/tutorial/01-latch.ghost.md'), 'utf8');
if (scenario === 'constraint-proof-valid') {
  if (!source.includes('  require pump => valve;')) throw new Error('missing fixture constraint');
  source = source.replace('  require pump => valve;', '  require pump => valve;\n  require pump => valve;');
}
if(adaptScenario) source='# Authored feedback\n```ghost\ncontrol Feedback { input door?: Bool; output pump: Bool; adapt policy { strategy WithDoor priority 100 match (door: sensor<Bool>) { pump <- case door { ok(value) => value; fault(_) => false; }; } strategy Baseline priority 0 match always { pump <- false; } } }\n```';
const compilation = await compileSource(source, { filename: '01-latch.ghost.md' });
if (scenario === 'constraint-proof-valid' && compilation.traceMetadata.format !== 'GhostFlow/source-trace-v2') {
  throw new Error('fixture must contain a checked executable replacement');
}
if (profileSource) identity.requiredCapabilities = [{kind:'actuator',name:'pump',type:scenario === 'profile-1' ? 'bool' : 'int'}, {kind:'actuator',name:'valve',type:'bool'}];
if (quantityScenario) identity.requiredCapabilities = [
  ...QUANTITY_TYPES.flatMap((_, index) => [{ kind: 'sensor', name: `input_${index}`, type: 'number' }, { kind: 'actuator', name: `output_${index}`, type: 'number' }]),
  { kind: 'sensor', name: 'enabled', type: 'bool' }, { kind: 'sensor', name: 'probe', type: 'number' },
];
if (timeScenario) identity.requiredCapabilities = timeTypes.flatMap((_, index) => [
  { kind: 'sensor', name: `input_${index}`, type: 'number' },
  { kind: 'actuator', name: `output_${index}`, type: 'number' },
]);
if (resultScenario) identity.requiredCapabilities = [
  { kind: 'sensor', name: 'probe', type: 'number' },
  { kind: 'actuator', name: 'dry', type: 'bool' }, { kind: 'actuator', name: 'held', type: 'bool' },
];
if (debounceScenario) identity.requiredCapabilities = [
  { kind: 'sensor', name: 'start', type: 'bool' },
  { kind: 'sensor', name: 'probe', type: 'bool' },
  { kind: 'sensor', name: 'backup', type: 'bool' },
  ...['rawResult', 'finiteResult', 'measuredResult'].map(name => ({ kind: 'actuator', name, type: 'bool' })),
];
if (holdScenario) identity.requiredCapabilities = [
  { kind: 'sensor', name: 'start', type: 'bool' },
  ...['probe', 'backup'].map(name => ({ kind: 'sensor', name, type: 'number' })),
  ...['measuredResult', 'finiteResult', 'booleanResult', 'integerResult'].map(name => ({ kind: 'actuator', name, type: 'bool' })),
];
if (intSettingsScenario) identity.requiredCapabilities = [{ kind: 'actuator', name: 'count', type: 'int' }];
if (windowScenario) identity.requiredCapabilities = [
  { kind: 'sensor', name: 'probe', type: 'number' },
  { kind: 'actuator', name: 'pump', type: 'bool' },
];
if(adaptScenario) identity.requiredCapabilities=[{kind:'actuator',name:'pump',type:'bool'}];
const packageValue = await buildPortablePackage(compilation, identity, {
  signers: [{ keyId: 'test-current-2026', privateKey }],
  verifyCompilation: (text, { filename }) => compileSource(text, { filename }),
});
if (scenario === 'adapt-valid' || scenario === 'valid' || scenario === 'constraint-proof-valid' || profileSource || configTimerScenario || scenario === 'quantity-valid' || scenario === 'time-valid' || scenario === 'result-valid' || scenario === 'debounce-valid' || scenario === 'hold-valid' || scenario === 'hold-basic-valid' || scenario === 'int-settings-valid' || scenario === 'window-valid') {
  process.stdout.write(serializePortablePackage(packageValue));
} else if (adaptScenario || quantityScenario || timeScenario || resultScenario || debounceScenario || holdScenario || intSettingsScenario || windowScenario || ['unsupported-bytecode-version', 'version-mismatch-1', 'version-mismatch-2', 'unsupported-header'].includes(scenario)) {
  const candidate = JSON.parse(JSON.stringify(packageValue));
  if (adaptScenario || quantityScenario || timeScenario || resultScenario || debounceScenario || holdScenario || intSettingsScenario || windowScenario) {
    const manifest = JSON.parse(Buffer.from(candidate.payload.manifest.contentBase64, 'base64').toString('utf8'));
    if(adaptScenario){
      if(scenario==='adapt-priority') manifest.strategies[0].priority++;
      else if(scenario==='adapt-name') manifest.strategies[0].name='Forged';
      else if(scenario==='adapt-match') manifest.strategies[0].match[0].role='other';
      else if(scenario==='adapt-output') manifest.strategies[0].outputNames[0]='other';
      else if(scenario==='adapt-policy') manifest.adaptPolicy.selection='first';
      else if(scenario==='adapt-unpaired') delete manifest.strategies;
      else if(scenario==='adapt-missing'){delete manifest.strategies;delete manifest.adaptPolicy;}
      else if(scenario==='adapt-bytecode'){
        const bytes=Buffer.from(candidate.payload.bytecode.contentBase64,'base64');const at=bytes.indexOf(Buffer.from('WithDoor'))+8;
        bytes.writeInt32LE(101,at);candidate.payload.bytecode.contentBase64=bytes.toString('base64');candidate.payload.bytecode.sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');manifest.bytecodeSha256=candidate.payload.bytecode.sha256;
      }else throw new Error('unknown adapt fixture');
    } else if (intSettingsScenario) {
      const config = manifest.configs[0];
      const match = /^int-settings-(value|min|max|step)-(fraction|underflow|overflow|string|null|missing)$/.exec(scenario);
      if (match) {
        const [, field, kind] = match, object = field === 'value' ? config : config.settings;
        if (kind === 'missing') delete object[field];
        else object[field] = { fraction: 0.5, underflow: -2147483649, overflow: 2147483648, string: '1', null: null }[kind];
      } else if (scenario === 'int-settings-step-zero') config.settings.step = 0;
      else if (scenario === 'int-settings-step-negative') config.settings.step = -1;
      else if (scenario === 'int-settings-inverted') { config.settings.min = 1; config.settings.max = 0; }
      else if (scenario === 'int-settings-default-grid') manifest.configs[3].value = 1;
      else if (scenario === 'int-settings-bytecode-mismatch') manifest.configs[3].value = 2147483647;
      else if (scenario === 'int-settings-context-abi-mismatch') candidate.payload.identity.runtimeAbi = 'GhostFlow/framed-scan-abi-v1';
      else if (scenario === 'int-settings-max-grid') manifest.configs[2].settings.max = 2147483647;
      else if (scenario === 'int-settings-outside-range') config.settings.min = -2147483647;
      else if (scenario === 'int-settings-extra-step-type') config.settings.stepType = 'Int';
      else if (scenario === 'int-settings-plain-invalid') manifest.configs[4].value = 0.5;
      else if (scenario === 'int-settings-access-missing') delete config.settings.access;
      else if (scenario === 'int-settings-access-invalid') config.settings.access = 'viewer';
      else if (scenario === 'int-settings-access-null') config.settings.access = null;
      else if (scenario === 'int-settings-apply-live') config.settings.apply = 'live';
      else if (scenario === 'int-settings-apply-null') config.settings.apply = null;
      else if (scenario === 'int-settings-label-empty') config.settings.label = '';
      else if (scenario === 'int-settings-label-long') config.settings.label = 'a'.repeat(129);
      else if (scenario === 'int-settings-label-surrogates') config.settings.label = '🌿'.repeat(65);
      else if (scenario === 'int-settings-label-number') config.settings.label = 1;
      else if (scenario === 'int-settings-unknown-key') config.settings.hidden = true;
      else if (scenario === 'int-settings-object-null') config.settings = null;
      else throw new Error(`unknown Int settings scenario: ${scenario}`);
    }
    else if (holdScenario) {
      const held = manifest.signals.find(item => item.name === 'measured');
      const finite = manifest.signals.find(item => item.name === 'finite');
      if (scenario === 'hold-duration-missing') delete held.forAtMostMs;
      else if (scenario === 'hold-duration-zero') held.forAtMostMs = 0;
      else if (scenario === 'hold-duration-fraction') held.forAtMostMs = 0.5;
      else if (scenario === 'hold-duration-overflow') held.forAtMostMs = 9007199254740992;
      else if (scenario === 'hold-quality') held.quality = 'estimated';
      else if (scenario === 'hold-error-type') held.errorType = 'ClockFault';
      else if (scenario === 'hold-extra-field') held.initial = 0;
      else if (scenario === 'hold-role-missing') delete held.states.maskedFaultOrigin;
      else if (scenario === 'hold-role-wrong') held.states.heldTimestamp = held.states.age;
      else if (scenario === 'hold-payload-type') held.payloadType = 'Int';
      else if (scenario === 'hold-enum-missing') delete finite.members;
      else if (scenario === 'hold-enum-duplicate') finite.members = ['Off', 'Off'];
      else if (scenario === 'hold-enum-built-in') finite.payloadType = 'SensorFault';
      else if (scenario === 'hold-source-empty') held.sources = [];
      else if (scenario === 'hold-source-mode') held.sourceMode = 'scan';
      else if (scenario === 'hold-source-unknown') held.sources[0].name = 'other';
      else if (scenario === 'hold-source-tag-zero') held.sources[0].tag = 0;
      else if (scenario === 'hold-source-reordered') held.sources.reverse();
      else if (scenario === 'hold-source-id-missing') delete held.sources[0].states.lastId;
      else if (scenario === 'hold-source-state-extra') held.sources[0].states.hidden = held.states.age;
      else if (scenario === 'hold-source-history-alias') held.sources[1].states = { ...held.sources[0].states };
      else if (scenario === 'hold-sample-missing') delete manifest.sensors[0].sampleIdInput;
      else if (scenario === 'hold-sample-wrong') manifest.sensors[0].sampleIdInput = '__gf_sensor_sample_id_other';
      else if (scenario === 'hold-descriptors-deleted') {
        manifest.signals = [];
        for (const sensor of manifest.sensors) for (const key of ['samplePresentInput', 'sampleEpochInput', 'sampleIdInput', 'sampleTimestampInput']) delete sensor[key];
      } else if (scenario.startsWith('hold-bytecode-') || scenario === 'hold-basic-bytecode-default') {
        const bytes = Buffer.from(candidate.payload.bytecode.contentBase64, 'base64');
        let at = 6;
        const string = () => { const length = bytes.readUInt16LE(at); at += 2; const start = at; const name = bytes.toString('utf8', at, at + length); at += length; return { name, start, length }; };
        string(); at += 4;
        const inputs = bytes.readUInt16LE(at); at += 2;
        let changed = false;
        for (let index = 0; index < inputs; index++) {
          const field = string(); at++;
          if (scenario === 'hold-bytecode-sample-name' && field.name === manifest.sensors[0].sampleIdInput) { bytes[field.start + field.length - 1] = 120; changed = true; }
        }
        const states = bytes.readUInt16LE(at); at += 2;
        const role = scenario.slice('hold-bytecode-default-'.length);
        const defaultTarget = scenario === 'hold-basic-bytecode-default' ? held.states.age
          : scenario.startsWith('hold-bytecode-default-') ? held.states[role]
          : scenario === 'hold-bytecode-int-default' ? manifest.signals.find(item => item.name === 'integer').states.value
          : scenario === 'hold-bytecode-bool-default' ? manifest.signals.find(item => item.name === 'boolean').states.value
          : scenario === 'hold-bytecode-source-id-default' ? held.sources[0].states.lastId
          : scenario === 'hold-bytecode-source-epoch-default' ? held.sources[0].states.lastEpoch : null;
        for (let index = 0; index < states; index++) {
          const field = string(), type = bytes[at++];
          if (field.name === defaultTarget) {
            if (type === 1) bytes[at] = 1;
            else if (type === 3) bytes.writeInt32LE(1, at);
            else bytes.writeDoubleLE(bytes.readDoubleLE(at) + 1, at);
            changed = true;
          }
          if ((scenario === 'hold-bytecode-state-name' && field.name === held.states.value)
            || (scenario === 'hold-bytecode-source-state-name' && field.name === held.sources[0].states.lastId)) {
            bytes[field.start + field.length - 1] = 120; changed = true;
          }
          at += type === 1 ? 1 : type === 3 ? 4 : 8;
        }
        if (!changed) throw new Error(`hold bytecode mutation did not find its field: ${scenario}`);
        const digest = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
        candidate.payload.bytecode.contentBase64 = bytes.toString('base64');
        candidate.payload.bytecode.sha256 = digest;
        manifest.bytecodeSha256 = digest;
        const map = JSON.parse(Buffer.from(candidate.payload.sourceMap.contentBase64, 'base64').toString('utf8'));
        map.bytecodeSha256 = digest; map.traceMetadata.bytecodeSha256 = digest;
        const mapBytes = encoder.encode(canonicalJson(map));
        candidate.payload.sourceMap.contentBase64 = Buffer.from(mapBytes).toString('base64');
        candidate.payload.sourceMap.sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', mapBytes)).toString('hex');
      } else throw new Error(`unknown hold scenario: ${scenario}`);
    }
    else if (debounceScenario) {
      const raw = manifest.signals.find(item => item.name === 'raw');
      const finite = manifest.signals.find(item => item.name === 'finite');
      const measured = manifest.signals.find(item => item.name === 'measured');
      if (scenario === 'debounce-duration-missing') delete raw.stableForMs;
      else if (scenario === 'debounce-duration-zero') raw.stableForMs = 0;
      else if (scenario === 'debounce-duration-fraction') raw.stableForMs = 0.5;
      else if (scenario === 'debounce-extra-field') raw.hidden = true;
      else if (scenario === 'debounce-role-missing') delete raw.states.lastSourceTag;
      else if (scenario === 'debounce-role-wrong') raw.states.stable = '__gf_debounce_stable_other';
      else if (scenario === 'debounce-enum-missing') delete finite.members;
      else if (scenario === 'debounce-enum-duplicate') finite.members = ['Off', 'Off'];
      else if (scenario === 'debounce-enum-initial') finite.initial = 2;
      else if (scenario === 'debounce-error-type') measured.errorType = 'CustomFault';
      else if (scenario === 'debounce-source-unknown') measured.sources[0].name = 'other';
      else if (scenario === 'debounce-source-tag-zero') measured.sources[0].tag = 0;
      else if (scenario === 'debounce-source-duplicate') measured.sources.push({ ...measured.sources[0] });
      else if (scenario === 'debounce-source-states-missing') delete measured.sources[0].states;
      else if (scenario === 'debounce-source-id-missing') delete measured.sources[0].states.lastId;
      else if (scenario === 'debounce-source-epoch-name') measured.sources[0].states.lastEpoch = raw.states.lastSourceTag;
      else if (scenario === 'debounce-source-state-extra') measured.sources[0].states.hidden = raw.states.stable;
      else if (scenario === 'debounce-source-history-alias') measured.sources[1].states = { ...measured.sources[0].states };
      else if (scenario === 'debounce-sample-missing') delete manifest.sensors[0].sampleIdInput;
      else if (scenario === 'debounce-sample-wrong') manifest.sensors[0].sampleIdInput = '__gf_sensor_sample_id_other';
      else if (scenario === 'debounce-descriptors-deleted') {
        manifest.signals = [];
        for (const key of ['samplePresentInput', 'sampleEpochInput', 'sampleIdInput', 'sampleTimestampInput']) delete manifest.sensors[0][key];
      } else if (['debounce-bytecode-default', 'debounce-bytecode-state-name', 'debounce-bytecode-sample-name', 'debounce-bytecode-source-id-default', 'debounce-bytecode-source-epoch-default', 'debounce-bytecode-source-state-name'].includes(scenario)) {
        const bytes = Buffer.from(candidate.payload.bytecode.contentBase64, 'base64');
        let at = 6;
        const string = () => { const length = bytes.readUInt16LE(at); at += 2; const start = at; const name = bytes.toString('utf8', at, at + length); at += length; return { name, start, length }; };
        string(); at += 4;
        const inputs = bytes.readUInt16LE(at); at += 2;
        let changed = false;
        for (let index = 0; index < inputs; index++) {
          const field = string(); at++;
          if (scenario === 'debounce-bytecode-sample-name' && field.name === manifest.sensors[0].sampleIdInput) { bytes[field.start + field.length - 1] = 'x'.charCodeAt(0); changed = true; }
        }
        const states = bytes.readUInt16LE(at); at += 2;
        for (let index = 0; index < states; index++) {
          const field = string(), type = bytes[at++];
          if (field.name === raw.states.stable) {
            if (scenario === 'debounce-bytecode-default') { bytes[at] = 1; changed = true; }
            if (scenario === 'debounce-bytecode-state-name') { bytes[field.start + field.length - 1] = 'x'.charCodeAt(0); changed = true; }
          }
          if (field.name === measured.sources[0].states.lastId) {
            if (scenario === 'debounce-bytecode-source-id-default') { bytes.writeDoubleLE(0, at); changed = true; }
            if (scenario === 'debounce-bytecode-source-state-name') { bytes[field.start + field.length - 1] = 'x'.charCodeAt(0); changed = true; }
          }
          if (field.name === measured.sources[0].states.lastEpoch && scenario === 'debounce-bytecode-source-epoch-default') { bytes.writeDoubleLE(1, at); changed = true; }
          at += type === 1 ? 1 : type === 3 ? 4 : 8;
        }
        if (!changed) throw new Error('debounce bytecode mutation did not find its field');
        const digest = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
        candidate.payload.bytecode.contentBase64 = bytes.toString('base64');
        candidate.payload.bytecode.sha256 = digest;
        manifest.bytecodeSha256 = digest;
        const map = JSON.parse(Buffer.from(candidate.payload.sourceMap.contentBase64, 'base64').toString('utf8'));
        map.bytecodeSha256 = digest; map.traceMetadata.bytecodeSha256 = digest;
        const mapBytes = encoder.encode(canonicalJson(map));
        candidate.payload.sourceMap.contentBase64 = Buffer.from(mapBytes).toString('base64');
        candidate.payload.sourceMap.sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', mapBytes)).toString('hex');
      } else throw new Error(`unknown debounce scenario: ${scenario}`);
    }
    else if (windowScenario) {
      const average = manifest.signals.find(item => item.name === 'average');
      if (scenario === 'window-bytecode-duration') {
        const alternate = await compileSource(source.replace('over: 1s', 'over: 2s'), { filename: '01-latch.ghost.md' });
        const bytecode = Buffer.from(alternate.bytes);
        const digest = Buffer.from(await crypto.subtle.digest('SHA-256', bytecode)).toString('hex');
        candidate.payload.bytecode.contentBase64 = bytecode.toString('base64');
        candidate.payload.bytecode.sha256 = digest;
        manifest.bytecodeSha256 = digest;
        const map = JSON.parse(Buffer.from(candidate.payload.sourceMap.contentBase64, 'base64').toString('utf8'));
        map.bytecodeSha256 = digest;
        map.traceMetadata.bytecodeSha256 = digest;
        const mapBytes = encoder.encode(canonicalJson(map));
        candidate.payload.sourceMap.contentBase64 = Buffer.from(mapBytes).toString('base64');
        candidate.payload.sourceMap.sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', mapBytes)).toString('hex');
      } else if (scenario === 'window-zero-duration') average.overMs = 0;
      else if (scenario === 'window-duration-mismatch') average.overMs = 2000;
      else if (scenario === 'window-operation-mismatch') average.operation = 'min';
      else if (scenario === 'window-slot-mismatch') average.slot = 1;
      else if (scenario === 'window-site-mismatch') average.site += 1;
      else if (scenario === 'window-payload-mismatch') average.payloadType = 'Int';
      else if (scenario === 'window-source-tag-mismatch') average.sources[0].tag += 1;
      else if (scenario === 'window-missing-signal') manifest.signals = manifest.signals.filter(item => item.name !== 'average');
      else if (scenario === 'window-missing-sample-input') delete manifest.sensors[0].sampleIdInput;
      else if (scenario === 'window-unknown-key') average.extra = true;
      else if (scenario === 'window-format-mismatch') { manifest.format = 'GhostFlow/control-v1'; }
      else if (scenario === 'window-clock-mismatch') average.clockInput = '__gf_time_epoch';
      else throw new Error(`unknown window scenario: ${scenario}`);
    }
    else if (scenario === 'result-sensor-missing') delete manifest.sensors[0].faultInput;
    else if (scenario === 'result-signal-missing') delete manifest.signals[0].faultInput;
    else if (scenario === 'result-sensor-wrong') manifest.sensors[0].faultInput = '__gf_sensor_fault_other';
    else if (scenario === 'result-signal-wrong') manifest.signals[0].faultInput = '__gf_sensor_fault_probe';
    else if (scenario === 'result-sensor-collision') manifest.sensors[0].valueInput = manifest.sensors[0].faultInput;
    else if (scenario === 'result-signal-collision') manifest.signals[0].okInput = manifest.signals[0].faultInput;
    else if (scenario === 'time-port-unit') manifest.sensors[0].canonicalUnit = 'day';
    else if (scenario === 'time-config-unit') manifest.configs[0].canonicalUnit = 'day';
    else if (scenario === 'time-wrong-type') manifest.outputs[0].type = 'Datetime';
    else if (scenario === 'time-config-string') manifest.configs[0].value = '0';
    else if (scenario === 'time-config-null') manifest.configs[0].value = null;
    else if (scenario === 'time-config-missing') delete manifest.configs[0].value;
    else if (scenario === 'time-settings-step-type') manifest.configs[0].settings.stepType = 'Duration';
    else if (scenario === 'time-settings-missing-step-type') delete manifest.configs[2].settings.stepType;
    else if (scenario === 'time-settings-step-overflow') manifest.configs[0].settings.step = 2147483648;
    else if (scenario === 'time-settings-grid') manifest.configs[2].settings.step = 2;
    else if (scenario === 'time-settings-range') manifest.configs[4].settings.max = 253402300800000;
    else if (/^time-config-[012]-(negative|fractional|overflow)$/.test(scenario)) {
      const [, , index, kind] = scenario.split('-');
      manifest.configs[Number(index) * 2].value = kind === 'negative' ? -1 : kind === 'fractional' ? 0.5 : [2932897, 86400000, 253402300800000][Number(index)];
    }
    else if (scenario === 'quantity-missing-unit') delete manifest.sensors[0].canonicalUnit;
    else if (scenario === 'quantity-wrong-unit') manifest.outputs[0].canonicalUnit = '°C';
    else if (scenario === 'quantity-extra-field') manifest.sensors[0].displayUnit = '°C';
    else if (scenario === 'quantity-wrong-type') manifest.sensors[0].type = 'ImaginaryQuantity';
    else if (scenario === 'quantity-scalar-unit') manifest.sensors[17].canonicalUnit = 'K';
    else if (scenario === 'quantity-sensor-unit') delete manifest.sensors[18].canonicalUnit;
    else if (scenario === 'quantity-config-unit') manifest.configs[0].canonicalUnit = '°C';
    else if (scenario === 'quantity-scalar-config-unit') manifest.configs[1].canonicalUnit = 'K';
    else throw new Error(`unknown quantity scenario: ${scenario}`);
    const bytes = encoder.encode(canonicalJson(manifest));
    candidate.payload.manifest.contentBase64 = Buffer.from(bytes).toString('base64');
    candidate.payload.manifest.sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  } else if (scenario === 'unsupported-header') {
    const bytes = Buffer.from(candidate.payload.bytecode.contentBase64, 'base64');
    bytes.writeUInt16LE(5, 4);
    candidate.payload.bytecode.contentBase64 = bytes.toString('base64');
    candidate.payload.bytecode.sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  } else candidate.payload.bytecode.version = scenario === 'unsupported-bytecode-version' ? '5' : scenario.slice(-1);
  const payloadBytes = encoder.encode(canonicalJson(candidate.payload));
  const payloadDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', payloadBytes));
  candidate.payloadSha256 = Array.from(payloadDigest, byte => byte.toString(16).padStart(2, '0')).join('');
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, payloadBytes));
  candidate.signatures = [{
    algorithm: 'Ed25519',
    keyId: 'test-current-2026',
    signatureBase64: Buffer.from(signature).toString('base64'),
  }];
  process.stdout.write(serializePortablePackage(candidate));
} else {
  throw new Error(`unknown native fixture scenario: ${scenario}`);
}
