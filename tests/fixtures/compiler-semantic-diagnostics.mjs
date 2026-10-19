// § marks the exact source position that must own the public diagnostic.
export const cases = [];
const add = (id, bad, good, message, classification = 'invalid-source') => cases.push({ id, bad, good, message, classification });
const wrap = body => `control Diagnostic { ${body} }`;
const expr = (id, bad, good, type, message, setup = '') => add(id,
  wrap(`${setup} output out: ${type}; out <- ${bad};`),
  wrap(`${setup} output out: ${type}; out <- ${good};`), message);

add('name-reserved-prefix', wrap('§input __gf_private: Bool;'), wrap('input publicValue: Bool;'), 'input name __gf_private uses reserved __gf_ prefix');
add('name-reserved-keyword', wrap('§input control: Bool;'), wrap('input enabled: Bool;'), 'input name control is reserved');
add('name-fault-member', wrap('§let Stale = false;'), wrap('let staleValue = false;'), 'let name Stale is a reserved fault member');
add('duplicate-name', wrap('input x: Bool; §state x: Bool = false;'), wrap('input x: Bool; state y: Bool = false;'), 'duplicate name x');
add('reserved-type', wrap('§type SensorFault = Custom;'), wrap('type CustomFault = Custom;'), 'type name SensorFault is reserved');
add('duplicate-enum-local', wrap('type Mode = Off | §Off;'), wrap('type Mode = Off | On;'), 'duplicate enum member Off');
add('duplicate-enum-global', wrap('type Mode = Off; type Other = §Off;'), wrap('type Mode = Off; type Other = On;'), 'duplicate enum member Off');
add('enum-fault-shadow', wrap('type Mode = §Stale;'), wrap('type Mode = Fresh;'), 'enum member name Stale is a reserved fault member');
add('unknown-type', wrap('input x: §Missing;'), wrap('input x: Number;'), 'unknown type Missing');
add('input-result-storage', wrap('input x: §Result<Bool, SensorFault>;'), wrap('input x: Bool;'), 'input type must be a supported scalar payload');
add('output-result-storage', wrap('output x: §Result<Bool, SensorFault>; x <- ok(true);'), wrap('output x: Bool; x <- true;'), 'output must use a scalar type');
add('state-result-storage', wrap('state x: §Result<Bool, SensorFault> = ok(true);'), wrap('state x: Bool = true;'), 'Result cannot be stored in state');
add('config-result-storage', wrap('config x: §Result<Bool, SensorFault> = ok(true);'), wrap('config x: Bool = true;'), 'Result cannot be stored in config');
add('state-nonconstant', wrap('input x: Bool; §state y: Bool = x;'), wrap('input x: Bool; state y: Bool = false;'), 'state initial value must be a constant of the state type');
add('config-nonconstant', wrap('input x: Bool; §config y: Bool = x;'), wrap('input x: Bool; config y: Bool = false;'), 'config value must be a constant of the declared type');
add('state-wrong-type', wrap('§state x: Bool = 1;'), wrap('state x: Bool = true;'), 'state initial value must be a constant of the state type');
add('config-wrong-type', wrap('§config x: Bool = 1;'), wrap('config x: Bool = true;'), 'config value must be a constant of the declared type');
add('output-unconnected', wrap('§output x: Bool;'), wrap('output x: Bool; x <- false;'), 'output x requires exactly one connection (x <- expression;)');
add('unknown-next-state', wrap("§x' = false;"), wrap("state x: Bool = false; x' = true;"), 'unknown state x');
add('duplicate-next-state', wrap("state x: Bool = false; x' = true; §x' = false;"), wrap("state x: Bool = false; x' = true;"), 'duplicate next state x');
add('next-type', wrap("state x: Bool = false; §x' = 1;"), wrap("state x: Bool = false; x' = true;"), 'next state x must be Bool');
add('unknown-output', wrap('§x <- false;'), wrap('output x: Bool; x <- false;'), 'unknown output x');
add('duplicate-output', wrap('output x: Bool; x <- true; §x <- false;'), wrap('output x: Bool; x <- true;'), 'duplicate output connection x');
add('output-type', wrap('output x: Bool; §x <- 1;'), wrap('output x: Bool; x <- true;'), 'output x must be Bool');
add('let-annotation', wrap('§let x: Bool = 1;'), wrap('let x: Bool = true;'), 'let x does not match annotation Bool');
add('let-cycle', wrap('§let x = y; let y = x;'), wrap('let x = y; let y = true;'), 'cyclic let definition involving x');
expr('unknown-reference', '§missing', 'true', 'Bool', 'unknown identifier missing');
expr('unknown-member', '§flag.missing', 'flag', 'Bool', 'unknown member flag.missing', 'let flag: Bool = true;');
expr('next-unknown-reference', "§missing'", "known'", 'Bool', 'unknown state missing', 'state known: Bool = false;');
add('let-next-reference', wrap("state x: Bool = false; let y = §x';"), wrap('state x: Bool = false; let y = x;'), 'next state references are allowed only in output expressions');
expr('dead-branch-name', 'if false then §missing else true', 'if false then false else true', 'Bool', 'unknown identifier missing');
expr('dead-branch-type', '§if false then 1 else true', 'if false then false else true', 'Bool', 'if branches must have the same type');
expr('if-condition', 'if §1 then true else false', 'if true then true else false', 'Bool', 'if condition must be Bool');
expr('not-type', '§!1', '!true', 'Bool', '! requires Bool');
expr('negation-type', '§-true', '-1.0', 'Number', 'unary - requires numeric value');
expr('temperature-negation', '§-(25°C)', '25°C', 'Temperature', 'unary - is not defined for Temperature');
for (const op of ['&&', '||']) expr(`logic-${op}`, `true §${op} 1`, `true ${op} false`, 'Bool', `${op} requires Bool operands`);
for (const op of ['==', '!=']) expr(`equality-${op}`, `true §${op} 1`, `true ${op} false`, 'Bool', `${op} requires values of the same type`);
for (const op of ['<', '<=', '>', '>=']) expr(`ordered-${op}`, `true §${op} false`, `1 ${op} 2`, 'Bool', `${op} requires matching ordered types`);
expr('set-type', '1 §in { true }', '1 in { 2 }', 'Bool', 'in values must match the tested value type');
expr('bool-arithmetic', 'true §+ false', '1.0 + 2.0', 'Number', '+ requires numeric operands');
expr('int-number-mixing', 'i §+ n', 'number(i) + n', 'Number', '+ does not implicitly mix Int and Number', 'let i: Int = 1; let n: Number = 1.0;');
expr('int-slash', '1 §/ 2', '1 div 2', 'Int', '/ is not defined for Int operands; use div or convert both operands to Number');
for (const op of ['div', '%']) expr(`number-${op}`, `1.0 §${op} 2.0`, '1.0 / 2.0', 'Number', `${op} requires Int operands`);
expr('nominal-addition', '1s §+ 1%', '1s + 1s', 'Duration', '+ does not implicitly mix Duration and Percent');
expr('nominal-scale', '1s §* 2s', '1s * 2.0', 'Duration', '* requires a Number scale factor');
expr('nominal-division', '1s §/ 2%', '1s / 2.0', 'Duration', '/ requires a Number divisor or matching units');
expr('quantity-arithmetic', '1m §+ 1Pa', '1m + 2m', 'Length', '+ is not defined for Length and Pressure');
expr('datetime-wrong-arithmetic', 'datetime`2026-01-01T00:00:00Z` §- datetime`2026-01-01T00:00:00Z`', 'datetime`2026-01-01T00:00:00Z` - 0ms', 'DateTime', '- is not defined for DateTime and DateTime');
expr('datetime-overflow', 'datetime`9999-12-31T23:59:59.999Z` §+ 1ms', 'datetime`9999-12-31T23:59:59.999Z` + 0ms', 'DateTime', 'DateTime constant must be an integer in [0, 253402300799999]');
expr('duration-underflow', '0ms §- 1ms', '1ms - 1ms', 'Duration', 'Duration constant must be a non-negative integer number of milliseconds');
expr('percent-overflow', '100% §+ 1%', '99% + 1%', 'Percent', 'Percent constant must be between 0% and 100%');
expr('humidity-arithmetic', '100%RH §+ 1%RH', '100%RH', 'RelativeHumidity', '+ is not defined for RelativeHumidity and RelativeHumidity');
expr('humidity-literal-bound', '§101%RH', '100%RH', 'RelativeHumidity', 'RelativeHumidity constant must be between 0%RH and 100%RH');
expr('percent-literal-bound', '§101%', '100%', 'Percent', 'Percent literal must be between 0% and 100%');
expr('int-literal-high', '§2147483648', '2147483647', 'Int', 'Int literal is outside -2147483648..2147483647');
expr('int-literal-low', '§-2147483649', '-2147483648', 'Int', 'Int literal is outside -2147483648..2147483647');
expr('int-fraction', '§1.5', '1', 'Int', 'Int literal must be a whole decimal numeral without a decimal point or exponent');
expr('int-constant-overflow', '2147483647 §+ 1', '2147483646 + 1', 'Int', 'constant Int arithmetic overflows');
for (const [op, zero, one, type, message] of [['/', '0.0', '1.0', 'Number', 'constant division by zero'], ['div', '0', '1', 'Int', 'constant integer division by zero'], ['%', '0', '1', 'Int', 'constant integer division by zero']]) expr(`constant-zero-${op}`, `${one} §${op} ${zero}`, `${one} ${op} ${one}`, type, message);
expr('number-nonfinite', '§1e999', '1e2', 'Number', 'number literal must be finite');
expr('number-operation-overflow', '1e308 §* 1e308', '1e308 * 1.0', 'Number', 'constant arithmetic result is not finite');
expr('duration-literal-overflow', '§9007199254740992ms', '9007199254740991ms', 'Duration', 'Duration literal exceeds the maximum 2^53-1 milliseconds');
expr('duration-fraction-unit', '§0.5s', '500ms', 'Duration', 'Duration literal must use a whole-number unit quantity');
for (const [id, bad, good, type, message] of [
  ['date-spelling', 'date`2026-1-01`', 'date`2026-01-01`', 'Date', 'invalid date literal'],
  ['date-calendar', 'date`2026-02-29`', 'date`2024-02-29`', 'Date', 'date literal is out of range'],
  ['time-spelling', 'time`1:00`', 'time`01:00`', 'TimeOfDay', 'invalid time literal'],
  ['time-range', 'time`24:00`', 'time`23:59`', 'TimeOfDay', 'time literal is out of range'],
  ['datetime-spelling', 'datetime`2026-01-01T00:00Z`', 'datetime`2026-01-01T00:00:00Z`', 'DateTime', 'invalid datetime literal'],
  ['datetime-clock-range', 'datetime`2026-01-01T24:00:00Z`', 'datetime`2026-01-01T23:00:00Z`', 'DateTime', 'datetime literal is out of range'],
  ['datetime-ambiguous-offset', 'datetime`2026-01-01T00:00:00-00:00`', 'datetime`2026-01-01T00:00:00+00:00`', 'DateTime', 'negative zero offset is ambiguous'],
  ['datetime-offset-range', 'datetime`2026-01-01T00:00:00+14:01`', 'datetime`2026-01-01T00:00:00+14:00`', 'DateTime', 'datetime offset is out of range'],
  ['datetime-instant-range', 'datetime`1970-01-01T00:00:00+00:01`', 'datetime`1970-01-01T00:00:00Z`', 'DateTime', 'datetime instant is out of range'],
]) expr(id, `§${bad}`, good, type, message);
add('function-param-duplicate', 'fn f(x: Bool, §x: Bool) -> Bool { x } control D {}', 'fn f(x: Bool, y: Bool) -> Bool { x } control D {}', 'duplicate function parameter x');
add('function-param-shadow', 'fn f(§Stale: Bool) -> Bool { Stale } control D {}', 'fn f(value: Bool) -> Bool { value } control D {}', 'function parameter name Stale is a reserved fault member');
add('function-return-type', '§fn f(x: Bool) -> Number { x } control D {}', 'fn f(x: Bool) -> Bool { x } control D {}', 'function f returns Bool, expected Number');
add('function-capture', 'fn f(x: Number) -> Number { §global } control D { config global: Number = 1.0; }', 'fn f(x: Number) -> Number { x } control D { config global: Number = 1.0; }', 'fn f cannot capture global global');
add('function-primed-capture', "fn f(x: Bool) -> Bool { §stateValue' } control D { state stateValue: Bool = false; }", 'fn f(x: Bool) -> Bool { x } control D { state stateValue: Bool = false; }', "fn f cannot read primed state stateValue'");
add('function-recursive', 'fn f(x: Bool) -> Bool { §f(x) } control D {}', 'fn f(x: Bool) -> Bool { x } control D {}', 'recursive fn f is not supported');
add('function-cycle', 'fn f(x: Bool) -> Bool { g(x) } fn g(x: Bool) -> Bool { §f(x) } control D {}', 'fn f(x: Bool) -> Bool { g(x) } fn g(x: Bool) -> Bool { x } control D {}', 'recursive fn f is not supported');
expr('unknown-function', '§missing(true)', 'true', 'Bool', 'unknown function missing');
expr('function-arity', '§f()', 'f(true)', 'Bool', 'function f expects 1 arguments', 'fn f(x: Bool) -> Bool { x }');
expr('function-argument-type', 'f(§1)', 'f(true)', 'Bool', 'argument 1 to f must be Bool', 'fn f(x: Bool) -> Bool { x }');
expr('function-as-value', '§f', 'f(true)', 'Bool', 'function f requires arguments', 'fn f(x: Bool) -> Bool { x }');
expr('number-conversion-arity', '§number()', 'number(1)', 'Number', 'number expects one Int argument');
expr('number-conversion-type', 'number(§true)', 'number(1)', 'Number', 'number argument must be Int');
for (const fn of ['int_exact', 'int_floor', 'int_ceil', 'int_trunc', 'int_nearest_even']) {
  expr(`${fn}-arity`, `§${fn}()`, `${fn}(1.0)`, 'Int', `${fn} expects one Number argument`);
  expr(`${fn}-type`, `${fn}(§true)`, `${fn}(1.0)`, 'Int', `${fn} argument must be Number`);
  expr(`${fn}-range`, `§${fn}(2147483648.0)`, `${fn}(2147483647.0)`, 'Int', 'integer conversion constant is outside -2147483648..2147483647');
}
expr('int-exact-fraction', '§int_exact(1.5)', 'int_exact(1.0)', 'Int', 'int_exact constant must be integral');
add('result-error-type', 'fn f(x: Result<Bool, §Number>) -> Bool { true } control D {}', 'fn f(x: Result<Bool, SensorFault>) -> Bool { true } control D {}', 'Result error type must be a compiler-owned fault enum');
add('result-nested', 'fn f(x: Result<§Result<Bool, SensorFault>, SensorFault>) -> Bool { true } control D {}', 'fn f(x: Result<Bool, SensorFault>) -> Bool { true } control D {}', 'nested Result payload is not supported');
add('result-error-mismatch', '§fn f(x: Result<Bool, ClockFault>) -> Result<Bool, CalendarFault> { x } control D {}', 'fn f(x: Result<Bool, ClockFault>) -> Result<Bool, ClockFault> { x } control D {}', 'function f returns Result<Bool, ClockFault>, expected Result<Bool, CalendarFault>');
add('result-payload-mismatch', '§fn f(x: Result<Bool, SensorFault>) -> Result<Int, SensorFault> { x } control D {}', 'fn f(x: Result<Bool, SensorFault>) -> Result<Bool, SensorFault> { x } control D {}', 'function f returns Result<Bool, SensorFault>, expected Result<Int, SensorFault>');
add('fault-ambiguous', wrap('let reason = §ClockUnknown;'), 'fn f() -> ClockFault { ClockUnknown } control D {}', 'ambiguous fault member ClockUnknown requires an expected fault type');
for (const [ctor, arg] of [['ok', 'true'], ['fault', 'Stale']]) {
  add(`${ctor}-missing-context`, wrap(`let result = §${ctor}(${arg});`), wrap(`let result: Result<Bool, SensorFault> = ${ctor}(${arg});`), `${ctor} requires an expected Result<T, E> type`);
  add(`${ctor}-arity`, wrap(`let result: Result<Bool, SensorFault> = §${ctor}();`), wrap(`let result: Result<Bool, SensorFault> = ${ctor}(${arg});`), `${ctor} expects one argument`);
}
add('ok-payload-type', wrap('let result: Result<Bool, SensorFault> = ok(§1);'), wrap('let result: Result<Bool, SensorFault> = ok(true);'), 'ok payload must be Bool');
add('fault-enum-type', wrap('let result: Result<Bool, ClockFault> = fault(§Stale);'), wrap('let result: Result<Bool, ClockFault> = fault(ClockUnknown);'), 'fault reason must be ClockFault');

