import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../tools/toolchain.mjs';
import { compileControl } from '../tools/control.mjs';
import { extractLiterate, LiterateError } from '../tools/literate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/compiler-syntax-diagnostics.json', import.meta.url), 'utf8'));

function document(code, eol = '\n') {
  return ['# Compiler syntax diagnostic', '', '```ghost', code, '```', ''].join(eol);
}

function locationOf(code, marker, occurrence = 1) {
  let index = -1;
  for (let seen = 0; seen < occurrence; seen++) index = code.indexOf(marker, index + 1);
  assert.notEqual(index, -1, `missing location marker ${JSON.stringify(marker)}`);
  const before = code.slice(0, index).replace(/\r\n/g, '\n');
  const lines = before.split('\n');
  return { line: lines.length + 3, column: lines.at(-1).length + 1 };
}

async function compile(code, filename, eol = '\n', { emitBytecode = true } = {}) {
  const source = document(code, eol);
  if (!emitBytecode) {
    const extraction = extractLiterate(source, { filename });
    return compileControl(extraction.code, { filename, emitBytecode: false });
  }
  return compileSource(source, { filename });
}

test('canonical lexer and parser diagnostics are independently located', async t => {
  for (const item of fixture.cases) await t.test(item.id, async () => {
    const filename = `${item.id}.ghost.md`;
    await assert.doesNotReject(() => compile(item.valid, `valid-${filename}`, '\n', { emitBytecode: false }), `${item.id} adjacent valid control`);
    const expected = locationOf(item.code, item.at, item.occurrence ?? 1);
    await assert.rejects(() => compile(item.code, filename), error => {
      assert.equal(error.name, item.errorName ?? 'ControlCompileError');
      assert.equal(error.filename, filename);
      assert.equal(error.line, expected.line);
      assert.equal(error.column, expected.column);
      assert.equal(error.message, `${filename}:${expected.line}:${expected.column}: ${item.message}`);
      return true;
    });
  });
});

test('lexer and parser resource diagnostics retain their defined boundaries', async t => {
  await t.test('control parser source limit is below the product document limit', async () => {
    const code = `control Large {\n//${'x'.repeat(256 * 1024)}\n}`;
    await assert.rejects(() => compile(code, 'parser-source-limit.ghost.md'), error => {
      assert.equal(error.name, 'ControlCompileError');
      assert.equal(error.message, 'control source exceeds 256 KiB parser limit');
      assert.equal(error.filename, undefined);
      return true;
    });
  });
  await t.test('token limit identifies the exact token that crosses 8192', async () => {
    const code = `control TokenLimit {\n${'x\n'.repeat(8190)}}`;
    await assert.rejects(() => compile(code, 'token-limit.ghost.md'), error => {
      assert.equal(error.message, 'token-limit.ghost.md:8194:1: token limit exceeded (8192)');
      assert.equal(error.line, 8194);
      assert.equal(error.column, 1);
      return true;
    });
  });
  await t.test('parser nesting limit identifies the exact opening parenthesis', async () => {
    const prefix = 'control Depth { let value = ';
    const code = `${prefix}${'('.repeat(65)}true${')'.repeat(65)}; }`;
    await assert.rejects(() => compile(code, 'parser-depth.ghost.md'), error => {
      assert.equal(error.message, `parser-depth.ghost.md:4:${prefix.length + 65}: parser nesting exceeds 64`);
      assert.equal(error.line, 4);
      assert.equal(error.column, prefix.length + 65);
      return true;
    });
  });
  await t.test('AST node limit identifies the exact operator that exceeds 4096 nodes', async () => {
    const prefix = 'control Nodes { let value = ';
    const expression = Array(2049).fill('1').join('+');
    const code = `${prefix}${expression}; }`;
    await assert.rejects(() => compile(code, 'node-limit.ghost.md'), error => {
      const column = prefix.length + (2048 * 2);
      assert.equal(error.message, `node-limit.ghost.md:4:${column}: AST node limit exceeded (4096)`);
      assert.equal(error.line, 4);
      assert.equal(error.column, column);
      return true;
    });
  });
});

