import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
const nativePath = path.join(root, `target/release/examples/context_tape${process.platform === 'win32' ? '.exe' : ''}`);
const activation = { bootEpoch: 1, terminalCapacity: 64, bindings: [] };
const day = Date.UTC(2026, 0, 1);
const minute = 60_000;
const hour = 3_600_000;

const source = (initial = '[time`08:00`]') => `# REF-03-078 TimeSlots Range\n\n<!-- ghostflow:anchor id=GF-INT-REF-03-078 kind=intent status=confirmed origin=user -->\nIssue [#267](https://github.com/callin2/ghostflow-language/issues/267) requires whole-event Range overlap rejection while preserving accepted keyed history.\n\n\`\`\`ghost\ncontrol RangeTimeSlots {\n  config enabled: Bool = false { access = operator; }\n  // ghostflow:link id=GF-INT-REF-03-078 relation=implements\n  config watering_slots: TimeSlots<1min, 8> = ${initial} { access = operator; }\n  schedule watering: DailySlots<1min> {\n    timezone = "UTC";\n    selected = watering_slots;\n    dst_missing = skip;\n    dst_repeated = first;\n    basis = range(20min);\n    when = true;\n    cancel_when = false;\n    clock = trusted_only;\n    gap = skip_after(60s);\n    recovery = baseline;\n    fallback = skip;\n  }\n  output pump: Bool;\n  pump <- watering.active;\n}\n\`\`\`\n`;

function facts(site, mono, wall, settings = null, trusted = true) {
  return { clock: { monotonicMs: mono, bootEpoch: 1, wallMs: wall, uncertaintyMs: 0,
    trusted, unknownReason: trusted ? null : 'ClockUnknown', sourceRevision: 'range-timeslots-v1' },
  natural: [], schedules: [{ site, coverageStartMs: 0, coverageEndMs: 253402300799999,
    provider: null, calendar: null, rows: [] }], settings };
}

function event(fingerprint, changes, eventId, baseRevision, position) {
  return { programFingerprint: fingerprint, eventId, baseRevision, position, origin: 'operatorEdit', changes };
}
const slotsChange = (configId, entries) => ({ configId, result: { ok: true, type: 'TimeSlots<60000ms,8>', value: { kind: 'slots', entries } } });
const boolChange = (configId, value) => ({ configId, result: { ok: true, type: 'Bool', value } });

async function artifact(initial = '[time`08:00`]') {
  const out = await compileSource(source(initial), { filename: 'range-timeslots-overlap.ghost.md' });
  out.bytes = Buffer.from(out.bytes);
  assert.equal(out.bytes.readUInt16LE(4), 20);
  assert.equal(out.manifest.format, 'GhostFlow/control-v20');
  assert.equal(out.manifest.bytecodeSha256, sha256Hex(out.bytes));
  assert.equal(out.manifest.schedules[0].selectedConfig, 'watering_slots');
  return out;
}