const sensor = (body, type = 'Number') => wrap(`input reading: ${type} { ${body} }`);
add('sensor-type', wrap('input reading: §Result<Number, SensorFault>;'), wrap('input reading: Number;'), 'input type must be a supported scalar payload');
add('sensor-nonconstant-option', wrap('input interval: Duration; input reading: Number { sample = §interval; }'), sensor('sample = 1s;'), 'sample must be a constant Duration');
add('sensor-inverted-range', wrap('§input reading: Number { valid = 2.0 .. 1.0; }'), sensor('valid = 1.0 .. 2.0;'), 'sensor valid range is inverted');
add('sensor-filter-type', sensor('filter = §median(3);', 'Bool'), sensor('filter = median(3);'), 'numeric filtering requires a numeric sensor');
add('sensor-filter-shape', sensor('filter = §1;'), sensor('filter = median(3);'), 'filter must be median(N), moving_average(N), or ema(alpha: Number)');
add('sensor-filter-name', sensor('filter = §unknown(3);'), sensor('filter = median(3);'), 'filter must be median(N), moving_average(N), or ema(alpha: Number)');
add('sensor-ema-shape', sensor('filter = §ema(0.5);'), sensor('filter = ema(alpha: 0.5);'), 'ema filter requires exactly ema(alpha: Number)');
add('sensor-ema-range', sensor('filter = §ema(alpha: 0.0);'), sensor('filter = ema(alpha: 0.5);'), 'ema alpha must be finite and in (0, 1]');
for (const [name, bad, good, message] of [['median', 2, 3, 'median window must be an odd integer from 1 to 31'], ['moving_average', 32, 31, 'moving_average window must be an integer from 1 to 31']]) add(`sensor-${name}-window`, sensor(`filter = §${name}(${bad});`), sensor(`filter = ${name}(${good});`), message);
add('sensor-recovery-count', sensor('recover_after = §0 samples;'), sensor('recover_after = 1 samples;'), 'recover_after must be an integer from 1 to 31 samples');
add('sensor-positive-duration', wrap('§input reading: Number { stale_after = 0s; }'), sensor('stale_after = 1s;'), 'sensor durations must be positive');
const signal = (call, type = 'Number') => wrap(`input reading: ${type}; signal stable = ${call};`);
const hysteresis = 'hysteresis(reading, on_below: 1.0, off_above: 2.0, initial: false)';
add('signal-shape', signal('§true'), signal(hysteresis), 'signal requires hysteresis(sensor, on_below:, off_above:, initial:)');
add('signal-sensor-reference', signal('hysteresis(§true, on_below: 1.0, off_above: 2.0, initial: false)'), signal(hysteresis), 'hysteresis first argument must be a declared sensor');
add('signal-sensor-type', signal('hysteresis(§reading, on_below: false, off_above: true, initial: false)', 'Bool'), signal(hysteresis), 'hysteresis requires a numeric sensor');
add('signal-options', signal('§hysteresis(reading, low: 1.0, off_above: 2.0, initial: false)'), signal(hysteresis), 'hysteresis requires on_below, off_above, and initial');
add('signal-threshold-type', signal('§hysteresis(reading, on_below: true, off_above: 2.0, initial: false)'), signal(hysteresis), 'hysteresis thresholds must be constant sensor values');
add('signal-threshold-order', signal('§hysteresis(reading, on_below: 2.0, off_above: 1.0, initial: false)'), signal(hysteresis), 'hysteresis on_below must be less than off_above');
add('signal-initial-type', signal('§hysteresis(reading, on_below: 1.0, off_above: 2.0, initial: 0)'), signal(hysteresis), 'hysteresis initial must be a Bool constant');
add('timer-shape', wrap('timer age = §true;'), wrap('timer age = continuous_true(true);'), 'timer requires elapsed(state) or continuous_true(Bool)');
add('timer-state-reference', wrap('timer age = elapsed(§true);'), wrap('state value: Bool = false; timer age = elapsed(value);'), 'elapsed argument must be a declared state');
add('timer-condition-type', wrap('timer age = continuous_true(§1);'), wrap('timer age = continuous_true(true);'), 'continuous_true argument must be Bool');
add('timer-cycle', wrap('§timer age = continuous_true(age > 0s);'), wrap('timer age = continuous_true(true);'), 'cyclic timer definition involving age');
const schedule = (interval, body) => wrap(`schedule times: DailySlots<${interval}> { ${body} }`);
const dailyBody = 'timezone = "UTC"; selected = [ 06:00 ];';
add('schedule-interval', schedule('§1min', dailyBody), schedule('15min', dailyBody), 'only DailySlots<15min> is supported');
add('schedule-timezone', wrap('§schedule times: DailySlots<15min> { selected = [ 06:00 ]; }'), schedule('15min', dailyBody), 'schedule requires timezone');
add('schedule-selected', wrap('§schedule times: DailySlots<15min> { timezone = "UTC"; }'), schedule('15min', dailyBody), 'schedule requires selected slots');
add('schedule-slot-grid', schedule('15min', 'timezone = "UTC"; selected = [ §06:01 ];'), schedule('15min', dailyBody), 'DailySlots<15min> requires a unique 15-minute HH:MM slot');
add('schedule-slot-duplicate', schedule('15min', 'timezone = "UTC"; selected = [ 06:00, §06:00 ];'), schedule('15min', dailyBody), 'duplicate schedule slot');
expr('schedule-direct-reference', '§times', 'times.due', 'Bool', 'schedule times must be read as times.due', 'schedule times: DailySlots<15min> { timezone = "UTC"; selected = [ 06:00 ]; }');
const solarBody = 'timezone = "UTC"; latitude = 37.0; longitude = 127.0; at = sun`rise`; fallback = skip;';
for (const [field, clause] of [['timezone', 'timezone = "UTC";'], ['latitude', 'latitude = 37.0;'], ['longitude', 'longitude = 127.0;'], ['at', 'at = sun`rise`;'], ['fallback', 'fallback = skip;']]) add(`solar-missing-${field}`, wrap(`§schedule dawn: Solar { ${solarBody.replace(clause, '')} }`), wrap(`schedule dawn: Solar { ${solarBody} }`), `Solar schedule requires ${field}`);
add('solar-empty-timezone', wrap(`§schedule dawn: Solar { ${solarBody.replace('"UTC"', '""')} }`), wrap(`schedule dawn: Solar { ${solarBody} }`), 'Solar schedule requires a non-empty timezone');
add('solar-unknown-timezone', wrap(`§schedule dawn: Solar { ${solarBody.replace('"UTC"', '"Not/AZone"')} }`), wrap(`schedule dawn: Solar { ${solarBody} }`), 'Solar timezone must be a supported IANA timezone');

