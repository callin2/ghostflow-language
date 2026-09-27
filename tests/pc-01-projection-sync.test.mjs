import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writePc01Projection, PC01_DOCUMENT, PC01_PROJECTION } from '../tools/generate-pc-01-projection.mjs';

const catalogPath = 'examples/curriculum/catalog.json';
const replayPath = 'examples/curriculum/replay-scenarios.json';

test('PC-01 write syncs current identity without changing replay evidence or other lessons', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-01-sync-'));
  try {
    for (const relative of [PC01_DOCUMENT, PC01_PROJECTION, catalogPath, replayPath]) {
      fs.mkdirSync(path.dirname(path.join(temp, relative)), { recursive: true });
      fs.copyFileSync(new URL(`../${relative}`, import.meta.url), path.join(temp, relative));
    }
    fs.appendFileSync(path.join(temp, PC01_DOCUMENT), '\nA prose-only revision.\n');
    const beforeCatalog = JSON.parse(fs.readFileSync(path.join(temp, catalogPath), 'utf8'));
    const beforeReplay = JSON.parse(fs.readFileSync(path.join(temp, replayPath), 'utf8'));
    beforeCatalog.lessons[1].source.sha256 = '0'.repeat(64); // Existing unrelated tampering must survive the writer.
    fs.writeFileSync(path.join(temp, catalogPath), `${JSON.stringify(beforeCatalog, null, 2)}\n`);

    writePc01Projection({ repositoryRoot: temp });

    const catalog = JSON.parse(fs.readFileSync(path.join(temp, catalogPath), 'utf8'));
    const replay = JSON.parse(fs.readFileSync(path.join(temp, replayPath), 'utf8'));
    assert.notEqual(catalog.lessons[0].source.documentSha256, beforeCatalog.lessons[0].source.documentSha256);
    assert.notEqual(catalog.lessons[0].source.projectionSha256, beforeCatalog.lessons[0].source.projectionSha256);
    assert.equal(replay.scenarios[0].source.canonicalSha256, catalog.lessons[0].source.documentSha256);
    assert.equal(replay.scenarios[0].source.executableSha256, catalog.lessons[0].source.projectionSha256);
    assert.deepEqual(catalog.lessons.slice(1), beforeCatalog.lessons.slice(1));
    assert.deepEqual(replay.scenarios[0].frames, beforeReplay.scenarios[0].frames);
    assert.deepEqual(replay.scenarios[0].checkpoints, beforeReplay.scenarios[0].checkpoints);
    assert.deepEqual(replay.scenarios.slice(1), beforeReplay.scenarios.slice(1));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