async function run(steps, { initial, checkpoint = null, compilation } = {}) {
  const a = compilation ?? await artifact(initial);
  const site = a.manifest.schedules[0].site;
  const boolId = a.manifest.configs.find(c => c.name === 'enabled')?.id;
  const slotsId = a.manifest.configs.find(c => c.name === 'watering_slots')?.id;
  const durationId = a.manifest.configs.find(c => c.name === 'duration')?.id;
  const probe = await ControlRuntime.instantiateFramed(wasm, a, { context: activation });
  const fingerprint = probe.contextSnapshot().state.programFingerprint;
  probe.dispose();
  const frames = steps.map((step, scanId) => ({ scanId: step.scanId ?? scanId, logicalTimeMs: step.mono, inputs: [],
    ...facts(site, step.mono, step.wall, step.settings?.({ fingerprint, boolId, slotsId, durationId }), step.trusted ?? true) }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-range-timeslots-'));
  const runtime = await ControlRuntime.instantiateFramed(wasm, a, { context: activation });
  if (checkpoint) runtime.restoreContextCheckpoint(Buffer.from(checkpoint, 'hex'));
  try {
    const artifactPath = path.join(dir, 'module.gfb');
    const tapePath = path.join(dir, 'tape.json');
    fs.writeFileSync(artifactPath, a.bytes);
    fs.writeFileSync(tapePath, JSON.stringify({ profile: 'context-settings-civil-v1', activation, steps: frames, checkpoint }));
    const native = spawnSync(nativePath, [artifactPath, tapePath], { encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(native.status, 0, native.stderr || native.stdout);
    const rows = native.stdout.trim().split('\n').map(line => JSON.parse(line));
    const wasmRows = frames.map(frame => {
      try {
        const step = runtime.step({ nowMs: frame.logicalTimeMs, inputs: {}, contextFacts: facts(site, frame.logicalTimeMs, frame.clock.wallMs, frame.settings, frame.clock.trusted) });
        return { accepted: true, vm: step.vm, checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex'), settings: runtime.contextSnapshot().state };
      } catch (error) {
        return { accepted: false, error: error.message, checkpoint: Buffer.from(runtime.contextSnapshot().bytes).toString('hex'), settings: runtime.contextSnapshot().state };
      }
    });
    rows.forEach((row, i) => {
      assert.equal(row.accepted, wasmRows[i].accepted, `native/WASM acceptance ${i}: native=${row.error ?? 'accepted'} wasm=${wasmRows[i].error ?? 'accepted'}`);
      assert.deepEqual(row.settings, wasmRows[i].settings, `native/WASM settings ${i}`);
      assert.equal(row.checkpoint, wasmRows[i].checkpoint, `native/WASM checkpoint ${i}`);
      if (row.accepted) assert.deepEqual(row.outcome.trace, wasmRows[i].vm, `native/WASM trace ${i}`);
    });
    return { artifact: a, rows, ids: { boolId, slotsId, fingerprint } };
  } finally {
    runtime.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const decisions = row => row.outcome?.trace.contextTrace.map(e => e.decision).filter(d => d !== 'ObservationGap' && !d.startsWith('Settings')) ?? [];
const occurrenceIds = row => row.outcome?.trace.contextTrace.filter(e => e.occurrenceId && !e.decision.startsWith('Settings')).map(e => e.occurrenceId) ?? [];
const slotEntries = row => {
  const value = row.settings.settings.find(setting => setting.name === 'watering_slots').result.value;
  return value.entries ?? value;
};

const at0800 = 8 * hour;
const entry = (key, minuteOfDay) => ({ key, minuteOfDay });

test('REF-03-078 TimeSlots Range rejects overlap before commit and accepts touching replacement', async () => {
  const start = day + at0800;
  const rows = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: minute, wall: start + 5 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [entry(1, 8 * 60), entry(0, 8 * 60 + 15)])], 'overlap-0815', 0, 2) },
    { scanId: 1, mono: 2 * minute, wall: start + 6 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [entry(1, 8 * 60), entry(0, 8 * 60 + 20)])], 'touch-0820', 0, 2) },
  ]).then(r => r.rows);
  assert.deepEqual(rows.map(r => r.accepted), [true, false, true]);
  assert.equal(rows[1].checkpoint, rows[0].checkpoint, 'overlap rejection leaves complete checkpoint unchanged');
  assert.deepEqual(rows[1].settings, rows[0].settings, 'overlap rejection leaves settings and allocator unchanged');
  assert.match(rows[1].error, /overlapping UTC Range/);
  assert.equal(rows[2].settings.settingsRevision, 1);
  assert.deepEqual(rows[2].settings.settings[1].result, { ok: true, value: { kind: 'slots', entries: [entry(1,480),entry(2,500)] } });
  assert.deepEqual(rows.map(row => row.outcome?.trace.safe.pump), [true, undefined, true]);
  assert.equal(occurrenceIds(rows[2])[0], occurrenceIds(rows[0])[0]);
});

test('REF-03-078 mixed Bool plus overlapping TimeSlots event rolls back whole event', async () => {
  const start = day + at0800;
  const rows = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: minute, wall: start + 5 * minute, settings: ({ fingerprint, boolId, slotsId }) => event(fingerprint, [
      boolChange(boolId, true),
      slotsChange(slotsId, [entry(1, 480), entry(0, 495)]),
    ], 'mixed-overlap', 0, 2) },
  ]).then(r => r.rows);
  assert.deepEqual(rows.map(r => r.accepted), [true, false]);
  assert.equal(rows[1].checkpoint, rows[0].checkpoint);
  assert.deepEqual(rows[1].settings, rows[0].settings);
  assert.equal(rows[1].settings.settings[0].result.value, false, 'Bool change must not partially commit');
});

