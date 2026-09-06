import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  jsonSha256, sha256, STATUSES,
  validateReleaseIdentity, validateRunEvidence, validateIntegration,
} from '../tools/integration-contract.mjs';

const example = JSON.parse(readFileSync(new URL('../contracts/integration-v1/examples/fictional-fixture.json', import.meta.url), 'utf8'));
function fixture() {
  const { release, boardProfile, installation, artifacts, runEvidence } = structuredClone(example);
  return { release, boardProfile, installation, artifacts: {
    source: artifacts.source, module: Buffer.from(artifacts.moduleHex, 'hex'), manifest: artifacts.manifest,
  }, runEvidence };
}
function invalid(result, code) {
  assert.equal(result.valid, false, 'must reject the mismatched contract');
  assert.ok(result.errors.some(error => error.code === code), JSON.stringify(result.errors));
}
function repinMapping(f) {
  f.release.installation.sha256 = jsonSha256(f.installation);
  f.runEvidence.releaseSha256 = jsonSha256(f.release);
}
function absentGate(status = 'not_run') {
  return { status, source: { type: 'none', reference: null }, scope: 'No evidence collected by this fictional fixture.' };
}

test('fictional JSON is self-contained, hash-consistent, deterministic, and never promoted to physical proof', () => {
  const f = fixture(), before = structuredClone(f);
  assert.equal(example.kind, 'fictional-fixture');
  assert.equal(f.runEvidence.kind, 'fictional-fixture');
  assert.deepEqual(validateReleaseIdentity(f.release, f), { valid: true, errors: [] });
  assert.deepEqual(validateRunEvidence(f.runEvidence, f), { valid: true, errors: [] });
  assert.deepEqual(validateIntegration(f), validateIntegration(f));
  assert.deepEqual(validateIntegration(f), { valid: true, errors: [] });
  assert.equal(f.runEvidence.gates.physical.status, 'unknown');
  assert.deepEqual(structuredClone(f), before);
});

test('exact artifact bytes and canonical metadata hashes have different normalization rules', () => {
  assert.notEqual(sha256('source'), sha256('source\n'));
  assert.equal(sha256('한글\r\n'), sha256(Buffer.from('한글\r\n')));
  assert.equal(jsonSha256({ b: 2, a: { d: 4, c: 3 } }), jsonSha256({ a: { c: 3, d: 4 }, b: 2 }));
  assert.notEqual(jsonSha256(['pump', 'valveA']), jsonSha256(['valveA', 'pump']));
  assert.throws(() => jsonSha256({ a: undefined }), TypeError);
  assert.throws(() => jsonSha256({ a: NaN }), TypeError);
  const cycle = {}; cycle.self = cycle; assert.throws(() => jsonSha256(cycle), TypeError);
});

test('release identity rejects run-specific fields and does not need run evidence', () => {
  const f = fixture(); delete f.runEvidence;
  assert.equal(validateIntegration(f).valid, true);
  f.release.bootId = 'wrong-layer';
  invalid(validateReleaseIdentity(f.release, f), 'shape');
});

for (const [label, change, code] of [
  ['wrong board model under an unchanged profile ID', f => { f.boardProfile.boardModel = 'GENERIC-DEVKIT'; }, 'profile_mismatch'],
  ['profile revision drift', f => { f.boardProfile.revision = 'r2'; }, 'profile_mismatch'],
  ['profile digest mismatch', f => { f.release.device.boardProfile.sha256 = 'a'.repeat(64); }, 'profile_mismatch'],
  ['installation names a different board', f => { f.installation.boardProfile.id = 'some-other-board'; }, 'profile_mismatch'],
  ['generic GPIO7 substituted for the relay endpoint', f => { f.installation.bindings.pump = 'GPIO7'; }, 'unknown_endpoint'],
  ['inline pin binding instead of an endpoint ID', f => { f.installation.bindings.pump = { gpio: 7 }; }, 'shape'],
  ['GPIO driver hidden under an existing endpoint ID', f => { f.boardProfile.endpoints['relay.1'].driver = 'soc-gpio'; f.boardProfile.endpoints['relay.1'].address = '7'; }, 'profile_mismatch'],
  ['input repurposed as an output', f => { [f.installation.bindings.start, f.installation.bindings.pump] = [f.installation.bindings.pump, f.installation.bindings.start]; repinMapping(f); }, 'direction_mismatch'],
  ['two logical outputs alias one physical endpoint', f => { f.installation.bindings.valveA = 'relay.1'; }, 'duplicate_binding'],
  ['unapproved mapping swap', f => { [f.installation.bindings.valveA, f.installation.bindings.pump] = [f.installation.bindings.pump, f.installation.bindings.valveA]; }, 'mapping_mismatch'],
]) {
  test(`rejects ${label}`, () => {
    const f = fixture(); change(f); invalid(validateIntegration(f), code);
  });
}

