export const PERCENT_RANGE_FEATURE = 'percent-range-v1';

export function validateRequiredRuntimeFeatures(manifest) {
  if (!Object.hasOwn(manifest, 'requiredRuntimeFeatures')) return [];
  const value = manifest.requiredRuntimeFeatures;
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new TypeError('requiredRuntimeFeatures must be a non-empty bounded array');
  }
  const seen = new Set();
  for (const feature of value) {
    if (typeof feature !== 'string' || !feature) {
      throw new TypeError('requiredRuntimeFeatures entries must be non-empty strings');
    }
    if (seen.has(feature)) throw new Error(`duplicate required runtime feature ${feature}`);
    if (feature !== PERCENT_RANGE_FEATURE) throw new Error(`unsupported required runtime feature ${feature}`);
    seen.add(feature);
  }
  return value;
}