test('canonical literate diagnostics preserve CRLF, Unicode, and multiple-fence positions', async t => {
  await t.test('CRLF maps a parser diagnostic to the Markdown source', async () => {
    const code = 'control CRLF {\r\n  output ready: Bool = false;\r\n}';
    await assert.rejects(() => compile(code, 'crlf-diagnostic.ghost.md', '\r\n'), error => {
      assert.equal(error.message, 'crlf-diagnostic.ghost.md:5:22: output declarations are type-only; connect each output with `name <- expression;`');
      assert.equal(error.line, 5);
      assert.equal(error.column, 22);
      return true;
    });
  });
  await t.test('well-formed Unicode reaches the lexer and retains its exact column', async () => {
    await assert.rejects(() => compile('control Unicode { let snow = ☃; }', 'unicode-diagnostic.ghost.md'), error => {
      assert.equal(error.message, 'unicode-diagnostic.ghost.md:4:30: unexpected character "☃"');
      assert.equal(error.line, 4);
      assert.equal(error.column, 30);
      return true;
    });
  });
  await t.test('a later executable fence maps independently from an earlier valid fence', async () => {
    const markdown = '# Multiple\n\n```ghost\nfn identity(value: Bool) -> Bool { value }\n```\n\nText.\n\n```ghost\ncontrol Multiple {\n  output ready: Bool;\n  ready <- ;\n}\n```\n';
    await assert.rejects(() => compileSource(markdown, { filename: 'multiple-fences.ghost.md' }), error => {
      assert.equal(error.message, 'multiple-fences.ghost.md:12:12: expected expression, found ;');
      assert.equal(error.line, 12);
      assert.equal(error.column, 12);
      return true;
    });
  });
});

test('literate and compile-source ingress diagnostics stay categorized', async t => {
  for (const item of fixture.literateCases) await t.test(item.id, () => {
    assert.throws(() => extractLiterate(item.markdown, { filename: item.filename }), error => {
      assert.ok(error instanceof LiterateError);
      assert.equal(error.filename, item.filename);
      assert.equal(error.line, item.line);
      assert.equal(error.column, item.column);
      assert.equal(error.message, `${item.filename}:${item.line}:${item.column}: ${item.message}`);
      return true;
    });
  });
  await t.test('literate non-string input', () => {
    assert.throws(() => extractLiterate(null), error => error instanceof TypeError && error.message === 'markdown must be a string');
  });
  await t.test('literate byte limit', () => {
    assert.throws(() => extractLiterate('x'.repeat(1024 * 1024 + 1)), error => error instanceof RangeError && error.message === 'literate byte limit exceeded');
  });
  await t.test('literate line limit', () => {
    assert.throws(() => extractLiterate(Array(100_002).fill('x').join('\n')), error => error instanceof RangeError && error.message === 'literate line limit exceeded');
  });
  const ingress = [
    ['non-string source', () => compileSource(null), /source must be a well-formed UTF-8 string/],
    ['malformed Unicode source', () => compileSource('\ud800'), /source must be a well-formed UTF-8 string/],
    ['oversized source', () => compileSource('x'.repeat(1024 * 1024 + 1)), /source byte limit exceeded/],
    ['non-literate filename', () => compileSource(document('control Good {}'), { filename: 'plain.ghost' }), /requires a canonical \.ghost\.md literate source/],
    ['empty filename', () => compileSource(document('control Good {}'), { filename: '' }), /source filename must be a non-empty well-formed UTF-8 string/],
    ['NUL filename', () => compileSource(document('control Good {}'), { filename: 'bad\0.ghost.md' }), /source filename must be a non-empty well-formed UTF-8 string/],
    ['malformed Unicode filename', () => compileSource(document('control Good {}'), { filename: '\ud800.ghost.md' }), /source filename must be a non-empty well-formed UTF-8 string/],
    ['null options', () => compileSource(document('control Good {}'), null), /compile options must be an object/],
    ['non-object options', () => compileSource(document('control Good {}'), []), /compile options must be an object/],
    ['removed interactionSchema option', () => compileSource(document('control Good {}'), { interactionSchema: {} }), /interactionSchema is not a compile option/],
  ];
  for (const [name, action, expected] of ingress) await t.test(name, async () => {
    await assert.rejects(action, expected);
  });
});

