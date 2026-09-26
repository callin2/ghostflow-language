import { createOperatingSettingsCandidate } from './operating-settings.mjs';

const PUBLIC_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FORMAT = 'GhostFlow/temporary-operating-setting-v0';

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be an object`);
  return value;
}

function exact(value, fields, label) {
  record(value, label);
  if (fields.some(field => !Object.hasOwn(value, field)) || Object.keys(value).some(field => !fields.includes(field))) throw new TypeError(`${label} has unknown or missing fields`);
  return value;
}

function publicId(value, label) {
  if (typeof value !== 'string' || !PUBLIC_ID.test(value) || value.startsWith('__gf_')) throw new TypeError(`${label} must be a public identity`);
  return value;
}

function sourceIdentity(value, label) {
  exact(value, ['documentId', 'revisionId', 'sha256'], label);
  publicId(value.documentId, `${label}.documentId`);
  publicId(value.revisionId, `${label}.revisionId`);
  if (!SHA256.test(value.sha256)) throw new TypeError(`${label}.sha256 must be a lowercase SHA-256 digest`);
  return { ...value };
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

export function validateTemporaryOperatingSettingOverride(value) {
  exact(value, ['format', 'version', 'id', 'canonicalSource', 'candidate', 'setting', 'actor', 'reason', 'lifetime', 'applyPolicy', 'rollback'], 'override');
  if (value.format !== FORMAT || value.version !== '0.1') throw new TypeError('unsupported temporary operating setting format');
  publicId(value.id, 'override.id');
  sourceIdentity(value.canonicalSource, 'override.canonicalSource');
  exact(value.candidate, ['id', 'sourceSha256'], 'override.candidate');
  publicId(value.candidate.id, 'override.candidate.id');
  if (!SHA256.test(value.candidate.sourceSha256) || value.candidate.sourceSha256 === value.canonicalSource.sha256) throw new TypeError('override candidate source identity is invalid');
  exact(value.setting, ['name', 'descriptorId', 'type', 'value'], 'override.setting');
  publicId(value.setting.name, 'override.setting.name');
  if (value.setting.descriptorId !== `setting.${value.setting.name}`) throw new TypeError('override setting descriptor identity mismatch');
  if (!['Bool', 'Number', 'Duration', 'Percent'].includes(value.setting.type)) throw new TypeError('override setting type is unsupported');
  if (value.setting.type === 'Bool' ? typeof value.setting.value !== 'boolean'
    : typeof value.setting.value !== 'number' || !Number.isFinite(value.setting.value)) throw new TypeError('override setting value type mismatch');
  exact(value.actor, ['id', 'authority'], 'override.actor');
  publicId(value.actor.id, 'override.actor.id');
  if (!['operator', 'designer'].includes(value.actor.authority)) throw new TypeError('override actor authority is unsupported');
  if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 512) throw new TypeError('override reason must be 1 to 512 characters');
  exact(value.lifetime, ['issuedAtMs', 'expiresAtMs'], 'override.lifetime');
  if (!Number.isSafeInteger(value.lifetime.issuedAtMs) || value.lifetime.issuedAtMs < 0
      || !Number.isSafeInteger(value.lifetime.expiresAtMs) || value.lifetime.expiresAtMs <= value.lifetime.issuedAtMs) throw new TypeError('override lifetime must be a bounded positive interval');
  if (value.applyPolicy !== 'stopped') throw new TypeError('override apply policy must be stopped');
  exact(value.rollback, ['kind', 'source'], 'override.rollback');
  if (value.rollback.kind !== 'canonical-source' || JSON.stringify(value.rollback.source) !== JSON.stringify(value.canonicalSource)) throw new TypeError('override rollback must restore the exact canonical source');
  return value;
}

export async function createTemporaryOperatingSettingOverride({
  source, filename = 'program.ghost.md', sourceIdentity: identity, expectedSourceSha256,
  setting, value, overrideId, candidateId, actor, reason, issuedAtMs, expiresAtMs,
}) {
  const canonicalSource = sourceIdentity({ ...record(identity, 'sourceIdentity'), sha256: expectedSourceSha256 }, 'sourceIdentity');
  exact(actor, ['id', 'authority'], 'actor');
  const candidate = await createOperatingSettingsCandidate({
    source, filename, expectedSourceSha256, changes: { [setting]: value },
  });
  const config = candidate.manifest.configs.find(entry => entry.name === setting && entry.settings);
  if (!config) throw new Error(`unknown operating setting ${setting}`);
  if (actor.authority !== config.settings.access) throw new Error(`setting ${setting} requires ${config.settings.access} authority`);
  const override = {
    format: FORMAT,
    version: '0.1',
    id: overrideId,
    canonicalSource,
    candidate: { id: candidateId, sourceSha256: candidate.sourceSha256 },
    setting: { name: setting, descriptorId: `setting.${setting}`, type: config.type, value },
    actor: { id: actor.id, authority: actor.authority },
    reason,
    lifetime: { issuedAtMs, expiresAtMs },
    applyPolicy: config.settings.apply ?? 'stopped',
    rollback: { kind: 'canonical-source', source: canonicalSource },
  };
  validateTemporaryOperatingSettingOverride(override);
  return freeze({ override, candidate });
}

export function resolveTemporaryOperatingSettingOverride(overrideValue, {
  nowMs, currentSource, outcome = 'apply-succeeded',
}) {
  const override = validateTemporaryOperatingSettingOverride(overrideValue);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError('override resolution time must be a non-negative safe integer');
  const source = sourceIdentity(currentSource, 'currentSource');
  const rollback = reason => freeze({ status: 'rollback', reason, source: { ...override.rollback.source } });
  if (JSON.stringify(source) !== JSON.stringify(override.canonicalSource)) return rollback('stale-source');
  if (nowMs < override.lifetime.issuedAtMs) return rollback('not-yet-active');
  if (nowMs >= override.lifetime.expiresAtMs) return rollback('expired');
  if (outcome === 'restart') return rollback('restart');
  if (outcome === 'apply-failed') return rollback('apply-failed');
  if (outcome === 'operator-rollback') return rollback('operator-rollback');
  if (outcome !== 'apply-succeeded') throw new TypeError('unknown override outcome');
  return freeze({ status: 'active', overrideId: override.id, candidate: { ...override.candidate }, expiresAtMs: override.lifetime.expiresAtMs });
}
