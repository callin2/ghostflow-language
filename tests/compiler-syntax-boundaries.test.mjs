import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';

function document(code, eol = '\n') {
  return ['# Syntax boundary', '', '```ghost', code, '```', ''].join(eol);
}

function after(source, marker) {
  const index = source.lastIndexOf(marker);
  assert.notEqual(index, -1, `missing marker ${JSON.stringify(marker)}`);
  const prefix = source.slice(0, index + marker.length).replace(/\r\n/g, '\n');
  const lines = prefix.split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function at(source, marker) {
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, `missing marker ${JSON.stringify(marker)}`);
  const prefix = source.slice(0, index).replace(/\r\n/g, '\n');
  const lines = prefix.split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

const eofCases = [
  {
    id: 'binary-operator-rhs-eof',
    code: 'control Bad { let x = true &&',
    valid: 'control Good { let x = true && false; }',
    message: 'expected expression, found end of file',
  },
  {
    id: 'nested-call-expression-eof',
    code: 'control Bad { let x = number(int_exact(',
    valid: 'control Good { let x = number(int_exact(1.0)); }',
    message: 'expected expression, found end of file',
  },
  {
    id: 'call-closing-delimiter-eof',
    code: 'control Bad { let x = number(1',
    valid: 'control Good { let x = number(1); }',
    message: 'expected ) after arguments',
  },
  {
    id: 'if-else-expression-eof',
    code: 'control Bad { let x = if true then false else',
    valid: 'control Good { let x = if true then false else true; }',
    message: 'expected expression, found end of file',
  },
  {
    id: 'result-error-type-eof',
    code: 'control Bad { fn f(x: Result<Bool,',
    valid: 'control Good { fn f(x: Result<Bool, SensorFault>) -> Bool { false } }',
    message: 'expected type name',
  },
  {
    id: 'result-closing-delimiter-eof',
    code: 'control Bad { fn f(x: Result<Bool, SensorFault',
    valid: 'control Good { fn f(x: Result<Bool, SensorFault>) -> Bool { false } }',
    message: 'Result type requires closing >',
  },
  {
    id: 'case-branch-expression-eof',
    code: 'control Bad { type M = A | B; let x = case A { A =>',
    valid: 'control Good { type M = A | B; let x = case A { A => true; B => false; }; }',
    message: 'expected expression, found end of file',
  },
  {
    id: 'case-next-pattern-eof',
    code: 'control Bad { type M = A | B; let x = case A { A => true;',
    valid: 'control Good { type M = A | B; let x = case A { A => true; B => false; }; }',
    message: 'expected case pattern',
  },
  {
    id: 'case-pattern-arrow-eof',
    code: 'control Bad { type M = A | B; let x = case A { A => true; B',
    valid: 'control Good { type M = A | B; let x = case A { A => true; B => false; }; }',
    message: 'case pattern requires =>',
  },
  {
    id: 'config-body-eof',
    code: 'control Bad { config x: Bool = false { access = operator; label = "X";',
    valid: 'control Good { config x: Bool = false { access = operator; label = "X"; } }',
    message: 'expected config option',
  },
  {
    id: 'schedule-body-eof',
    code: 'control Bad { schedule s: DailySlots<15min> { timezone = "UTC"; selected = [];',
    valid: 'control Good { schedule s: DailySlots<15min> { timezone = "UTC"; selected = []; } }',
    message: 'expected schedule option',
  },
  {
    id: 'schedule-selected-entry-eof',
    code: 'control Bad { schedule s: DailySlots<15min> { selected = [06:00,',
    valid: 'control Good { schedule s: DailySlots<15min> { timezone = "UTC"; selected = [06:00]; } }',
    message: 'selected entries must be HH:MM',
  },
];

test('premature EOF diagnostics point to the end of the authored GhostFlow line', async t => {
  for (const item of eofCases) await t.test(item.id, async () => {
    const filename = `${item.id}.ghost.md`;
    const source = document(item.code);
    const expected = after(source, item.code);
    await assert.doesNotReject(() => compileSource(document(item.valid), { filename: `valid-${filename}` }));
    await assert.rejects(() => compileSource(source, { filename }), error => {
      assert.equal(error.name, 'ControlCompileError');
      assert.equal(error.filename, filename);
      assert.equal(error.line, expected.line);
      assert.equal(error.column, expected.column);
      assert.equal(error.message, `${filename}:${expected.line}:${expected.column}: ${item.message}`);
      return true;
    });
  });
});

test('delimiter failures identify the first authored token that cannot continue the grammar', async t => {
  const cases = [
    {
      id: 'operator-before-close',
      code: 'control Bad { let x = (true &&); }',
      valid: 'control Good { let x = (true && false); }',
      marker: ')',
      message: 'expected expression, found )',
    },
    {
      id: 'missing-call-comma',
      code: 'control Bad { let x = number(1 2); }',
      valid: 'control Good { let x = number(1); }',
      marker: '2',
      message: 'expected ) after arguments',
    },
    {
      id: 'extra-group-close',
      code: 'control Bad { let x = (true)); }',
      valid: 'control Good { let x = (true); }',
      marker: '));',
      message: 'expected ; after let declaration',
    },
  ];
  for (const item of cases) await t.test(item.id, async () => {
    const filename = `${item.id}.ghost.md`;
    const source = document(item.code);
    const expected = at(source, item.marker);
    if (item.id === 'extra-group-close') expected.column += 1;
    await assert.doesNotReject(() => compileSource(document(item.valid), { filename: `valid-${filename}` }));
    await assert.rejects(() => compileSource(source, { filename }), error => {
      assert.equal(error.name, 'ControlCompileError');
      assert.equal(error.filename, filename);
      assert.equal(error.line, expected.line);
      assert.equal(error.column, expected.column);
      assert.equal(error.message, `${filename}:${expected.line}:${expected.column}: ${item.message}`);
      return true;
    });
  });
});

test('terminal EOF mapping remains exact across CRLF Unicode and later executable fences', async t => {
  await t.test('CRLF and preceding Unicode prose', async () => {
    const code = 'control Bad {\r\n  // 측정값\r\n  let x = true &&';
    const valid = 'control Good {\r\n  // 측정값\r\n  let x = true && false;\r\n}';
    const source = document(code, '\r\n');
    const expected = after(source, '  let x = true &&');
    const filename = 'crlf-unicode-eof.ghost.md';
    await assert.doesNotReject(() => compileSource(document(valid, '\r\n'), { filename: `valid-${filename}` }));
    await assert.rejects(() => compileSource(source, { filename }), error => {
      assert.equal(error.name, 'ControlCompileError');
      assert.equal(error.filename, filename);
      assert.equal(error.line, expected.line);
      assert.equal(error.column, expected.column);
      assert.equal(error.message, `${filename}:${expected.line}:${expected.column}: expected expression, found end of file`);
      return true;
    });
  });

  await t.test('EOF in a later executable fence', async () => {
    const source = '# Multiple\n\n```ghost\nfn yes() -> Bool { true }\n```\n\n설명.\n\n```ghost\ncontrol Bad {\n  let x = true &&\n```\n';
    const valid = '# Multiple\n\n```ghost\nfn yes() -> Bool { true }\n```\n\n설명.\n\n```ghost\ncontrol Good {\n  let x = true && false;\n}\n```\n';
    const expected = after(source, '  let x = true &&');
    const filename = 'later-fence-eof.ghost.md';
    await assert.doesNotReject(() => compileSource(valid, { filename: `valid-${filename}` }));
    await assert.rejects(() => compileSource(source, { filename }), error => {
      assert.equal(error.name, 'ControlCompileError');
      assert.equal(error.filename, filename);
      assert.equal(error.line, expected.line);
      assert.equal(error.column, expected.column);
      assert.equal(error.message, `${filename}:${expected.line}:${expected.column}: expected expression, found end of file`);
      return true;
    });
  });
});

test('filenames containing diagnostic-like colons retain one exact source prefix', async t => {
  const filename = 'farm:1:2: plan.ghost.md';
  await t.test('ordinary located diagnostic', async () => {
    const source = document('control Bad { let x = missing; }');
    const expected = at(source, 'missing');
    await assert.doesNotReject(() => compileSource(document('control Good { let x = true; }'), { filename: `valid-${filename}` }));
    await assert.rejects(() => compileSource(source, { filename }), error => {
      assert.equal(error.name, 'ControlCompileError');
      assert.equal(error.filename, filename);
      assert.equal(error.line, expected.line);
      assert.equal(error.column, expected.column);
      assert.equal(error.message, `${filename}:${expected.line}:${expected.column}: unknown identifier missing`);
      return true;
    });
  });

  await t.test('terminal EOF diagnostic', async () => {
    const code = 'control Bad { let x = true &&';
    const source = document(code);
    const expected = after(source, code);
    await assert.rejects(() => compileSource(source, { filename }), error => {
      assert.equal(error.name, 'ControlCompileError');
      assert.equal(error.filename, filename);
      assert.equal(error.line, expected.line);
      assert.equal(error.column, expected.column);
      assert.equal(error.message, `${filename}:${expected.line}:${expected.column}: expected expression, found end of file`);
      return true;
    });
  });
});
