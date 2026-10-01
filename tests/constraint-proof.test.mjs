import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkedAdjacentConstraints, verifyConstraintProof } from '../tools/constraint-proof.mjs';
import { compileSource, restoreArtifactSourceMap } from '../tools/toolchain.mjs';
import { observeSourceTrace, observeRuntimeValues } from '../tools/source-trace.mjs';
import { compile, parse, tokenize } from '../tools/gfb1.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { FramedGhostFlowRuntime } from '../runtimes/wasm/framed-runtime.mjs';
import { canonicalJson } from '../tools/canonical-json.mjs';
import { sha256Hex } from '../tools/sha256.mjs';

const source = `<!-- ghostflow:anchor id=FIRST kind=premise status=confirmed origin=engineer -->
Keep the first constraint and the original prose bytes.

<!-- ghostflow:anchor id=SECOND kind=premise status=confirmed origin=user -->
Keep the duplicate constraint's independent source origin.

\`\`\`ghost
control Proof {
  input ia, ib, ic: Bool;
  output a, b, c: Bool;
  a <- ia;
  b <- ib;
  c <- ic;
  // ghostflow:link id=FIRST relation=constrains
  require a => b;
  // ghostflow:link id=SECOND relation=constrains
  require a => b;
  require b => c;
}
\`\`\`
`;
const filename = 'proof.ghost.md';
const clone = value => JSON.parse(JSON.stringify(value));

test('GF-TEST-local-constraint-envelope: grouped mandatory outputs enforce and recover identically in native and both WASM ABIs', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const document = fs.readFileSync(path.join(root, 'examples/constraint-envelope.ghost.md'), 'utf8');
  const translated = fs.readFileSync(path.join(root, 'examples/constraint-envelope.ghost.ko.md'), 'utf8');
  assert.equal(document.match(/```ghost\n([\s\S]*?)\n```/)[1], translated.match(/```ghost\n([\s\S]*?)\n```/)[1]);
  const compiled = await compileSource(document, { filename: 'examples/constraint-envelope.ghost.md' });
  const flat = await compileSource(document.replace('  constraints LocalEnvelope {\n', '')
    .replace('    require at safe_output', '    require').replace('    mutex(forward, reverse);\n  }', '    mutex(forward, reverse);'),
    { filename: 'flat-envelope.ghost.md' });
  assert.deepEqual(compiled.bytes, flat.bytes, 'grouping preserves existing local semantics');
  const inputs = [
    { start: true, valve_ready: false, forward_request: true, reverse_request: false },
    { start: true, valve_ready: true, forward_request: true, reverse_request: true },
    { start: true, valve_ready: true, forward_request: false, reverse_request: true },
    { start: false, valve_ready: false, forward_request: false, reverse_request: false },
  ];
  const expected = [
    { pump: false, valve: false, forward: true, reverse: false },
    { pump: true, valve: true, forward: false, reverse: false },
    { pump: true, valve: true, forward: false, reverse: true },
    { pump: false, valve: false, forward: false, reverse: false },
  ];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-local-envelope-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'control.gfb'), inputPath = path.join(directory, 'inputs.csv');
  fs.writeFileSync(modulePath, compiled.bytes);
  fs.writeFileSync(inputPath, `${Object.keys(inputs[0]).join(',')}\n${inputs.map(row => Object.values(row).join(',')).join('\n')}\n`);
  const native = () => execFileSync(path.join(root, 'target/release/examples/run' + (process.platform === 'win32' ? '.exe' : '')),
    [modulePath, inputPath], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
  const traces = native();
  assert.deepEqual(native(), traces);
  assert.deepEqual(traces.map(trace => trace.safe), expected);
  assert.deepEqual(traces.map(trace => trace.requested.pump), [true, true, true, false]);
  assert.ok(traces[0].faults.length > 0, 'missing valve blocks requested pump');
  assert.ok(traces[1].faults.length > 0, 'simultaneous directions are blocked');
  assert.deepEqual(traces[2].faults, [], 'valid recovery permits the request');
  const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
  for (const Runtime of [GhostFlowRuntime, FramedGhostFlowRuntime]) {
    const execute = async () => {
      const runtime = await Runtime.instantiate(wasm);
      try {
        runtime.load(compiled.bytes);
        for (const output of compiled.manifest.outputs) runtime.addCapability('actuator', output.name, 'bool');
        runtime.activate();
        return inputs.map((row, index) => {
          if (Runtime === FramedGhostFlowRuntime) return runtime.scan({ scanId: index, logicalTimeMs: index,
            inputs: Object.entries(row).map(([name, value]) => ({ name, value })) }).trace;
          for (const [name, value] of Object.entries(row)) runtime.setBool(name, value);
          runtime.tick(); return clone(runtime.trace);
        });
      } finally { runtime.dispose(); }
    };
    assert.deepEqual(await execute(), traces);
    assert.deepEqual(await execute(), traces);
  }
  const observation = observeSourceTrace(compiled.traceMetadata, traces[0]);
  assert.deepEqual(observation.constraints.map(rule => rule.observed), traces[0].safetyTrace.constraints);
  assert.deepEqual(observation.constraints.map(rule => rule.nodeId), compiled.manifest.localConstraints[0].rules.map(rule => rule.source.nodeId));
  await assert.rejects(compileSource(document.replace('pump => valve', 'pump => missing'), { filename: 'missing.ghost.md' }), /unknown|missing/);
});
function refreshProof(proof) {
  proof.originalSha256 = sha256Hex(canonicalJson(proof.original));
  proof.compiledSha256 = sha256Hex(canonicalJson(proof.compiled));
  const { certificateSha256: _digest, ...content } = proof;
  proof.certificateSha256 = sha256Hex(canonicalJson(content));
  return proof;
}

