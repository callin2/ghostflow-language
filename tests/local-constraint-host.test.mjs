import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { compileControl } from '../tools/control.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';
import { observeSourceTrace } from '../tools/source-trace.mjs';
import { sha256Hex } from '../tools/sha256.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
const source = `
\`\`\`ghost
control WaterRequest {
  input DI1, DI2: Bool;
  output RO1, RO2: Bool;
  RO1 <- (DI1 |> recover(false)) && !(DI2 |> recover(false));
  RO2 <- false;
  constraints ValveRequired {
    require at safe_output RO1 => RO2;
  }
}
\`\`\`
`;
const artifact = await compileSource(source, { filename: 'water-request.ghost.md' });

for (const entry of ['instantiate', 'instantiateFramed']) {
  test(`local constraints execute through public ControlRuntime.${entry}`, async t => {
    const runtime = await ControlRuntime[entry](wasm, artifact);
    t.after(() => runtime.dispose());
    assert.deepEqual(runtime.manifest.localConstraints, artifact.manifest.localConstraints);
    for (const [nowMs, enabled] of [[0, true], [1, false], [2, true]]) {
      const { vm } = runtime.step({ nowMs, samples: {
        DI1: { value: enabled, quality: 'Good', epoch: 1, id: nowMs + 1, timestampMs: nowMs },
        DI2: { value: false, quality: 'Good', epoch: 1, id: nowMs + 1, timestampMs: nowMs },
      } });
      assert.equal(vm.requested.RO1, enabled);
      assert.equal(vm.safe.RO1, false);
      assert.equal(vm.safe.RO2, false);
      assert.equal(vm.faults.length > 0, enabled);
      const observation = observeSourceTrace(artifact.traceMetadata, vm);
      assert.deepEqual(observation.constraints.map(rule => rule.observed), vm.safetyTrace.constraints);
      assert.equal(observation.constraints[0].nodeId, artifact.manifest.localConstraints[0].rules[0].source.nodeId);
    }
  });

  test(`local require-any and mutex preserve compiled enforcement in ${entry}`, async t => {
    const code = `control Local {
      output pump, valve, bypass, forward, reverse: Bool;
      pump <- true; valve <- false; bypass <- true; forward <- true; reverse <- true;
      constraints Safety { require pump => (valve || bypass); mutex(forward, reverse); }
    }`;
    // Exercise both raw compiler locations and remapped literate locations.
    const compiled = compileControl(code);
    compiled.manifest.bytecodeSha256 = sha256Hex(compiled.bytes);
    const flat = compileControl(code.replace('constraints Safety {', '').replace(/}\s*}$/, '}'));
    assert.deepEqual(compiled.bytes, flat.bytes);
    const runtime = await ControlRuntime[entry](wasm, compiled);
    t.after(() => runtime.dispose());
    const { vm } = runtime.step({ nowMs: 0 });
    assert.deepEqual(vm.requested, { pump: true, valve: false, bypass: true, forward: true, reverse: true });
    assert.deepEqual(vm.safe, { pump: true, valve: false, bypass: true, forward: false, reverse: false });
    assert.ok(vm.faults.length > 0);
  });

  test(`local constraint metadata remains strict in ${entry}`, async () => {
    const mutations = [
      m => { m.futureConstraints = []; },
      m => { m.localConstraints = null; },
      m => { m.localConstraints = []; },
      m => { m.localConstraints = Array(129).fill(m.localConstraints[0]); },
      m => { m.localConstraints.push(structuredClone(m.localConstraints[0])); },
      m => { m.localConstraints[0].scope = 'shared_resource'; },
      m => { m.localConstraints[0].extra = true; },
      m => { m.localConstraints[0].rules = []; },
      m => { m.localConstraints[0].rules[0].stage = 'admission'; },
      m => { m.localConstraints[0].rules[0].kind = 'monitor'; },
      m => { m.localConstraints[0].rules[0].extra = true; },
      m => { m.localConstraints[0].rules[0].lowered = [['future', 'RO1', 'RO2']]; },
      m => { m.localConstraints[0].rules[0].lowered = [['requires', 'RO1']]; },
      m => { m.localConstraints[0].rules[0].lowered = [['requires', 'RO1', 'missing']]; },
      m => { m.localConstraints[0].rules[0].lowered = [['requires', 'RO1', 'RO1']]; },
      m => { m.localConstraints[0].source.nodeId = -1; },
      m => { m.localConstraints[0].rules[0].source.extracted.extra = true; },
      m => { m.bytecodeSha256 = '0'.repeat(64); },
      m => { m.format = 'GhostFlow/control-future'; },
    ];
    for (const mutate of mutations) {
      const manifest = structuredClone(artifact.manifest);
      mutate(manifest);
      await assert.rejects(ControlRuntime[entry](wasm, { ...artifact, manifest }));
    }
    const flat = await compileSource(source.replace('  constraints ValveRequired {\n', '')
      .replace('    require at safe_output', '    require').replace('    require RO1 => RO2;\n  }', '    require RO1 => RO2;'),
      { filename: 'flat.ghost.md' });
    assert.equal(flat.manifest.localConstraints, undefined);
    const runtime = await ControlRuntime[entry](wasm, flat);
    runtime.dispose();
  });
}
