import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { compileSource as compileBrowserSource } from '../tools/browser-toolchain.mjs';
import { sha256Hex } from '../tools/sha256.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode, decode } from '@toon-format/toon';
import { runNodeCli } from './helpers/cli-process.mjs';

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

for (const [kind, name, declaration, before, after] of [
  ['state', 'hot', 'state hot: Bool = false;', '', "hot' = hot;"],
  ['timer', 'age', 'timer age = elapsed(running);',
    '// ghostflow:link id=Existing relation=implements\n  state running: Bool = false;\n  running\' = running;', ''],
  ['config', 'delay', 'config delay: Duration = 1s { min = 0s; max = 2s; step = 1s; access = operator; };', '', ''],
]) {
  test(`missing ${kind} provenance has an authored, compilable unconfirmed repair`, async () => {
    const markdown = `# 온실 🌱\n\n<!-- ghostflow:anchor id=Existing kind=intent status=confirmed origin=user -->\nExisting authored intent.\n\n<!-- ghostflow:anchor id=GF-REPAIR-${kind}-${name} kind=premise status=superseded origin=engineer -->\nHistorical reason.\n\n\`\`\`ghost\ncontrol Repair {\n  ${before}\n\`\`\`\n\nAnother fence.\n\n\`\`\`ghost\n  ${declaration}\n  ${after}\n}\n\`\`\`\n`.replaceAll('\n', '\r\n');
    const filename = `${kind}-repair.ghost.md`;
    const line = markdown.split('\r\n').findIndex(text => text === `  ${declaration}`) + 1;
    const bytes = (await compileSource(markdown, { filename })).bytes;
    for (const compile of [compileSource, compileBrowserSource]) {
      let failure;
      await assert.rejects(() => compile(markdown, { filename, interactionSourceIdentity: valid }), error => {
        failure = error;
        assert.equal(error.constructor, Error);
        assert.match(error.message, new RegExp(`^${filename}:${line}:3: interaction schema: ${kind}.${name} has no literate intent-anchor provenance`));
        assert.deepEqual(error.diagnosticEnvelope.source, { filename, sha256: sha256Hex(markdown), ...valid });
        const diagnostic = error.diagnosticEnvelope.diagnostics[0];
        assert.equal(diagnostic.code, 'GF_INTENT_PROVENANCE');
        assert.deepEqual(diagnostic.span.start, { line, column: 3 });
        assert.equal(diagnostic.span.file, filename);
        assert.ok(diagnostic.span.end.line >= line);
        assert.match(diagnostic.message, /anchor.*paragraph.*link/s);
        assert.equal(diagnostic.reference, 'docs/INTENT-ANCHOR-MAP.md#minimal-authored-form');
        assert.equal(error.bytes, undefined);
        return true;
      });
      const hint = failure.diagnosticEnvelope.diagnostics[0].hint;
      const anchor = hint.match(/<!-- ghostflow:anchor[^\n]+-->\n[^\n]+/)[0];
      const link = hint.match(/\/\/ ghostflow:link[^\n]+/)[0];
      assert.match(anchor, /kind=assumption status=unconfirmed origin=ai/);
      assert.match(link, /relation=assumes/);
      assert.match(anchor, new RegExp(`id=GF-REPAIR-${kind}-${name}-2 `));
      const lines = markdown.split('\r\n');
      lines.splice(line - 1, 0, `  ${link}`);
      const repaired = `${anchor}\r\n\r\n${lines.join('\r\n')}`;
      const result = await compile(repaired, { filename, interactionSourceIdentity: { ...valid, revisionId: 'revision.repaired' } });
      assert.deepEqual(Uint8Array.from(result.bytes), Uint8Array.from(bytes));
      assert.equal(result.sourceDocument.text, repaired);
      assert.equal(result.interactionSchema.source.revisionId, 'revision.repaired');
      assert.equal(result.traceMetadata.intentAnchors.find(entry => entry.id === link.match(/id=(\S+)/)[1]).status, 'unconfirmed');
      assert.equal(sha256Hex(markdown), failure.diagnosticEnvelope.source.sha256);
    }
  });
}

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

test('structured CLI preserves missing-provenance repair, identity and failed artifacts', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostflow-intent-diagnostic-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'hot.ghost.md');
  const output = path.join(directory, 'hot.gfb');
  const request = path.join(directory, 'request.toon');
  const markdown = '# Hot state\n\n```ghost\ncontrol Hot {\n  state hot: Bool = false;\n  hot\' = hot;\n}\n```\n';
  fs.writeFileSync(input, markdown);
  fs.writeFileSync(request, encode({ format: 'GhostFlow/cli-request-v1', operation: 'compile',
    source: { path: input, ...valid }, artifactPath: output }));
  for (const format of ['json', 'toon']) {
    const result = await runNodeCli([fileURLToPath(new URL('../tools/ghostc.mjs', import.meta.url)),
      '--request', request, '--format', format], { timeout: 30_000 });
    assert.equal(result.error, null);
    assert.equal(result.status, 1, result.stderr);
    const report = format === 'json' ? JSON.parse(result.stdout) : decode(result.stdout);
    assert.equal(report.ok, false);
    assert.deepEqual(report.source, { path: input, sha256: sha256Hex(markdown), ...valid });
    assert.equal(report.diagnostics[0].code, 'GF_INTENT_PROVENANCE');
    assert.equal(report.diagnostics[0].span.start.line, 5);
    assert.match(report.diagnostics[0].hint, /kind=assumption status=unconfirmed origin=ai/);
    assert.equal(report.artifact, undefined);
    for (const suffix of ['', '.manifest.json', '.map.json']) assert.equal(fs.existsSync(output + suffix), false);
    assert.equal(fs.readFileSync(input, 'utf8'), markdown);
  }
});

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
    error => {
      assert.equal(error?.constructor, Error);
      if (message.endsWith('has no literate intent-anchor provenance')) {
        assert.ok(error.message.includes(`interaction schema: ${message}.`));
        assert.equal(error.diagnosticEnvelope.diagnostics[0].code, 'GF_INTENT_PROVENANCE');
      } else assert.equal(error.message, `interaction schema: ${message}`);
      return true;
    },
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
