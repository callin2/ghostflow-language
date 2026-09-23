import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { compileControl } from '../tools/control.mjs';
import { extractLiterate } from '../tools/literate.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';

const cases = JSON.parse(fs.readFileSync(new URL('./reference/cases/02-time-control.json', import.meta.url))).cases;
const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
for (const [id, gate] of [
  ['REF-04-026', /after_event requires an identified Event delivery/],
  ['REF-03-062', /natural condition execution requires verified provider observations/],
  ['REF-03-050', /accounting execution requires verified resource binding/],
]) test(`${id}: a checked descriptor cannot bypass executable lowering or raw WASM loading`, async () => {
  const fixture = cases.find(item => item.id === id);
  const { code } = extractLiterate(fixture.source, { filename: fixture.filename });
  assert.throws(() => compileControl(code), gate);
  const artifact = await compileSource(fixture.source, { filename: fixture.filename });
  const descriptor = JSON.parse(artifact.bytes.toString('utf8'));
  assert.equal(descriptor.executable, false);
  if (id === 'REF-04-026') {
    const signal = descriptor.manifest.control.signals[0];
    assert.deepEqual({
      kind: signal.kind,
      event: signal.event.name,
      predicate: signal.predicate.name,
      quality: signal.quality,
      windowMs: signal.windowMs,
      projections: signal.projections,
    }, {
      kind: 'after-event',
      event: 'started',
      predicate: 'valve_open',
      quality: 'measured',
      windowMs: 10_000,
      projections: ['any', 'all'],
    });
  }
  await assert.rejects(() => ControlRuntime.instantiate(wasm, artifact), /manifest|descriptor/);
  const raw = await GhostFlowRuntime.instantiate(wasm);
  try {
    assert.throws(() => raw.load(artifact.bytes), /magic|format|header|version/i);
    assert.throws(() => raw.activate(), /module|loaded|installed/i);
  } finally { raw.dispose(); }
});
