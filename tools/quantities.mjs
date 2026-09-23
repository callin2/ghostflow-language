const MAX_DECIMAL_SOURCE_LENGTH = 256 * 1024;
const BINARY64_DECIMAL_MARGIN = 400n;

function unit(type, canonicalUnit, suffix, scaleNumerator = 1n, scaleDenominator = 1n, offsetNumerator = 0n, offsetDenominator = 1n) {
  return Object.freeze({ type, canonicalUnit, suffix, scaleNumerator, scaleDenominator, offsetNumerator, offsetDenominator });
}

const UNITS = Object.freeze([
  unit('Temperature', 'K', '°C', 1n, 1n, 27315n, 100n),
  unit('Temperature', 'K', 'K'),
  unit('Temperature', 'K', '°F', 5n, 9n, 45967n, 180n),
  unit('TemperatureDelta', 'ΔK', 'Δ°C'),
  unit('TemperatureDelta', 'ΔK', 'ΔK'),
  unit('TemperatureDelta', 'ΔK', 'Δ°F', 5n, 9n),
  unit('RelativeHumidity', 'ratio', '%RH', 1n, 100n),
  unit('Pressure', 'Pa', 'Pa'),
  unit('Pressure', 'Pa', 'kPa', 1000n),
  unit('Pressure', 'Pa', 'bar', 100000n),
  unit('VaporPressureDeficit', 'PaVPD', 'PaVPD'),
  unit('VaporPressureDeficit', 'PaVPD', 'kPaVPD', 1000n),
  unit('CO2Concentration', 'molar ratio', 'ppm', 1n, 1000000n),
  unit('FlowRate', 'm3/s', 'm3/s'),
  unit('FlowRate', 'm3/s', 'L/min', 1n, 60000n),
  unit('FlowRate', 'm3/s', 'mL/min', 1n, 60000000n),
  unit('Volume', 'm3', 'm3'),
  unit('Volume', 'm3', 'L', 1n, 1000n),
  unit('Volume', 'm3', 'mL', 1n, 1000000n),
  unit('Length', 'm', 'm'),
  unit('Length', 'm', 'cm', 1n, 100n),
  unit('Length', 'm', 'mm', 1n, 1000n),
  unit('Irradiance', 'W/m2', 'W/m2'),
  unit('PPFD', 'mol/m2/s', 'mol/m2/s'),
  unit('PPFD', 'mol/m2/s', 'umol/m2/s', 1n, 1000000n),
  unit('Energy', 'J', 'J'),
  unit('Energy', 'J', 'kJ', 1000n),
  unit('Energy', 'J', 'Wh', 3600n),
  unit('Energy', 'J', 'kWh', 3600000n),
  unit('Power', 'W', 'W'),
  unit('Power', 'W', 'kW', 1000n),
  unit('ElectricalCurrent', 'A', 'A'),
  unit('ElectricalCurrent', 'A', 'mA', 1n, 1000n),
  unit('Voltage', 'V', 'V'),
  unit('Voltage', 'V', 'mV', 1n, 1000n),
  unit('Conductivity', 'S/m', 'S/m'),
  unit('Conductivity', 'S/m', 'mS/cm', 1n, 10n),
  unit('Conductivity', 'S/m', 'uS/cm', 1n, 10000n),
  unit('Acidity', 'pH', 'pH'),
]);

const BY_SUFFIX = new Map(UNITS.map(entry => [entry.suffix, entry]));
const SUFFIXES = Object.freeze([...BY_SUFFIX.keys()].sort((a, b) => b.length - a.length));
const TYPE_UNITS = new Map();
for (const entry of UNITS) {
  const prior = TYPE_UNITS.get(entry.type);
  if (prior && prior !== entry.canonicalUnit) throw new Error(`inconsistent canonical unit for ${entry.type}`);
  TYPE_UNITS.set(entry.type, entry.canonicalUnit);
}

