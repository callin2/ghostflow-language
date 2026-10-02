<!-- translation-source: docs/reference/02-types-expressions-state.md -->
[Korean original](02-types-expressions-state.md)

# 2. Types, expressions, and state

[Complete contents](../LANGUAGE-REFERENCE.en.md) · [Previous: Source and syntax](01-source-and-syntax.en.md) · [Next: Time and schedules](03-time-and-schedules.en.md)

GhostFlow types preserve control meaning before storage format. True/false, approximate measurements, percentages, durations, exact counts, and stage state are not interchangeable. This makes incorrect comparisons and unit confusion detectable before execution and lets screens, records, and device boundaries use the same meaning.

The `ghost` fragments in this chapter illustrate rules.

Rationale: [Selected syntax](../LANGUAGE-SURFACE.md), [Common language contract](../LANGUAGE.md), [Exact integer contract](../EXACT-INTEGER-CONTRACT.md), [Programming in GhostFlow](../ProgrammingInGhostflow.md), [Physical-quantity design issue #93](https://github.com/callin2/ghostflow-language/issues/93). The [complete language reference](../LANGUAGE-REFERENCE.md) indexes this chapter and the other detailed chapters.

## 2.1 Value kinds

| Type | Meaning | Representative literals and values |
|---|---|---|
| `Bool` | True or false | `true`, `false` |
| `Int` | Exact signed 32-bit integer | Counts, repetitions, integer differences |
| `Number` | Finite binary64 approximate number | `3.0`, `0.5`, `-2.5` |
| `Percent` | Percentage from 0 to 100 | `30%` |
| `Duration` | Nonnegative duration with millisecond resolution | `250ms`, `2s`, `5min`, `1h` |
| Named enum | One of the declared finite cases | `Idle`, `Watering` |
| `Result<T, E>` | Normal payload or compiler-owned fault enum `E` | `ok(value)`, `fault(reason)` |
| Named physical quantity | Finite number preserving units and agricultural meaning | `25°C`, `1.2kPa`, `70%RH` |

`Bool` has no numeric or string truthiness. NaN and Infinity are not `Number` values. `30`, `30%`, and `30ms` are not the same numeric notation and are not implicitly compared or converted. `"Asia/Seoul"` and `06:00` in schedule settings are restricted syntax with meaning only in those positions. Do not extrapolate this notation into general string operations. A schedule's `[06:00, 18:45]` is not a general array value either. General dates and times use the explicit `date`, `time`, and `datetime` tagged literals in Chapter 3.

The boundaries of `Percent` expose meaning and prevent incorrect numeric connections. `Duration` differs from calendar time. Wall-clock correction does not rewind a timer's monotonic elapsed time.

### Literal spelling

- Bool is exactly `true` or `false`.
- Ordinary numbers use decimal integer, decimal-point, or exponent notation. A preceding `-` indicates a negative number; there is no truthiness or implicit string-to-number conversion.
- Percent is distinguished by `%` after a number. Example: `30%`.
- Duration joins a nonnegative integer with `ms | s | min | h`. Examples: `500ms`, `2s`. Write half a second as `500ms`, rather than `0.5s`.
- An enum case is an identifier in that enum's declaration.

Duration uses the nonnegative integer unit notation above. The design notation using `%` for integer remainder is a binary operation between operands; its context must be distinguished from a Percent suffix.

## 2.2 Literals and expected types

The following type-resolution principles distinguish integer-shaped ordinary numbers from approximate measurements.

- A number with a decimal point or exponent is `Number`.
- An integer-shaped decimal number is `Int` without an expected numeric type.
- A typed declaration, function parameter, another already-typed operand of the same operation, or the common expected type of two `if` branches can supply an expected type to an integer-shaped literal.
- `30` compared with `input temperature: Number;` can be interpreted as a `Number` literal from the outset. This is not an implicit runtime conversion from `Int` to `Number`.
- The type of an untyped `let count = 30;` is fixed by its initializer. Later uses do not retroactively change the initializer's type.
- Conflicting expected types produce diagnostics; overloads are not guessed.
- Integer literal ranges are checked against the original decimal digits. `-2147483648` is permitted as a boundary case; it is not processed by first rejecting positive `2147483648` and then applying unary `-`. Larger positive or negative magnitudes produce diagnostics.
- Digit separators are not part of the integer literal contract. The `_` in the range notation below separates digits for readability.

```ghost
control LiteralContexts {
  input temperature: Number;
  let count = 30;              // Int
  let warm = temperature >= 30; // 이 30은 Number 문맥
  output alarm: Bool;
  alarm <- warm;
}
```

Counts and repetitions are exact within the supported range. Loss, wrap, and saturation do not occur silently.

## 2.3 Exact integer design

The minimum semantic model is a signed 32-bit integer.

```text
Int = -2_147_483_648 .. 2_147_483_647
```

One signed type represents differences and offsets as well as counts. Nonnegative constraints are expressed as config/state domain bounds rather than by adding primitives. Date-time, monotonic clocks, and identifier widths have contracts separate from this `Int`.

### Operation semantics

| Expression | Result and constraints |
|---|---|
| `a + b`, `a - b`, `a * b` | Exact `Int`; exceeding the range is a fault |
| `-a` | Exact `Int`; negating the minimum value is a fault |
| `a div b` | Quotient truncated toward zero |
| `a % b` | Remainder with the dividend's sign |
| `a / b` (two `Int` values) | Error; requires `div` or explicit Number conversion |
| `== != < <= > >=` | Permitted between two `Int` values |
| Mixing `Int` and `Number` | Error until explicitly converted |

Valid division satisfies `a == (a div b) * b + (a % b)`. Division by zero and `MIN div -1` are respectively a division fault and overflow.

### Explicit conversions

| Spelling | Meaning |
|---|---|
| `number(i)` | Converts every i32 into an exact `Number` |
| `int_exact(n)` | Accepts only integer-valued Number values within range |
| `int_floor(n)` | Mathematical floor followed by range checking |
| `int_ceil(n)` | Mathematical ceiling followed by range checking |
| `int_trunc(n)` | Truncation toward zero followed by range checking |
| `int_nearest_even(n)` | Nearest, exact ties toward even, followed by range checking |

There is no generic conversion with a hidden rounding default. Constant overflow and invalid constant conversions produce compile diagnostics. Input-dependent overflow, division by zero, fractional exact conversion, and out-of-range conversion reject the current tick. New state and intent do not partially commit. Stable fault reasons are distinguished as `integer-overflow`, `integer-division-by-zero`, `integer-conversion-fractional`, and `integer-conversion-out-of-range`.

`int_exact` checks the fractional part of finite inputs before the range. A value such as `2147483648.5` that is both fractional and out of range therefore produces `integer-conversion-fractional`. An integer-valued value outside the range produces `integer-conversion-out-of-range`. This order is identical in constant diagnostics and runtime faults and first explains whether an input can be converted into an exact integer.

`Int`, `div`, `%`, and the conversion function names above are canonical spellings. There is no conversion such as generic `int(n)` that hides a rounding policy. `div` and binary `%` have the same precedence as `*` and `/` and are left-associative. `30%` attached directly to a number without whitespace is a Percent literal; `%` between two expressions is Int remainder.

### Number operations

`Number` supports `+`, `-`, `*`, `/`, unary `-`, and comparisons with same-type operands. Results must be finite. Division by zero or a nonfinite result prevents the tick from committing state and intent. Mixing `Int` and `Number` cannot bypass this rule.

## 2.4 Enums and exhaustive branching

Enums express sequential stages as names rather than hiding them as numbers.

```ghost
type Phase = Idle | Opening | Watering | Closing;
state phase: Phase = Idle;

phase' = case phase {
  Idle     => if start then Opening else Idle;
  Opening  => Opening;
  Watering => Watering;
  Closing  => Idle;
};
```

Every case must be handled. Missing cases are errors; adding a new enum case requires reviewing affected branches. Every branch must produce a value of the same type required by the context. `phase in {Opening, Watering}` checks membership in a finite set of the same enum type. `{...}` is set notation in this position and does not create a general collection value.

`enum Phase { ... }` and `enum Phase = ...;` in reference material are historical notation and are rejected as executable input.

## 2.5 Sensor results and explicit error flow

The declared type of `sensor moisture: Percent;` is its normal payload type. Reading a sensor produces either a normal value or a fault, so it cannot be compared directly as a payload.

```ghost
let dry = case moisture {
  ok(value) => value < 30%;
  fault(_)  => false;
};
```

`_` is a pattern indicating that this expression does not use the fault's detail. Even when replaced with false, the original fault does not become a normal value and remains in the record. `SensorFault` is a built-in enum with `Disconnected | Stale | Invalid | NotReady`. A fault binding can be exhaustively branched again with `case`.

```ghost
let available = case moisture {
  ok(_) => true;
  fault(reason) => case reason {
    Disconnected => false;
    Stale => false;
    Invalid => false;
    NotReady => false;
  };
};
```

`Result<T, E>` may also be used for function parameters and result types. `E` must be a compiler-defined finite fault enum. v1 has `SensorFault`, `ClockFault`, `CalendarFault`, `TemporalContextFault`, `AccountingFault`, and `SettingsFault`. `ok(expr)` and `fault(reason)` are constructors of this built-in Result. There is no general syntax for users to declare new ADTs, new Result error types, or constructors. Results are not stored as scalar state, config, input, or output values or exposed to installation bindings. `config x: T = initial` does not declare scalar storage for a Result. It declares a settings stream with payload `T`; the type of `x` read in an expression is `Result<T, SettingsFault>`. Its initial emission is `ok(initial)`. Do not replace the current error rail with the source default or previous successful value. Follow the stream rules in [§5.2](05-settings-and-observation.md#설정-stream과-현재-observation).

Members of built-in fault enums are fixed as follows. Names for time, calendars, and natural events match the [Unknown causes in Chapter 3](03-time-and-schedules.md#자연-기준의-fallback과-회복).

| Error type | Members |
|---|---|
| `SensorFault` | `Disconnected`, `Stale`, `Invalid`, `NotReady` |
| `ClockFault` | `ClockUnknown`, `ZoneUnsupported` |
| `CalendarFault` | `ClockUnknown`, `CalendarMissing`, `CalendarOutOfRange`, `ZoneUnsupported` |
| `TemporalContextFault` | `ClockUnknown`, `LocationUnknown`, `EventUnavailable`, `PredictionMissing`, `PredictionStale`, `ZoneUnsupported` |
| `AccountingFault` | `ClockUnknown`, `LedgerMissing`, `LedgerCorrupt`, `LedgerIncomplete`, `CountOverflow` |
| `SettingsFault` | `SettingsInvalid`, `SettingsUnavailable` |

Some names belong to multiple built-in fault enums. `fault(reason)` resolves the member through the expected Result error type; `case reason` resolves it through the inspected error type. A member reference that cannot resolve to one type from context is an error. User declarations cannot shadow these members or add new ones. An incorrect provider kind or binding is an activation error; do not substitute an arbitrary new member of these enums.

**Why:** To avoid erasing causes requiring different responses, such as missing clocks and missing predictions, into one failure value, while limiting each Result to finite possibilities for exhaustive branch checking.

`?` in `sensor moisture?: Percent;` means an installation capability is optional. An uninstalled sensor differs from a fault in an installed sensor. `?` alone creates neither an alternative strategy nor an arbitrary default.

Stateful sensor processing also declares its meaning.

```ghost
sensor moisture: Percent {
  sample = 1s;
  valid = 0% .. 100%;
  filter = median(3);
  stale_after = 3s;
  recover_after = 1 samples;
}
signal dry = hysteresis(moisture,
  on_below: 30%, off_above: 35%, initial: false);
```

The n in `median(n)` is odd within 1..31; hysteresis retains the previous decision between its two boundaries. `sample` is measurement interval information rather than a command to start a separate thread. Filter and hysteresis memory are also explicit control state subject to checkpointing and replay.

### Static Result transformations and composition

Result flow supports the following compiler-known static transformations.

| Notation | Value meaning |
|---|---|
| `ok(value)` / `fault(reason)` | Normal payload or built-in fault constructor of the corresponding Result |
| `below(limit)` | Static transformation accepting a compatible ordered payload and returning `value < limit` |
| `map(f)` | Unary function mapping `Ok(x)` to `Ok(f(x))` and passing `Err(e)` through unchanged |
| `and_then(f)` | Connects `Ok(x)` to Result-returning `f(x)` and passes `Err(e)` through |
| `recover(default)` | Turns `Ok(x)` into x and `Err(e)` into a same-type default |
| `x \|> f` | Passes a value to a function as `f(x)` |
| `f >> g` | Left-to-right composition as `(x) -> g(f(x))` |

```text
is_dry = map(below(35%)) >> recover(false)
dry = moisture |> map(below(35%)) |> recover(false)
```

Arguments to `map` and `and_then` must be statically resolved named `fn` functions or compiler-known bounded transforms such as `below(limit)`. They do not create function values, lambdas, closures, or runtime function selection. `>>` also composes only these static transform chains. `|>` and `>>` are left-associative and bind more tightly than `if/then/else`.

These operations are pure value transformations that create neither state nor a stream scheduler. `recover` also does not erase original sensor faults or fallback selection records. Uppercase `Ok`/`Err` and `not`, `and`, `or`, `is`, `isnt` are not canonical aliases.

## 2.6 Expressions and operators

Binding precedence in the selected control syntax is listed strongest first.

| Rank | Operation |
|---:|---|
| 1 | Parentheses, function calls, member and next-state references |
| 2 | Unary `!`, unary `-` |
| 3 | `*`, `/`, `div`, binary `%` |
| 4 | `+`, `-` |
| 5 | `in { ... }` |
| 6 | `==`, `!=`, `<`, `<=`, `>`, `>=` |
| 7 | `&&` |
| 8 | `\|\|` |
| 9 | Static transform composition `>>` |
| 10 | Static value piping `\|>` |

Binary operations at the same rank are left-associative. `6 - 2 - 1` means `(6 - 2) - 1`. Chained comparisons are prohibited. Write `a < b && b < c` instead of `a < b < c`. Equality and ordering comparisons are only between compatible values of the same type. Use parentheses and named `let` bindings to expose the intent of complex decisions.

`|>` and `>>` are used only for statically resolved Result transform chains. `not`, `and`, `or`, `is`, and `isnt` from early A/B/C material are not aliases for these control operators.

### Conditional expressions

`if condition then a else b` is a value. The condition is `Bool`; both branches must have the same type. As with `case`, even unselected branches are statically type-checked.

```ghost
let denominator = if b == 0 then 1.0 else b;
let result = if b == 0 then 0.0 else a / denominator;
```

`if`, `&&`, and `||` deterministically short-circuit from left to right. `if` evaluates only the selected branch after the condition; `&&` evaluates the right side only when the left side is true; `||` evaluates the right side only when the left side is false. All branches and operands still undergo static name and type checking. Compile-time errors remain even in unreachable branches, but runtime faults in unselected branches do not occur. Constant folding and function inlining preserve this fault reachability and order.

## 2.7 Pure functions and computational composition

```ghost
fn hold(start: Bool, stop: Bool, previous: Bool) -> Bool {
  !stop && (start || previous)
}
```

A function declares parameter and result types and returns the value of its final expression. There is no `return` statement. Functions are pure computations producing the same value for the same arguments and do not implicitly capture control inputs, state, or settings. Required values are passed as call arguments.

Functions have no mutable local state, waits, or I/O effects. Calls must resolve statically; recursion and cyclic calls are prohibited. Splitting or rearranging functions and `let` bindings does not change results when the dependency graph is identical. Function names are not ordinary values and cannot be stored, returned, dynamically selected, or passed as general function parameters. Result's `map(fnName)`, `and_then(fnName)`, and `>>` are restricted positions where the compiler statically specializes names. There are no general higher-order functions or closures. Typed expression macros are compile-time features distinct from runtime functions and follow [Chapter 6](06-composition-and-replay.md#610-syntax-quote-splice의-문법).

`let name = expression;` only names an expression; it creates no memory between ticks. Computation follows an acyclic graph independent of declaration order. Use `state` when memory is needed.

## 2.8 Tick and state snapshot

A tick is a logical unit committing one decision from one input snapshot.

```text
Input snapshot + previous state
  → compute all next states
  → construct complete candidate state
  → compute requested output intent
  → compute safe intent with constraints applied
  → commit successful results together
```

```ghost
control SnapshotPair {
  input swap: Bool;
  state left: Bool = true;
  state right: Bool = false;
  output lamp: Bool;

  left'  = if swap then right else left;
  right' = if swap then left else right;
  lamp <- left';
}
```

`left` and `right` are values from the previous tick. All next-state expressions read the same previous state and inputs, so changing source order leaves results unchanged. Reading another next state within a state transition, as in `right' = left';`, is an error. Next-state references are allowed only in output expressions. `let` cannot reference next state either.

An output connection can read the current tick's candidate state, but unprimed state names still mean previous state. Values made with `<-` are requested intent. Output constraints limit them to safe intent, then state and logical results commit together. An output declaration's omitted initial value or `<-` does not mean a physical safe value at device startup or failure.

An undefined next state retains its previous value. A state cannot have more than one next-state definition. If computation fails during a tick due to a numeric fault or similar failure, candidate state and intent do not partially commit. This logical atomicity does not guarantee simultaneous changes across physical outputs.

The initial value in `state name: Type = value;` must be a constant of the declared type. It is not computed by reading inputs or other state. This explicit starting value creates reproducible previous state for the first tick.

**Design rationale and origin:** In [#149](https://github.com/callin2/ghostflow-language/issues/149),
the user described the React/ObservableHQ influence as evaluating control within an
event stream and explicitly returning the next state. The user's educational premise
was that electricians may find recursive or loop-shaped control difficult to trace.
Writing previous state and candidate next state separately makes the time boundary
visible: `left' = right; right' = left;` reads the previous pair and describes the next
pair. That premise guides readability; it is not a claim about every electrician.
The executable notation is the ASCII apostrophe (`'`). The user's conversational
backtick spelling and the later assistant discussion of general cycle rules,
time travel and causal explanations do not establish additional syntax or features.
The snapshot, transition and output rules above define execution.

### Timers are state too

`timer age = elapsed(phase);` is monotonic elapsed time since the last committed change to `phase`. It resets to 0 when the change commits and is read in subsequent ticks. Its initial value is also 0. For Bool targets, transitions in both true and false directions begin new intervals. A timer is neither `sleep` nor a separate execution thread and does not block processing other inputs.

A stage transition occurs once on the first tick satisfying the condition. One long tick does not pass through several state stages consecutively. The delay is at least the requested duration and may be late by the tick resolution during normal operation.

## 2.9 Physical quantities and units

Ordinary `Number` alone cannot distinguish the physical meanings of `25°C`, `800ppm`, `1.2kPa`, `5L/min`, and `70%RH`. The following names and suffixes are the approved fixed catalog. Suffixes are case-sensitive and attach directly after numeric tokens. The lexer recognizes the longest suffix first.

| Type | Permitted suffixes | Canonical unit |
|---|---|---|
| `Temperature` | `°C`, `K`, `°F` | `K` |
| `TemperatureDelta` | `Δ°C`, `ΔK`, `Δ°F` | `ΔK` |
| `RelativeHumidity` | `%RH` | ratio `0..1` |
| `Pressure` | `Pa`, `kPa`, `bar` | `Pa` |
| `VaporPressureDeficit` | `PaVPD`, `kPaVPD` | `PaVPD` |
| `CO2Concentration` | `ppm` | molar ratio |
| `FlowRate` | `m3/s`, `L/min`, `mL/min` | `m3/s` |
| `Volume` | `m3`, `L`, `mL` | `m3` |
| `Length` | `m`, `cm`, `mm` | `m` |
| `Irradiance` | `W/m2` | `W/m2` |
| `PPFD` | `mol/m2/s`, `umol/m2/s` | `mol/m2/s` |
| `Energy` | `J`, `kJ`, `Wh`, `kWh` | `J` |
| `Power` | `W`, `kW` | `W` |
| `ElectricalCurrent` | `A`, `mA` | `A` |
| `Voltage` | `V`, `mV` | `V` |
| `Conductivity` | `S/m`, `mS/cm`, `uS/cm` | `S/m` |
| `Acidity` | `pH` | `pH` |

`Rate<Q>` is an expression-only type produced by `window_rate` in Chapter 4. Its canonical meaning is change in Q per second; the numerator of `Rate<Temperature>` is `ΔK`, like `TemperatureDelta`. For other permitted linear Q types, the numerator is the canonical difference of the same nominal quantity. Results may be referenced through the `signal` declaration name of `window_rate`. They cannot be created as direct literals, general value bindings, function parameters/results, state, config, input, or output types. Thresholds are created with `rate(delta: difference, time: Duration)`; only rates of the same Q can be compared. The constructor's Q is determined by the other operand of a comparison or an explicit expected `Rate<Q>`. In particular, if `TemperatureDelta` alone does not uniquely determine Q, reject it rather than guessing. v1 `window_rate` Q is one of `Temperature`, `TemperatureDelta`, `Pressure`, `VaporPressureDeficit`, `FlowRate`, `Volume`, `Length`, `Irradiance`, `PPFD`, `Energy`, `Power`, `ElectricalCurrent`, `Voltage`, or `Conductivity`. It does not apply to `Int`, `Number`, `Percent`, `RelativeHumidity`, `CO2Concentration`, or `Acidity`.

```ghost
signal warming = window_rate(temperature, over: 10min,
  quality: measured, max_age: 2min);
output warming_slowly: Bool;
warming_slowly <- warming |> map(below(rate(delta: 1ΔK, time: 1s))) |> recover(false);
```

In this fragment, `temperature` is a Temperature sensor. The comparison's expected type is `Rate<Temperature>`, and the threshold is 1 ΔK/s. `time` must be a positive Duration. Constant 0 is rejected statically; a runtime value of 0 fails the tick with an arithmetic error.

**Why:** Temperature and temperature-difference rates have different control subjects even when both use ΔK/s. Resolving the subject from the expected type and restricting general value storage prevents mixing different rates merely because their units match. Assigning an arbitrary rate to a zero-duration interval would create a control decision unsupported by actual measurement.

`Percent` is a 0..100 value, including position, and differs from `RelativeHumidity`. `Temperature` is absolute temperature; `TemperatureDelta` is a difference. A temperature setting's `step` therefore uses a delta such as `0.5Δ°C`.

```ghost
control ClimateTarget {
  input inside_temperature: Temperature;
  config target_temperature: Temperature = 25°C {
    min = 18°C;
    max = 32°C;
    step = 0.5Δ°C;
    access = operator;
  }
  output heat: Bool;
  heat <- case target_temperature {
    ok(target) => inside_temperature < target;
    fault(reason) => false;
  };
}
```

Decimal literals undergo unit conversion as exact decimal rationals, then one binary64 ties-to-even rounding at the canonical value. Different units of the same physical quantity compare as the same semantic value after conversion. Artifact metadata preserves nominal quantity identity and canonical unit. Display units and locale formatting are UI metadata and do not change control meaning. `Temperature` operating settings must preserve the author's selected `°C` or `K` as separate `displayUnit` metadata. Internal values and comparisons continue to use canonical `K`. Missing or ambiguous metadata is an error; do not infer display units from value magnitude or canonical units or default to `°C`.

Permitted operations are closed to the following.

- Compare values of the same nominal quantity.
- Linear physical quantities support same-type `+`, `-`, and unary `-` and multiplication or division by `Number`. Same-type division produces `Number`.
- `Temperature - Temperature` produces `TemperatureDelta`; `Temperature + TemperatureDelta` and `Temperature - TemperatureDelta` produce `Temperature`. Two absolute temperatures cannot be added.
- `RelativeHumidity` supports same-type comparisons and explicit `RelativeHumidity / RelativeHumidity -> Number`. For example, `60%RH / 100%RH` is `0.6`. Its other arithmetic and implicit numeric conversion remain forbidden. A zero divisor retains the ordinary constant diagnostic or dynamic tick rejection; normalization does not erase sensor quality.
- `CO2Concentration` and `Acidity` support only same-type comparisons.
- `FlowRate * Duration` produces `Volume`; `Volume / Duration` produces `FlowRate`; `Power * Duration` produces `Energy`; `Energy / Duration` produces `Power`; `Voltage * ElectricalCurrent` produces `Power`. Multiplication permits either operand order.
- `VaporPressureDeficit` is a nominal type distinct from `Pressure`, even though its canonical scale matches pressure. Unspecified cross-quantity operations and numeric-type conversions are errors.

PID gains use the bounded constructors in Chapter 4 rather than unrestricted dimensional algebra. Their spellings are `proportional_gain(output: 2%, error: 1Δ°C)`, `integral_gain(output: 0.1%, error: 1Δ°C, time: 1s)`, and `derivative_gain(output: 1%, time: 1s, error: 1Δ°C)`. Bindings must specify quantity and unit. A unitless OCR number is not an authoritative quantity and is not promoted without a user-confirmed binding.

When `moving_average` and `ema` process absolute `Temperature`, they compute an affine weighted mean in canonical K. This is the filter's closed semantics and does not permit source-level `Temperature + Temperature`.

## 2.10 Settled type boundaries

- `Int` is signed 32-bit and uses `div`, `%`, and named conversions.
- `if`, `&&`, and `||` short-circuit from left to right.
- Removed function, enum, next, and qualified-value aliases are rejected with migration diagnostics.
- Only built-in `Result<T, E>` using compiler-owned fault enums and static transforms are provided. There are no general ADTs, user Result error types, function values, or general higher-order functions.
- Physical quantities use only the fixed catalog and closed operations in 2.9.
- General dates and times use Chapter 3's `date`YYYY-MM-DD``, `time`HH:MM[:SS[.f|.ff|.fff]]``, and `datetime`YYYY-MM-DDTHH:MM:SS[.f|.ff|.fff](Z|±HH:MM)`` tagged literals. `DateTime` must have an offset; only `Duration` is used for time offsets.

Spellings, implicit conversions, unit guesses, user constructors, and runtime function selection beyond these boundaries produce diagnostics rather than being inferred as separate language features.