test('intent link ingress reports duplicate, unknown, and orphan authorship at the directive', async t => {
  const anchor = '<!-- ghostflow:anchor id=GF-ONE kind=intent status=confirmed origin=user -->\nIntent body.\n\n';
  const cases = [
    {
      name: 'confirmed assumption',
      source: '<!-- ghostflow:anchor id=GF-ASSUME kind=assumption status=confirmed origin=user -->\nAssumption body.\n\n```ghost\ncontrol ConfirmedAssumption {}\n```\n',
      line: 1, column: 1, message: 'confirmed intent assumption is invalid',
    },
    {
      name: 'duplicate anchor',
      source: `${anchor}<!-- ghostflow:anchor id=GF-ONE kind=intent status=confirmed origin=user -->\nSecond body.\n\n\`\`\`ghost\ncontrol DuplicateAnchor {}\n\`\`\`\n`,
      line: 4, column: 1, message: 'duplicate intent anchor GF-ONE',
    },
    {
      name: 'unknown linked anchor',
      source: `${anchor}\`\`\`ghost\ncontrol MissingAnchor {\n  // ghostflow:link id=GF-MISSING relation=implements\n  output ready: Bool;\n  ready <- false;\n}\n\`\`\`\n`,
      line: 6, column: 3, message: 'intent link references missing anchor GF-MISSING',
    },
    {
      name: 'orphan link',
      source: `${anchor}\`\`\`ghost\ncontrol Orphan {\n  // ghostflow:link id=GF-ONE relation=implements\n\n  output ready: Bool;\n  ready <- false;\n}\n\`\`\`\n`,
      line: 6, column: 3, message: 'orphan intent link GF-ONE',
    },
    {
      name: 'duplicate identical link',
      source: `${anchor}\`\`\`ghost\ncontrol DuplicateLink {\n  // ghostflow:link id=GF-ONE relation=implements\n  // ghostflow:link id=GF-ONE relation=implements\n  output ready: Bool;\n  ready <- false;\n}\n\`\`\`\n`,
      line: 7, column: 3, message: 'duplicate identical intent link',
    },
    {
      name: 'superseded anchor link',
      source: '<!-- ghostflow:anchor id=GF-OLD kind=intent status=superseded origin=user -->\nOld intent.\n\n```ghost\ncontrol Superseded {\n  // ghostflow:link id=GF-OLD relation=implements\n  output ready: Bool;\n  ready <- false;\n}\n```\n',
      line: 6, column: 3, message: 'intent link references superseded anchor GF-OLD',
    },
    {
      name: 'assumes requires unconfirmed assumption',
      source: '<!-- ghostflow:anchor id=GF-INTENT kind=intent status=confirmed origin=user -->\nIntent.\n\n```ghost\ncontrol WrongAssumes {\n  // ghostflow:link id=GF-INTENT relation=assumes\n  output ready: Bool;\n  ready <- false;\n}\n```\n',
      line: 6, column: 3, message: 'intent link assumes requires unconfirmed assumption GF-INTENT',
    },
    {
      name: 'non-assumes relation rejects assumption',
      source: '<!-- ghostflow:anchor id=GF-ASSUME kind=assumption status=unconfirmed origin=user -->\nAssumption.\n\n```ghost\ncontrol WrongRelation {\n  // ghostflow:link id=GF-ASSUME relation=implements\n  output ready: Bool;\n  ready <- false;\n}\n```\n',
      line: 6, column: 3, message: 'intent link implements cannot reference assumption GF-ASSUME',
    },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const filename = `${item.name.replaceAll(' ', '-')}.ghost.md`;
    await assert.rejects(() => compileSource(item.source, { filename }), error => {
      assert.equal(error.filename, filename);
      assert.equal(error.line, item.line);
      assert.equal(error.column, item.column);
      assert.equal(error.message, `${filename}:${item.line}:${item.column}: ${item.message}`);
      return true;
    });
  });
});