test('REF-03-078 empty TimeSlots Range is valid and produces no fallback plan', async () => {
  const start = day + at0800;
  const rows = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: minute, wall: start + 5 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [])], 'empty', 0, 2) },
    { mono: 2 * minute, wall: start + 6 * minute },
  ]).then(r => r.rows);
  assert.deepEqual(rows.map(r => r.accepted), [true, true, true]);
  assert.deepEqual(rows[1].settings.settings[1].result.value.entries, []);
  assert.deepEqual(decisions(rows[2]), ['Active'], 'empty future list does not cancel already admitted occurrence');
});

test('REF-03-078 retained-key retime preserves occurrence and removed key active retention', async () => {
  const start = day + at0800;
  const rows = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: 3 * minute, wall: start + 7 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [entry(1, 8 * 60 + 15)])], 'retime-0815', 0, 2) },
    { mono: 12 * minute, wall: start + 16 * minute },
    { mono: 13 * minute, wall: start + 17 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [])], 'remove-active', 1, 4) },
    { mono: 32 * minute, wall: start + 35 * minute },
  ]).then(r => r.rows);
  assert.deepEqual(rows.map(r => r.accepted), [true, true, true, true, true]);
  assert.equal(new Set(rows.flatMap(occurrenceIds)).size, 1);
  assert.deepEqual(rows.map(decisions), [['Due'], ['Waiting'], ['Active'], ['Active'], ['Completed']]);
});

test('REF-03-078 added baseline and re-add fresh key prevent same-window admission', async () => {
  const start = day + at0800;
  const rows = await run([
    { mono: 0, wall: start + 21 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [entry(1, 480), entry(0, 500)])], 'add-0820-too-late', 0, 1) },
    { mono: minute, wall: start + 22 * minute },
    { mono: 2 * minute, wall: start + 23 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [entry(1, 480)])], 'remove-0820', 1, 3) },
    { mono: 3 * minute, wall: start + 24 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [entry(1, 480), entry(0, 500)])], 'readd-0820-fresh', 2, 4) },
  ]).then(r => r.rows);
  assert.deepEqual(rows.map(r => r.accepted), [true, true, true, true]);
  assert.deepEqual(slotEntries(rows[0]), [entry(1,480),entry(2,500)]);
  assert.deepEqual(slotEntries(rows[3]), [entry(1,480),entry(3,500)]);
  assert.deepEqual(rows.map(row => row.outcome.trace.safe.pump), [false,false,false,false]);
  assert.equal(rows.flatMap(decisions).filter(decision => decision === 'Due').length, 0);
  assert.equal(rows[3].settings.settingsRevision, 3);
});

test('REF-03-078 accepted fault advances revision without deriving Range plan and recovery restores exact checkpoint parity', async () => {
  const start = day + at0800;
  const faultChange = slotsId => ({ configId: slotsId, result: { ok: false, fault: 'SettingsInvalid' } });
  const first = await run([
    { mono: 0, wall: start + 4 * minute },
    { mono: 2 * minute, wall: start + 6 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [faultChange(slotsId)], 'fault', 0, 2) },
    { mono: 3 * minute, wall: start + 7 * minute, settings: ({ fingerprint, slotsId }) => event(fingerprint, [slotsChange(slotsId, [entry(1, 480), entry(0, 500)])], 'recover-touch', 1, 3) },
    { mono: 4 * minute, wall: start + 8 * minute },
  ]);
  assert.deepEqual(first.rows.map(r => r.accepted), [true, true, true, true]);
  assert.equal(first.rows[1].settings.settingsRevision, 1);
  assert.deepEqual(first.rows[1].settings.settings[1].result, { ok: false, fault: 'SettingsInvalid' });
  assert.deepEqual(decisions(first.rows[1]), ['Unknown(SettingsInvalid)']);
  assert.equal(first.rows[2].settings.settingsRevision, 2);
  assert.deepEqual(slotEntries(first.rows[2]), [entry(1,480),entry(2,500)]);
  assert.equal(first.rows[2].outcome.trace.safe.pump, true);
  assert.equal(occurrenceIds(first.rows[2])[0], occurrenceIds(first.rows[0])[0]);
  const faultRestored = await run([{mono:0,wall:start+7*minute}], { checkpoint:first.rows[1].checkpoint });
  assert.deepEqual(faultRestored.rows[0].settings.settings[1].result, {ok:false,fault:'SettingsInvalid'});
  assert.deepEqual(decisions(faultRestored.rows[0]), ['Unknown(SettingsInvalid)']);
  const inconsistentFault=Buffer.from(first.rows[1].checkpoint,'hex');
  const faultMarker=inconsistentFault.indexOf(Buffer.from('GFES\x02GFRG\x04','latin1'));
  assert.ok(faultMarker>0);
  assert.equal(inconsistentFault.readUInt16LE(faultMarker+10),1);
  // Keep the engine list valid on its authored grid, but disagree with config
  // last_success. Repair the envelope CRC so semantic consistency is checked.
  inconsistentFault.writeUInt16LE(481,faultMarker+20);
  fixChecksum(inconsistentFault);
  const faultOwner=await ControlRuntime.instantiateFramed(wasm,first.artifact,{context:activation});
  try{
    const before=Buffer.from(faultOwner.contextSnapshot().bytes).toString('hex');
    assert.throws(()=>faultOwner.restoreContextCheckpoint(inconsistentFault),/config consumer value mismatch/);
    assert.equal(Buffer.from(faultOwner.contextSnapshot().bytes).toString('hex'),before);
  }finally{faultOwner.dispose();}
  await assertNativeRejected(first.artifact,{checkpoint:inconsistentFault.toString('hex')},/config consumer value mismatch/);
  const restored = await run([
    { mono: 0, wall: start + 20 * minute - 1 },
    { mono: 1, wall: start + 20 * minute },
  ], { checkpoint: first.rows.at(-1).checkpoint });
  assert.deepEqual(restored.rows.map(r => r.outcome.trace.safe.pump), [false, true]);
  assert.deepEqual(slotEntries(restored.rows[1]), [entry(1,480),entry(2,500)]);
  assert.ok(occurrenceIds(restored.rows[1]).some(id => id.endsWith(':2')));
});

