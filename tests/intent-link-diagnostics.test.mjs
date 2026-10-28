import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource, compileSourceSync } from '../tools/compile-source.mjs';
import { compileSource as compileBrowser } from '../tools/browser-toolchain.mjs';
import { INTENT_LINK_EXAMPLE } from '../tools/intent-link-diagnostics.mjs';
import { sha256Hex } from '../tools/sha256.mjs';

const filename = 'follow.ghost.md';
const anchor = '<!-- ghostflow:anchor id=GF-REASON kind=intent status=confirmed origin=user -->\n> Reviewed behavior.\n\n';
const link = '// ghostflow:link id=GF-REASON relation=implements';
const document = body => `# Follow\n\n\`\`\`ghost\ncontrol Follow {\n${body}\n}\n\`\`\`\n`;
const body = '  input request: Bool;\n  output lamp: Bool;\n  lamp <- request |> recover(false);';

test('default warning locates unlinked behavior in Markdown and preserves execution bytes', async () => {
  const result = await compileSource(document(body), { filename });
  assert.equal(result.warnings.length, 1);
  const [diagnostic] = result.diagnosticEnvelope.diagnostics;
  assert.deepEqual(result.warnings, [diagnostic]);
  assert.equal(diagnostic.code, 'GF_INTENT_LINK_MISSING');
  assert.equal(diagnostic.severity, 'warning');
  assert.deepEqual(diagnostic.span.start, { line: 7, column: 3 });
  assert.equal(diagnostic.span.file, filename);
  assert.match(diagnostic.message, /connection.*intent cannot be traced/);
  // Captured from unmodified latest dev 06c09444, using this exact executable code.
  assert.equal(sha256Hex(result.bytes), '50460ab7dd446dc43346afefdfdb8913dffc011cce8f0c6ab60c4aeabc0195a5');
  for (const prefix of ['', anchor, 'See https://example.com/intent\n\n']) {
    const candidate = await compileSource(prefix + document(body.replace('  lamp <-', '  // ordinary reason\n  lamp <-')), { filename });
    assert.equal(candidate.warnings.length, 1);
    assert.deepEqual(candidate.bytes, result.bytes);
  }
});

test('partial and declaration-only links cover exactly their own statements', async () => {
  const source = anchor + document(`  ${link}\n  output lamp, spare: Bool;\n  ${link}\n  lamp <- true;\n  spare <- false;`);
  const result = await compileSource(source, { filename });
  assert.equal(result.warnings.length, 1);
  assert.equal(source.split('\n')[result.warnings[0].span.start.line - 1].trim(), 'spare <- false;');
  const fullyLinked = source.replace('  spare <-', `  ${link}\n  spare <-`);
  assert.deepEqual((await compileSource(fullyLinked, { filename })).warnings, []);
  assert.deepEqual((await compileSource(fullyLinked, { filename })).bytes, result.bytes);
});

test('state transitions and each constraint require their own structural link', async () => {
  const source = anchor + document(`  state active: Bool = false;\n  output lamp, spare: Bool;\n  active' = !active;\n  ${link}\n  lamp <- active;\n  spare <- false;\n  require lamp => spare;\n  mutex(lamp, spare);`);
  const result = await compileSource(source, { filename });
  assert.deepEqual(result.warnings.map(w => w.message.match(/this (\w+) statement/)[1]), ['next', 'connection', 'require', 'mutex']);
});

test('copyable hint compiles in browser and Node without inventing confirmed intent', async () => {
  const result = compileSourceSync(document(body), { filename });
  const hint = result.warnings[0].hint;
  const example = hint.slice(hint.indexOf('<!-- ghostflow:anchor'));
  assert.equal(example, INTENT_LINK_EXAMPLE);
  assert.match(example, /kind=assumption status=unconfirmed origin=ai/);
  assert.match(example, /relation=assumes/);
  assert.match(hint, /implements, constrains, fallback, or assumes/);
  assert.match(hint, /only for intent actually confirmed by the user/);
  for (const compile of [compileSource, compileBrowser]) {
    const fixed = await compile(example, { filename });
    assert.deepEqual(fixed.warnings, []);
    assert.deepEqual([...fixed.bytes], [...result.bytes]);
  }
});