const config = body => wrap(`config amount: Number = 1.0 { ${body} }`);
const settings = 'min = 0.0; max = 2.0; step = 1.0; access = operator;';
add('config-computed-initial', wrap(`config amount: Number = 1.0 §+ 0.0 { ${settings} }`), config(settings), 'operating config initial value must be a supported literal');
add('config-unknown-option', wrap(`§config amount: Number = 1.0 { ${settings} unexpected = 0; }`), config(settings), 'unknown config option unexpected');
add('config-access', wrap(`§config amount: Number = 1.0 { ${settings.replace('operator', 'guest')} }`), config(settings), 'config access must be operator or designer');
add('config-label', wrap(`§config amount: Number = 1.0 { ${settings} label = ""; }`), config(settings), 'config label must be 1 to 128 characters');
add('config-bool-bounds', wrap('§config enabled: Bool = true { min = 0; access = operator; }'), wrap('config enabled: Bool = true { access = operator; }'), 'Bool config cannot have numeric bounds');
add('config-missing-step', wrap('§config amount: Number = 1.0 { min = 0.0; max = 2.0; access = operator; }'), config(settings), 'numeric config requires valid min, max and positive step');
add('config-outside-range', wrap(`config amount: Number = §3.0 { ${settings} }`), config(settings), 'config initial value is outside settings range');
add('config-default-grid', wrap(`config amount: Number = §0.5 { ${settings} }`), config(settings), 'config initial value is not aligned to settings.step from settings.min');
add('config-percent-unit', wrap('§config amount: Percent = 1% { min = 0; max = 100%; step = 1%; access = operator; }'), wrap('config amount: Percent = 1% { min = 0%; max = 100%; step = 1%; access = operator; }'), 'Percent setting must use %');
add('config-duration-unit', wrap('§config amount: Duration = 1s { min = 0; max = 2s; step = 1s; access = operator; }'), wrap('config amount: Duration = 1s { min = 0s; max = 2s; step = 1s; access = operator; }'), 'Duration setting must use a duration literal');
add('config-quantity-unit', wrap('§config amount: Length = 1m { min = 0Pa; max = 2m; step = 1m; access = operator; }'), wrap('config amount: Length = 1m { min = 0m; max = 2m; step = 1m; access = operator; }'), 'Length setting must use a Length unit literal');
const dateSettings = 'min = date`2026-01-01`; max = date`2026-01-03`; step = 1; access = operator;';
add('config-date-tag-required', wrap(`§config day: Date = date\`2026-01-01\` { ${dateSettings.replace('min = date`2026-01-01`', 'min = 0')} }`), wrap(`config day: Date = date\`2026-01-01\` { ${dateSettings} }`), 'Date setting must use a tagged literal');
add('config-date-tag-mismatch', wrap(`§config day: Date = date\`2026-01-01\` { ${dateSettings.replace('min = date`2026-01-01`', 'min = time`00:00`')} }`), wrap(`config day: Date = date\`2026-01-01\` { ${dateSettings} }`), 'Date setting must use a matching tagged literal');
add('config-date-step-fraction', wrap(`§config day: Date = date\`2026-01-01\` { ${dateSettings.replace('step = 1', 'step = 1.5')} }`), wrap(`config day: Date = date\`2026-01-01\` { ${dateSettings} }`), 'Int setting must use a whole decimal literal');
add('config-date-step-overflow', wrap(`§config day: Date = date\`2026-01-01\` { ${dateSettings.replace('step = 1', 'step = 2147483648')} }`), wrap(`config day: Date = date\`2026-01-01\` { ${dateSettings} }`), 'Int setting is outside -2147483648..2147483647');
add('config-time-max-grid', wrap('§config t: TimeOfDay = time`00:00` { min = time`00:00`; max = time`00:00:00.003`; step = 2ms; access = operator; }'), wrap('config t: TimeOfDay = time`00:00` { min = time`00:00`; max = time`00:00:00.004`; step = 2ms; access = operator; }'), 'time config max is not aligned to settings.step from settings.min');