test('REF-03-078 malformed TimeSlots Range manifests are rejected by framed runtime', async () => {
  const a = await artifact();
  for (const mutate of [
    m => { m.format = 'GhostFlow/control-v19'; },
    m => { m.schedules[0].timezone = 'Asia/Seoul'; },
    m => { m.configs.find(c => c.name === 'watering_slots').type = 'Bool'; },
    m => { m.schedules[0].policy.basis.durationConfig = 'duration'; },
    m => { m.schedules[0].slots = [481]; },
  ]) {
    const manifest = structuredClone(a.manifest);
    mutate(manifest);
    await assert.rejects(() => ControlRuntime.instantiateFramed(wasm, { ...a, manifest }, { context: activation }), /Range|manifest|metadata|matching|UTC|TimeSlots/);
  }
});

test('REF-03-078 original live Duration proposal rejects 20 minute overlap atomically and accepts 15 minute touching intervals', async () => {
  const durationSource = source()
    .replace('config watering_slots: TimeSlots<1min, 8> = [time`08:00`] { access = operator; }',
      'config duration: Duration = 10min { min = 5min; max = 20min; step = 1min; access = operator; }')
    .replace('DailySlots<1min>', 'DailySlots<15min>')
    .replace('selected = watering_slots;', 'selected = [08:00, 08:15];')
    .replace('basis = range(20min);', 'basis = range(duration);');
  const compilation = await compileSource(durationSource, { filename:'range-duration-overlap.ghost.md' });
  assert.equal(Buffer.from(compilation.bytes).readUInt16LE(4),12);
  const start=day+at0800;
  const change=(configId,value)=>({configId,result:{ok:true,type:'Duration',value}});
  const {rows}=await run([
    {mono:0,wall:start+4*minute},
    {mono:minute,wall:start+5*minute,settings:({fingerprint,durationId})=>event(fingerprint,[change(durationId,20*minute)],'duration-overlap',0,2)},
    {scanId:1,mono:2*minute,wall:start+6*minute,settings:({fingerprint,durationId})=>event(fingerprint,[change(durationId,15*minute)],'duration-touching',0,2)},
  ],{compilation});
  assert.deepEqual(rows.map(row=>row.accepted),[true,false,true]);
  assert.match(rows[1].error,/overlap/);
  assert.equal(rows[1].checkpoint,rows[0].checkpoint);
  assert.deepEqual(rows[1].settings,rows[0].settings);
  assert.deepEqual(rows[2].settings.settings.find(setting=>setting.name==='duration').result,{ok:true,value:15*minute});
  assert.equal(rows[2].settings.settingsRevision,1);
  assert.equal(rows[2].outcome.trace.safe.pump,true);
  assert.equal(occurrenceIds(rows[2])[0],occurrenceIds(rows[0])[0]);
  assert.equal(rows.flatMap(decisions).filter(decision=>decision==='Due').length,1);
});

