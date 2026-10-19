import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { encode, decode } from '@toon-format/toon';
import { queryTarget, TARGET_QUERY_SCHEMA } from '../tools/target-query.mjs';
import { jsonSha256 } from '../tools/integration-contract.mjs';

const fixture = JSON.parse(readFileSync(new URL('../contracts/integration-v1/examples/fictional-fixture.json', import.meta.url)));
const clone = x => structuredClone(x);
function request() {
  const drivers = [
    { id: 'fixture-relay-expander', version: 'driver-v1', sha256: '3'.repeat(64) },
    { id: 'fixture-input-driver', version: 'input-v1', sha256: '4'.repeat(64) },
  ];
  return { schema: TARGET_QUERY_SCHEMA, asOf: '2000-01-01T00:00:10.000Z', maxAgeMs: 5000,
    target: { id: 'fictional-target', release: clone(fixture.release), boardProfile: clone(fixture.boardProfile),
      installation: clone(fixture.installation), drivers,
      channels: [
        { id: 'relay.1', features: ['switch'], resources: ['power'], unit: 'boolean', updatePeriodMs: 100 },
        { id: 'relay.2', features: ['switch'], resources: ['power'] },
        { id: 'input.1', features: ['sense'] },
      ],
      examples: [{ id: 'pump-demo', ref: 'fixture://pump-example', tags: ['pump'], channels: ['relay.1'] }],
    } };
}
function report(r, at = '2000-01-01T00:00:09.000Z') {
  return { targetId: r.target.id, bootId: 'boot-1', releaseSha256: jsonSha256(r.target.release),
    drivers: clone(r.target.drivers), observedAt: at, evidenceRef: 'fixture://installation' };
}
function observation(r, channelState = 'available', resourceState = 'available') {
  return { ...report(r), evidenceRef: `fixture://observed-${channelState}-${resourceState}`,
    channels: [{ id: 'relay.1', state: channelState }, { id: 'relay.2', state: 'available' }],
    resources: [{ id: 'power', state: resourceState }] };
}
const byId = (result, id) => result.channels.find(c => c.id === id);

test('declarations alone do not claim installation or live availability', () => {
  const result = queryTarget(request());
  assert.equal(result.installation, 'unknown');
  assert.equal(byId(result, 'relay.1').availability, 'unknown');
  assert.equal(byId(result, 'relay.1').installation, 'unknown');
  assert.equal(byId(result, 'relay.2').unit, undefined);
  assert.equal(byId(result, 'relay.2').updatePeriodMs, undefined);
  assert.equal(byId(result, 'input.1').resources, undefined);
  assert.deepEqual(result.examples, []);
  assert.equal(result.declared.runtimeSemanticsVersion, fixture.release.runtimeSemanticsVersion);
  assert.equal(result.requestSha256.length, 64);
  assert.equal(result.targetSha256.length, 64);
});

test('fresh, pinned installation and observations identify current reported availability', () => {
  const r = request(); r.installed = report(r); r.observations = [observation(r)];
  const result = queryTarget(r);
  assert.equal(result.installation, 'installed_reported');
  assert.equal(byId(result, 'relay.1').availability, 'available');
  assert.equal(byId(result, 'input.1').availability, 'unknown');
  assert.equal(byId(result, 'input.1').observation, 'unknown');
  assert.equal(result.suppliedEvidence.installed.status, 'linked_fresh');
  assert.equal(result.suppliedEvidence.observations[0].evidenceRef, r.observations[0].evidenceRef);
  assert.equal(result.suppliedEvidence.observations[0].bootId, 'boot-1');
  assert.deepEqual(result.suppliedEvidence.observations[0].channels, r.observations[0].channels);
  assert.deepEqual(result.diagnostics, []);
  r.observations[0].resources[0].state = 'busy';
  assert.equal(byId(queryTarget(r), 'relay.1').availability, 'busy');
  r.observations[0].resources[0].state = 'reserved';
  assert.equal(byId(queryTarget(r), 'relay.1').availability, 'reserved');
});

test('unlinked, stale, future and mismatched evidence cannot become available', () => {
  const mutations = [
    r => { delete r.installed; },
    r => { r.installed.observedAt = '2000-01-01T00:00:01.000Z'; },
    r => { r.installed.observedAt = '2000-01-01T00:00:11.000Z'; },
    r => { r.installed.targetId = 'elsewhere'; },
    r => { r.installed.releaseSha256 = '5'.repeat(64); },
    r => { r.installed.drivers[0].sha256 = '6'.repeat(64); },
    r => { r.observations[0].observedAt = '2000-01-01T00:00:01.000Z'; },
    r => { r.observations[0].observedAt = '2000-01-01T00:00:11.000Z'; },
    r => { r.observations[0].targetId = 'elsewhere'; },
    r => { r.observations[0].bootId = 'another-boot'; },
    r => { r.observations[0].releaseSha256 = '5'.repeat(64); },
    r => { r.observations[0].drivers[0].version = 'different'; },
  ];
  for (const mutate of mutations) {
    const r = request(); r.installed = report(r); r.observations = [observation(r)]; mutate(r);
    const result = queryTarget(r);
    assert.equal(byId(result, 'relay.1').availability, 'unknown');
    assert.ok(result.diagnostics.length);
    assert.ok(result.diagnostics.every(d => d.observedAt && d.bootId));
    assert.ok(result.suppliedEvidence.observations.every(e => e.status === 'excluded'));
  }
});

