const scalar = field => `${field} must be a safe integer in [-2147483648, 2147483647]`;
const packageScalar = field => `${field} must be a signed i32 Int`;
const grid = 'settings range or grid is invalid for Int';

export const validIntSettings = [
  { value: -2147483648, min: -2147483648, max: 2147483647, step: 1 },
  { value: 2147483647, min: -2147483648, max: 2147483647, step: 1 },
  { value: 0, min: 0, max: 2147483647, step: 2147483647 },
  { value: -2, min: -5, max: 10, step: 3 },
];

// Shared malformed metadata; each boundary keeps its own error type and wording.
export const invalidIntSettings = [
  ['fractional default', c => { c.value = 0.5; }, packageScalar('value'), scalar('value'), TypeError],
  ['overflow default', c => { c.value = 2147483648; }, packageScalar('value'), scalar('value'), TypeError],
  ['underflow default', c => { c.value = -2147483649; }, packageScalar('value'), scalar('value'), TypeError],
  ['fractional minimum', c => { c.settings.min = -0.5; }, packageScalar('settings.min'), scalar('settings.min'), TypeError],
  ['underflow minimum', c => { c.settings.min = -2147483649; }, packageScalar('settings.min'), scalar('settings.min'), TypeError],
  ['fractional maximum', c => { c.settings.max = 0.5; }, packageScalar('settings.max'), scalar('settings.max'), TypeError],
  ['overflow maximum', c => { c.settings.max = 2147483648; }, packageScalar('settings.max'), scalar('settings.max'), TypeError],
  ['fractional step', c => { c.settings.step = 0.5; }, packageScalar('settings.step'), scalar('settings.step'), TypeError],
  ['overflow step', c => { c.settings.step = 2147483648; }, packageScalar('settings.step'), scalar('settings.step'), TypeError],
  ['zero step', c => { c.settings.step = 0; }, grid, 'settings.step must be positive', Error],
  ['negative step', c => { c.settings.step = -1; }, grid, 'settings.step must be positive', Error],
  ['inverted range', c => { c.settings.min = 1; c.settings.max = 0; }, grid, 'settings range is inverted', Error],
  ['default outside range', c => { c.settings.min = 1; }, grid, 'value is outside settings range', Error],
  ['large-step tolerance hole', c => { c.value = 1; c.settings.min = 0; c.settings.max = 2147483647; c.settings.step = 2147483647; }, grid, 'value is not aligned to settings.step from settings.min', Error],
  ['maximum off grid', c => { c.settings.min = 0; c.settings.max = 5; c.settings.step = 2; }, grid, 'settings.max is not aligned to settings.step from settings.min', Error],
  ['unexpected stepType', c => { c.settings.stepType = 'Int'; }, 'settings.stepType is forbidden', 'settings.stepType is forbidden for Int', Error],
  ['obsolete apply policy', c => { c.settings.apply = 'stopped'; }, 'settings.apply is forbidden', 'settings has unknown key apply', Error],
  ['unknown setting field', c => { c.settings.extra = true; }, 'settings.extra is forbidden', 'settings has unknown key extra', Error],
  ['inverted range before zero step', c => { c.settings.min = 1; c.settings.max = 0; c.settings.step = 0; }, grid, 'settings range is inverted', Error],
  ['value grid before maximum grid', c => { c.value = 1; c.settings.min = 0; c.settings.max = 5; c.settings.step = 2; }, grid, 'value is not aligned to settings.step from settings.min', Error],
];
