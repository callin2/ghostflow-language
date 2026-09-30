// Pure numeric rules only: callers own object shape, permissions and diagnostics.
export function isInt32(value) {
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
}

// Call only after value, min, max and step have passed the i32 check.
// Preserve the runtime's first-error order when several constraints fail.
export function intSettingsIssue(value, { min, max, step }) {
  if (min > max) return 'inverted-range';
  if (step <= 0) return 'nonpositive-step';
  if ((value - min) % step !== 0) return 'value-grid';
  if ((max - min) % step !== 0) return 'max-grid';
  if (value < min || value > max) return 'value-range';
  return null;
}