test('declaration order cannot assign pins; name bindings survive reorder', () => {
  const f = fixture(), beforeBindings = structuredClone(f.installation.bindings);
  f.artifacts.manifest.outputs.reverse();
  f.runEvidence.artifacts.manifestSha256 = jsonSha256(f.artifacts.manifest);
  assert.equal(validateIntegration(f).valid, true);
  assert.deepEqual(f.installation.bindings, beforeBindings);
  assert.equal(f.installation.bindings.pump, 'relay.1');
  assert.equal(f.installation.bindings.valveA, 'relay.2');
  f.artifacts.manifest.outputs[0].name = 'unnamedValve';
  invalid(validateIntegration(f), 'missing_binding');
});

test('positional binding arrays and wrong semantic types are rejected', () => {
  const f = fixture(); f.installation.bindings = ['relay.1', 'relay.2', 'input.1'];
  invalid(validateIntegration(f), 'shape');
  const g = fixture(); g.artifacts.manifest.outputs[0].type = 'Number';
  invalid(validateIntegration(g), 'type_mismatch');
});

for (const [label, change] of [
  ['archived source digest', f => { f.runEvidence.artifacts.sourceSha256 = 'a'.repeat(64); }],
  ['archived module digest', f => { f.runEvidence.artifacts.moduleSha256 = 'a'.repeat(64); }],
  ['archived manifest digest', f => { f.runEvidence.artifacts.manifestSha256 = 'a'.repeat(64); }],
  ['source newline', f => { f.artifacts.source += '\n'; }],
  ['module byte', f => { f.artifacts.module[0] ^= 1; }],
  ['manifest module hash', f => { f.artifacts.manifest.bytecodeSha256 = 'a'.repeat(64); }],
  ['board source hash', f => { f.runEvidence.device.sourceSha256 = 'a'.repeat(64); }],
  ['board module hash', f => { f.runEvidence.device.moduleSha256 = 'a'.repeat(64); }],
]) {
  test(`rejects mismatched ${label}`, () => {
    const f = fixture(); change(f); invalid(validateIntegration(f), 'artifact_mismatch');
  });
}

for (const [field, value, code] of [
  ['firmwareSha256', 'f'.repeat(64), 'firmware_mismatch'],
  ['runtimeSemanticsVersion', 'other-semantics', 'identity_mismatch'],
  ['bytecodeFormat', 'other-bytecode', 'identity_mismatch'],
  ['protocolVersion', 'other-protocol', 'identity_mismatch'],
]) {
  test(`compares observed ${field} to the release identity`, () => {
    const f = fixture(); f.runEvidence.device[field] = value;
    invalid(validateRunEvidence(f.runEvidence, f), code);
  });
}

test('observed profile and pinned release must agree', () => {
  const f = fixture(); f.runEvidence.device.boardProfile.id = 'GENERIC-ESP32';
  invalid(validateIntegration(f), 'profile_mismatch');
  const g = fixture(); g.runEvidence.releaseSha256 = 'e'.repeat(64);
  invalid(validateIntegration(g), 'release_mismatch');
});

for (const [field, value] of [
  ['id', 'other-fixture-site'],
  ['revision', 'fixture-r2'],
  ['sha256', 'd'.repeat(64)],
]) {
  test(`rejects observed installation ${field} drift with unchanged firmware, profile and program`, () => {
    const f = fixture(); f.runEvidence.device.installation[field] = value;
    for (const result of [validateRunEvidence(f.runEvidence, f), validateIntegration(f)]) {
      invalid(result, 'mapping_mismatch');
      assert.deepEqual(result.errors.map(error => error.path), [`run.device.installation.${field}`]);
    }
  });
}

test('every non-null device observation requires a complete installation identity, even with unknown gates', () => {
  for (const change of [
    device => { delete device.installation; },
    device => { device.installation = null; },
    device => { delete device.installation.id; },
    device => { delete device.installation.revision; },
    device => { delete device.installation.sha256; },
  ]) {
    const f = fixture();
    f.runEvidence.gates.hardware = absentGate('unknown');
    f.runEvidence.gates.physical = absentGate('unknown');
    change(f.runEvidence.device);
    invalid(validateRunEvidence(f.runEvidence, f), 'shape');
    invalid(validateIntegration(f), 'shape');
  }
});

