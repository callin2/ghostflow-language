import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compileSource } from '../tools/toolchain.mjs';
import { atSource } from './helpers/at-source.mjs';

test('At input migration retains the pinned earlier fixture source revision', () => {
  const bytes = fs.readFileSync(new URL('./fixtures/history/at-before-input-531.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '13e2a04307d833c6b1284b77f3b724725e4cbff7569342036a2a9aa6e9e63bdd');
  const snapshot = JSON.parse(bytes);
  assert.equal(snapshot.revision, '76501ff238694fe0e2979bc4f5b05366fc739426');
  assert.equal(snapshot.sources.length, 4);
  for (const source of snapshot.sources) assert.equal(createHash('sha256').update(source.text).digest('hex'), source.sha256);
});

test('GF-TEST-at-contract: typed absolute singleton emits the At-only executable profile', async () => {
  const a = await compileSource(atSource(), { filename: 'at.ghost.md' });
  const b = await compileSource(atSource({ at: '2026-01-01T17:00:00+09:00' }), { filename: 'at.ghost.md' });
  assert.equal(a.executable, undefined);
  assert.equal(a.bytes.readUInt16LE(4), 14);
  assert.equal(a.manifest.format, 'GhostFlow/control-v13');
  assert.equal(a.manifest.schedules[0].kind, 'at');
  assert.equal(a.manifest.schedules[0].atMs, Date.UTC(2026, 0, 1, 8));
  assert.deepEqual(a.bytes, b.bytes);
  assert.equal(a.manifest.schedules[0].site, b.manifest.schedules[0].site);
});

test('GF-TEST-at-contract: missing, mistyped and unsupported At fields reject before emission', async () => {
  const source = atSource();
  const cases = [
    [source.replace(/    at = .*;\n/, ''), /requires at/],
    [source.replace('datetime`2026-01-01T08:00:00Z`', 'time`08:00`'), /constant DateTime/],
    [source.replace('T08:00:00Z', 'T08:00:00'), /offset|DateTime|datetime/],
    [source.replace('2026-01-01', '2026-02-30'), /DateTime|date|datetime/],
    [source.replace('basis = pulse;', 'basis = window(5min);'), /requires pulse/],
    [source.replace('basis = pulse;', 'basis = run(5min, on_time);'), /requires pulse/],
    [source.replace('basis = pulse;', 'basis = range(5min);'), /requires pulse/],
    [source.replace('when = (allow |> recover(false));', 'when = 1;'), /must be Bool/],
    [source.replace('gap = skip_after(60s);', 'gap = skip_after(0s);'), /positive constant Duration/],
    [source.replace('basis = pulse;', 'basis = pulse; timezone = "UTC";'), /no timezone/],
    [source.replace('basis = pulse;', 'basis = pulse; dst_missing = skip;'), /no timezone or DST/],
    [source.replace('basis = pulse;', 'basis = pulse; cancel_when = false;'), /does not use cancel_when/],
    [source.replace('fallback = skip;', 'fallback = fixed_time(time`08:00`, terminal: skip);'), /fallback must be skip/],
    [source.replace('clock = trusted_only;', 'clock = hold_trusted(5min, terminal: skip);'), /clock must be trusted_only/],
    [source.replace('recovery = baseline;', ''), /requires recovery/],
    [source.replace('output alarm: Bool;', 'config hidden: Number = 1.0; output alarm: Bool;'), /cannot mix/],
    [source.replace('output alarm: Bool;', 'signal stable = debounce(allow |> recover(false), stable_for: 1s, initial: false); output alarm: Bool;'), /cannot mix/],
    [source.replace('output alarm: Bool;', 'signal held = true_for(allow, duration: 1s, quality: measured); output alarm: Bool;'), /cannot mix/],
  ];
  for (const [candidate, diagnostic] of cases) await assert.rejects(compileSource(candidate, { filename: 'at.ghost.md' }), diagnostic);
  for (const field of ['basis','when','clock','gap','recovery','fallback']) {
    const candidate = source.replace(new RegExp(`    ${field} = [^;]+;\\n`), '');
    await assert.rejects(compileSource(candidate, { filename: 'at.ghost.md' }), /requires/);
  }
});
