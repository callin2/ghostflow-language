// Issue #590: bind one narrow constraint theorem to actual product artifacts.
// Run from any directory with `node experiments/compiler-correctness/bridge.mjs`.
// This is an experiment: source parsing, bytecode expressions, and the Rust VM
// are tested connections, not included in the Lean constraint theorem.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../../tools/toolchain.mjs';
import { verifyConstraintProof, checkedAdjacentConstraints } from '../../tools/constraint-proof.mjs';
import { extractLiterate } from '../../tools/literate.mjs';
import { parseControl } from '../../tools/control.mjs';
import { GhostFlowRuntime } from '../../runtimes/wasm/ghostflow-runtime.mjs';
import { decodeConstraintModule, replaceConstraints } from './decoder.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outputRoot = path.join(root, 'experiments/compiler-correctness/evidence/bridge');
const nativePath = path.join(root, 'target/release/examples/run' + (process.platform === 'win32' ? '.exe' : ''));
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const writeJson = (name, value) => fs.writeFileSync(name, JSON.stringify(value, null, 2) + '\n');

function expectedConstraints(source, filename) {
  // This checks against the production parser's AST. Parser correctness is an
  // explicit assumption of this experiment, not a formal consequence.
  const ast = parseControl(extractLiterate(source, { filename }).code, { filename });
  const names = node => node.kind === 'reference' ? [node.name]
    : node.kind === 'binary' && node.op === '||'
      ? [...names(node.left), ...names(node.right)] : null;
  return ast.body.flatMap(node => {
    if (node.kind === 'mutex') return [['mutex', ...node.names]];
    if (node.kind !== 'require') return [];
    const relation = node.value;
    if (relation.kind !== 'binary' || relation.op !== '=>' || relation.left.kind !== 'reference') {
      throw new Error('unsupported source constraint AST');
    }
    const dependencies = names(relation.right);
    if (!dependencies || !dependencies.length) throw new Error('unsupported require dependency AST');
    return [[dependencies.length === 1 ? 'requires' : 'requires-any', relation.left.name, ...dependencies]];
  });
}

function fixture(name, outputNames, constraints, { state = false, constant = false, intState = false } = {}) {
  const inputs = outputNames.map(name => `  input raw_${name}: Bool;`).join('\n');
  const stateLines = state ? [
    '  state remembered: Bool = false;',
    "  remembered' = case raw_a { ok(value) => value; fault(_) => remembered; };",
  ].join('\n') : intState ? "  state counter: Int = 0;\n  counter' = counter + 1;" : '';
  const outputs = outputNames.map((name, index) => `  ${name} <- ${constant ? String(index % 2 === 0) : state && name === 'a' ? "remembered'" : `case raw_${name} { ok(value) => value; fault(_) => false; }`};`).join('\n');
  const source = `# ${name}\n\n\`\`\`ghost\ncontrol ${name} {\n${inputs}\n${stateLines}\n  output ${outputNames.join(', ')}: Bool;\n${outputs}\n${constraints.map(form => {
    const [kind, ...names] = form;
    return kind === 'mutex' ? `  mutex(${names.join(', ')});`
      : `  require ${names[0]} => ${names.slice(1).join(' || ')};`;
  }).join('\n')}\n}\n\`\`\`\n`;
  return { name, outputNames, constraints, source, filename: `${name}.ghost.md` };
}

const a8 = 'abcdefgh'.split('');
const a9 = 'abcdefghi'.split('');
const fixtures = [
  fixture('BridgeScalarOne', ['a', 'b'], [['requires', 'a', 'b'], ['requires', 'a', 'b']], { constant: true }),
  fixture('BridgeScalarTwo', ['a', 'b'], [['mutex', 'a', 'b'], ['mutex', 'a', 'b']], { constant: true, intState: true }),
  fixture('BridgeChained', 'abcdef'.split(''), [
    ['requires', 'a', 'b'], ['requires', 'a', 'b'],
    ['requires-any', 'a', 'b', 'c'], ['requires-any', 'a', 'b', 'c'],
    ['mutex', 'd', 'e', 'f'], ['mutex', 'd', 'e', 'f'],
    ['requires', 'b', 'd'], ['requires', 'b', 'd'],
    ['requires', 'd', 'e'], ['requires', 'd', 'e'],
  ], { state: true }),
  fixture('BridgeEight', a8, [['mutex', ...a8], ['mutex', ...a8],
    ['requires-any', 'a', 'b', 'c'], ['requires-any', 'a', 'b', 'c']]),
  fixture('BridgeNineFallback', a9, [['mutex', ...a9], ['mutex', ...a9]]),
  fixture('BridgeCountBoundary', ['a', 'b'], Array.from({ length: 128 }, () => ['requires', 'a', 'b'])),
];