test('GF-TEST-shared-constraint-descriptor: actual native and both WASM loaders reject checked policy bytes without enforcement', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const contract = fs.readFileSync(path.join(root, 'docs/CONSTRAINTS.en.md'), 'utf8');
  const code = contract.match(/```ghost\n(control SharedPumpPolicy \{[\s\S]*?)\n```/)[1];
  const compiled = await compileSource(`# Checked shared contract\n\n\`\`\`ghost\n${code}\n\`\`\`\n`, { filename: 'shared-envelope.ghost.md' });
  assert.equal(compiled.manifest.format, 'GhostFlow/control-policy-descriptor-v1');
  const descriptor = JSON.parse(Buffer.from(compiled.bytes).toString('utf8'));
  assert.equal(descriptor.executable, false);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-unbound-envelope-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const modulePath = path.join(directory, 'policy.json'), inputPath = path.join(directory, 'inputs.csv');
  fs.writeFileSync(inputPath, 'unused\n');
  const wasm = fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm'));
  for (const bytes of [compiled.bytes, Buffer.from(JSON.stringify({ ...descriptor, executable: true }))]) {
    fs.writeFileSync(modulePath, bytes);
    const outcome = JSON.parse(execFileSync(path.join(root, 'target/release/examples/run' + (process.platform === 'win32' ? '.exe' : '')),
      [modulePath, inputPath, '--outcomes'], { encoding: 'utf8' }).trim());
    assert.equal(outcome.status, 'ERROR');
    assert.equal(outcome.phase, 'load');
    for (const Runtime of [GhostFlowRuntime, FramedGhostFlowRuntime]) {
      const runtime = await Runtime.instantiate(wasm);
      try { assert.throws(() => runtime.load(bytes), /magic|GFB|module|format|version/i); }
      finally { runtime.dispose(); }
    }
  }
});
function mapOf(a) {
  return { format: 'GhostFlow/source-map-v1', bytecodeSha256: a.manifest.bytecodeSha256,
    sourceDocument: a.sourceDocument, nodes: a.sourceMap, lines: a.extractionMap, traceMetadata: a.traceMetadata };
}

