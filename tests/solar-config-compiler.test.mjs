import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileControl } from '../tools/control.mjs';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { lowerCoreModule, compile } from '../tools/gfb1.mjs';

test('the bilingual Solar live-config example preserves the executable program', () => {
  const canonical = fs.readFileSync(new URL('../examples/solar-live-config.ghost.md', import.meta.url), 'utf8');
  const projection = fs.readFileSync(new URL('../examples/solar-live-config.ghost.en.md', import.meta.url), 'utf8');
  const fences = text => [...text.matchAll(/```ghost\n([\s\S]*?)\n```/g)].map(match => match[1]);
  assert.ok(fences(canonical).length > 0);
  assert.deepEqual(fences(projection), fences(canonical));
  const artifact = compileSourceSync(canonical, { filename: 'solar-live-config.ghost.md' });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v15');
  assert.deepEqual(artifact.manifest.schedules[0].configIds, [artifact.manifest.configs[0].id]);
});

const source = (when = 'case enabled { ok(v) => v; fault(_) => false; }', extra = '') => `control SolarSettings {
  config enabled: Bool = true { access = operator; }
  config unused: Bool = false { access = operator; }
  schedule dawn: Solar { timezone = "Asia/Seoul"; latitude = 37.5665; longitude = 126.978;
    at = sun\`rise + 30min\`; basis = pulse; when = ${when}; clock = trusted_only;
    gap = skip_after(60s); recovery = baseline; fallback = skip; }
  ${extra}
  output due: Bool; due <- dawn.due;
}`;

test('Solar with typed live config emits the context execution format and exact referenced dependency', () => {
  const artifact = compileControl(source());
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v15');
  assert.equal(Buffer.from(artifact.bytes).readUInt16LE(4), 16);
  assert.deepEqual(artifact.manifest.schedules[0].configIds, [artifact.manifest.configs[0].id]);
  assert.equal(artifact.manifest.schedules[0].offsetMs, 1800000);
});

const core = (predicate, deps) => ['module', 'SolarCore', ['version', '1'],
  ...[['__gf_now_ms','number'],['__gf_time_epoch','number'],['a_ok','bool'],['a_value','bool'],['a_fault','number']]
    .map(([name,type]) => ['input',name,type]), ['temporal-context','__gf_now_ms','__gf_time_epoch'],
  ['strategy','control','0',['device','true'],
    ['config-stream','1','enabled','Bool','Bool','true',['scalar','true','none'],'a_ok','a_value','a_fault'],
    ['solar-context-pulse','3','dawn','60000','UTC','37','127','rise','1800000','86400000',
      ['config-deps',...deps.map(String)],predicate,'false','0'], ['intent','due',['schedule-read','1','due']]]];

test('Solar config dependencies include fault-only reads and allow independent predicates', () => {
  const artifact = compileControl(source('case enabled { ok(_) => true; fault(_) => true; }'));
  assert.deepEqual(artifact.manifest.schedules[0].configIds, [artifact.manifest.configs[0].id]);
  assert.deepEqual(compileControl(source('true')).manifest.schedules[0].configIds, []);
  const module = core(['eq','input.a_fault','1'], [1]);
  assert.deepEqual(lowerCoreModule(module).strategies[0].extensions.preludes[1].value.detail.configIds, [1]);
  assert.equal(Buffer.from(compile(core('true', []))).readUInt16LE(4),16);
});

test('Solar context encoding rejects forged missing, extra and duplicate dependencies', () => {
  for (const deps of [[], [2], [1,1]]) assert.throws(() => compile(core('input.a_value',deps)), /Solar config dependenc/);
});

test('Solar retains typed predicate and missing-reference checks', () => {
  assert.throws(() => compileControl(source('case missing { ok(v) => v; fault(_) => false; }')), /unknown identifier missing/);
  assert.throws(() => compileControl(source('1')), /Bool|boolean/i);
  assert.throws(() => compileControl(source().replace('latitude = 37.5665', 'latitude = enabled')), /literal/);
});

test('Solar context supports explicit hold/fixed fallback but rejects legacy civil mixtures', () => {
  const extended = compileControl(source().replace('clock = trusted_only', 'clock = hold_trusted(10min, terminal: skip)')
    .replace('fallback = skip', 'fallback = fixed_time(time`06:00`, terminal: skip)'));
  assert.equal(extended.manifest.schedules[0].policy.clock.durationMs,600000);
  assert.equal(extended.manifest.schedules[0].policy.fallback.atMs,21600000);
  assert.equal(Buffer.from(extended.bytes).readUInt16LE(4),16);
  assert.throws(() => compileControl(source('true', 'schedule ordinary: Daily { timezone = "UTC"; at = time`06:00`; dst_missing = skip; dst_repeated = first; basis = pulse; when = true; clock = trusted_only; gap = skip_after(60s); recovery = baseline; fallback = skip; }')), /config streams cannot mix/);
  assert.throws(() => compileControl(source('true', 'schedule slots: DailySlots<15min> { timezone = "UTC"; selected = [06:00]; dst_missing = skip; dst_repeated = first; basis = pulse; when = true; clock = trusted_only; gap = skip_after(60s); recovery = baseline; fallback = skip; }')), /config streams cannot mix/);
});
