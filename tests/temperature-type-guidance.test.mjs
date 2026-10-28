import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { encode, decode } from '@toon-format/toon';
import { compileSource as compileInNode } from '../tools/toolchain.mjs';
import { compileSource as compileInBrowser } from '../tools/browser-toolchain.mjs';
import { sha256Hex } from '../tools/sha256.mjs';

const filename = 'temperature.ghost.md';
const document = type => `\`\`\`ghost\ncontrol Vent { input temperature: ${type}; output fan: Bool; fan <- true; }\n\`\`\``;
const bad = document('Celsius');
const reference = 'docs/ProgrammingInGhostflow.md#quantity-type-lookup';

for (const [entry, compile] of [['Node', compileInNode], ['browser', compileInBrowser]]) {
  test(`${entry} compiler explains an undeclared Celsius type at the original source span`, async () => {
    await assert.rejects(compile(bad, { filename }), error => {
      assert.match(error.message, /unknown type Celsius/);
      assert.match(error.message, /Temperature/);
      assert.match(error.message, /30°C/);
      const envelope = error.diagnosticEnvelope;
      assert.equal(envelope.source.sha256, sha256Hex(bad));
      const diagnostic = envelope.diagnostics[0];
      assert.equal(diagnostic.code, 'GF_SEMANTIC');
      assert.equal(diagnostic.severity, 'error');
      assert.equal(diagnostic.message, 'unknown type Celsius');
      assert.match(diagnostic.hint, /input temperature: Temperature;/);
      assert.match(diagnostic.hint, /30°C/);
      assert.equal(diagnostic.reference, reference);
      assert.deepEqual(diagnostic.span, { file: filename,
        start: { line: 2, column: 35 }, end: { line: 2, column: 42 } });
      return true;
    });
  });

  test(`${entry} compiler preserves real types, user-defined Celsius and unrelated diagnostics`, async () => {
    const repaired = '```ghost\ncontrol Vent { input temperature: Temperature; output fan: Bool; fan <- (temperature |> recover(0°C)) > 28°C; }\n```';
    const artifact = await compile(repaired, { filename });
    assert.equal(sha256Hex(artifact.bytes), '63175ef4e7f23b0781b6b2f3beb01340281b01ac5f6e8d81f61c52c83a051d56');
    const authored = await compile('```ghost\ncontrol Enum { type Celsius = Cold | Hot; state mode: Celsius = Cold; output fan: Bool; fan <- mode == Hot; }\n```', { filename });
    assert.ok(authored.bytes.length > 6);
    await assert.rejects(compile(document('Missing'), { filename }), error => {
      assert.equal(error.diagnosticEnvelope.diagnostics[0].message, 'unknown type Missing');
      assert.equal(error.diagnosticEnvelope.diagnostics[0].hint, undefined);
      return true;
    });
  });
}

test('human, JSON and TOON CLI carry Celsius guidance and preserve existing artifacts', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-temperature-guidance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, filename), output = path.join(directory, 'control.gfb');
  fs.writeFileSync(input, bad);
  const artifacts = [output, `${output}.manifest.json`, `${output}.map.json`];
  for (const artifact of artifacts) fs.writeFileSync(artifact, 'existing artifact');
  const run = args => {
    const result = spawnSync(process.execPath, ['tools/ghostc.mjs', ...args], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    return result;
  };
  const human = run([input, output]);
  assert.match(human.stderr, /unknown type Celsius/);
  assert.match(human.stderr, /input temperature: Temperature;/);
  assert.match(human.stderr, /30°C/);
  assert.equal(human.stdout, '');
  const requestPath = path.join(directory, 'request.toon');
  fs.writeFileSync(requestPath, encode({ format: 'GhostFlow/cli-request-v1', operation: 'compile',
    source: { path: input, documentId: 'temperature', revisionId: 'r1' }, artifactPath: output }));
  const json = JSON.parse(run(['--request', requestPath, '--format', 'json']).stdout);
  const toon = decode(run(['--request', requestPath]).stdout, { strict: true });
  assert.deepEqual(toon, json);
  assert.match(json.diagnostics[0].hint, /input temperature: Temperature;/);
  assert.equal(json.diagnostics[0].reference, reference);
  assert.equal(json.artifact, undefined);
  for (const artifact of artifacts) assert.equal(fs.readFileSync(artifact, 'utf8'), 'existing artifact');
  assert.match(fs.readFileSync(new URL('../docs/ProgrammingInGhostflow.md', import.meta.url), 'utf8'), /id="quantity-type-lookup"/);
});
