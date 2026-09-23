import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  createTemporaryOperatingSettingOverride,
  resolveTemporaryOperatingSettingOverride,
  validateTemporaryOperatingSettingOverride,
} from '../tools/temporary-operating-setting.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const filename = 'contracts/interaction-v0/examples/operator-settings.ghost.md';
const source = fs.readFileSync(path.join(root, filename), 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const canonicalSource = {
  documentId: 'source.fixture-operator-settings',
  revisionId: 'revision.fixture-operator-settings-v0',
  sha256: sha256(source),
};

const request = (overrides = {}) => ({
  source,
  filename,
  sourceIdentity: { documentId: canonicalSource.documentId, revisionId: canonicalSource.revisionId },
  expectedSourceSha256: canonicalSource.sha256,
  setting: 'duration',
  value: 600000,
  overrideId: 'override.watering-duration.1',
  candidateId: 'candidate.watering-duration.1',
  actor: { id: 'operator.callin', authority: 'operator' },
  reason: 'Extend the current watering interval for this run.',
  issuedAtMs: 1000,
  expiresAtMs: 61000,
  ...overrides,
});

test('GF-TEST-temporary-setting: canonical source and transient literal-only candidate remain distinct', async () => {
  const { override, candidate } = await createTemporaryOperatingSettingOverride(request());
  assert.equal(source.includes('Duration = 10min'), false);
  assert.match(candidate.source, /Duration = 600000ms/);
  assert.equal(candidate.beforeSourceSha256, canonicalSource.sha256);
  assert.equal(override.canonicalSource.sha256, canonicalSource.sha256);
  assert.equal(override.candidate.sourceSha256, candidate.sourceSha256);
  assert.notEqual(override.candidate.sourceSha256, override.canonicalSource.sha256);
  assert.deepEqual(override.setting, {
    name: 'duration', descriptorId: 'setting.duration', type: 'Duration', value: 600000,
  });
  assert.deepEqual(override.rollback, { kind: 'canonical-source', source: canonicalSource });
  assert.equal(Object.isFrozen(override), true);
});

test('GF-TEST-temporary-setting-lifecycle: expiry, restart, failure, rollback, and source change select canonical fallback', async () => {
  const { override } = await createTemporaryOperatingSettingOverride(request());
  assert.deepEqual(resolveTemporaryOperatingSettingOverride(override, {
    nowMs: 1000, currentSource: canonicalSource,
  }), {
    status: 'active', overrideId: override.id, candidate: { ...override.candidate }, expiresAtMs: 61000,
  });
  for (const [input, reason] of [
    [{ nowMs: 999, currentSource: canonicalSource }, 'not-yet-active'],
    [{ nowMs: 61000, currentSource: canonicalSource }, 'expired'],
    [{ nowMs: 2000, currentSource: canonicalSource, outcome: 'restart' }, 'restart'],
    [{ nowMs: 2000, currentSource: canonicalSource, outcome: 'apply-failed' }, 'apply-failed'],
    [{ nowMs: 2000, currentSource: canonicalSource, outcome: 'operator-rollback' }, 'operator-rollback'],
    [{ nowMs: 2000, currentSource: { ...canonicalSource, revisionId: 'revision.new' } }, 'stale-source'],
  ]) {
    assert.deepEqual(resolveTemporaryOperatingSettingOverride(override, input), {
      status: 'rollback', reason, source: canonicalSource,
    });
  }
});

test('GF-TEST-temporary-setting-rejection: stale source, authority, range, identity, and tampering fail closed', async () => {
  await assert.rejects(() => createTemporaryOperatingSettingOverride(request({ expectedSourceSha256: '0'.repeat(64) })), /stale source hash/);
  await assert.rejects(() => createTemporaryOperatingSettingOverride(request({ actor: { id: 'designer.callin', authority: 'designer' } })), /requires operator authority/);
  await assert.rejects(() => createTemporaryOperatingSettingOverride(request({ value: 600001 })), /range or step/);
  await assert.rejects(() => createTemporaryOperatingSettingOverride(request({ expiresAtMs: 1000 })), /lifetime/);
  const { override } = await createTemporaryOperatingSettingOverride(request());
  const tampered = structuredClone(override);
  tampered.rollback.source = { ...tampered.rollback.source, revisionId: 'revision.forged' };
  assert.throws(() => validateTemporaryOperatingSettingOverride(tampered), /rollback/);
});
