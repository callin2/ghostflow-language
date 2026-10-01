import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileControl, ControlCompileError } from '../tools/control.mjs';
import { compileSource } from '../tools/toolchain.mjs';
import { extractLiterate, mapSourcePosition } from '../tools/literate.mjs';
import { GhostFlowRuntime } from '../runtimes/wasm/ghostflow-runtime.mjs';
import { compile as compileGfb, parse as parseGfb, tokenize as tokenizeGfb } from '../tools/gfb1.mjs';

const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));

function rejectsControl(source, diagnostic) {
  assert.throws(
    () => compileControl(source, { filename: 'coverage-edge.ghost' }),
    error => error instanceof ControlCompileError && error.message.includes(diagnostic),
  );
}

test('GF-TEST-coverage-declarations: canonical type forms, explicit mutex and constant arithmetic compile', () => {
  const result = compileControl(`
    control DeclarationEdges {
      input enabled: Bool;
      type Mode = Off | On;
      type Phase = Idle | Running;
      config sum: Number = 1 + 2;
      config difference: Number = 5 - 3;
      config product: Duration = 2.0 * 1s;
      config quotient: Number = 6 / 3;
      state mode: Mode = Off;
      state phase: Phase = Idle;
      mode' = if enabled then On else Off;
      phase' = if enabled then Running else Idle;
      output first, second: Bool;
      first <- mode' in {On};
      second <- phase' in {Running};
      mutex(first, second);
    }
  `);
  assert.equal(result.manifest.configs.length, 4);
  assert.equal(result.manifest.outputs.length, 2);
});