test('GF-TEST-constraint-proof: independent checker rejects changed effects, order, nonadjacency and budgets', () => {
  for (const form of [['requires', 'a', 'b'], ['requires-any', 'a', 'b', 'c'], ['mutex', 'a', 'b', 'c']]) {
    const proof = checkedAdjacentConstraints([form, form]);
    assert.equal(verifyConstraintProof(proof), true);
    assert.deepEqual(proof.sourceToCompiled, [0, 0]);
    for (const mutate of [p => p.compiled[0].push('other'), p => p.sourceToCompiled[1] = 1,
      p => p.original[1][1] = 'other', p => p.checker = 'unverified', p => p.extra = true]) {
      const bad = clone(proof); mutate(bad); assert.throws(() => verifyConstraintProof(bad));
    }
  }
  const a = ['requires', 'a', 'b'], b = ['requires', 'b', 'c'];
  assert.equal(checkedAdjacentConstraints([a, b, a]), null);
  assert.equal(checkedAdjacentConstraints(Array.from({ length: 129 }, () => a)), null);
  assert.equal(checkedAdjacentConstraints(Array.from({ length: 128 }, () => a)).compiled.length, 1);
  const boundary = ['mutex', ...Array.from({ length: 8 }, (_, i) => `o${i}`)];
  assert.equal(verifyConstraintProof(checkedAdjacentConstraints([boundary, boundary])), true);
  const big = ['mutex', ...Array.from({ length: 9 }, (_, i) => `o${i}`)];
  assert.equal(checkedAdjacentConstraints([big, big]), null);
  assert.equal(checkedAdjacentConstraints([a, a], () => { throw new Error('forced checker timeout'); }), null);
  assert.equal(checkedAdjacentConstraints([a, a], () => false), null);
  assert.equal(checkedAdjacentConstraints([a, a], () => undefined), null);
  for (const invalid of [['requires', 'a', 'b', 'c'], ['requires-any', 'a', 'b'], ['mutex', 'a'], ['mutex', 'a', 'a']]) {
    assert.equal(checkedAdjacentConstraints([invalid, invalid]), null);
  }
  const proof = checkedAdjacentConstraints([a, a, b]);
  proof.original.push(a); proof.sourceToCompiled.push(0);
  refreshProof(proof);
  assert.throws(() => verifyConstraintProof(proof), /order|adjacent/);
  const altered = checkedAdjacentConstraints([a, a]);
  altered.compiled[0][2] = 'c'; refreshProof(altered);
  assert.throws(() => verifyConstraintProof(altered), /effect/);
});

test('GF-TEST-constraint-proof-source: eliminated checks retain both origins, strict replay and unproven lowering', async () => {
  const a = await compileSource(source, { filename });
  assert.equal(a.traceMetadata.format, 'GhostFlow/source-trace-v2');
  assert.equal(a.sourceDocument.text, source);
  assert.deepEqual(a.traceMetadata.constraintProof.sourceToCompiled, [0, 0, 1]);
  assert.equal(a.traceMetadata.constraints.length, 3);
  assert.deepEqual(a.traceMetadata.intentLinks.map(link => link.anchorId), ['FIRST', 'SECOND']);
  assert.notEqual(a.traceMetadata.intentLinks[0].nodeId, a.traceMetadata.intentLinks[1].nodeId);
  assert.ok(a.traceMetadata.derivations.every(d => d.semanticVerification === 'not-proven' && d.status === 'compiler-derived'));
  assert.deepEqual(restoreArtifactSourceMap(mapOf(a), a.bytes).traceMetadata, a.traceMetadata);
  for (const mutate of [m => delete m.traceMetadata.constraintProof,
    m => m.traceMetadata.constraintProof.compiled[0][2] = 'c',
    m => m.traceMetadata.constraintProof.originalSha256 = '0'.repeat(64),
    m => m.traceMetadata.constraintProof.compiledSha256 = '0'.repeat(64),
    m => m.traceMetadata.constraintProof.certificateSha256 = '0'.repeat(64),
    m => m.traceMetadata.constraintProof.status = 'proved',
    m => m.traceMetadata.constraintProof.sourceToCompiled[1] = 1,
    m => m.traceMetadata.format = 'GhostFlow/source-trace-v1',
    m => m.traceMetadata.constraints[1].nodeId = m.traceMetadata.constraints[0].nodeId,
    m => m.traceMetadata.derivations[1].originNodeIds.pop(),
    m => m.traceMetadata.sourceDocumentSha256 = '0'.repeat(64)]) {
    const bad = clone(mapOf(a)); mutate(bad); assert.throws(() => restoreArtifactSourceMap(bad, a.bytes));
  }
  const revised = await compileSource(source.replace('original prose bytes', 'revised prose bytes'), { filename });
  assert.deepEqual(revised.bytes, a.bytes);
  assert.notEqual(revised.sourceDocument.sha256, a.sourceDocument.sha256);
  const mixed = mapOf(revised); mixed.traceMetadata = a.traceMetadata;
  assert.throws(() => restoreArtifactSourceMap(mixed, revised.bytes), /revision/);
  const noOp = await compileSource(source.replace('  require a => b;\n  require b => c;', '  require a => c;\n  require b => c;'), { filename });
  assert.equal(noOp.traceMetadata.format, 'GhostFlow/source-trace-v1');
  assert.equal(Object.hasOwn(noOp.traceMetadata, 'constraintProof'), false);
  const groups = await compileSource(source.replace('  require b => c;', '  require b => c;\n  require b => c;'), { filename });
  assert.deepEqual(groups.traceMetadata.constraintProof.sourceToCompiled, [0, 0, 1, 1]);
  assert.deepEqual(groups.traceMetadata.derivations.map(d => d.target.index), [0, 0, 1, 1]);
  assert.deepEqual(restoreArtifactSourceMap(mapOf(groups), groups.bytes).traceMetadata, groups.traceMetadata);
  const constraints = n => `\`\`\`ghost\ncontrol Bounds { output a,b: Bool; a <- true; b <- false; ${'require a => b;'.repeat(n)} }\n\`\`\``;
  assert.equal((await compileSource(constraints(128), { filename })).traceMetadata.constraintProof.original.length, 128);
  await assert.rejects(compileSource(constraints(129), { filename }), /resource limit/);
  await assert.rejects(compileSource('```ghost\ncontrol BadMutex { output a: Bool; a <- true; mutex(a,a); mutex(a,a); }\n```', { filename }), /constraint names/);
});