test('REF-03-078 admitted removed-key interval participates in whole-event overlap preflight', async () => {
  const start=day+at0800;
  const {rows}=await run([
    {mono:0,wall:start+4*minute},
    {mono:minute,wall:start+5*minute,settings:({fingerprint,slotsId})=>event(fingerprint,[slotsChange(slotsId,[entry(0,490)])],'replace-admitted-overlap',0,2)},
  ]);
  assert.deepEqual(rows.map(row=>row.accepted),[true,false]);
  assert.match(rows[1].error,/overlap.*admitted/);
  assert.equal(rows[1].checkpoint,rows[0].checkpoint);
  assert.deepEqual(rows[1].settings,rows[0].settings);
});

test('REF-03-078 initially empty keyed Range uses GFRG4 and restores without inventing an occurrence', async () => {
  const first=await run([{mono:0,wall:day+at0800+4*minute}],{initial:'[]'});
  assert.equal(first.rows[0].accepted,true);
  assert.equal(first.rows[0].outcome.trace.safe.pump,false);
  assert.deepEqual(slotEntries(first.rows[0]),[]);
  assert.ok(Buffer.from(first.rows[0].checkpoint,'hex').includes(Buffer.from('GFES\x02GFRG\x04','latin1')));
  const restored=await run([{mono:0,wall:day+at0800+5*minute}],{initial:'[]',checkpoint:first.rows[0].checkpoint});
  assert.equal(restored.rows[0].accepted,true);
  assert.deepEqual(slotEntries(restored.rows[0]),[]);
  assert.equal(restored.rows[0].outcome.trace.safe.pump,false);
});

test('REF-03-078 checkpoint preserves key order after valid retime reverses displayed time order', async () => {
  const start=day+at0800;
  const initial='[time`08:00`, time`08:40`]';
  const first=await run([
    {mono:0,wall:start+4*minute},
    {mono:3*minute,wall:start+7*minute,settings:({fingerprint,slotsId})=>event(fingerprint,[slotsChange(slotsId,[entry(1,540),entry(2,520)])],'reorder-retained-keys',0,2)},
  ],{initial});
  assert.deepEqual(first.rows.map(row=>row.accepted),[true,true]);
  assert.deepEqual(slotEntries(first.rows[1]),[entry(1,540),entry(2,520)]);
  const restored=await run([
    {mono:0,wall:start+40*minute-1},
    {mono:1,wall:start+40*minute},
  ],{initial,checkpoint:first.rows[1].checkpoint});
  assert.deepEqual(restored.rows.map(row=>row.accepted),[true,true]);
  assert.deepEqual(slotEntries(restored.rows[1]),[entry(1,540),entry(2,520)]);
  assert.deepEqual(restored.rows.map(row=>row.outcome.trace.safe.pump),[false,true]);
  assert.ok(occurrenceIds(restored.rows[1]).some(id=>id.endsWith(':2')));
});