const invalidControls = [
  ['non-string source', null, 'control source must be a string'],
  ['unterminated string', 'control X { schedule s: DailySlots<15min> { timezone = "bad; selected = []; } }', 'unterminated string literal'],
  ['unexpected character', 'control X { @ }', 'unexpected character'],
  ['missing punctuation', 'control X { input x Bool; }', 'expected : after input name'],
  ['identifier required', 'control X { input 1: Bool; }', 'expected input name'],
  ['unsupported check', 'control X { check nope; }', 'unsupported construct check'],
  ['unexpected declaration', 'control X { nonsense; }', 'unexpected declaration nonsense'],
  ['unknown sensor option', 'control X { sensor s: Number { nope = 1; } }', 'unsupported sensor option nope'],
  ['unsupported schedule kind', 'control X { schedule s: Weekly<15min> { timezone = "UTC"; selected = []; } }', 'only At, Daily, DailySlots<15min>, Periodic, Cron, Solar and Tide schedules are supported'],
  ['schedule timezone type', 'control X { schedule s: DailySlots<15min> { timezone = 1; selected = []; } }', 'timezone must be a string'],
  ['schedule selected item', 'control X { schedule s: DailySlots<15min> { timezone = "UTC"; selected = [true]; } }', 'selected entries must be HH:MM'],
  ['unknown schedule option', 'control X { schedule s: DailySlots<15min> { timezone = "UTC"; other = []; selected = []; } }', 'unsupported schedule option other'],
  ['empty membership set', 'control X { output x: Bool; x <- true in {}; }', 'in set must not be empty'],
  ['unknown type', 'control X { state x: Missing = Value; }', 'unknown type Missing'],
  ['duplicate enum member', 'control X { type A = Same | Other; type B = Same | Last; }', 'duplicate enum member Same'],
  ['enum input type', 'control X { type Mode = Off | On; input x: Mode; }', 'input must use a scalar type'],
  ['enum output type', 'control X { type Mode = Off | On; output x: Mode; x <- Off; }', 'output must use a scalar type'],
  ['nonconstant state', 'control X { input x: Bool; state held: Bool = x; }', 'state initial value must be a constant'],
  ['duration sensor', 'control X { sensor s: Duration; }', 'sensor type must be Bool, Number, Percent, or a physical quantity'],
  ['bool median', 'control X { sensor s: Bool { filter = median(3); } }', 'numeric filtering requires a numeric sensor'],
  ['bad median call', 'control X { sensor s: Number { filter = median(3, 5); } }', 'filter must be median(N), moving_average(N), or ema(alpha: Number)'],
  ['wrong schedule interval', 'control X { schedule s: DailySlots<5min> { timezone = "UTC"; selected = []; } }', 'only DailySlots<15min> is supported'],
  ['missing schedule timezone', 'control X { schedule s: DailySlots<15min> { selected = []; } }', 'schedule requires timezone'],
  ['missing schedule slots', 'control X { schedule s: DailySlots<15min> { timezone = "UTC"; } }', 'schedule requires selected slots'],
  ['bad signal form', 'control X { sensor s: Number; signal d = median(3); }', 'signal requires hysteresis'],
  ['bad signal sensor', 'control X { input x: Number; signal d = hysteresis(x, on_below: 1, off_above: 2, initial: false); }', 'hysteresis first argument must be a declared sensor'],
  ['bool hysteresis', 'control X { sensor s: Bool; signal d = hysteresis(s, on_below: false, off_above: true, initial: false); }', 'hysteresis requires a numeric sensor'],
  ['inverted hysteresis', 'control X { sensor s: Number; signal d = hysteresis(s, on_below: 2, off_above: 1, initial: false); }', 'on_below must be less than off_above'],
  ['bad timer call', 'control X { state s: Bool = false; timer t = median(3); }', 'timer requires elapsed(state)'],
  ['bad timer state', 'control X { input x: Bool; timer t = elapsed(x); }', 'elapsed argument must be a declared state'],
  ['duplicate function', 'control X { fn f() -> Bool { true } fn f() -> Bool { true } }', 'duplicate name f'],
  ['duplicate parameter', 'control X { fn f(x: Bool, x: Bool) -> Bool { x } }', 'duplicate function parameter x'],
  ['function return mismatch', 'control X { fn f() -> Bool { 1 } }', 'function f returns Int, expected Bool'],
  ['let annotation mismatch', 'control X { let x: Bool = 1; }', 'let x does not match annotation Bool'],
  ['unknown next state', "control X { missing' = true; }", 'unknown state missing'],
  ['duplicate next state', "control X { state x: Bool = false; x' = true; x' = false; }", 'duplicate next state x'],
  ['unknown output connection', 'control X { missing <- true; }', 'unknown output missing'],
  ['unsupported require', 'control X { output a: Bool; a <- true; require a; }', 'require supports an implication'],
  ['non-output constraint', 'control X { input a: Bool; output b: Bool; b <- false; require a => b; }', 'must be a Bool output'],
  ['numeric mutex member', 'control X { output a: Number; output b: Bool; a <- 1; b <- false; mutex(a, b); }', 'must be a Bool output'],
  ['schedule direct reference', 'control X { schedule s: DailySlots<15min> { timezone = "UTC"; selected = []; } output x: Bool; x <- s; }', 'must be read as s.due'],
  ['function direct reference', 'control X { fn f() -> Bool { true } output x: Bool; x <- f; }', 'function f requires arguments'],
  ['removed input qualifier', 'control X { output x: Bool; x <- input.nope; }', 'removed qualified reference input.nope'],
  ['removed state qualifier', 'control X { output x: Bool; x <- state.nope; }', 'removed qualified reference state.nope'],
  ['removed next qualifier', 'control X { output x: Bool; x <- next.nope; }', 'removed qualified reference next.nope'],
  ['unknown member', 'control X { input x: Bool; output y: Bool; y <- x.nope; }', 'unknown member x.nope'],
  ['unary bool mismatch', 'control X { output x: Bool; x <- !1; }', '! requires Bool'],
  ['unary number mismatch', 'control X { output x: Number; x <- -true; }', 'unary - requires numeric value'],
  ['if condition mismatch', 'control X { output x: Bool; x <- if 1 then true else false; }', 'if condition must be Bool'],
  ['if branch mismatch', 'control X { output x: Bool; x <- if true then true else 1; }', 'if branches must have the same type'],
  ['membership mismatch', 'control X { output x: Bool; x <- 1 in {true}; }', 'in values must match'],
  ['removed ifthenelse alias', 'control X { output x: Bool; x <- ifthenelse(true, false); }', 'removed alias ifthenelse'],
  ['unknown call', 'control X { output x: Bool; x <- missing(); }', 'unknown function missing'],
  ['constant division zero', 'control X { config x: Number = 1 / 0; }', 'constant division by zero'],
];

for (const [name, source, diagnostic] of invalidControls) {
  test(`GF-TEST-coverage-control-error: ${name}`, () => {
    rejectsControl(source === null ? 42 : source, diagnostic);
  });
}