test('GF-TEST-constraint-proof-timer: duplicate removal leaves elapsed timer/state bytecode and boundary behavior intact', async t => {
  const timerSource = `\`\`\`ghost
control TimerProof {
  input run_request: Bool;
  output drive, permit: Bool;
  state run: Bool = false;
  run' = run_request;
  timer age = elapsed(run);
  let run_age = if run_request == run then age else 0s;
  drive <- run_request && run_age < 2s;
  permit <- true;
  require drive => permit;
  require drive => permit;
}
\`\`\``;
  const a = await compileSource(timerSource, { filename: 'timer-proof.ghost.md' });
  const baseline = await compileSource(timerSource.replace('  require drive => permit;\n  require drive => permit;', '  require drive => permit;'), { filename: 'timer-proof.ghost.md' });
  assert.deepEqual(a.bytes, baseline.bytes);
  assert.deepEqual(a.manifest, baseline.manifest);
  assert.equal(a.traceMetadata.constraintProof.compiled.length, 1);
  const runtime = await GhostFlowRuntime.instantiate(fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url)));
  t.after(() => runtime.dispose()); runtime.load(a.bytes);
  for (const name of ['drive', 'permit']) runtime.addCapability('actuator', name, 'bool');
  runtime.activate();
  for (const [now, request, expected] of [[0, true, true], [1999, true, true], [2000, true, false], [2001, true, false], [2002, false, false], [3000, true, true]]) {
    runtime.setBool('run_request', request); runtime.setNumber('__gf_now_ms', now); runtime.tick();
    assert.equal(runtime.trace.safe.drive, expected);
    assert.equal(runtime.trace.stateAfter.run, request);
    assert.equal(observeRuntimeValues(a.traceMetadata, runtime.trace).format, 'GhostFlow/runtime-values-v1');
  }
});

