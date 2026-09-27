import { encodeTemporalProfile } from './temporal-profile.mjs';

const U32_MAX = 0xffff_ffff;

function exact(value, keys, label = 'temporal replay request') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
}

function positiveU32(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > U32_MAX) {
    throw new RangeError(`${label} must be a positive u32 integer`);
  }
  return value;
}

export function temporalReplayRequest(value) {
  exact(value, ['count', 'profile', 'maxPeakTemporalBytes', 'maxJsonBytes']);
  return {
    count: positiveU32(value.count, 'count'),
    profile: encodeTemporalProfile(value.profile),
    maxPeakTemporalBytes: positiveU32(value.maxPeakTemporalBytes, 'maxPeakTemporalBytes'),
    maxJsonBytes: positiveU32(value.maxJsonBytes, 'maxJsonBytes'),
  };
}

export function coreReplayRequest(value) {
  exact(value, ['count', 'maxJsonBytes'], 'core replay request');
  return {
    count: positiveU32(value.count, 'count'),
    maxJsonBytes: positiveU32(value.maxJsonBytes, 'maxJsonBytes'),
  };
}

export function temporalPlanRequest(value) {
  exact(value, ['profile', 'maxJsonBytes'], 'temporal plan request');
  return {
    profile: encodeTemporalProfile(value.profile),
    maxJsonBytes: positiveU32(value.maxJsonBytes, 'maxJsonBytes'),
  };
}

export function temporalReplayPlanRequest(value) {
  exact(value, ['count', 'profile', 'maxJsonBytes'], 'temporal replay plan request');
  return {
    count: positiveU32(value.count, 'count'),
    profile: encodeTemporalProfile(value.profile),
    maxJsonBytes: positiveU32(value.maxJsonBytes, 'maxJsonBytes'),
  };
}