function framesFor(outputNames, countBoundary = false) {
  if (countBoundary) return [0, 1, 2, 3].map(mask =>
    Object.fromEntries(outputNames.map((name, bit) => [name, Boolean(mask & (1 << bit))])));
  const masks = outputNames.length <= 8
    ? Array.from({ length: 2 ** outputNames.length }, (_, n) => n)
    : [0, 2 ** outputNames.length - 1, ...outputNames.map((_, n) => 1 << n)];
  return masks.map(mask => Object.fromEntries(outputNames.map((name, bit) => [name, Boolean(mask & (1 << bit))])));
}

function inputRails(compilation, frame) {
  return compilation.manifest.sensors.flatMap(port => {
    const value = frame[port.name.replace(/^raw_/, '')];
    assert.equal(typeof value, 'boolean');
    return [
      { name: port.valueInput, type: 'bool', value },
      { name: port.okInput, type: 'bool', value: true },
      { name: port.faultInput, type: 'number', value: 0 },
    ];
  });
}

function csv(rails) {
  return rails[0].map(port => port.name).join(',') + '\n'
    + rails.map(row => row.map(port => String(port.value)).join(',')).join('\n') + '\n';
}

function runNative(modulePath, csvPath) {
  const result = spawnSync(nativePath, [modulePath, csvPath, '--outcomes'], {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`native runner failed (${result.status}): ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout.trim().split('\n').map(line => JSON.parse(line));
}

async function runWasm(bytes, compilation, rails, wasmBytes) {
  const runtime = await GhostFlowRuntime.instantiate(wasmBytes);
  try {
    runtime.load(bytes);
    for (const output of compilation.manifest.outputs) runtime.addCapability('actuator', output.name, 'bool');
    runtime.activate();
    return rails.map(row => {
      for (const port of row) runtime[port.type === 'bool' ? 'setBool' : 'setNumber'](port.name, port.value);
      runtime.tick();
      return clone(runtime.trace);
    });
  } finally { runtime.dispose(); }
}

function comparable(trace) {
  return { requested: trace.requested, safe: trace.safe, faults: trace.faults,
    stateBefore: trace.stateBefore, stateAfter: trace.stateAfter };
}

function bindCertificate(compilation, sourceForms, decoded) {
  const proof = compilation.traceMetadata?.constraintProof;
  assert.ok(proof, 'expected adjacent-duplicate certificate');
  assert.equal(verifyConstraintProof(proof), true);
  assert.deepEqual(proof.original, sourceForms, 'certificate original differs from production source AST');
  assert.deepEqual(proof.compiled, decoded.constraints, 'certificate compiled differs from independently decoded GFB');
  assert.equal(compilation.manifest.bytecodeSha256, sha256(compilation.bytes));
  assert.equal(compilation.sourceDocument.sha256, sha256(compilation.sourceDocument.text));
  return proof;
}

function leanConstraint(form) {
  const [kind, target, ...rest] = form;
  const str = value => JSON.stringify(value);
  const list = values => `[${values.map(str).join(', ')}]`;
  if (kind === 'requires') return `Constraint.requires ${str(target)} ${str(rest[0])}`;
  if (kind === 'requires-any') return `Constraint.requiresAny ${str(target)} ${list(rest)}`;
  if (kind === 'mutex') return `Constraint.mutex ${list(form.slice(1))}`;
  throw new Error('unknown constraint for Lean');
}

function leanCertificate(proof) {
  const list = forms => `[\n  ${forms.map(leanConstraint).join(',\n  ')}\n]`;
  return `import ConstraintPreservation\nopen CompilerSafety\nset_option maxRecDepth 4096\n\ndef original : List Constraint := ${list(proof.original)}\ndef compiled : List Constraint := ${list(proof.compiled)}\ntheorem accepted : check original compiled = true := by decide\ntheorem preservation (rounds : Nat) (initial : SafetyState) :\n    run rounds original initial = run rounds compiled initial :=\n  check_run original compiled accepted rounds initial\n`;
}

function negativeChecks(compilation, sourceForms, decoded) {
  const results = {};
  const bytes = compilation.bytes;
  const reject = (name, action) => { assert.throws(action); results[name] = 'rejected'; };
  reject('truncatedGfb', () => decodeConstraintModule(bytes.subarray(0, bytes.length - 1)));
  reject('trailingGfb', () => decodeConstraintModule(Uint8Array.from([...bytes, 0])));
  const unsupported = Uint8Array.from(bytes); unsupported[4] = 4; unsupported[5] = 0;
  reject('unsupportedProfile', () => decodeConstraintModule(unsupported));
  const invalidKind = Uint8Array.from(bytes); invalidKind[decoded.constraintsOffset + 2] = 255;
  reject('invalidConstraintKind', () => decodeConstraintModule(invalidKind));
  const proof = compilation.traceMetadata.constraintProof;
  const tampered = clone(proof); tampered.compiled[0][1] = 'wrong';
  reject('tamperedCertificate', () => verifyConstraintProof(tampered));
  const different = proof.compiled[0][0] === 'mutex' ? ['requires', 'a', 'b'] : ['mutex', 'a', 'b'];
  const validButChanged = replaceConstraints(bytes, [different]);
  reject('validChangedBytesVsCertificate', () => bindCertificate(compilation, sourceForms, decodeConstraintModule(validButChanged)));
  return results;
}

async function runFixture(item, wasmBytes) {
  const dir = path.join(outputRoot, item.name);
  fs.mkdirSync(dir, { recursive: true });
  const compilation = await compileSource(item.source, { filename: item.filename });
  const decoded = decodeConstraintModule(compilation.bytes);
  const sourceForms = expectedConstraints(item.source, item.filename);
  assert.deepEqual(sourceForms, item.constraints);
  let proof = compilation.traceMetadata?.constraintProof ?? null;
  if (item.name === 'BridgeNineFallback') {
    assert.equal(proof, null, 'nine-name mutex must not receive eight-name certificate');
    assert.deepEqual(decoded.constraints, sourceForms, 'unproved path must retain original constraints');
  } else proof = bindCertificate(compilation, sourceForms, decoded);
  const referenceBytes = proof ? replaceConstraints(compilation.bytes, proof.original) : compilation.bytes;
  assert.deepEqual(decodeConstraintModule(referenceBytes).constraints, sourceForms);
  const frames = framesFor(item.outputNames, item.name === 'BridgeCountBoundary');
  const rails = frames.map(frame => inputRails(compilation, frame));
  const sourcePath = path.join(dir, 'source.ghost.md');
  const optimizedPath = path.join(dir, 'optimized.gfb');
  const referencePath = path.join(dir, 'original.gfb');
  const csvPath = path.join(dir, 'input.csv');
  fs.writeFileSync(sourcePath, item.source);
  fs.writeFileSync(optimizedPath, compilation.bytes);
  fs.writeFileSync(referencePath, referenceBytes);
  fs.writeFileSync(csvPath, csv(rails));
  writeJson(path.join(dir, 'model-input.json'), { sourceForms, decoded, frames, rails,
    trustBoundary: 'production literate extractor and parser; independent GFB framing decoder' });
  if (proof) {
    writeJson(path.join(dir, 'certificate.json'), proof);
    fs.writeFileSync(path.join(dir, 'certificate.lean'), leanCertificate(proof));
  }
  const nativeOriginal = runNative(referencePath, csvPath);
  const nativeOptimized = runNative(optimizedPath, csvPath);
  const wasmOriginal = await runWasm(referenceBytes, compilation, rails, wasmBytes);
  const wasmOptimized = await runWasm(compilation.bytes, compilation, rails, wasmBytes);
  assert.equal(nativeOriginal.length, frames.length);
  assert.equal(nativeOptimized.length, frames.length);
  for (let index = 0; index < frames.length; index++) {
    assert.equal(nativeOriginal[index].status, 'OK');
    assert.equal(nativeOptimized[index].status, 'OK');
    const expected = comparable(nativeOriginal[index].trace);
    assert.deepEqual(comparable(nativeOptimized[index].trace), expected);
    assert.deepEqual(comparable(wasmOriginal[index]), expected);
    assert.deepEqual(comparable(wasmOptimized[index]), expected);
  }
  writeJson(path.join(dir, 'trace.native.json'), { original: nativeOriginal, optimized: nativeOptimized });
  writeJson(path.join(dir, 'trace.wasm.json'), { original: wasmOriginal, optimized: wasmOptimized });
  const negative = proof ? negativeChecks(compilation, sourceForms, decoded) : {};
  const result = { fixture: item.name, sourceSha256: sha256(item.source), optimizedSha256: sha256(compilation.bytes),
    originalSha256: sha256(referenceBytes), certificateSha256: proof?.certificateSha256 ?? null,
    gfbProfile: decoded.version, sourceConstraints: sourceForms.length, emittedConstraints: decoded.constraints.length,
    valuations: frames.length, nativeAndWasmCompared: true, negative,
    formalStatus: proof ? 'Lean source generated; checked theorem pending Lean execution' : 'no proof; unoptimized nine-name fallback',
    limits: ['source extraction and AST parse are production code, not proved here',
      'GFB expression instructions are opaque to this decoder', 'native and WASM runs sample finite input sequences'] };
  writeJson(path.join(dir, 'result.json'), result);
  return result;
}

function runLeanCertificates(results) {
  const leanBin = process.env.LEAN_BIN;
  if (!leanBin) return { status: 'not-run', reason: 'set LEAN_BIN to a Lean 4 executable to check generated theorems' };
  if (!fs.existsSync(leanBin)) throw new Error(`LEAN_BIN does not exist: ${leanBin}`);
  const proofDir = path.join(outputRoot, 'lean-check');
  fs.mkdirSync(proofDir, { recursive: true });
  fs.copyFileSync(path.join(root, 'experiments/compiler-correctness/lean/ConstraintPreservation.lean'),
    path.join(proofDir, 'ConstraintPreservation.lean'));
  const check = (directory, filename, environment = {}) => {
    const result = spawnSync(leanBin, ['-o', filename.replace(/\.lean$/, '.olean'), filename], {
      cwd: directory, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, ...environment },
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Lean rejected ${filename}: ${result.error?.message ?? result.stderr ?? result.stdout}`);
    }
    return { exitCode: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  };
  const moduleRun = check(proofDir, 'ConstraintPreservation.lean');
  const certificateRuns = [];
  for (const result of results) {
    if (!result.certificateSha256) continue;
    const directory = path.join(outputRoot, result.fixture);
    const run = check(directory, 'certificate.lean', { LEAN_PATH: proofDir });
    const record = { fixture: result.fixture, sourceSha256: sha256(fs.readFileSync(path.join(directory, 'certificate.lean'))),
      theorem: 'CompilerSafety.check_run instantiated with accepted : check original compiled = true', ...run };
    writeJson(path.join(directory, 'lean-result.json'), record);
    result.formalStatus = 'formal-partial: generated certificate accepted by Lean; adjacent exact Bool constraint effect only';
    writeJson(path.join(directory, 'result.json'), result);
    certificateRuns.push(record);
  }
  return { status: 'checked', leanBinarySha256: sha256(fs.readFileSync(leanBin)), moduleRun, certificateRuns };
}