test('conflicting fresh states remain conflict regardless of observation order', () => {
  const r = request(); r.installed = report(r);
  const a = observation(r), b = observation(r, 'busy');
  for (const pair of [[a, b], [b, a]]) {
    r.observations = clone(pair);
    assert.equal(byId(queryTarget(r), 'relay.1').availability, 'conflict');
  }
  const c = observation(r, 'available', 'busy');
  r.observations = [a, c];
  assert.equal(byId(queryTarget(r), 'relay.1').availability, 'conflict');
});

test('filters are AND across fields, OR within list; examples require explicit tags', () => {
  const r = request();
  r.filter = { channels: ['relay.1', 'relay.2'], directions: ['output'], types: ['Bool'],
    features: ['switch'], contractVersions: ['driver-v1'], exampleTags: ['pump'] };
  let result = queryTarget(r);
  assert.deepEqual(result.channels.map(c => c.id), ['relay.1', 'relay.2']);
  assert.deepEqual(result.examples.map(e => e.id), ['pump-demo']);
  r.filter.features = ['missing'];
  result = queryTarget(r);
  assert.deepEqual(result.channels, []);
  assert.deepEqual(result.examples, []);
  r.filter = { contractVersions: ['fixture-protocol-v1'] };
  assert.deepEqual(queryTarget(r).channels, []); // version filter means exact driver version only
});

test('shape limits, duplicate ids and empty filters reject', () => {
  const bad = [
    r => { r.filter = { channels: [] }; },
    r => { r.filter = { channels: ['relay.1', 'relay.1'] }; },
    r => { r.target.channels.push(clone(r.target.channels[0])); },
    r => { r.target.drivers.push(clone(r.target.drivers[0])); },
    r => { r.asOf = '2000-01-01'; },
    r => { r.target.channels[0].unit = 'x'.repeat(4097); },
    r => { r.target.channels[0].unit = 'x'.repeat(255); r.target.examples = Array.from({ length: 129 }, (_, i) => ({ id: `ex-${i}`, ref: 'fixture://example', tags: ['a'], channels: ['relay.1'] })); },
    r => { r.target.channels[0].resources = Array.from({ length: 33 }, (_, i) => `resource-${i}`); },
    r => { r.target.channels[0].surprise = true; },
    r => { r.target.channels = Array(3); r.target.channels[0] = { id: 'relay.1' }; r.target.channels[2] = { id: 'input.1' }; },
    r => { r.installed = { ...report(r), channels: [] }; },
    r => { r.installed = report(r); r.observations = [observation(r)]; r.observations[0].channels.push({ id: 'relay.1', state: 'busy' }); },
  ];
  for (const mutate of bad) { const r = request(); mutate(r); assert.throws(() => queryTarget(r)); }
});

test('query snapshots inputs and returns unaliased deterministic output', () => {
  const r = request(); const before = clone(r);
  const a = queryTarget(r), b = queryTarget(r);
  assert.deepEqual(r, before); assert.deepEqual(a, b);
  a.channels[0].driver.version = 'changed';
  a.suppliedEvidence.observations.push({ forged: true });
  assert.equal(r.target.drivers[0].version, 'driver-v1');
  assert.deepEqual(queryTarget(r), b);
});

test('missing resource declaration blocks availability while explicit empty resource list permits it', () => {
  const r = request(); r.installed = report(r); r.observations = [observation(r)];
  r.target.channels[0].resources = undefined;
  assert.throws(() => queryTarget(r)); // undefined is not JSON
  delete r.target.channels[0].resources;
  assert.equal(byId(queryTarget(r), 'relay.1').availability, 'unknown');
  r.target.channels[0].resources = [];
  assert.equal(byId(queryTarget(r), 'relay.1').availability, 'available');
});

test('oversize expanded result is explicitly incomplete', () => {
  const r = request(); r.installed = report(r);
  r.observations = Array.from({ length: 128 }, (_, i) => ({ ...observation(r),
    evidenceRef: `fixture://long-observation-${String(i).padStart(3, '0')}-${'x'.repeat(180)}` }));
  const result = queryTarget(r);
  assert.equal(result.outcome, 'incomplete');
  assert.ok(result.diagnostics[0].codes.includes('output_limit'));
  assert.equal(result.channels, undefined);
});

test('JSON and TOON CLI return the same result, with bounded rejection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ghostdescribe-'));
  try {
    const r = request(), json = join(dir, 'request.json'), toon = join(dir, 'request.toon');
    writeFileSync(json, JSON.stringify(r)); writeFileSync(toon, encode(r));
    const cli = new URL('../tools/ghostdescribe.mjs', import.meta.url).pathname;
    const run = (file, format) => spawnSync(process.execPath, [cli, '--request', file, '--format', format], { encoding: 'utf8' });
    const j = run(json, 'json'), t = run(toon, 'toon');
    assert.equal(j.status, 0, j.stdout + j.stderr); assert.equal(t.status, 0, t.stdout + t.stderr);
    assert.deepEqual(decode(t.stdout, { strict: true }), JSON.parse(j.stdout));
    writeFileSync(json, ' '.repeat(262145));
    const rejected = run(json, 'json');
    assert.equal(rejected.status, 1); assert.equal(JSON.parse(rejected.stdout).outcome, 'rejected');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
