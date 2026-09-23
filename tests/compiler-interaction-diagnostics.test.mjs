import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';

const source = `# Interaction diagnostics

\`\`\`ghost
control IdentityFixture {
  output ready: Bool;
  ready <- false;
}
\`\`\`
`;
const filename = 'identity-fixture.ghost.md';
const valid = { documentId: 'source.identity-fixture', revisionId: 'revision.identity-fixture-v1' };

for (const [label, identity, message] of [
  ['missing identity', {}, 'source identity must contain exactly documentId and revisionId'],
  ['extra identity field', { ...valid, extra: 'x' }, 'source identity must contain exactly documentId and revisionId'],
  ['array identity', [], 'source identity must contain exactly documentId and revisionId'],
  ['missing documentId', { revisionId: valid.revisionId }, 'source identity must contain exactly documentId and revisionId'],
  ['missing revisionId', { documentId: valid.documentId }, 'source identity must contain exactly documentId and revisionId'],
  ['empty documentId', { ...valid, documentId: '' }, 'source identity documentId must be an explicit public immutable identity'],
  ['reserved documentId', { ...valid, documentId: '__gf_source' }, 'source identity documentId must be an explicit public immutable identity'],
  ['malformed revisionId', { ...valid, revisionId: 'bad revision' }, 'source identity revisionId must be an explicit public immutable identity'],
  ['empty revisionId', { ...valid, revisionId: '' }, 'source identity revisionId must be an explicit public immutable identity'],
]) {
  test(`interaction identity diagnostic: ${label}`, async () => {
    await assert.rejects(
      () => compileSource(source, { filename, interactionSourceIdentity: identity }),
      error => error?.constructor === Error && error.message === `interaction schema: ${message}`,
    );
  });
}

test('valid public identity remains an accepted neighbor', async () => {
  const result = await compileSource(source, { filename, interactionSourceIdentity: valid });
  assert.equal(result.interactionSchema.source.documentId, valid.documentId);
});

const expectSchemaError = (label, body, message, preamble = '', validBody = null, validPreamble = preamble) => test(`interaction schema diagnostic: ${label}`, async () => {
  const markdown = (sourceBody, sourcePreamble) => `# ${label}\n\n${sourcePreamble}\n\`\`\`ghost\n${sourceBody}\n\`\`\`\n`;
  await assert.rejects(
    () => compileSource(markdown(body, preamble), {
      filename: `${label}.ghost.md`, interactionSourceIdentity: valid,
    }),
    error => error?.constructor === Error && error.message === `interaction schema: ${message}`,
  );
  const result = await compileSource(markdown(validBody, validPreamble), {
    filename: `${label}-valid.ghost.md`, interactionSourceIdentity: valid,
  });
  assert.ok(result.interactionSchema.descriptors.length > 0);
});

expectSchemaError(
  'authored state without intent link',
  'control MissingState {\n  state running: Bool = false;\n  running\' = running;\n}',
  'state.running has no literate intent-anchor provenance',
  '',
  'control ValidState {\n  // ghostflow:link id=GF-STATE-VALID relation=implements\n  state running: Bool = false;\n  running\' = running;\n}',
  '<!-- ghostflow:anchor id=GF-STATE-VALID kind=intent status=confirmed origin=user -->\n\nState intent.',
);
expectSchemaError(
  'authored timer without intent link',
  'control MissingTimer {\n  // ghostflow:link id=GF-TIMER-STATE relation=implements\n  state running: Bool = false;\n  running\' = running;\n  timer age = elapsed(running);\n}',
  'timer.age has no literate intent-anchor provenance',
  '<!-- ghostflow:anchor id=GF-TIMER-STATE kind=intent status=confirmed origin=user -->\n\nTimer state intent.',
  'control ValidTimer {\n  // ghostflow:link id=GF-TIMER-STATE relation=implements\n  state running: Bool = false;\n  running\' = running;\n  // ghostflow:link id=GF-TIMER-STATE relation=implements\n  timer age = elapsed(running);\n}',
);
expectSchemaError(
  'authored config without intent link',
  'control MissingConfig {\n  config delay: Duration = 1s { min = 0s; max = 2s; step = 1s; access = operator; };\n}',
  'config.delay has no literate intent-anchor provenance',
  '<!-- ghostflow:anchor id=GF-CONFIG-VALID kind=intent status=confirmed origin=user -->\n\nConfig intent.',
  'control ValidConfig {\n  // ghostflow:link id=GF-CONFIG-VALID relation=implements\n  config delay: Duration = 1s { min = 0s; max = 2s; step = 1s; access = operator; };\n}',
);

expectSchemaError(
  'counter meaning on Bool state',
  'control BoolCounter {\n  // ghostflow:link id=GF-COUNTER-BOOL relation=implements meaning=counter\n  state running: Bool = false;\n  running\' = running;\n}',
  'state.running counter meaning requires Int',
  '<!-- ghostflow:anchor id=GF-COUNTER-BOOL kind=intent status=confirmed origin=user -->\n\nCounter intent.',
  'control IntCounter {\n  // ghostflow:link id=GF-COUNTER-BOOL relation=implements meaning=counter\n  state running: Int = 0;\n  running\' = running;\n}',
);