const invalidGfb = [
  ['empty source', '', 'unexpected end of input'],
  ['unexpected close', ')', 'unexpected )'],
  ['unclosed list', '(module M', 'unclosed ('],
  ['multiple roots', '(module M) extra', 'multiple top-level forms'],
  ['wrong root', '(program M)', 'expected (module NAME'],
  ['empty form', '(module M () (strategy s 0 (device true)))', 'invalid module form'],
  ['bad version', '(module M (version -1) (strategy s 0 (device true)))', 'invalid version'],
  ['input arity', '(module M (input x) (strategy s 0 (device true)))', 'input expects name type'],
  ['bad input name', '(module M (input 1x bool) (strategy s 0 (device true)))', 'invalid input name'],
  ['unknown type', '(module M (input x percent) (strategy s 0 (device true)))', 'unknown type'],
  ['state arity', '(module M (state x bool) (strategy s 0 (device true)))', 'state expects name type default'],
  ['bool default', '(module M (state x bool 1) (strategy s 0 (device true)))', 'bool default expected'],
  ['number default', '(module M (state x number nope) (strategy s 0 (device true)))', 'number default expected'],
  ['requires arity', '(module M (requires x) (strategy s 0 (device true) (intent x true)))', 'requires expects target prerequisite'],
  ['requires-any arity', '(module M (requires-any x) (strategy s 0 (device true) (intent x true)))', 'requires-any expects'],
  ['mutex arity', '(module M (mutex x) (strategy s 0 (device true) (intent x true)))', 'mutex needs at least 2'],
  ['unknown form', '(module M (wat) (strategy s 0 (device true)))', 'unknown module form wat'],
  ['duplicate input', '(module M (input x bool) (input x bool) (strategy s 0 (device true)))', 'duplicate input x'],
  ['duplicate state', '(module M (state x bool false) (state x bool true) (strategy s 0 (device true)))', 'duplicate state x'],
  ['constraint duplicate', '(module M (mutex x x) (strategy s 0 (device true) (intent x true)))', 'invalid constraint names or arity'],
  ['priority', '(module M (strategy s nope (device true)))', 'strategy priority must be i32'],
  ['strategy atom', '(module M (strategy s 0 nope))', 'invalid strategy form'],
  ['device arity', '(module M (strategy s 0 (device true false)))', 'strategy needs one device query'],
  ['duplicate device', '(module M (strategy s 0 (device true) (device true)))', 'strategy needs one device query'],
  ['next arity', '(module M (state x bool false) (strategy s 0 (device true) (next x)))', 'next expects state expression'],
  ['unknown next state', '(module M (strategy s 0 (device true) (next x true)))', 'unknown state x'],
  ['next type', '(module M (state x bool false) (strategy s 0 (device true) (next x 1)))', 'type mismatch for state x'],
  ['intent arity', '(module M (strategy s 0 (device true) (intent x)))', 'intent expects name expression'],
  ['unknown strategy form', '(module M (strategy s 0 (device true) (wat)))', 'unknown strategy form wat'],
  ['missing device', '(module M (strategy s 0 (intent x true)))', 'has no device query'],
  ['duplicate transition', '(module M (state x bool false) (strategy s 0 (device true) (next x true) (next x false)))', 'duplicate state transition'],
  ['duplicate intent', '(module M (strategy s 0 (device true) (intent x true) (intent x false)))', 'duplicate intent x'],
  ['duplicate strategy', '(module M (strategy s 0 (device true)) (strategy s 1 (device true)))', 'duplicate strategy s'],
  ['no strategy', '(module M)', 'module needs a strategy'],
  ['constraint missing intent', '(module M (requires x y) (strategy s 0 (device true) (intent x true)))', 'constraint intent y is missing'],
  ['constraint non-bool', '(module M (requires x y) (strategy s 0 (device true) (intent x 1) (intent y true)))', 'constraint intent x must be bool'],
  ['query invalid', '(module M (strategy s 0 (device atom)))', 'invalid device query'],
  ['query has arity', '(module M (strategy s 0 (device (has actuator x))))', 'has expects kind name type'],
  ['query all empty', '(module M (strategy s 0 (device (all))))', 'all needs children'],
  ['query not arity', '(module M (strategy s 0 (device (not true false))))', 'query not expects one child'],
  ['query unknown', '(module M (strategy s 0 (device (some true))))', 'unknown device query some'],
  ['unknown atom', '(module M (strategy s 0 (device true) (intent x nope)))', 'unknown atom nope'],
  ['unknown namespace', '(module M (strategy s 0 (device true) (intent x bad.value)))', 'unknown namespace bad'],
  ['next in transition expression', '(module M (state x bool false) (strategy s 0 (device true) (next x next.x)))', 'next.* is allowed only in intents'],
  ['unknown next expression', '(module M (strategy s 0 (device true) (intent x next.missing)))', 'unknown state missing'],
  ['not type', '(module M (strategy s 0 (device true) (intent x (not 1))))', 'not expects bool'],
  ['and arity', '(module M (strategy s 0 (device true) (intent x (and true))))', 'and expects 2 arguments'],
  ['and type', '(module M (strategy s 0 (device true) (intent x (and true 1))))', 'and expects bools'],
  ['comparison operands', '(module M (strategy s 0 (device true) (intent x (lt true false))))', 'bad operands for lt'],
  ['arithmetic arity', '(module M (strategy s 0 (device true) (intent x (add 1))))', 'add expects 2 arguments'],
  ['arithmetic type', '(module M (strategy s 0 (device true) (intent x (mul true 1))))', 'mul expects numbers'],
  ['if arity', '(module M (strategy s 0 (device true) (intent x (if true false))))', 'if expects 3 arguments'],
  ['if condition', '(module M (strategy s 0 (device true) (intent x (if 1 true false))))', 'if condition must be bool'],
  ['if branches', '(module M (strategy s 0 (device true) (intent x (if true true 1))))', 'if branches must have same type'],
  ['unknown expression', '(module M (strategy s 0 (device true) (intent x (wat true))))', 'unknown expression wat'],
];