test('invalid explicit links remain errors rather than becoming advisory warnings', async () => {
  for (const [source, message] of [
    [document(body.replace('  lamp <-', `  ${link}\n  lamp <-`)), /missing anchor/],
    [anchor + document(body.replace('  lamp <-', `  ${link}\n\n  lamp <-`)), /orphan intent link/],
    [anchor + document(body.replace('  lamp <-', `  ${link.replace('implements', 'unknown')}\n  lamp <-`)), /malformed ghostflow link directive/],
  ]) await assert.rejects(() => compileSource(source, { filename }), message);
});

test('nested strategy outputs expose unsupported linkage instead of silently claiming coverage', async () => {
  const source = document('output pump: Bool;\nadapt policy { strategy Baseline priority 0 match always { pump <- false; } }');
  const result = await compileSource(source, { filename });
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[1].message, /connection statement/);
  for (const warning of result.warnings) {
    assert.equal(warning.code, 'GF_INTENT_LINK_COVERAGE_UNSUPPORTED');
    assert.match(warning.hint, /Do not insert an orphan link here/);
    assert.match(warning.hint, /not an immediate repair/);
  }
});

test('unsupported accounting, objective and grouped constraints disclose individual coverage gaps', async () => {
  const bodies = [
    'resource pump: BoolActuator; account a = on_time(pump, stage: applied, persistence: durable);',
    `output lamp, spare: Bool;\n${link}\nlamp <- false;\n${link}\nspare <- false;\nconstraints Safety { require lamp => spare; }`,
    'input temperature: Temperature; config target: Temperature = 25°C { min = 10°C; max = 40°C; step = 0.5Δ°C; access = operator; label = "Target"; } resource vent: ContinuousActuator<Percent>; objective comfort { measure = temperature; target = target; manipulate = vent.position; output = 0% .. 80%; controller = pid { period = 10s; late_after = 30s; direction = reverse; kp = proportional_gain(output: 2%, error: 1Δ°C); ki = integral_gain(output: 0.1%, error: 1Δ°C, time: 1s); kd = derivative_gain(output: 1%, time: 1s, error: 1Δ°C); bias = 0%; anti_windup = conditional_safe; disabled = track_safe; transfer = track_safe; fault = disable; restart = reset(output: 0%); } }',
  ];
  for (const body of bodies) {
    const result = await compileSource(anchor + document(body), { filename });
    assert.ok(result.warnings.some(w => w.code === 'GF_INTENT_LINK_COVERAGE_UNSUPPORTED'));
  }
});

test('bounded warning collection distinguishes exactly twenty from truncated coverage', async () => {
  for (const count of [20, 21]) {
    const names = Array.from({ length: count }, (_, i) => `o${i}`);
    const result = await compileSource(document(`output ${names.join(', ')}: Bool;\n${names.map(n => `${n} <- false;`).join('\n')}`));
    assert.equal(result.warnings.length, 20);
    assert.deepEqual(result.diagnosticEnvelope.collection, count === 20 ? undefined : { limit: 20, truncated: true });
  }
});

test('instantiated import warns at its own source once; unused imports do not contribute coverage', async () => {
  const child = document('  output lamp: Bool;\n  lamp <- true;');
  const imported = `import Child from "./child.ghost.md" revision "r1" sha256 "${sha256Hex(child)}";`;
  for (const instantiate of [false, true]) {
    const source = `\`\`\`ghost\n${imported}\ncontrol Root { ${instantiate ? 'instance east: Child; instance west: Child;' : ''} }\n\`\`\``;
    const result = await compileSource(source, { filename, sourceClosure: [{ filename: 'child.ghost.md', revision: 'r1', text: child }] });
    assert.equal(result.warnings.length, instantiate ? 1 : 0);
    if (instantiate) {
      assert.equal(result.warnings[0].span.file, 'child.ghost.md');
      assert.equal(result.warnings[0].span.start.line, 6);
      assert.match(result.warnings[0].hint, /original definition document.*Root links cannot cover imported statements/);
    }
  }
});