test('GF-TEST-constraint-proof-runtime: native and both WASM ABIs preserve fixed-point faults and distinguish derived evidence', async t => {
  const runtimeSource = source.replace('  require b => c;', `  require b => c;
  require a => (b || c);
  require a => (b || c);
  mutex(a,b);
  mutex(a,b);
  mutex(b,c);
  mutex(b,c);`).replace('  output a, b, c: Bool;', "  output a, b, c: Bool;\n  state seen: Bool = false;\n  seen' = ia;");
  const a = await compileSource(runtimeSource, { filename });
  const reference = compile(parse(tokenize(`(module Proof (input ia bool) (input ib bool) (input ic bool) (state seen bool false)
    (strategy control 0 (device true) (next seen input.ia) (intent a input.ia) (intent b input.ib) (intent c input.ic))
    (requires a b) (requires a b) (requires b c)
    (requires-any a b c) (requires-any a b c)
    (mutex a b) (mutex a b) (mutex b c) (mutex b c))`)));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-proof-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const frames = Array.from({ length: 8 }, (_, mask) => Object.fromEntries(['ia', 'ib', 'ic'].map((name, bit) => [name, Boolean(mask & (1 << bit))])));
  const inputs = path.join(dir, 'inputs.csv');
  fs.writeFileSync(inputs, `ia,ib,ic\n${frames.map(frame => Object.values(frame).join(',')).join('\n')}\n`);
  const native = bytes => {
    const module = path.join(dir, 'module.gfb'); fs.writeFileSync(module, bytes);
    return execFileSync(path.join(root, 'target/release/examples/run' + (process.platform === 'win32' ? '.exe' : '')),
      [module, inputs, '--outcomes'], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
  };
  const original = native(reference), optimized = native(a.bytes);
  const comparable = trace => ({ requested: trace.requested, safe: trace.safe, faults: trace.faults,
    stateBefore: trace.stateBefore, stateAfter: trace.stateAfter });
  for (let i = 0; i < frames.length; i++) {
    assert.deepEqual(comparable(optimized[i].trace), comparable(original[i].trace));
    assert.equal(optimized[i].trace.safetyTrace.constraints.length, 5);
    assert.equal(original[i].trace.safetyTrace.constraints.length, 9);
    // Every original check, including removed duplicates, had the same
    // per-round effect. Only retained nodes are reported executed by the
    // optimized artifact; compare their actual records to the original records
    // without weakening round, values, firstViolation or final satisfaction.
    for (let sourceIndex = 0; sourceIndex < a.traceMetadata.constraintProof.original.length; sourceIndex++) {
      const compiledIndex = a.traceMetadata.constraintProof.sourceToCompiled[sourceIndex];
      assert.deepEqual(optimized[i].trace.safetyTrace.constraints[compiledIndex], {
        ...original[i].trace.safetyTrace.constraints[sourceIndex], index: compiledIndex,
      });
    }
    const observation = observeSourceTrace(a.traceMetadata, optimized[i].trace);
    assert.equal(observation.format, 'GhostFlow/source-observation-v2');
    assert.equal(observation.constraints[0].evidence, 'executed');
    assert.equal(observation.constraints[1].evidence, 'derived');
    assert.equal(Object.hasOwn(observation.constraints[1], 'observed'), false);
    assert.equal(Object.hasOwn(observation.constraints[1], 'satisfied'), false);
    assert.equal(observeRuntimeValues(a.traceMetadata, optimized[i].trace).format, 'GhostFlow/runtime-values-v1');
    for (const mutate of [m => delete m.constraintProof, m => m.constraints.pop(),
      m => m.constraints[1].nodeId = m.constraints[0].nodeId,
      m => m.format = 'GhostFlow/source-trace-v1']) {
      const bad = clone(a.traceMetadata); mutate(bad);
      assert.throws(() => observeSourceTrace(bad, optimized[i].trace));
    }
  }
  for (const Runtime of [GhostFlowRuntime, FramedGhostFlowRuntime]) {
    const runtime = await Runtime.instantiate(fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm')));
    t.after(() => runtime.dispose()); runtime.load(a.bytes);
    for (const name of ['a', 'b', 'c']) runtime.addCapability('actuator', name, 'bool');
    runtime.activate();
    for (let i = 0; i < frames.length; i++) {
      let trace;
      if (Runtime === GhostFlowRuntime) {
        for (const [name, value] of Object.entries(frames[i])) runtime.setBool(name, value);
        runtime.tick(); trace = runtime.trace;
      } else trace = runtime.scan({ scanId: i, logicalTimeMs: i, inputs: Object.entries(frames[i]).map(([name, value]) => ({ name, value })) }).trace;
      assert.deepEqual(comparable(trace), comparable(original[i].trace));
      assert.deepEqual(trace.safetyTrace, optimized[i].trace.safetyTrace);
    }
  }
});
