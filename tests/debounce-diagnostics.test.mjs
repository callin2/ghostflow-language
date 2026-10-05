import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlCompileError } from '../tools/control.mjs';

const filename = 'debounce-diagnostic.ghost.md';
const document = code => `# Debounce diagnostics\n\nProse remains outside the source block.\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;
const wrap = body => `control DebounceDiagnostic { ${body} }`;

const cases = [
  ['missing positional argument', wrap('input start: Bool; signal stable = §debounce();'), wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false);'), 'debounce requires debounce(source, stable_for: Duration, initial: value)'],
  ['extra positional argument', wrap('input start: Bool; signal stable = §debounce(start, false, stable_for: 1s, initial: false);'), wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false);'), 'debounce requires debounce(source, stable_for: Duration, initial: value)'],
  ['missing stable_for', wrap('input start: Bool; signal stable = §debounce(start, initial: false);'), wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false);'), 'debounce requires debounce(source, stable_for: Duration, initial: value)'],
  ['missing initial', wrap('input start: Bool; signal stable = §debounce(start, stable_for: 1s);'), wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false);'), 'debounce requires debounce(source, stable_for: Duration, initial: value)'],
  ['unknown named argument', wrap('input start: Bool; signal stable = §debounce(start, stable_for: 1s, duration: 1s);'), wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false);'), 'debounce requires debounce(source, stable_for: Duration, initial: value)'],
  ['duplicate named argument', wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, §stable_for: 2s, initial: false);'), wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false);'), 'duplicate debounce argument stable_for'],
  ['numeric source', wrap('input level: Number; signal stable = debounce(§level, stable_for: 1s, initial: false);'), wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false);'), 'debounce source must be Bool or a named finite enum'],
  ['zero duration', wrap('input start: Bool; signal stable = debounce(start, §stable_for: 0s, initial: false);'), wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false);'), 'debounce stable_for must be a positive constant Duration'],
  ['negative duration', wrap('input start: Bool; signal stable = debounce(start, stable_for: §-1s, initial: false);'), wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false);'), 'Duration constant must be a non-negative integer number of milliseconds'],
  ['wrong duration type', wrap('input start: Bool; signal stable = debounce(start, §stable_for: 1.0, initial: false);'), wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false);'), 'debounce stable_for must be a positive constant Duration'],
  ['dynamic duration', wrap('input start: Bool; input delay: Duration; signal stable = debounce(start, §stable_for: delay, initial: false);'), wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false);'), 'debounce stable_for must be a positive constant Duration'],
  ['initial wrong type', wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, §initial: 0);'), wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false);'), 'debounce initial must be a constant Bool'],
  ['dynamic initial', wrap('input start: Bool; input fallback: Bool; signal stable = debounce(start, stable_for: 1s, §initial: fallback);'), wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false);'), 'debounce initial must be a constant Bool'],
  ['valid enum source neighbor', wrap('type Mode = Off | On; state mode: Mode = Off; signal stable = debounce(mode, stable_for: 1s, initial: Off);'), wrap('type Mode = Off | On; state mode: Mode = Off; signal stable = debounce(mode, stable_for: 1s, initial: Off);'), null],
  ['valid Bool source neighbor', wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false);'), wrap('input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false);'), null],
];

for (const [label, bad, good, message] of cases) {
  test(`debounce diagnostic: ${label}`, async () => {
    const valid = await compileSource(document(good), { filename });
    assert.ok(valid.bytes.length > 6);
    if (message === null) return;
    const marked = document(bad), at = marked.indexOf('§');
    const before = marked.slice(0, at);
    const line = before.split('\n').length;
    const column = before.length - before.lastIndexOf('\n');
    await assert.rejects(() => compileSource(marked.replace('§', ''), { filename }), error => {
      assert.ok(error instanceof ControlCompileError);
      assert.equal(error.filename, filename);
      assert.equal(error.line, line);
      assert.equal(error.column, column);
      assert.equal(error.message, `${filename}:${line}:${column}: ${message}`);
      return true;
    });
  });
}

const expectLocatedFailure = (name, markedCode, message) => test(`debounce boundary diagnostic: ${name}`, async () => {
  const marked = document(markedCode), at = marked.indexOf('§');
  const before = marked.slice(0, at);
  const line = before.split('\n').length;
  const column = before.length - before.lastIndexOf('\n');
  await assert.rejects(() => compileSource(marked.replace('§', ''), { filename }), error => {
    assert.ok(error instanceof ControlCompileError);
    assert.equal(error.filename, filename);
    assert.equal(error.line, line);
    assert.equal(error.column, column);
    assert.equal(error.message, `${filename}:${line}:${column}: ${message}`);
    return true;
  });
});

expectLocatedFailure(
  'direct signal cycle',
  'control DebounceDirectCycle { §signal first = debounce(first, stable_for: 1s, initial: false); }',
  'cyclic signal dependency involving first',
);
expectLocatedFailure(
  'mutual signal cycle',
  'control DebounceMutualCycle { §signal first = debounce(second, stable_for: 1s, initial: false); signal second = debounce(first, stable_for: 1s, initial: false); }',
  'cyclic signal dependency involving first',
);

test('debounce boundary diagnostic: twenty-five accepted and twenty-six rejected raw Bool debouncers', async () => {
  const signals = Array.from({ length: 25 }, (_, index) => `signal s${index} = debounce(start, stable_for: 1s, initial: false);`).join(' ');
  const compiled = await compileSource(document(`control DebounceStateBudget { state start: Bool = false; ${signals} output ready: Bool; ready <- s0; }`), { filename });
  assert.equal(compiled.manifest.signals.length, 25);
  assert.equal(compiled.manifest.signals.reduce((total, signal) => total + Object.keys(signal.states).length, 0), 125);
  const signals26 = Array.from({ length: 26 }, (_, index) => `signal s${index} = debounce(start, stable_for: 1s, initial: false);`).join(' ');
  const marked = document(`§control DebounceStateBudget { state start: Bool = false; ${signals26} output ready: Bool; ready <- s0; }`);
  const at = marked.indexOf('§'), before = marked.slice(0, at), line = before.split('\n').length;
  const column = before.length - before.lastIndexOf('\n');
  await assert.rejects(() => compileSource(marked.replace('§', ''), { filename }), error => {
    assert.ok(error instanceof ControlCompileError);
    assert.equal(error.filename, filename);
    assert.equal(error.line, line);
    assert.equal(error.column, column);
    assert.equal(error.message, `${filename}:${line}:${column}: state budget exceeded (128)`);
    return true;
  });
});
