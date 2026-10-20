import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSourceSync, compileSource } from '../tools/compile-source.mjs';
import { compileSource as nodeCompile } from '../tools/toolchain.mjs';
import { compileSource as browserCompile } from '../tools/browser-toolchain.mjs';
import { COMPILER_FEATURE_IDS, COMPILER_TELEMETRY_PHASES } from '../tools/compiler-telemetry.mjs';

const canary = 'SECRET_PRIVATE_CANARY';
const source = `# ${canary}\n\n\`\`\`ghost\ncontrol ${canary} { input privateInput: Bool; output privateOutput: Bool; privateOutput <- true; }\n\`\`\`\n`;

for (const [name, compile] of [['sync', compileSourceSync], ['async', compileSource], ['node', nodeCompile], ['browser', browserCompile]]) {
  test(`${name}: optional telemetry preserves complete outputs and contains no authored text`, async () => {
    const events = [];
    const expected = await compile(source);
    const actual = await compile(source, { onTelemetry: event => events.push(event) });
    assert.deepEqual(actual, expected);
    assert.deepEqual(events.filter(e => e.event === 'compiler.phase').map(e => e.phase), COMPILER_TELEMETRY_PHASES);
    for (const event of events.filter(e => e.event === 'compiler.phase')) assert.ok(Number.isFinite(event.durationMs) && event.durationMs >= 0);
    const features = events.find(e => e.event === 'compiler.features');
    assert.equal(features.scope, 'root');
    assert.equal(features.coverage, 'static');
    assert.ok(features.features.some(e => e.id === 'ast.output' && e.count === 1));
    assert.ok(features.features.some(e => e.id === 'type.Bool' && e.count === 2));
    assert.ok(features.features.every(e => COMPILER_FEATURE_IDS.includes(e.id) && Number.isInteger(e.count)));
    assert.doesNotMatch(JSON.stringify(events), /SECRET_PRIVATE_CANARY|privateInput|privateOutput|sha256|filename/);
  });
}

test('parse failure reports completed timing and no fabricated zero feature coverage', () => {
  const events = [];
  assert.throws(() => compileSourceSync('```ghost\ncontrol Broken { output x: Bool; x <- ; }\n```', { onTelemetry: e => events.push(e) }));
  assert.deepEqual(events.filter(e => e.event === 'compiler.phase').map(e => e.phase), ['extract', 'parse']);
  assert.equal(events.some(e => e.event === 'compiler.features'), false);
  assert.ok(events.some(e => e.event === 'compiler.diagnostic' && e.code === 'GF_PARSE' && e.category === 'validation'));
});

test('semantic rejection has static coverage and measured failed compile phase', () => {
  const events = [];
  assert.throws(() => compileSourceSync('```ghost\ncontrol Broken { output x: Bool; x <- missing; }\n```', { onTelemetry: e => events.push(e) }));
  assert.ok(events.some(e => e.event === 'compiler.features'));
  assert.ok(events.some(e => e.phase === 'compile_lower_encode'));
  assert.ok(events.some(e => e.code === 'GF_SEMANTIC'));
});

test('early input failure preserves error and does not invent phase measurements', () => {
  let expected;
  try { compileSourceSync(null); } catch (error) { expected = error; }
  const events = [];
  assert.throws(() => compileSourceSync(null, { onTelemetry: e => events.push(e) }), error => error.message === expected.message && error.constructor === expected.constructor);
  assert.deepEqual(events.map(e => e.event), ['compiler.diagnostic']);
});

test('throwing and rejecting observers cannot alter success or failure', async () => {
  const expected = compileSourceSync(source);
  for (const onTelemetry of [() => { throw new Error(canary); }, () => Promise.reject(new Error(canary))]) {
    assert.deepEqual(compileSourceSync(source, { onTelemetry }), expected);
    assert.throws(() => compileSourceSync('```ghost\ncontrol Broken {\n```', { onTelemetry }));
  }
  await new Promise(resolve => setImmediate(resolve));
});
