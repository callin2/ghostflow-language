import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createOperatingSettingsCandidate } from '../tools/operating-settings.mjs';
import { compileSource } from '../tools/toolchain.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const document = code => `# Int operating setting\n\n\`\`\`ghost\n${code}\n\`\`\`\n`;

const intSource = document(`control IntSettings {
  config count: Int = -2 { min = -5; max = 10; step = 3; access = operator; label = "Count"; }
  output selected: Int;
  selected <- count;
}`);

function position(source, marker, occurrence = 1) {
  let index = -1;
  for (let seen = 0; seen < occurrence; seen += 1) index = source.indexOf(marker, index + 1);
  assert.notEqual(index, -1, `missing marker ${marker}`);
  const lines = source.slice(0, index).split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

async function rejectsLocated({ code, marker, detail, filename }) {
  const source = document(code);
  const expected = position(source, marker);
  await assert.rejects(() => compileSource(source, { filename }), error => {
    assert.equal(error.name, 'ControlCompileError');
    assert.equal(error.filename, filename);
    assert.equal(error.line, expected.line);
    assert.equal(error.column, expected.column);
    assert.equal(error.message, `${filename}:${expected.line}:${expected.column}: ${detail}`);
    return true;
  });
}

test('Int operating config emits exact signed metadata without a speculative step type', async () => {
  const artifact = await compileSource(intSource, { filename: 'int-settings.ghost.md' });
  assert.equal(artifact.manifest.format, 'GhostFlow/control-v4');
  assert.deepEqual(artifact.manifest.configs, [{
    name: 'count',
    type: 'Int',
    value: -2,
    settings: { min: -5, max: 10, step: 3, access: 'operator', label: 'Count' },
    initialOffset: artifact.manifest.configs[0].initialOffset,
    initialEndOffset: artifact.manifest.configs[0].initialEndOffset,
  }]);
  assert.equal(Number.isInteger(artifact.manifest.configs[0].settings.step), true);
  assert.equal(Object.hasOwn(artifact.manifest.configs[0].settings, 'stepType'), false);
});

test('candidate rewrite changes only the signed Int literal and preserves exact canonical source', async () => {
  const originalHash = sha256(intSource);
  const result = await createOperatingSettingsCandidate({
    source: intSource,
    filename: 'int-settings.ghost.md',
    expectedSourceSha256: originalHash,
    changes: { count: 10 },
  });
  const expected = intSource.replace('Int = -2 {', 'Int = 10 {');
  assert.equal(result.source, expected);
  assert.equal(intSource.includes('Int = -2 {'), true, 'input document stays immutable');
  assert.equal(result.beforeSourceSha256, originalHash);
  assert.equal(result.sourceSha256, sha256(expected));
  assert.equal(result.manifest.configs[0].value, 10);
  assert.deepEqual(result.manifest.configs[0].settings, { min: -5, max: 10, step: 3, access: 'operator', label: 'Count' });
});

test('signed 32-bit endpoint literals survive compilation and rewriting without precision loss', async () => {
  const source = document(`control IntEndpoints {
  config count: Int = -2147483648 { min = -2147483648; max = 2147483647; step = 1; access = operator; }
  output selected: Int;
  selected <- count;
}`);
  const before = await compileSource(source, { filename: 'int-endpoints.ghost.md' });
  assert.equal(before.manifest.configs[0].value, -2147483648);
  const result = await createOperatingSettingsCandidate({
    source,
    filename: 'int-endpoints.ghost.md',
    expectedSourceSha256: sha256(source),
    changes: { count: 2147483647 },
  });
  assert.equal(result.source, source.replace('Int = -2147483648 {', 'Int = 2147483647 {'));
  assert.equal(result.manifest.configs[0].value, 2147483647);
});

test('compiler rejects invalid Int setting literals at exact authored locations', async t => {
  const cases = [
    {
      id: 'fractional initial',
      code: 'control Bad { config count: Int = 1.5 { min = 0; max = 5; step = 1; access = operator; } }',
      marker: '1.5',
      detail: 'Int literal must be a whole decimal numeral without a decimal point or exponent',
    },
    {
      id: 'initial above i32',
      code: 'control Bad { config count: Int = 2147483648 { min = 0; max = 2147483647; step = 1; access = operator; } }',
      marker: '2147483648',
      detail: 'Int literal is outside -2147483648..2147483647',
    },
    {
      id: 'fractional min',
      code: 'control Bad { config count: Int = 1 { min = 0.5; max = 5; step = 1; access = operator; } }',
      marker: 'config',
      detail: 'Int setting must use a whole decimal literal',
    },
    {
      id: 'max above i32',
      code: 'control Bad { config count: Int = 1 { min = 0; max = 2147483648; step = 1; access = operator; } }',
      marker: 'config',
      detail: 'Int setting is outside -2147483648..2147483647',
    },
    {
      id: 'zero step',
      code: 'control Bad { config count: Int = 1 { min = 0; max = 5; step = 0; access = operator; } }',
      marker: 'config',
      detail: 'numeric config requires valid min, max and positive step',
    },
    {
      id: 'negative step',
      code: 'control Bad { config count: Int = 1 { min = 0; max = 5; step = -1; access = operator; } }',
      marker: 'config',
      detail: 'numeric config requires valid min, max and positive step',
    },
    {
      id: 'exact grid mismatch',
      code: 'control Bad { config count: Int = 1 { min = 0; max = 2147483647; step = 2147483647; access = operator; } }',
      marker: '1',
      detail: 'config initial value is not aligned to settings.step from settings.min',
    },
    {
      id: 'max exact grid mismatch',
      code: 'control Bad { config count: Int = 0 { min = 0; max = 5; step = 2; access = operator; } }',
      marker: 'config',
      detail: 'Int config max is not aligned to settings.step from settings.min',
    },
  ];
  for (const item of cases) await t.test(item.id, () => rejectsLocated({
    ...item,
    filename: `int-${item.id.replaceAll(' ', '-')}.ghost.md`,
  }));
});

test('candidate validation uses exact Int type range and min-relative modulo', async t => {
  const run = requested => createOperatingSettingsCandidate({
    source: intSource,
    filename: 'int-candidate.ghost.md',
    expectedSourceSha256: sha256(intSource),
    changes: { count: requested },
  });
  for (const [id, requested, message] of [
    ['fractional', 1.5, 'invalid type for count'],
    ['below i32', -2147483649, 'value outside range or step for count'],
    ['above i32', 2147483648, 'value outside range or step for count'],
    ['misaligned', 0, 'value outside range or step for count'],
    ['non-finite', Number.POSITIVE_INFINITY, 'value outside range or step for count'],
    ['wrong primitive', '1', 'invalid type for count'],
  ]) await t.test(id, async () => {
    await assert.rejects(run(requested), error => error instanceof Error && error.message === message);
  });

  const exactGrid = document('control ExactGrid { config count: Int = 0 { min = 0; max = 2147483647; step = 2147483647; access = operator; } }');
  await t.test('large exact grid does not use floating tolerance', async () => {
    await assert.rejects(() => createOperatingSettingsCandidate({
      source: exactGrid,
      filename: 'int-exact-grid.ghost.md',
      expectedSourceSha256: sha256(exactGrid),
      changes: { count: 1 },
    }), error => error instanceof Error && error.message === 'value outside range or step for count');
  });
});

test('REF-05-108 succeeds through ghostc check and build', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-int-setting-'));
  try {
    const input = path.join(directory, 'config-int-valid.ghost.md');
    const output = path.join(directory, 'config-int-valid.gfb');
    fs.writeFileSync(input, document(`control IntSettings {
  config count: Int = 1 { min = 0; max = 5; step = 1; access = operator; }
}`));
    const checked = spawnSync(process.execPath, ['tools/ghostc.mjs', '--check', input], { cwd: root, encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(fs.existsSync(output), false);
    const built = spawnSync(process.execPath, ['tools/ghostc.mjs', input, output], { cwd: root, encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    assert.ok(fs.statSync(output).size > 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
