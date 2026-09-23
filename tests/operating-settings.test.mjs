import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { compileSource, literateDocument } from './helpers/literate-compile.mjs';
import { createOperatingSettingsCandidate } from '../tools/operating-settings.mjs';
import { ControlRuntime } from '../runtimes/wasm/control-runtime.mjs';

const source = literateDocument(`// preserve this\ncontrol irrigation {\n  config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; label = "관수"; }\n  state running: Bool = false;\n}`);
const hash = value => createHash('sha256').update(value).digest('hex');

test('참조하지 않는 운영 설정은 GFB를 유지한다', async () => {
  const before = await compileSource(source, { filename: 'irrigation.ghost.md' });
  const result = await createOperatingSettingsCandidate({ source, expectedSourceSha256: hash(source), changes: { duration: 600000 } });
  assert.equal(before.manifest.format, 'GhostFlow/control-v2');
  assert.equal(result.manifest.format, 'GhostFlow/control-v2');
  assert.deepEqual([...before.bytes], [...(await compileSource(result.source, { filename: 'irrigation.ghost.md' })).bytes]);
  assert.match(result.source, /duration: Duration = 600000ms/);
  assert.match(result.source, /preserve this/);
});

test('참조하는 duration 설정은 GFB 상수와 실제 WASM 출력만 바꾼다', async () => {
  // Concrete TASK43.2 reproduction: the config is part of an output expression,
  // so its literal must change the compiled constant. Exercise the explicit
  // v2 simulation consumer without stripping metadata or weakening v1.
  const effectSource = literateDocument(`// source outside the literal stays byte-for-byte\ncontrol SettingsEffect {\n  config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; }\n  output duration_ms: Duration;\n  duration_ms <- duration;\n}`);
  const before = await compileSource(effectSource, { filename: 'settings-effect.ghost.md' });
  const result = await createOperatingSettingsCandidate({
    source: effectSource,
    filename: 'settings-effect.ghost.md',
    expectedSourceSha256: hash(effectSource),
    changes: { duration: 600000 },
  });
  const after = await compileSource(result.source, { filename: 'settings-effect.ghost.md' });
  assert.equal(result.source, effectSource.replace('Duration = 5min {', 'Duration = 600000ms {'));
  assert.notDeepEqual([...after.bytes], [...before.bytes]);
  assert.notEqual(after.manifest.bytecodeSha256, before.manifest.bytecodeSha256);

  const wasm = fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm', import.meta.url));
  await assert.rejects(() => ControlRuntime.instantiate(wasm, after), /unsupported manifest format GhostFlow\/control-v2/);
  for (const [artifact, expected] of [[before, 300000], [after, 600000]]) {
    const runtime = await ControlRuntime.instantiateSimulation(wasm, artifact);
    try {
      assert.equal(runtime.step({ nowMs: 0 }).vm.safe.duration_ms, expected);
      assert.equal(runtime.manifest.configs[0].settings.apply, 'stopped');
    } finally {
      runtime.dispose();
    }
  }
});

test('운영 후보는 stale, designer, unknown, 범위·간격·주입을 원자적으로 거절한다', async () => {
  const run = changes => createOperatingSettingsCandidate({ source, expectedSourceSha256: hash(source), changes });
  await assert.rejects(() => createOperatingSettingsCandidate({ source, expectedSourceSha256: '0'.repeat(64), changes: { duration: 600000 } }), /stale/);
  await assert.rejects(run({ missing: 600000 }), /unknown/);
  await assert.rejects(run({ duration: 600001 }), /range or step/);
  await assert.rejects(run({ duration: '600000' }), /invalid type/);
  await assert.rejects(run({ 'duration; state running': 600000 }), /unknown/);
  assert.equal(source.includes('600000ms'), false);
});

test('운영 후보는 첫 await 전 요청 값을 snapshot해 TOCTOU 변경을 무시한다', async () => {
  const changes = { duration: 600000 };
  const candidate = createOperatingSettingsCandidate({ source, expectedSourceSha256: hash(source), changes });
  changes.duration = 900000;
  changes.unknown = 600000;
  const result = await candidate;
  assert.match(result.source, /duration: Duration = 600000ms/);
  assert.doesNotMatch(result.source, /900000ms/);
});

test('Bool 운영 설정 후보는 숫자 경계 없이 실제 리터럴만 바꾼다', async () => {
  const boolSource = literateDocument(`control BoolSettings {\n  config enabled: Bool = false { access = operator; label = "사용"; }\n  output value: Bool;\n  value <- enabled;\n}`);
  const result = await createOperatingSettingsCandidate({
    source: boolSource,
    filename: 'bool-settings.ghost.md',
    expectedSourceSha256: hash(boolSource),
    changes: { enabled: true },
  });
  assert.equal(result.source, boolSource.replace('Bool = false {', 'Bool = true {'));
  assert.equal(result.manifest.configs[0].value, true);
});

