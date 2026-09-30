import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileControl, typeCheckControl } from '../tools/control.mjs';
import { extractLiterate } from '../tools/literate.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const cases = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url))).cases;
const fixture = cases.find(entry => entry.id === 'REF-03-062');
const source = extractLiterate(fixture.source, { filename: fixture.filename }).code;

test('natural condition reference retains typed provider queries', () => {
  const manifest = typeCheckControl(source, { filename: fixture.filename }).manifest;
  assert.deepEqual(manifest.providers, [
    { name: 'harbor_tides', type: 'TidePredictions' },
    { name: 'moon', type: 'LunarEphemeris' },
  ]);
  assert.deepEqual(manifest.naturalConditions.map(({ site, projectionInputs, ...condition }) => condition), [
    {
      operation: 'tide_is', provider: 'harbor_tides', classification: 'neap',
      result: { value: 'Bool', error: 'TemporalContextFault' },
    },
    {
      operation: 'moon_is', provider: 'moon', classification: 'full',
      result: { value: 'Bool', error: 'TemporalContextFault' },
    },
  ]);
  assert.ok(manifest.naturalConditions.every(condition => Number.isSafeInteger(condition.site)));
  for (const condition of manifest.naturalConditions) {
    assert.deepEqual(condition.projectionInputs, {
      ok: `__gf_natural_${condition.site}_ok`, value: `__gf_natural_${condition.site}_value`,
      fault: `__gf_natural_${condition.site}_fault`,
    });
  }
});

test('natural condition execution binds protected Results in GFB11', () => {
  const compiled = compileControl(source, { filename: fixture.filename });
  assert.equal(compiled.manifest.format, 'GhostFlow/control-v10');
  assert.equal(new DataView(compiled.bytes.buffer, compiled.bytes.byteOffset, compiled.bytes.byteLength).getUint16(4, true), 11);
});

test('natural conditions require their matching logical provider type', () => {
  assert.throws(() => typeCheckControl(`control WrongTide {
    provider moon: LunarEphemeris;
    let value = tide_is(moon, tide\`neap\`);
    output allowed: Bool;
    allowed <- case value { ok(value) => value; fault(_) => false; };
  }`), /tide_is requires a TidePredictions provider/);
  assert.throws(() => typeCheckControl(`control WrongMoon {
    provider tide: TidePredictions;
    let value = moon_is(tide, moon\`full\`);
    output allowed: Bool;
    allowed <- case value { ok(value) => value; fault(_) => false; };
  }`), /moon_is requires a LunarEphemeris provider/);
});

test('natural conditions accept only classification tags defined by the Reference', () => {
  assert.throws(() => typeCheckControl(`control WrongTideClass {
    provider tide: TidePredictions;
    let value = tide_is(tide, tide\`high\`);
    output allowed: Bool;
    allowed <- case value { ok(value) => value; fault(_) => false; };
  }`), /tide_is classification must be spring or neap/);
  assert.throws(() => typeCheckControl(`control WrongMoonPhase {
    provider moon: LunarEphemeris;
    let value = moon_is(moon, moon\`blue\`);
    output allowed: Bool;
    allowed <- case value { ok(value) => value; fault(_) => false; };
  }`), /moon_is classification must be new or waxing_crescent/);
});

test('natural conditions retain Result<Bool, TemporalContextFault> typing', () => {
  const manifest = typeCheckControl(`control TypedNaturalCondition {
    provider tide: TidePredictions;
    let value: Result<Bool, TemporalContextFault> = tide_is(tide, tide\`spring\`);
    output allowed: Bool;
    allowed <- case value { ok(value) => value; fault(_) => false; };
  }`).manifest;
  assert.deepEqual(manifest.naturalConditions[0].result, { value: 'Bool', error: 'TemporalContextFault' });
  assert.throws(() => typeCheckControl(`control WrongFaultType {
    provider tide: TidePredictions;
    let value: Result<Bool, ClockFault> = tide_is(tide, tide\`spring\`);
    output allowed: Bool;
    allowed <- false;
  }`), /let value does not match annotation Result/);
});

test('natural Result must be handled before use as Bool', () => {
  assert.throws(() => typeCheckControl(`control UnhandledNaturalResult {
    provider tide: TidePredictions;
    let value = tide_is(tide, tide\`neap\`);
    output allowed: Bool;
    allowed <- value;
  }`), /output allowed must be Bool/);
});

test('all Reference tide classes and moon phases are accepted', () => {
  const classifications = [
    ['tide_is', 'TidePredictions', 'tide', 'spring'],
    ['tide_is', 'TidePredictions', 'tide', 'neap'],
    ...['new', 'waxing_crescent', 'first_quarter', 'waxing_gibbous', 'full',
      'waning_gibbous', 'last_quarter', 'waning_crescent']
      .map(phase => ['moon_is', 'LunarEphemeris', 'moon', phase]),
  ];
  for (const [operation, providerType, tag, classification] of classifications) {
    const manifest = typeCheckControl(`control NaturalClass {
      provider context: ${providerType};
      let value = ${operation}(context, ${tag}\`${classification}\`);
      output allowed: Bool;
      allowed <- case value { ok(value) => value; fault(_) => false; };
    }`).manifest;
    assert.equal(manifest.naturalConditions[0].classification, classification);
  }
});

for (const classification of ['spring', 'neap']) {
  test(`${classification}: canonical condition has a source-bound descriptor and explicit fault branch`, async () => {
    const source = fixture.source.replace('tide`neap`', `tide\`${classification}\``);
    const compiled = await compileSource(source, { filename: fixture.filename });
    const condition = compiled.manifest.naturalConditions.find(item => item.operation === 'tide_is');
    assert.equal(condition.classification, classification);
    assert.equal(condition.provider, 'harbor_tides');
    assert.deepEqual(condition.result, { value: 'Bool', error: 'TemporalContextFault' });
    const mapped = compiled.sourceMap.find(node => node.id === condition.site);
    assert.equal(mapped.kind, 'call');
    assert.equal(mapped.line, source.split('\n').findIndex(line => line.includes('tide_is(')) + 1);
    const extracted = extractLiterate(source, { filename: fixture.filename }).code;
    assert.equal(extracted.slice(mapped.offset, mapped.endOffset), 'tide_is');

    const wrongFaultBranch = source.replace('fault(_) => false', 'fault(_) => 5min');
    await assert.rejects(() => compileSource(wrongFaultBranch, { filename: fixture.filename }), /case branches/);
    const missingFaultBranch = source.replace('fault(_) => false;', '');
    await assert.rejects(() => compileSource(missingFaultBranch, { filename: fixture.filename }), /exhaustive|fault/);
  });
}