test('software inputs bind explicitly to logical endpoints without requiring physical DI', () => {
  const f = fixture();
  delete f.boardProfile.endpoints['input.1'];
  f.boardProfile.endpoints['command.start'] = {
    direction: 'input', type: 'Bool', driver: 'software-input', address: 'commands/start',
    activeLevel: 'high', safeLevel: 0,
  };
  f.installation.bindings.start = 'command.start';
  const profileDigest = jsonSha256(f.boardProfile);
  f.release.device.boardProfile.sha256 = profileDigest;
  f.installation.boardProfile.sha256 = profileDigest;
  f.runEvidence.device.boardProfile.sha256 = profileDigest;
  repinMapping(f);
  f.runEvidence.device.installation = structuredClone(f.release.installation);
  const before = structuredClone(f);
  assert.deepEqual(validateIntegration(f), { valid: true, errors: [] });
  assert.deepEqual(structuredClone(f), before);
  assert.equal(f.installation.bindings.start, 'command.start');
  assert.equal(f.runEvidence.gates.physical.status, 'unknown');
});

test('host pass leaves absent hardware and physical gates explicitly untested', () => {
  const f = fixture(); f.runEvidence.device = null;
  f.runEvidence.gates.hardware = absentGate('unknown');
  f.runEvidence.gates.physical = absentGate();
  assert.equal(validateIntegration(f).valid, true);
  assert.equal(f.runEvidence.gates.host.status, 'pass');
  assert.equal(f.runEvidence.gates.hardware.status, 'unknown');
  assert.equal(f.runEvidence.gates.physical.status, 'not_run');
  delete f.runEvidence.gates.physical;
  invalid(validateIntegration(f), 'shape');
});

for (const type of ['host-tests', 'injected-fixture', 'device-status', 'gpio-readback', 'register-readback']) {
  test(`${type} cannot justify physical pass`, () => {
    const f = fixture(); f.runEvidence.gates.physical = {
      status: 'pass', source: { type, reference: 'fixture://not-physical' }, scope: 'Claimed physical result',
    };
    invalid(validateIntegration(f), 'evidence_source');
  });
}

test('each status is explicit and independent; valid evidence can record a failure', () => {
  for (const status of STATUSES) {
    const f = fixture(); f.runEvidence.gates.host.status = status;
    if (status === 'not_run') f.runEvidence.gates.host = absentGate();
    assert.equal(validateIntegration(f).valid, true);
    assert.equal(f.runEvidence.gates.host.status, status);
    assert.equal(f.runEvidence.gates.physical.status, 'unknown');
  }
  const f = fixture(); f.runEvidence.gates.host.status = 'skipped';
  invalid(validateIntegration(f), 'status');
});

test('physical pass needs a scoped observation reference and device identity', () => {
  const f = fixture(); f.runEvidence.gates.physical = {
    status: 'pass', source: { type: 'physical-observation', reference: 'fixture://fictional-meter-record' },
    scope: 'Fictional terminal-voltage observation only; no water delivery claim.',
  };
  assert.equal(validateIntegration(f).valid, true);
  f.runEvidence.device = null;
  invalid(validateIntegration(f), 'device_required');
  const g = fixture(); g.runEvidence.gates.physical.status = 'pass';
  invalid(validateIntegration(g), 'evidence_source');
});

test('fixture evidence cannot be assigned to a hardware pass', () => {
  const f = fixture(); f.runEvidence.gates.hardware.source.type = 'injected-fixture';
  invalid(validateIntegration(f), 'evidence_source');
});

test('timestamps and missing run fields never acquire guessed defaults', () => {
  const f = fixture(); f.runEvidence.device.observedAt = '1999-01-01T00:00:00.000Z';
  invalid(validateIntegration(f), 'timestamp');
  const g = fixture(); g.runEvidence.finishedAt = 'not-a-timestamp';
  invalid(validateIntegration(g), 'timestamp');
  const h = fixture(); delete h.runEvidence.device.bootId;
  invalid(validateIntegration(h), 'shape');
  invalid(validateRunEvidence(null, fixture()), 'shape');
  invalid(validateIntegration(), 'shape');
});
