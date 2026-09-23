import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { ControlCompileError } from '../tools/control.mjs';

const document = code => `# Structural syntax diagnostic\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;

function markedLocation(marked) {
  const offset = marked.indexOf('§');
  assert.notEqual(offset, -1, 'fixture requires one location marker');
  assert.equal(marked.indexOf('§', offset + 1), -1, 'fixture has multiple location markers');
  const before = marked.slice(0, offset);
  const lines = before.split('\n');
  return { source: marked.replace('§', ''), line: lines.length + 3, column: lines.at(-1).length + 1 };
}

const structuralCases = [
  {
    id: 'function-trailing-parameter-comma',
    bad: 'control Bad { fn pass(value: Bool,§) -> Bool { value } }',
    good: 'control Good { fn pass(value: Bool) -> Bool { value } output ready: Bool; ready <- pass(true); }',
    message: 'expected parameter name',
  },
  {
    id: 'function-case-branch-if-missing-then',
    bad: 'control Bad { type Mode = Off | On; fn decide(mode: Mode) -> Bool { case mode { Off => if true §false else true; On => true; } } }',
    good: 'control Good { type Mode = Off | On; fn decide(mode: Mode) -> Bool { case mode { Off => if true then false else true; On => true; } } output ready: Bool; ready <- decide(Off); }',
    message: 'if requires then',
  },
  {
    id: 'function-case-branch-if-missing-else',
    bad: 'control Bad { type Mode = Off | On; fn decide(mode: Mode) -> Bool { case mode { Off => if true then false§; On => true; } } }',
    good: 'control Good { type Mode = Off | On; fn decide(mode: Mode) -> Bool { case mode { Off => if true then false else true; On => true; } } output ready: Bool; ready <- decide(Off); }',
    message: 'if requires else',
  },
  {
    id: 'result-case-empty-binding',
    bad: 'control Bad { fn present(value: Result<Bool, SensorFault>) -> Bool { case value { ok(§) => true; fault(_) => false; } } }',
    good: 'control Good { fn present(value: Result<Bool, SensorFault>) -> Bool { case value { ok(_) => true; fault(_) => false; } } output ready: Bool; ready <- present(ok(true)); }',
    message: 'expected case binding',
  },
  {
    id: 'enum-case-comma-between-branches',
    bad: 'control Bad { type Mode = Off | On; fn enabled(mode: Mode) -> Bool { case mode { Off => false; §, On => true; } } }',
    good: 'control Good { type Mode = Off | On; fn enabled(mode: Mode) -> Bool { case mode { Off => false; On => true; } } output ready: Bool; ready <- enabled(Off); }',
    message: 'expected case pattern',
  },
  {
    id: 'result-case-bound-pattern-missing-arrow',
    bad: 'control Bad { fn pass(value: Result<Bool, SensorFault>) -> Bool { case value { ok(v) §v; fault(_) => false; } } }',
    good: 'control Good { fn pass(value: Result<Bool, SensorFault>) -> Bool { case value { ok(v) => v; fault(_) => false; } } output ready: Bool; ready <- pass(ok(true)); }',
    message: 'case pattern requires =>',
  },
  {
    id: 'function-pipeline-missing-rhs-before-body-close',
    bad: 'control Bad { fn consume(value: Result<Bool, SensorFault>) -> Bool { value |> §} }',
    good: 'control Good { fn consume(value: Result<Bool, SensorFault>) -> Bool { value |> recover(false) } output ready: Bool; ready <- consume(ok(true)); }',
    message: 'expected expression, found }',
  },
  {
    id: 'static-transform-composition-missing-rhs',
    bad: 'control Bad { sensor moisture: Percent; let transform = map(below(35%)) >> §; output dry: Bool; dry <- moisture |> recover(false); }',
    good: 'control Good { sensor moisture: Percent; let transform = map(below(35%)) >> recover(false); output dry: Bool; dry <- moisture |> transform; }',
    message: 'expected expression, found ;',
  },
  {
    id: 'pipeline-nested-call-missing-close',
    bad: 'control Bad { sensor moisture: Percent; output dry: Bool; dry <- moisture |> map(below(35%) |> recover(false)§; }',
    good: 'control Good { sensor moisture: Percent; output dry: Bool; dry <- moisture |> map(below(35%)) |> recover(false); }',
    message: 'expected ) after arguments',
  },
  {
    id: 'nested-named-argument-missing-expression',
    bad: 'control Bad { input start: Bool; signal stable = debounce(start, stable_for: §, initial: false); output ready: Bool; ready <- stable; }',
    good: 'control Good { input start: Bool; signal stable = debounce(start, stable_for: 1s, initial: false); output ready: Bool; ready <- stable; }',
    message: 'expected expression, found ,',
  },
];

for (const entry of structuralCases) test(`structural syntax: ${entry.id}`, async () => {
  const filename = `${entry.id}.ghost.md`;
  await assert.doesNotReject(() => compileSource(document(entry.good), { filename: `valid-${filename}` }));
  const marked = markedLocation(entry.bad);
  await assert.rejects(() => compileSource(document(marked.source), { filename }), error => {
    assert.ok(error instanceof ControlCompileError);
    assert.equal(error.filename, filename);
    assert.equal(error.line, marked.line);
    assert.equal(error.column, marked.column);
    assert.equal(error.message, `${filename}:${marked.line}:${marked.column}: ${entry.message}`);
    return true;
  });
});

test('structural syntax: a comment after a pipeline operator still reports terminal EOF', async () => {
  const bad = `control Bad {
  sensor reading: Bool;
  output ready: Bool;
  ready <- reading |> // missing transform`;
  const good = `control Good {
  sensor reading: Bool;
  output ready: Bool;
  ready <- reading |> recover(false);
}`;
  const filename = 'pipeline-comment-eof.ghost.md';
  await assert.doesNotReject(() => compileSource(document(good), { filename: `valid-${filename}` }));
  const line = 7;
  const column = '  ready <- reading |> // missing transform'.length + 1;
  await assert.rejects(() => compileSource(document(bad), { filename }), error => {
    assert.ok(error instanceof ControlCompileError);
    assert.equal(error.filename, filename);
    assert.equal(error.line, line);
    assert.equal(error.column, column);
    assert.equal(error.message, `${filename}:${line}:${column}: expected expression, found end of file`);
    return true;
  });
});