test('컴파일러는 호스트가 거절할 v2 운영 설정 선언을 fail-closed 한다', async () => {
  const declaration = (initial, settings) => `control InvalidSettings {\n  config level: Number = ${initial} { ${settings} }\n  output value: Number;\n  value <- level;\n}`;
  for (const [initial, settings, message] of [
    ['1 + 1', 'min = 0; max = 10; step = 1; access = operator;', /supported literal/],
    ['5', 'min = 0; max = 4; step = 1; access = operator;', /outside settings range/],
    ['5', 'min = 0; max = 10; step = 3; access = operator;', /not aligned/],
    ['5', 'min = -10; max = 10; step = 1; access = operator; label = "";', /label must be 1 to 128/],
  ]) {
    await assert.rejects(() => compileSource(declaration(initial, settings), { filename: 'invalid-settings.ghost' }), message);
  }
  await assert.rejects(() => compileSource('control InvalidPercent { config level: Percent = 50% { min = 0%; max = 101%; step = 1%; access = operator; } output value: Percent; value <- level; }', { filename: 'invalid-percent.ghost' }), /between 0% and 100%/);
});

test('컴파일러는 단순 음수 Number 리터럴의 전체 span만 편집 가능하게 만든다', async () => {
  const negativeSource = literateDocument(`control NegativeSettings {\n  config offset: Number = -5 { min = -10; max = 10; step = 1; access = operator; }\n  output value: Number;\n  value <- offset;\n}`);
  const negative = await createOperatingSettingsCandidate({
    source: negativeSource,
    filename: 'negative-settings.ghost.md',
    expectedSourceSha256: hash(negativeSource),
    changes: { offset: -4 },
  });
  assert.equal(negative.source, negativeSource.replace('Number = -5 {', 'Number = -4 {'));
  const positive = await createOperatingSettingsCandidate({
    source: negativeSource,
    filename: 'negative-settings.ghost.md',
    expectedSourceSha256: hash(negativeSource),
    changes: { offset: 5 },
  });
  assert.equal(positive.source, negativeSource.replace('Number = -5 {', 'Number = 5 {'));
  await assert.rejects(() => compileSource('control GroupedNegative { config offset: Number = -(5) { min = -10; max = 10; step = 1; access = operator; } output value: Number; value <- offset; }', { filename: 'grouped-negative.ghost' }), /supported literal/);
});

test('literate 후보는 Markdown 원문과 코드 위치를 보존하며 설정만 바꾼다', async () => {
  const literateSource = [
    '# 관수 문서',
    '',
    '설명에 duration: Duration = 5min 이 있어도 실행 코드가 아니다.',
    '',
    '```ghost',
    'control irrigation {',
    '  config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; label = "관수"; }',
    '  state running: Bool = false;',
    '}',
    '```',
    '',
    '문서 끝.',
    '',
  ].join('\r\n');
  const before = await compileSource(literateSource, { filename: 'irrigation.ghost.md' });
  const result = await createOperatingSettingsCandidate({
    source: literateSource,
    filename: 'irrigation.ghost.md',
    expectedSourceSha256: hash(literateSource),
    changes: { duration: 600000 },
  });
  const expected = literateSource.replace('config duration: Duration = 5min {', 'config duration: Duration = 600000ms {');
  assert.equal(result.source, expected);
  assert.equal(result.source.split('duration: Duration = 5min').length, 2);
  assert.deepEqual([...before.bytes], [...(await compileSource(result.source, { filename: 'irrigation.ghost.md' })).bytes]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.manifest), true);
  assert.equal(Object.isFrozen(result.manifest.configs), true);
  await assert.rejects(() => createOperatingSettingsCandidate({
    source: literateSource,
    filename: 'irrigation.ghost.md',
    expectedSourceSha256: hash(literateSource.slice(0, -1)),
    changes: { duration: 600000 },
  }), /stale/);
});

test('분리된 literate fence의 여러 설정과 무시된 중첩 ghost를 함께 보존한다', async () => {
  const literateSource = [
    '# 🌱 관수 설정 문서',
    '',
    '비실행 설명: 한국어와 이모지 👩🏽‍🌾는 원문에 그대로 남아야 한다.',
    '',
    '```ghost',
    'control irrigation {',
    '  config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; label = "관수 시간"; }',
    '```',
    '',
    '- ```ghost',
    '  control ignored {',
    '    config phantom: Duration = 9min { min = 1min; max = 20min; step = 1min; access = operator; }',
    '  }',
    '  ```',
    '',
    '> ```ghost',
    '> control quoted { config quoted: Duration = 9min { min = 1min; max = 20min; step = 1min; access = operator; } }',
    '> ```',
    '',
    '설명 fence 사이에도 🌾 문서 내용이 있다.',
    '',
    '~~~ghost',
    '  config duty: Percent = 50% { min = 0%; max = 100%; step = 10%; access = operator; label = "밸브 비율"; }',
    '  state running: Bool = false;',
    '}',
    '~~~',
    '',
  ].join('\n');
  const before = await compileSource(literateSource, { filename: 'split.ghost.md' });
  assert.deepEqual(before.manifest.configs.map(config => config.name), ['duration', 'duty']);
  const result = await createOperatingSettingsCandidate({
    source: literateSource,
    filename: 'split.ghost.md',
    expectedSourceSha256: hash(literateSource),
    changes: { duration: 600000, duty: 70 },
  });
  const expected = literateSource
    .replace('config duration: Duration = 5min {', 'config duration: Duration = 600000ms {')
    .replace('config duty: Percent = 50% {', 'config duty: Percent = 70% {');
  assert.equal(result.source, expected);
  assert.match(result.source, /phantom: Duration = 9min/);
  assert.match(result.source, /quoted: Duration = 9min/);
  assert.match(result.source, /🌱 관수 설정 문서/);
  assert.match(result.source, /👩🏽‍🌾/);
  assert.deepEqual([...before.bytes], [...(await compileSource(result.source, { filename: 'split.ghost.md' })).bytes]);
});
