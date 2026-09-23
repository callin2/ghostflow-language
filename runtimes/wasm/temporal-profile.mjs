// GFTA v1/v2. Bounds derive from GFB's 128 inputs.
const MAX_ROOTS = Math.floor((128 - 2) / 4);
const U32_MAX = 0xffff_ffff;

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new TypeError(`${label} has unknown or missing fields`);
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${label} must be an integer in ${min}..${max}`);
  return value;
}

export function encodeTemporalProfile(profile) {
  const certified = Object.hasOwn(profile ?? {}, 'certifiedBoolRoots');
  exact(profile, certified ? ['timeEpoch', 'rootDensity', 'certifiedBoolRoots', 'budget'] : ['timeEpoch', 'rootDensity', 'budget'], 'temporal profile');
  const timeEpoch = integer(profile.timeEpoch, 0, Number.MAX_SAFE_INTEGER, 'timeEpoch');
  const density = profile.rootDensity, budget = profile.budget;
  exact(budget, ['maxRetainedSamples', 'maxBytes'], 'temporal budget');
  const maxRetainedSamples = integer(budget.maxRetainedSamples, 1, U32_MAX, 'maxRetainedSamples');
  const maxBytes = integer(budget.maxBytes, 1, U32_MAX, 'maxBytes');
  if (!Array.isArray(density) || density.length > MAX_ROOTS || (!certified && density.length < 1)) throw new RangeError(`rootDensity must contain ${certified ? '0' : '1'}..${MAX_ROOTS} roots`);
  const certifiedRoots = certified ? profile.certifiedBoolRoots : [];
  if (certified && (!Array.isArray(certifiedRoots) || certifiedRoots.length < 1 || certifiedRoots.length > MAX_ROOTS || density.length + certifiedRoots.length > MAX_ROOTS)) {
    throw new RangeError(`certifiedBoolRoots must contain 1..${MAX_ROOTS} roots within the combined root bound`);
  }
  const count = density.length;
  const header = certified ? 28 : 24;
  const bytes = new Uint8Array(header + 16 * count + 4 * certifiedRoots.length);
  const view = new DataView(bytes.buffer);
  bytes.set([71, 70, 84, 65]);
  view.setUint16(4, certified ? 2 : 1, true);
  view.setUint16(6, count, true);
  view.setBigUint64(8, BigInt(timeEpoch), true);
  view.setUint32(16, maxRetainedSamples, true);
  view.setUint32(20, maxBytes, true);
  if (certified) {
    view.setUint16(24, certifiedRoots.length, true);
    view.setUint16(26, 0, true);
  }
  let previous = 0;
  for (let index = 0; index < count; index++) {
    if (density.length !== count || !Object.hasOwn(density, index)) throw new TypeError('rootDensity changed or contains a missing root');
    const root = density[index];
    exact(root, ['sourceTag', 'maxObservations', 'intervalMs'], 'root density');
    const tag = integer(root.sourceTag, 1, U32_MAX, 'sourceTag');
    const maxObservations = integer(root.maxObservations, 1, U32_MAX, 'maxObservations');
    const interval = integer(root.intervalMs, 1, Number.MAX_SAFE_INTEGER, 'intervalMs');
    if (tag <= previous) throw new RangeError('rootDensity source tags must be strictly increasing');
    previous = tag;
    const offset = header + index * 16;
    view.setUint32(offset, tag, true);
    view.setUint32(offset + 4, maxObservations, true);
    view.setBigUint64(offset + 8, BigInt(interval), true);
  }
  if (density.length !== count) throw new TypeError('rootDensity changed during capture');
  previous = 0;
  for (let index = 0; index < certifiedRoots.length; index++) {
    if (certifiedRoots.length !== view.getUint16(24, true) || !Object.hasOwn(certifiedRoots, index)) throw new TypeError('certifiedBoolRoots changed or contains a missing root');
    const tag = integer(certifiedRoots[index], 1, U32_MAX, 'certified Bool sourceTag');
    if (tag <= previous) throw new RangeError('certifiedBoolRoots source tags must be strictly increasing');
    view.setUint32(header + 16 * count + 4 * index, tag, true);
    previous = tag;
  }
  if (certifiedRoots.length !== (certified ? view.getUint16(24, true) : 0)) throw new TypeError('certifiedBoolRoots changed during capture');
  return bytes;
}
