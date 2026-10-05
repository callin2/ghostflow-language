import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { compileSourceSync } from '../tools/compile-source.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const qualities = ['NotReady', 'Disconnected', 'Stale', 'Invalid'];
const programs = [
  ['tutorial', 'examples/tutorial/01-latch.ghost.md', ['start', 'stop']],
  ['irrigation', 'examples/irrigation.ghost.md', ['start', 'stop', 'low_water', 'moisture']],
];

for (const framed of [false, true]) {
  const mode = framed ? 'framed' : 'plain';
  const instantiate = artifact => (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate).call(ControlRuntime, wasm, artifact);
  test(`PC-01/${mode}: lamp has explicit fault OFF with no START requirement`, async () => {
    const filename = 'examples/curriculum/generated/pc-01-e01.generated.ghost.md';
    const artifact = compileSourceSync(fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8'), { filename });
    assert.deepEqual(artifact.manifest.sensors.map(sensor => sensor.name), ['switch_on']);
    const runtime = await instantiate(artifact);
    try {
      for (const [index, [quality, value, expected]] of [
        ['Good', true, true], ...qualities.map(quality => [quality, true, false]),
        ['Good', false, false], ['Good', true, true],
      ].entries()) {
        const id = index + 1;
        const row = runtime.step({ nowMs: id, samples: { switch_on: { epoch: 1, id, timestampMs: id, quality, value } } });
        assert.equal(row.vm.safe.lamp, expected);
        assert.equal(row.sensors.switch_on.quality, quality);
      }
    } finally { runtime.dispose(); }
  });
  for (const quality of qualities) test(`PC-02/${mode}: ${quality} STOP permission fault stops and requires healthy release`, async () => {
    const filename = 'examples/curriculum/pc-02-start-stop.ghost.md';
    const artifact = compileSourceSync(fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8'), { filename });
    const runtime = await instantiate(artifact);
    const step = (id, start, stopQuality = 'Good') => runtime.step({ nowMs: id, samples: {
      start: { epoch: 1, id, timestampMs: id, quality: 'Good', value: start },
      stop_ok: { epoch: 1, id, timestampMs: id, quality: stopQuality, value: true },
    } });
    try {
      assert.equal(step(1, true).vm.safe.pump, false, 'original PC-02 requires initial healthy release');
      assert.equal(step(2, false).vm.safe.pump, false);
      assert.equal(step(3, true).vm.safe.pump, true);
      assert.equal(step(4, false, quality).vm.safe.pump, false);
      assert.equal(step(5, true).vm.safe.pump, false, 'release during fault cannot arm');
      assert.equal(step(6, false).vm.safe.pump, false);
      assert.equal(step(7, true).vm.safe.pump, true);
    } finally { runtime.dispose(); }
  });
}

test('approved input revisions preserve exact predecessor source bytes separately', () => {
  const history = JSON.parse(fs.readFileSync(new URL('./fixtures/history/issue531/programs.json', import.meta.url), 'utf8'));
  for (const record of history.programs) {
    const snapshot = fs.readFileSync(new URL(`../${record.snapshot}`, import.meta.url));
    assert.equal(createHash('sha256').update(snapshot).digest('hex'), record.sha256);
    const current = fs.readFileSync(new URL(`../${record.source}`, import.meta.url));
    assert.notEqual(createHash('sha256').update(current).digest('hex'), record.sha256);
    assert.match(current.toString('utf8'), /issue531-approved-fault-restart-v1/);
  }
});

for (const [program, filename, names] of programs) for (const framed of [false, true]) {
  const mode = framed ? 'framed' : 'plain';
  const artifact = compileSourceSync(fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8'), { filename });
  const instantiate = () => (framed ? ControlRuntime.instantiateFramed : ControlRuntime.instantiate).call(ControlRuntime, wasm, artifact);
  const packets = (id, values = {}, faults = {}) => Object.fromEntries(names.map(name => [name, {
    epoch: 1, id, timestampMs: id, quality: faults[name] ?? 'Good',
    value: values[name] ?? (name === 'moisture' ? 0 : false),
  }]));

  test(`${program}/${mode}: healthy latch and simultaneous STOP priority remain`, async () => {
    const runtime = await instantiate();
    try {
      for (const [index, [start, stop, expected]] of [
        [true, false, true], [false, false, true], [true, true, false],
        [false, false, false], [true, false, true],
      ].entries()) {
        const id = index + 1;
        const row = runtime.step({ nowMs: id, samples: packets(id, { start, stop }) });
        assert.equal(row.vm.safe.pump, expected);
        assert.equal(row.vm.safe.valve, expected);
      }
    } finally { runtime.dispose(); }
  });

  for (const quality of qualities) {
    test(`${program}/${mode}: ${quality} START blocks inactive starts and preserves a protected active run`, async () => {
      for (const active of [false, true]) {
        const runtime = await instantiate();
        try {
          runtime.step({ nowMs: 1, samples: packets(1, { start: active }) });
          const fault = runtime.step({ nowMs: 2, samples: packets(2, { start: true }, { start: quality }) });
          assert.equal(fault.sensors.start.quality, quality);
          assert.equal(fault.vm.safe.pump, active);
          assert.equal(fault.vm.safe.valve, active);
          assert.equal(runtime.step({ nowMs: 3, samples: packets(3, { start: true }) }).vm.safe.pump, active);
          runtime.step({ nowMs: 4, samples: packets(4, { start: false }) });
          assert.equal(runtime.step({ nowMs: 5, samples: packets(5, { start: true }) }).vm.safe.pump, true);
        } finally { runtime.dispose(); }
      }
    });

    for (const source of names.includes('low_water') ? ['stop', 'low_water'] : ['stop']) {
      test(`${program}/${mode}: ${quality} ${source} releases the run and requires healthy START off then on`, async () => {
        const runtime = await instantiate();
        try {
          assert.equal(runtime.step({ nowMs: 1, samples: packets(1, { start: true }) }).vm.safe.pump, true);
          const fault = runtime.step({ nowMs: 2, samples: packets(2, { start: true }, { [source]: quality }) });
          assert.equal(fault.vm.safe.pump, false);
          assert.equal(fault.vm.safe.valve, false);
          assert.equal(fault.sensors[source].quality, quality);
          if (source === 'low_water') assert.equal(fault.vm.stateAfter.low_fault, true);
          assert.equal(runtime.step({ nowMs: 3, samples: packets(3, { start: false }, { [source]: quality }) }).vm.safe.pump, false);
          assert.equal(runtime.step({ nowMs: 4, samples: packets(4, { start: true }) }).vm.safe.pump, false, 'release during a fault cannot arm restart');
          assert.equal(runtime.step({ nowMs: 5, samples: packets(5, { start: true }) }).vm.safe.pump, false, 'healthy held START cannot restart');
          assert.equal(runtime.step({ nowMs: 6, samples: packets(6, { start: false }) }).vm.safe.pump, false);
          assert.equal(runtime.step({ nowMs: 7, samples: packets(7, { start: true }) }).vm.safe.pump, true);
        } finally { runtime.dispose(); }
      });
    }
  }

  test(`${program}/${mode}: clock-only staleness cannot restart or create a new observation`, async () => {
    const runtime = await instantiate();
    try {
      runtime.step({ nowMs: 1, samples: packets(1, { start: true }) });
      const stale = runtime.step({ nowMs: 3001 });
      assert.equal(stale.sensors.stop.quality, 'Stale');
      assert.equal(stale.vm.safe.pump, false);
      assert.deepEqual(runtime.sensors.get('stop').conditioner.sampleIdentity(), { epoch: 1, id: 1, timestampMs: 1 });
    } finally { runtime.dispose(); }
  });
}