async function main() {
  fs.mkdirSync(outputRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  const sourceFiles = [
    'experiments/compiler-correctness/bridge.mjs',
    'experiments/compiler-correctness/decoder.mjs',
    'experiments/compiler-correctness/lean/ConstraintPreservation.lean',
    'tools/toolchain.mjs', 'tools/compile-source.mjs', 'tools/control.mjs',
    'tools/constraint-proof.mjs', 'tools/gfb1.mjs', 'crates/ghostflow-core/src/lib.rs',
  ];
  const sourceSha256 = Object.fromEntries(sourceFiles.map(file => [file, sha256(fs.readFileSync(path.join(root, file)))]));
  const summaryPath = path.join(outputRoot, 'summary.json');
  writeJson(summaryPath, { format: 'GhostFlow/compiler-correctness-bridge-v1', status: 'running', startedAt, sourceSha256 });
  if (!fs.existsSync(nativePath) || !fs.existsSync(wasmPath)) throw new Error('native runner and WASM artifact must exist; build is intentionally external to this bridge');
  const wasmBytes = fs.readFileSync(wasmPath);
  const results = [];
  for (const item of fixtures) results.push(await runFixture(item, wasmBytes));
  const lean = runLeanCertificates(results);
  const fallback = checkedAdjacentConstraints([['requires', 'a', 'b'], ['requires', 'a', 'b']], () => false);
  assert.equal(fallback, null);
  const tooMany = fixture('BridgeReject129', ['a', 'b'], Array.from({ length: 129 }, () => ['requires', 'a', 'b']));
  let rejection;
  try { await compileSource(tooMany.source, { filename: tooMany.filename }); }
  catch (error) { rejection = { message: error.message, status: 'rejected-before-artifact' }; }
  assert.ok(rejection, '129 constraints must be rejected');
  writeJson(summaryPath, {
    format: 'GhostFlow/compiler-correctness-bridge-v1',
    status: 'passed', startedAt, completedAt: new Date().toISOString(), sourceSha256,
    compilerRevision: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
    wasmSha256: sha256(wasmBytes), nativeSha256: sha256(fs.readFileSync(nativePath)),
    results, lean, checkerFalseFallback: 'retains original constraints', overBudget129: rejection,
    claim: 'Concrete source-to-byte and native/WASM evidence for adjacent exact Bool constraint elimination; no full compiler proof.'
  });
  console.log(JSON.stringify({ fixtures: results.map(({ fixture, valuations, gfbProfile, sourceConstraints, emittedConstraints }) =>
    ({ fixture, valuations, gfbProfile, sourceConstraints, emittedConstraints })), evidence: outputRoot }));
}

main().catch(error => {
  const summaryPath = path.join(outputRoot, 'summary.json');
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch {}
  fs.mkdirSync(outputRoot, { recursive: true });
  writeJson(summaryPath, { format: 'GhostFlow/compiler-correctness-bridge-v1',
    status: 'failed', startedAt: previous.startedAt ?? new Date().toISOString(),
    failedAt: new Date().toISOString(), sourceSha256: previous.sourceSha256 ?? null,
    error: { name: error.name, message: error.message } });
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