for (const [name, source, diagnostic] of invalidGfb) {
  test(`GF-TEST-coverage-gfb-error: ${name}`, () => {
    assert.throws(() => compileGfb(parseGfb(tokenizeGfb(source))), new RegExp(diagnostic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}

test('GF-TEST-coverage-literate-and-toolchain-errors: defensive source boundaries stay explicit', async () => {
  assert.throws(() => extractLiterate(42), /markdown must be a string/);
  assert.throws(() => extractLiterate('x'.repeat(1024 * 1024 + 1)), /literate byte limit exceeded/);
  assert.throws(() => extractLiterate('---\ntitle: open'), /unclosed front matter/);
  assert.equal(mapSourcePosition(null, 1, 1), null);
  assert.equal(mapSourcePosition([], 0, 1), null);
  assert.deepEqual(mapSourcePosition([{ file: 'mapped.ghost.md', line: 7, column: 3, length: 4 }], 1, 2), {
    file: 'mapped.ghost.md', line: 7, column: 4,
  });
  await assert.rejects(() => compileSource('x'.repeat(1024 * 1024 + 1)), /source byte limit exceeded/);
  await assert.rejects(() => compileSource('# prose', { filename: 'program.md' }), /requires a canonical .ghost.md literate source/);
  await assert.rejects(
    () => compileSource('prose\n\n```ghost\ncontrol Broken { output x: Bool; x <- ; }\n```\n', { filename: 'broken.ghost.md' }),
    error => error.filename === 'broken.ghost.md' && error.line === 4 && /expected expression/.test(error.message),
  );
  await assert.rejects(
    () => compileSource('(module Legacy (strategy run 0 (device true)))', { filename: 'legacy.ghost' }),
    /requires a canonical .ghost.md literate source/,
  );
});

test('GF-TEST-coverage-runtime-lifecycle: hot swap, rewind, typed getters and wrapper guards', async t => {
  const first = await compileSource(`\`\`\`ghost
control Lifecycle {
    input enabled: Bool;
    state held: Bool = false;
    held' = enabled;
    output result: Bool;
    result <- held';
  }
\`\`\`
`, { filename: 'lifecycle-first.ghost.md' });
  const second = await compileSource(`\`\`\`ghost
control Lifecycle {
    input enabled: Bool;
    state held: Bool = false;
    held' = !enabled;
    output result: Bool;
    result <- held';
  }
\`\`\`
`, { filename: 'lifecycle-second.ghost.md' });
  const runtime = await GhostFlowRuntime.instantiate(wasm);
  t.after(() => runtime.dispose());
  runtime.load(first.bytes.buffer.slice(first.bytes.byteOffset, first.bytes.byteOffset + first.bytes.byteLength));
  runtime.addCapability('actuator', 'result', 'bool');
  runtime.activate();
  runtime.setBool('enabled', true);
  runtime.tick();
  assert.equal(runtime.stateBool('held'), true);
  runtime.setBool('enabled', false);
  runtime.tick();
  assert.equal(runtime.stateBool('held'), false);
  runtime.rewind(1);
  assert.equal(runtime.stateBool('held'), true);
  runtime.hotSwap(second.bytes);
  assert.equal(runtime.stateBool('held'), true);
  runtime.setBool('enabled', true);
  runtime.tick();
  assert.equal(runtime.stateBool('held'), false);

  assert.throws(() => runtime.tickAt(-1), /invalid monotonic milliseconds/);
  assert.throws(() => runtime.addCapability('actuator', 'x', 'text'), /invalid capability type/);
  assert.throws(() => runtime.setBool('enabled', 1), /expected boolean/);
  assert.throws(() => runtime.setNumber('enabled', Number.NaN), /expected finite number/);
  assert.throws(() => new GhostFlowRuntime({ gf_create: () => 0 }), /allocation failed/);

  const fallback = new GhostFlowRuntime({
    gf_create: () => 1,
    gf_activate: () => 0,
    gf_last_error_ptr: () => 0,
    gf_last_error_len: () => 0,
    gf_destroy: () => {},
    memory: new WebAssembly.Memory({ initial: 1 }),
  });
  assert.throws(() => fallback.activate(), /GhostFlow operation failed/);
  fallback.dispose();
  assert.throws(() => fallback.clearInputs(), /runtime is disposed/);
});