async function assertNativeRejected(compilation,{bytes=compilation.bytes,checkpoint=null}={},match=/Range|UTC|checkpoint|invalid|corrupt|truncated|capacity/i){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ghostflow-range-rejection-'));
  try{
    const modulePath=path.join(dir,'module.gfb'),tapePath=path.join(dir,'tape.json');
    fs.writeFileSync(modulePath,bytes);
    fs.writeFileSync(tapePath,JSON.stringify({profile:'context-settings-civil-v1',activation,checkpoint,steps:[]}));
    const result=spawnSync(nativePath,[modulePath,tapePath],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
    assert.notEqual(result.status,0);
    assert.match(result.stderr||result.stdout,match);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function fixChecksum(bytes){
  let crc=0xffffffff;
  for(const byte of bytes.subarray(0,-4)){
    crc^=byte;
    for(let bit=0;bit<8;bit++) crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;
  }
  bytes.writeUInt32LE((crc^0xffffffff)>>>0,bytes.length-4);
  return bytes;
}

test('REF-03-078 actual native and WASM loaders reject valid-layout non-UTC GFB20 Range metadata', async () => {
  const compiled=await artifact();
  const bytes=Buffer.from(compiled.bytes);
  const at=bytes.indexOf(Buffer.from('UTC'));
  assert.ok(at>0);
  bytes.write('EST',at,'ascii');
  const runtime=await FramedGhostFlowRuntime.instantiate(wasm);
  try{assert.throws(()=>runtime.load(bytes),/TimeSlots Range requires UTC/);}finally{runtime.dispose();}
  await assertNativeRejected(compiled,{bytes},/TimeSlots Range requires UTC/);
});

test('REF-03-078 repaired malformed GFRG4 checkpoints reject without mutating native or WASM owners', async () => {
  const start=day+at0800;
  const first=await run([
    {mono:0,wall:start+4*minute},
    {mono:minute,wall:start+5*minute,settings:({fingerprint,slotsId})=>event(fingerprint,[slotsChange(slotsId,[entry(1,480),entry(0,500)])],'checkpoint-two-keys',0,2)},
  ]);
  const good=Buffer.from(first.rows[1].checkpoint,'hex');
  const marker=good.indexOf(Buffer.from('GFES\x02GFRG\x04','latin1'));
  assert.ok(marker>0);
  assert.equal(good.readUInt16LE(marker+10),2);
  const allocator=marker+32,addedCount=allocator+8;
  assert.equal(good.readUInt16LE(addedCount),1);
  const mutations=[
    ['profile downgrade',b=>{b[marker+9]=1;return fixChecksum(b);}],
    ['zero slot key',b=>{b.writeBigUInt64LE(0n,marker+12);return fixChecksum(b);}],
    ['overlapping displayed slots',b=>{b.writeUInt16LE(490,marker+30);return fixChecksum(b);}],
    ['allocator does not follow keys',b=>{b.writeBigUInt64LE(2n,allocator);return fixChecksum(b);}],
    ['allocator disagrees with shared config history',b=>{b.writeBigUInt64LE(4n,allocator);return fixChecksum(b);}],
    ['out-of-range addition baseline',b=>{b.writeBigUInt64LE(1n,addedCount+2);b.writeBigUInt64LE(0xffffffffffffffffn,addedCount+10);return fixChecksum(b);}],
    ['truncated envelope',b=>b.subarray(0,-1)],
  ];
  for(const [label,mutate] of mutations){
    const bad=mutate(Buffer.from(good));
    const runtime=await ControlRuntime.instantiateFramed(wasm,first.artifact,{context:activation});
    try{
      const before=Buffer.from(runtime.contextSnapshot().bytes).toString('hex');
      assert.throws(()=>runtime.restoreContextCheckpoint(bad),/Range|checkpoint|invalid|corrupt|truncated/i,label);
      assert.equal(Buffer.from(runtime.contextSnapshot().bytes).toString('hex'),before,label);
    }finally{runtime.dispose();}
    await assertNativeRejected(first.artifact,{checkpoint:bad.toString('hex')});
  }
});

test('REF-03-078 unknown-clock insertion rejects without inventing a wall baseline and trusted retry cannot replay an elapsed start', async () => {
  const start=day+at0800;
  const change=({fingerprint,slotsId})=>event(fingerprint,[slotsChange(slotsId,[entry(0,495)])],'unknown-baseline',0,2);
  const result=await run([
    {mono:0,wall:start+14*minute},
    {mono:2*minute,wall:start+16*minute,trusted:false,settings:change},
    {scanId:1,mono:3*minute,wall:start+17*minute,settings:change},
    {scanId:2,mono:4*minute,wall:start+18*minute},
  ],{initial:'[]'});
  const [before,rejected,accepted,after]=result.rows;
  assert.equal(rejected.accepted,false);
  assert.match(rejected.error,/trusted wall baseline/);
  assert.equal(rejected.checkpoint,before.checkpoint);
  assert.deepEqual(rejected.settings,before.settings);
  assert.equal(accepted.accepted,true);
  assert.deepEqual(slotEntries(accepted),[entry(1,495)]);
  assert.equal(accepted.settings.settingsRevision,1);
  for(const row of [accepted,after]){
    assert.equal(row.outcome.trace.safe.pump,false);
    assert.ok(!decisions(row).includes('Due'));
  }
});

test('REF-03-078 canonical compilation rejects unsupported zones combined live Duration overlapping initial lists and invalid grids', async () => {
  const canonical=source();
  const proposals=[
    canonical.replace('timezone = "UTC";','timezone = "Asia/Seoul";'),
    canonical.replace('schedule watering:', 'config duration: Duration = 20min { min = 1min; max = 20min; step = 1min; access = operator; }\n  schedule watering:').replace('basis = range(20min);','basis = range(duration);'),
    source('[time`08:00`, time`08:15`]'),
    source('[time`00:00`, time`23:50`]'),
    canonical.replaceAll('1min','7min'),
  ];
  for(const proposal of proposals){
    await assert.rejects(()=>compileSource(proposal,{filename:'unsupported-timeslots-range.ghost.md'}),/UTC|unsupported|Range|range|overlap|grid|divide/i);
  }
});