export const QUANTITY_TYPES = Object.freeze([...TYPE_UNITS.keys()]);
export const QUANTITY_UNITS = UNITS;

export function isQuantityType(type) { return TYPE_UNITS.has(type); }
export function canonicalUnitFor(type) { return TYPE_UNITS.get(type); }

function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

function rational(numerator, denominator) {
  if (denominator === 0n) throw new RangeError('quantity rational denominator must not be zero');
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  if (numerator === 0n) return { numerator: 0n, denominator: 1n };
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

export function decimalRational(text) {
  if (text.length > MAX_DECIMAL_SOURCE_LENGTH) throw new RangeError(`decimal literal exceeds ${MAX_DECIMAL_SOURCE_LENGTH} source characters`);
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw new SyntaxError(`invalid decimal literal ${JSON.stringify(text)}`);
  const whole = match[2] ?? '';
  const fraction = match[3] ?? match[4] ?? '';
  let digits = `${whole}${fraction}`.replace(/^0+/, '') || '0';
  let trailingZeros = 0;
  while (digits.length > 1 && digits.endsWith('0')) { digits = digits.slice(0, -1); trailingZeros++; }
  if (digits === '0') return { numerator: 0n, denominator: 1n };
  let exponent = BigInt(match[5] ?? 0) - BigInt(fraction.length) + BigInt(trailingZeros);
  const decimalOrder = BigInt(digits.length - 1) + exponent;
  if (decimalOrder > BINARY64_DECIMAL_MARGIN) throw new RangeError('quantity literal exceeds finite binary64 range');
  // Values this far below the subnormal boundary cannot affect any catalog
  // affine offset after its bounded unit transform. Keep a signed tiny
  // rational so final binary64 conversion still preserves underflow sign.
  if (decimalOrder < -BINARY64_DECIMAL_MARGIN) {
    const signed = match[1] === '-' ? -1n : 1n;
    return rational(signed, 10n ** BINARY64_DECIMAL_MARGIN);
  }
  let numerator = BigInt(digits);
  let denominator = 1n;
  if (exponent >= 0n) numerator *= 10n ** exponent;
  else denominator = 10n ** -exponent;
  if (match[1] === '-') numerator = -numerator;
  return rational(numerator, denominator);
}

function bitLength(value) { return value === 0n ? 0 : value.toString(2).length; }

function compareRatioToPowerOfTwo(numerator, denominator, exponent) {
  return exponent >= 0
    ? numerator - (denominator << BigInt(exponent))
    : (numerator << BigInt(-exponent)) - denominator;
}

function roundedQuotient(numerator, denominator, shift) {
  if (shift >= 0) numerator <<= BigInt(shift);
  else denominator <<= BigInt(-shift);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const comparison = 2n * remainder - denominator;
  if (comparison > 0n || (comparison === 0n && quotient % 2n === 1n)) quotient++;
  return quotient;
}

function floatFromBits(bits) {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setBigUint64(0, bits, false);
  return view.getFloat64(0, false);
}

export function rationalToBinary64(numerator, denominator = 1n) {
  ({ numerator, denominator } = rational(numerator, denominator));
  const negative = numerator < 0n;
  let magnitude = negative ? -numerator : numerator;
  const sign = negative ? 1n << 63n : 0n;
  if (magnitude === 0n) return 0;

  let exponent = bitLength(magnitude) - bitLength(denominator);
  if (compareRatioToPowerOfTwo(magnitude, denominator, exponent) < 0n) exponent--;
  else if (compareRatioToPowerOfTwo(magnitude, denominator, exponent + 1) >= 0n) exponent++;

  if (exponent > 1023) throw new RangeError('quantity literal exceeds finite binary64 range');
  if (exponent < -1022) {
    const significand = roundedQuotient(magnitude, denominator, 1074);
    if (significand === 0n) return negative ? -0 : 0;
    if (significand >= 1n << 52n) return floatFromBits(sign | (1n << 52n));
    return floatFromBits(sign | significand);
  }

  let significand = roundedQuotient(magnitude, denominator, 52 - exponent);
  if (significand === 1n << 53n) { significand >>= 1n; exponent++; }
  if (exponent > 1023) throw new RangeError('quantity literal exceeds finite binary64 range');
  const exponentBits = BigInt(exponent + 1023) << 52n;
  const fractionBits = significand - (1n << 52n);
  return floatFromBits(sign | exponentBits | fractionBits);
}

export function quantityLiteral(text) {
  const number = /^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(text)?.[0];
  if (!number) return null;
  const suffixText = text.slice(number.length);
  const suffix = SUFFIXES.find(candidate => suffixText.startsWith(candidate));
  if (!suffix || suffix.length !== suffixText.length) return null;
  const definition = BY_SUFFIX.get(suffix);
  const source = decimalRational(number);
  const scaledNumerator = source.numerator * definition.scaleNumerator;
  const scaledDenominator = source.denominator * definition.scaleDenominator;
  const canonicalNumerator = scaledNumerator * definition.offsetDenominator
    + definition.offsetNumerator * scaledDenominator;
  const canonicalDenominator = scaledDenominator * definition.offsetDenominator;
  return Object.freeze({
    type: definition.type,
    canonicalUnit: definition.canonicalUnit,
    suffix,
    value: rationalToBinary64(canonicalNumerator, canonicalDenominator),
  });
}

export function quantitySuffixAt(text, offset = 0) {
  return SUFFIXES.find(suffix => text.startsWith(suffix, offset)) ?? null;
}

function exactScaledBinary64Decimal(value, scale) {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  const negative = (bits >> 63n) === 1n;
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  let numerator = (exponentBits === 0 ? fraction : (1n << 52n) + fraction) * scale;
  const binaryExponent = exponentBits === 0 ? -1074 : exponentBits - 1023 - 52;
  if (binaryExponent >= 0) numerator <<= BigInt(binaryExponent);
  else numerator *= 5n ** BigInt(-binaryExponent);
  let digits = numerator.toString();
  if (binaryExponent < 0) {
    const places = -binaryExponent;
    if (digits.length <= places) digits = `0.${'0'.repeat(places - digits.length)}${digits}`;
    else digits = `${digits.slice(0, digits.length - places)}.${digits.slice(digits.length - places)}`;
    digits = digits.replace(/0+$/, '').replace(/\.$/, '');
  }
  return negative && numerator !== 0n ? `-${digits}` : digits;
}

export function formatCanonicalQuantityLiteral(type, value) {
  if (!isQuantityType(type) || typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('quantity source formatting requires a finite catalog value');
  if (type === 'RelativeHumidity' || type === 'CO2Concentration') {
    const scale = type === 'RelativeHumidity' ? 100n : 1000000n;
    const suffix = type === 'RelativeHumidity' ? '%RH' : 'ppm';
    const simple = `${String(value * Number(scale))}${suffix}`;
    if (quantityLiteral(simple)?.value === value) return simple;
    return `${exactScaledBinary64Decimal(value, scale)}${suffix}`;
  }
  const suffix = canonicalUnitFor(type);
  return `${String(value)}${suffix}`;
}

export function formatTemperatureLiteral(value, displayUnit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('temperature source formatting requires a finite canonical value');
  if (displayUnit !== '°C' && displayUnit !== 'K') throw new TypeError('temperature displayUnit must be °C or K');
  if (displayUnit === 'K') return `${String(value)}K`;
  const converted = value - 273.15;
  const simple = `${String(converted)}°C`;
  if (quantityLiteral(simple)?.value === value) return simple;
  for (let precision = 1; precision <= 17; precision += 1) {
    const decimal = converted.toPrecision(precision).replace(/(?:\.0+|(?:(\.\d*?)0+))$/, '$1');
    const candidate = `${decimal}°C`;
    if (quantityLiteral(candidate)?.value === value) return candidate;
  }
  throw new RangeError('temperature cannot be represented exactly in selected displayUnit');
}