const enumSetup = 'type Mode = Off | On; state mode: Mode = Off;';
expr('case-not-enum', 'case §1 { Off => true; On => false; }', 'case mode { Off => true; On => false; }', 'Bool', 'case requires an enum or sensor/signal result', enumSetup);
expr('case-enum-binding', 'case mode { §Off(x) => true; On => false; }', 'case mode { Off => true; On => false; }', 'Bool', 'enum case members do not take bindings', enumSetup);
expr('case-enum-unknown', 'case mode { §Unknown => true; On => false; }', 'case mode { Off => true; On => false; }', 'Bool', 'unknown Mode member Unknown', enumSetup);
expr('case-enum-duplicate', 'case mode { Off => true; §Off => false; On => false; }', 'case mode { Off => true; On => false; }', 'Bool', 'duplicate case member Off', enumSetup);
expr('case-enum-incomplete', '§case mode { Off => true; }', 'case mode { Off => true; On => false; }', 'Bool', 'case for Mode must be exhaustive', enumSetup);
expr('case-enum-branch-type', 'case mode { §Off => true; On => 1; }', 'case mode { Off => true; On => false; }', 'Bool', 'case branches must have the same type', enumSetup);
const resultSetup = 'input reading: Bool;';
const caseGood = 'case reading { ok(v) => v; fault(_) => false; }';
expr('case-result-pattern', 'case reading { §good(v) => v; fault(_) => false; }', caseGood, 'Bool', 'Result case supports only ok(...) and fault(...)', resultSetup);
expr('case-result-duplicate', 'case reading { ok(v) => v; §ok(_) => false; fault(_) => false; }', caseGood, 'Bool', 'duplicate ok branch', resultSetup);
expr('case-result-binding', 'case reading { §ok => true; fault(_) => false; }', caseGood, 'Bool', 'ok branch requires a binding', resultSetup);
expr('case-result-incomplete', '§case reading { ok(v) => v; }', caseGood, 'Bool', 'Result case must handle ok(...) and fault(...)', resultSetup);
expr('case-result-branch-type', '§case reading { ok(v) => v; fault(_) => 1; }', caseGood, 'Bool', 'case branches must have the same type', resultSetup);
expr('case-result-shadow', 'case reading { §ok(Stale) => Stale; fault(_) => false; }', caseGood, 'Bool', 'case binding name Stale is a reserved fault member', resultSetup);
expr('case-result-reserved-binding', 'case reading { §ok(__gf_private) => __gf_private; fault(_) => false; }', caseGood, 'Bool', 'case binding name __gf_private uses reserved __gf_ prefix', resultSetup);
const pipeSetup = 'input reading: Number;';
const pipeGood = 'reading |> map(below(3.0)) |> recover(false)';
expr('pipeline-shape', 'reading |> §true', pipeGood, 'Bool', 'Result pipeline requires a compiler-known static transform', pipeSetup);
expr('pipeline-unknown-transform', 'reading |> §unknown()', pipeGood, 'Bool', 'unsupported Result transform unknown', pipeSetup);
expr('pipeline-not-static-alias', 'reading |> §alias', pipeGood, 'Bool', 'alias is not a static Result transform', `${pipeSetup} let alias = true;`);
add('pipeline-composition-context', wrap('let transform: Bool = true §>> false;'), wrap('let transform: Bool = true;'), '>> is valid only inside a static Result transform pipeline');
expr('map-arity', 'reading |> §map()', pipeGood, 'Bool', 'map expects one transform and a Result value', pipeSetup);
expr('map-input-type', '1.0 |> §map(below(3.0))', pipeGood, 'Bool', 'map expects one transform and a Result value', pipeSetup);
expr('map-result-return', 'reading |> §map(f) |> recover(false)', 'reading |> and_then(f) |> recover(false)', 'Bool', 'map transform must return a non-Result value', `${pipeSetup} fn f(x: Number) -> Result<Bool, SensorFault> { ok(true) }`);
expr('and-then-arity', 'reading |> §and_then()', pipeGood, 'Bool', 'and_then expects one transform and a Result value', pipeSetup);
expr('and-then-input-type', '1.0 |> §and_then(f) |> recover(false)', 'reading |> and_then(f) |> recover(false)', 'Bool', 'and_then expects one transform and a Result value', `${pipeSetup} fn f(x: Number) -> Result<Bool, SensorFault> { ok(true) }`);
expr('and-then-nonresult-return', 'reading |> §and_then(f) |> recover(false)', 'reading |> map(f) |> recover(false)', 'Bool', 'and_then transform must return Result<U, E> with the same error type', `${pipeSetup} fn f(x: Number) -> Bool { true }`);
expr('and-then-error-enum', 'reading |> §and_then(f) |> recover(false)', 'reading |> map(below(3.0)) |> recover(false)', 'Bool', 'and_then transform must return Result<U, E> with the same error type', `${pipeSetup} fn f(x: Number) -> Result<Bool, ClockFault> { fault(ClockUnknown) }`);
expr('recover-arity', 'reading |> §recover()', 'reading |> recover(0.0)', 'Number', 'recover expects one default and a Result value', pipeSetup);
expr('recover-input-type', '1.0 |> §recover(0.0)', 'reading |> recover(0.0)', 'Number', 'recover expects one default and a Result value', pipeSetup);
expr('recover-default-type', 'reading |> recover(§false)', 'reading |> recover(0.0)', 'Number', 'recover default must be Number', pipeSetup);
expr('below-arity', 'reading |> map(§below()) |> recover(false)', pipeGood, 'Bool', 'below expects one limit', pipeSetup);
expr('below-payload-type', 'reading |> map(§below(true)) |> recover(false)', 'reading |> recover(false)', 'Bool', 'below is not defined for Bool', 'input reading: Bool;');
expr('below-limit-type', 'reading |> map(below(§true)) |> recover(false)', pipeGood, 'Bool', 'below limit must be Number', pipeSetup);
expr('callback-shape', 'reading |> map(§true) |> recover(false)', pipeGood, 'Bool', 'map/and_then requires a named fn or below(limit)', pipeSetup);
expr('callback-unknown-name', 'reading |> map(§missing) |> recover(false)', pipeGood, 'Bool', 'transform missing must name a unary fn', pipeSetup);
expr('callback-arity', 'reading |> map(§f) |> recover(false)', pipeGood, 'Bool', 'transform f must name a unary fn', `${pipeSetup} fn f(x: Number, y: Number) -> Bool { true }`);
expr('callback-parameter-type', 'reading |> map(§f) |> recover(false)', pipeGood, 'Bool', 'transform f expects Bool', `${pipeSetup} fn f(x: Bool) -> Bool { x }`);
add('callback-recursion', 'fn wrap(x: Number) -> Result<Number, SensorFault> { ok(x) } fn f(x: Number) -> Number { wrap(x) |> map(§f) |> recover(0.0) } control D {}', 'fn wrap(x: Number) -> Result<Number, SensorFault> { ok(x) } fn f(x: Number) -> Number { wrap(x) |> recover(0.0) } control D {}', 'recursive fn f is not supported');
const outputSetup = 'output a, b: Bool; a <- true; b <- false;';
add('constraint-shape', wrap(`${outputSetup} §require !a;`), wrap(`${outputSetup} require !(a && b);`), 'unsupported require: use output => output, output => (a || b), or !(a && b)');
add('constraint-target-type', wrap(`${outputSetup} require §true => b;`), wrap(`${outputSetup} require a => b;`), 'require implication target must be a Bool output');
add('constraint-mutex-count', wrap(`${outputSetup} §mutex(a);`), wrap(`${outputSetup} mutex(a, b);`), 'mutex needs 2 to 32 Bool outputs');
add('constraint-mutex-member', wrap(`${outputSetup} §mutex(a, missing);`), wrap(`${outputSetup} mutex(a, b);`), 'mutex member must be a Bool output');
// Each external Bool owns value/quality/fault rails: 42 declarations use 126
// VM inputs; 43 cross the unchanged 128-input resource boundary.
add('input-resource-budget', `§control Diagnostic { input ${Array.from({length:43}, (_,i)=>`x${i}`).join(', ')}: Bool; }`, wrap(`input ${Array.from({length:42}, (_,i)=>`x${i}`).join(', ')}: Bool;`), 'input budget exceeded (128)');
add('state-resource-budget', `§control Diagnostic { ${Array.from({length:129}, (_,i)=>`state x${i}: Bool = false;`).join(' ')} }`, wrap(Array.from({length:128}, (_,i)=>`state x${i}: Bool = false;`).join(' ')), 'state budget exceeded (128)');
add('output-resource-budget', `§control Diagnostic { ${Array.from({length:129}, (_,i)=>`output x${i}: Bool; x${i} <- false;`).join(' ')} }`, wrap(Array.from({length:128}, (_,i)=>`output x${i}: Bool; x${i} <- false;`).join(' ')), 'GFB1 lowering rejected control: strategy resource limit exceeded');
const duplicated = depth => `${'twice('.repeat(depth)}inputValue${')'.repeat(depth)}`;
add('expanded-tree-budget', `§control Diagnostic { fn twice(x: Bool) -> Bool { x || x } state inputValue: Bool = false; output out: Bool; out <- ${duplicated(12)}; }`, wrap(`fn twice(x: Bool) -> Bool { x || x } state inputValue: Bool = false; output out: Bool; out <- ${duplicated(3)};`), 'function expansion exceeds 4096 node budget');