test('ghostc --check and build reject atomically and report the mapped diagnostic', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostc-syntax-diagnostic-'));
  try {
    const invalid = path.join(temporary, 'invalid.ghost.md');
    const output = path.join(temporary, 'invalid.gfb');
    fs.writeFileSync(invalid, document('control Invalid { output ready: Bool = false; }'));
    for (const args of [['--check', invalid], [invalid, output]]) {
      const result = spawnSync(process.execPath, ['tools/ghostc.mjs', ...args], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, new RegExp(`^ghostc: ${invalid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:4:38: output declarations are type-only;`, 'm'));
      assert.equal(fs.existsSync(output), false);
      assert.equal(fs.existsSync(`${output}.manifest.json`), false);
      assert.equal(fs.existsSync(`${output}.map.json`), false);
    }

    const valid = path.join(temporary, 'valid.ghost.md');
    const validOutput = path.join(temporary, 'valid.gfb');
    fs.writeFileSync(valid, document('control Valid { output ready: Bool; ready <- false; }'));
    const checked = spawnSync(process.execPath, ['tools/ghostc.mjs', '--check', valid], { cwd: root, encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /\(checked\)/);
    const built = spawnSync(process.execPath, ['tools/ghostc.mjs', valid, validOutput], { cwd: root, encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    assert.equal(fs.existsSync(validOutput), true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('ghostc argument and byte ingress diagnostics are exhaustive and atomic', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostc-ingress-diagnostic-'));
  try {
    const valid = path.join(temporary, 'valid.ghost.md');
    const ignored = path.join(temporary, 'ignored.gfb');
    fs.writeFileSync(valid, document('control Valid {}'));
    const usage = 'usage: ghostc <input.ghost.md> <output.gfb>\n       ghostc --check <input.ghost.md>\n';
    const usageCases = [
      ['empty arguments', []],
      ['missing build output', [valid]],
      ['extra build operand', [valid, ignored, 'extra']],
      ['unknown flag', ['--unknown', valid, ignored]],
      ['duplicate check flag', ['--check', '--check', valid]],
      ['extra check operand', ['--check', valid, ignored]],
    ];
    for (const [name, args] of usageCases) await t.test(name, () => {
      const result = spawnSync(process.execPath, ['tools/ghostc.mjs', ...args], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, usage);
      assert.equal(fs.existsSync(ignored), false);
    });

    const malformedForms = [
      ['invalid continuation', [0xc3, 0x28]],
      ['truncated sequence', [0xe2, 0x82]],
      ['lone continuation', [0x80]],
    ];
    for (const [name, octets] of malformedForms) await t.test(name, async t => {
      const invalid = path.join(temporary, `${name.replaceAll(' ', '-')}.ghost.md`);
      fs.writeFileSync(invalid, Buffer.concat([Buffer.from('# Bad\n\n```ghost\ncontrol Bad { let value = '), Buffer.from(octets), Buffer.from('; }\n```\n')]));
      await t.test('--check rejects before compilation', () => {
        const result = spawnSync(process.execPath, ['tools/ghostc.mjs', '--check', invalid], { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, `ghostc: ${invalid}: source must contain valid UTF-8 bytes\n`);
      });
      await t.test('build preserves an existing destination sentinel', () => {
        const output = path.join(temporary, `${name.replaceAll(' ', '-')}.gfb`);
        const sentinel = Buffer.from('existing-artifact');
        fs.writeFileSync(output, sentinel);
        const result = spawnSync(process.execPath, ['tools/ghostc.mjs', invalid, output], { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, `ghostc: ${invalid}: source must contain valid UTF-8 bytes\n`);
        assert.deepEqual(fs.readFileSync(output), sentinel);
        assert.equal(fs.existsSync(`${output}.manifest.json`), false);
        assert.equal(fs.existsSync(`${output}.map.json`), false);
      });
    });

    await t.test('UTF-8 BOM remains part of canonical source identity', async () => {
      const input = path.join(temporary, 'bom.ghost.md');
      const output = path.join(temporary, 'bom.gfb');
      const source = `\ufeff${document('control Bom {}')}`;
      fs.writeFileSync(input, source, 'utf8');
      const result = spawnSync(process.execPath, ['tools/ghostc.mjs', input, output], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const map = JSON.parse(fs.readFileSync(`${output}.map.json`, 'utf8'));
      const api = await compileSource(source, { filename: input });
      assert.equal(map.sourceDocument.text, source);
      assert.equal(map.sourceDocument.sha256, api.sourceDocument.sha256);
      assert.deepEqual(fs.readFileSync(output), Buffer.from(api.bytes));
    });

    await t.test('missing input retains the filesystem diagnostic and filename', () => {
      const missing = path.join(temporary, 'missing.ghost.md');
      const output = path.join(temporary, 'missing.gfb');
      const result = spawnSync(process.execPath, ['tools/ghostc.mjs', missing, output], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /ENOENT/);
      assert.match(result.stderr, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(result.stderr, /valid UTF-8 bytes/);
      assert.equal(fs.existsSync(output), false);
    });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('diagnostic inventory names reused coverage and unreachable internal guards', () => {
  for (const item of fixture.existingCoverage) {
    const source = fs.readFileSync(path.join(root, item.file), 'utf8');
    assert.match(source, new RegExp(item.needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${item.family} inventory link`);
  }
  const allCaseIds = new Set([
    ...fixture.cases.map(item => item.id),
    ...fixture.literateCases.map(item => item.id),
    ...fixture.additionalCaseIds,
    ...fixture.ingressCaseIds,
  ]);
  const sites = fixture.siteCoverage.flatMap(item => item.sites);
  assert.equal(new Set(sites).size, sites.length, 'each reachable diagnostic site is mapped once');
  for (const item of fixture.siteCoverage) for (const id of item.cases) {
    assert.ok(allCaseIds.has(id), `${item.sites.join(', ')} maps known case ${id}`);
  }
  const mappedParserCases = new Set(fixture.siteCoverage.flatMap(item => item.cases));
  for (const item of fixture.cases) assert.ok(mappedParserCases.has(item.id), `${item.id} has a parser site`);
  assert.equal(new Set(fixture.unreachable.map(item => item.site)).size, fixture.unreachable.length);
  assert.ok(fixture.unreachable.length >= 8);
  for (const item of fixture.unreachable) assert.ok(item.reason.length > 20, `${item.site} explains why source cannot reach it`);
});