// Helper failures must retain the same public diagnostic class and source location.
expr('quantity-decimal-exponent-overflow', '§1e999m', '1e2m', 'Length', 'quantity literal exceeds finite binary64 range');
expr('quantity-binary64-overflow', '§1.8e308m', '1.7e308m', 'Length', 'quantity literal exceeds finite binary64 range');
expr('quantity-rounded-overflow', '§1.79769313486231581e308m', '1.7976931348623158e308m', 'Length', 'quantity literal exceeds finite binary64 range');
expr('quantity-unary-overflow', '§-1e999m', '-1e2m', 'Length', 'quantity literal exceeds finite binary64 range');
add('quantity-setting-overflow', wrap('§config x: Length = 1m { min = 0m; max = 1e999m; step = 1m; access = operator; }'), wrap('config x: Length = 1m { min = 0m; max = 2m; step = 1m; access = operator; }'), 'quantity literal exceeds finite binary64 range');
add('constraint-prerequisite-type', wrap(`${outputSetup} require a => §true;`), wrap(`${outputSetup} require a => b;`), 'require prerequisite must be a Bool output');
const mutexNames = Array.from({ length: 33 }, (_, i) => `out${i}`);
const mutexOutputs = mutexNames.map(name => `output ${name}: Bool; ${name} <- false;`).join(' ');
add('constraint-mutex-upper-bound', wrap(`${mutexOutputs} §mutex(${mutexNames.join(', ')});`), wrap(`${mutexOutputs} mutex(${mutexNames.slice(0, 32).join(', ')});`), 'mutex needs 2 to 32 Bool outputs');
add('constraint-resource-budget', `§${wrap(`${outputSetup} ${Array(129).fill('require a => b;').join(' ')}`)}`, wrap(`${outputSetup} ${Array(128).fill('require a => b;').join(' ')}`), 'GFB1 lowering rejected control: module resource limit exceeded');
add('config-number-nonfinite', wrap('§config x: Number = 1.0 { min = 0.0; max = 1e999; step = 1.0; access = operator; }'), config(settings), 'config setting must be finite');
add('config-percent-bound', wrap('§config x: Percent = 1% { min = 0%; max = 101%; step = 1%; access = operator; }'), wrap('config x: Percent = 1% { min = 0%; max = 100%; step = 1%; access = operator; }'), 'config setting must be between 0% and 100%');
add('config-humidity-bound', wrap('§config x: RelativeHumidity = 1%RH { min = 0%RH; max = 101%RH; step = 1%RH; access = operator; }'), wrap('config x: RelativeHumidity = 1%RH { min = 0%RH; max = 100%RH; step = 1%RH; access = operator; }'), 'config setting must be between 0%RH and 100%RH');
add('config-temperature-step-type', wrap('§config x: Temperature = 1°C { min = 0°C; max = 2°C; step = 1°C; access = operator; }'), wrap('config x: Temperature = 1°C { min = 0°C; max = 2°C; step = 1Δ°C; access = operator; }'), 'TemperatureDelta setting must use a TemperatureDelta unit literal');
// This is an implementation restriction, not a Reference language rejection.
const contextSlotsBody = `${dailyBody} dst_missing = skip; dst_repeated = first; basis = pulse; when = true; clock = trusted_only; gap = skip_after(60s); recovery = baseline; fallback = skip;`;
add('config-daily-slots-combination', `§${wrap(`schedule times: DailySlots<15min> { ${contextSlotsBody} } config x: Bool = false { access = operator; }`)}`, wrap(`schedule times: DailySlots<15min> { ${contextSlotsBody} } let x = false;`), 'config streams cannot mix with legacy Daily/DailySlots context execution; use fixed let values or a config-aware schedule', 'implementation-restriction');
const aliasExpression = (count, rightHeavy) => `state x: Number = 1.0; ${Array.from({length: count}, (_, i) => `let v${i} = ${rightHeavy ? `x + ${i ? `v${i-1}` : 'x'}` : `${i ? `v${i-1}` : 'x'} + x`};`).join(' ')} output out: Number; out <- v${count-1};`;
add('expression-stack-budget', `§${wrap(aliasExpression(130, true))}`, wrap(aliasExpression(100, true)), 'expression stack budget exceeded (128) for out');
add('lowered-syntax-depth-budget', `§${wrap(aliasExpression(130, false))}`, wrap(aliasExpression(100, false)), 'GFB1 lowering rejected control: syntax nesting limit exceeded');
const largeExpression = depth => `fn twice(x: Number) -> Number { x + x } state x: Number = 1.0; output out: Number; out <- ${'twice('.repeat(depth)}(x + 17.0)${')'.repeat(depth)};`;
add('expression-byte-budget', `§${wrap(largeExpression(9))}`, wrap(largeExpression(8)), 'GFB1 lowering rejected control: strategy resource limit exceeded');
const recursiveExpansion = (depth, marked = false) => `fn f0(x: Bool) -> Bool { x } ${Array.from({length: depth}, (_, i) => `fn f${i+1}(x: Bool) -> Bool { f${i}(f${i}(${marked && i === 0 ? '§' : ''}x)) }`).join(' ')}`;
add('lowering-visit-budget', wrap(recursiveExpansion(12, true)), wrap(recursiveExpansion(3)), 'function expansion exceeds 4096 node budget');
const prerequisites = count => `require out0 => (${mutexNames.slice(1, count + 1).join(' || ')});`;
add('constraint-prerequisite-arity', `§${wrap(`${mutexOutputs} ${prerequisites(32)}`)}`, wrap(`${mutexOutputs} ${prerequisites(31)}`), 'constraint arity exceeds 32');
add('constraint-duplicate-member', `§${wrap(`${outputSetup} mutex(a, a);`)}`, wrap(`${outputSetup} mutex(a, b);`), 'GFB1 lowering rejected control: invalid constraint names or arity');
expr('removed-ifthenelse', '§ifthenelse(true, true, false)', 'if true then true else false', 'Bool', 'removed alias ifthenelse; use if condition then value else value');
for (const name of ['elapsed', 'hysteresis', 'median']) expr(`declaration-only-${name}`, `§${name}(true)`, 'true', 'Bool', `${name} is only valid in its declaration`);
add('result-type-parameters-missing', wrap('input value: §Result;'), wrap('input value: Bool;'), 'Result type requires payload and error types');
add('enum-type-as-value', wrap('type Mode = Off | On; let value = §Mode;'), wrap('type Mode = Off | On; let value = Off;'), 'unsupported reference Mode');
for (const base of ['input', 'state', 'next']) expr(`removed-qualified-${base}`, `§${base}.x`, 'x', 'Bool', `removed qualified reference ${base}.x; use the direct canonical name`, 'let x: Bool = true;');
add('config-date-setting-invalid-calendar', wrap(`§config day: Date = date\`2026-01-01\` { ${dateSettings.replace('2026-01-03', '2026-02-29')} }`), wrap(`config day: Date = date\`2026-01-01\` { ${dateSettings} }`), 'date literal is out of range');
// Solar offsets are parsed by a shared literal helper, before lowering.
add('solar-offset-whole-unit', wrap(`schedule dawn: Solar { ${solarBody.replace('sun`rise`', 'sun`rise + §0.5s`')} }`), wrap(`schedule dawn: Solar { ${solarBody.replace('sun`rise`', 'sun`rise + 500ms`')} }`), 'Solar offset must be an integer duration literal using ms, s, min, or h');
add('solar-offset-range', wrap(`schedule dawn: Solar { ${solarBody.replace('sun`rise`', 'sun`rise + §25h`')} }`), wrap(`schedule dawn: Solar { ${solarBody.replace('sun`rise`', 'sun`rise + 24h`')} }`), 'Solar offset magnitude must not exceed 24h');
expr('number-whole-literal-nonfinite', `§${'9'.repeat(310)}`, '1', 'Number', 'number literal must be finite');
const scheduled = `schedule times: DailySlots<15min> { ${dailyBody} }`;
add('function-schedule-member-capture', `fn f() -> Bool { §times.due } ${wrap(scheduled)}`, `fn f(value: Bool) -> Bool { value } ${wrap(`${scheduled} output out: Bool; out <- f(times.due);`)}`, 'fn f cannot capture global times');
add('function-local-member-shadow', `fn f(times: Bool) -> Bool { §times.due } ${wrap(scheduled)}`, `fn f(times: Bool) -> Bool { times } ${wrap(`${scheduled} output out: Bool; out <- f(times.due);`)}`, 'unknown member times.due');
expr('case-local-member-shadow', 'case reading { ok(times) => §times.due; fault(_) => false; }', 'case reading { ok(times) => times; fault(_) => false; }', 'Bool', 'unknown member times.due', `${scheduled} input reading: Bool;`);
add('encoded-name-length', `§control ${'x'.repeat(129)} {}`, `control ${'x'.repeat(128)} {}`, `GFB1 lowering rejected control: invalid module name: ${'x'.repeat(129)}`, 'resource-limit');
const namedOutputs = count => Array.from({length: count}, (_, i) => { const name = `x${i}`.padEnd(128, 'x'); return `output ${name}: Bool; ${name} <- false;`; }).join(' ');
add('device-query-byte-budget', `§${wrap(namedOutputs(32))}`, wrap(namedOutputs(20)), 'GFB1 lowering rejected control: strategy resource limit exceeded', 'resource-limit');
const expandedSource = count => `fn twice(x: Number) -> Number { x + x } let large = ${'twice('.repeat(8)}1e-300${')'.repeat(8)}; ${Array.from({length: count}, (_, i) => `output out${i}: Number; out${i} <- large;`).join(' ')}`;
add('lowered-source-byte-budget', `§${wrap(expandedSource(15))}`, wrap(expandedSource(10)), 'GFB1 lowering rejected control: source byte limit exceeded');
const mixedOutputs = 'output a: Number; output b: Bool; a <- 1.0; b <- false;';
add('constraint-target-nonbool-output', wrap(`${mixedOutputs} require §a => b;`), wrap(`${outputSetup} require a => b;`), 'require implication target must be a Bool output');
add('constraint-prerequisite-nonbool-output', wrap(`${mixedOutputs} require b => §a;`), wrap(`${outputSetup} require b => a;`), 'require prerequisite must be a Bool output');
add('constraint-mutex-nonbool-output', wrap(`${mixedOutputs} §mutex(a, b);`), wrap(`${outputSetup} mutex(a, b);`), 'mutex member must be a Bool output');

// 409 Number leaves and 408 additions emit 4089 bytes per expression.
// Balanced source stays below parser depth; the shared let stays below source limits.
const denseNumberTree = leaves => leaves === 1 ? '16.0'
  : `(${denseNumberTree(Math.floor(leaves / 2))} + ${denseNumberTree(Math.ceil(leaves / 2))})`;
const denseModule = outputCount => `control D { let large: Number = ${denseNumberTree(409)}; ${Array.from({length: 128}, (_, i) => `state s${i}: Number = 0.0; s${i}' = large;`).join(' ')} ${Array.from({length: outputCount}, (_, i) => `output o${i}: Number; o${i} <- large;`).join(' ')} }`;
export const moduleBoundaryCases = [{
  id: 'compiled-module-byte-limit',
  good: denseModule(126),
  bad: denseModule(128),
  validByteLength: 1_044_663,
  message: 'compiled module byte limit exceeded',
}];
