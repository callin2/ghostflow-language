# Exact integer contract proposal

Tracking: language issue #22 / integration `TASK-85.1` / review R14.

This document is the design input for N2–N4. It does not claim that the parser,
GFB format or VM already implements an integer type. The confirmed product
principle is that counts and repetition totals remain exact within a declared
range; the spelling below remains a reviewable language proposal until R14.

## Confirmed intent and current boundary

- Counts and measurements are different kinds of values. A count is not made
  approximate merely because it came from a sensor.
- Integer values and integer results must remain exact within the supported
  range. Precision loss, wrapping and saturation are never silent.
- Browser/WASM and ESP32 use the same value and fault semantics.
- The current implementation has only `Bool` and `Number`. `Number` is Rust
  `f64`, GFB1 stores each numeric constant/default as an eight-byte `f64`, and
  the JS/WASM boundary exposes it as a JavaScript `number`.
- Current GFB1 arithmetic has add, subtract, multiply and divide. Division by
  zero or a non-finite result rejects the tick before state/intent commit. It
  has no integer type, integer conversion or remainder opcode.
- Date/time, monotonic clock and identifier widths are separate contracts.
  This proposal must not force an epoch timestamp into the integer count type.

## Minimum type recommendation

Add one public scalar type, `Int`, with a fixed signed 32-bit representation:

```text
Int = -2_147_483_648 .. 2_147_483_647
```

`Int` means exactly this range on every host; it is not a platform-sized C/Rust
`int`. Signed storage supports counts, differences and offsets without adding a
second unsigned type. A non-negative domain such as fruit count is expressed by
its declared configuration/state bounds, not by another primitive type.

| Candidate | Benefit | Cost | Decision for the minimum profile |
| --- | --- | --- | --- |
| Keep integer-looking values in `f64` | no format change | type intent remains hidden; exact operations are not enforced | reject |
| `Int` backed by `i32` | native width on the 32-bit target, four-byte literal/default, exactly representable by JS `number` when explicitly converted | finite range; long-lived totals need a declared rollover/fault policy | recommend |
| `Int` backed by `i64` | much larger count range | eight-byte payload, multiword MCU arithmetic, and values beyond JavaScript's exact integer range need a new transport representation | defer until a demonstrated range requires it |
| separate signed and unsigned primitives | wider non-negative range | more mixed-type and conversion rules | reject for the first profile |

Adding an `i32` variant beside `f64` does not by itself prove that every VM
stack slot becomes smaller: enum layout is still dominated by its largest
variant and target alignment. The immediate bounded gains are native-width
integer operations and four-byte binary constants/defaults. N3 must measure the
actual ESP32 build rather than claim a whole-VM RAM saving from payload width.

## Literal and type rules

- A whole decimal numeral has exact integer value. With no expected numeric
  type it defaults to `Int`.
- A whole numeral may be elaborated directly as a `Number` literal when its
  surrounding declaration or operand supplies that expected type. This is
  literal typing, not a runtime `Int` to `Number` coercion.
- A numeral with a decimal point or exponent is `Number`, never `Int`.
- The first implementation need not add digit separators. The range is checked
  from the original digits before conversion through JavaScript `Number`.
- `-2147483648` is accepted as the minimum signed literal. Larger positive
  or negative magnitudes are compile errors.
- N2 must recognize the optional leading minus as part of an integer-literal
  boundary check, or implement an equivalent explicit minimum-literal rule. It
  must not first reject positive `2147483648` and then try to lower unary minus
  as `0 - 2147483648`.
- Variables, inputs, state, results and function values never convert implicitly
  between `Int` and `Number`. Mixed arithmetic and comparison are compile errors.

These rules preserve readable thresholds such as `temperature < 30` when the
left operand supplies expected type `Number`, while an untyped `let count = 30`
is exact `Int`.

Expected type reaches a whole literal only from its immediate typed context:

- a declared config/state/output initializer or output connection;
- a statically typed function parameter;
- the other concrete numeric operand of arithmetic or comparison; and
- an enclosing expected type shared by both `if` branches.

When neither side supplies a type, whole literals default to `Int`; a decimal
literal makes the same numeric expression `Number`. An untyped `let` is fixed
from its initializer and later uses do not back-propagate a different type.
Conflicting contexts are diagnostics, not overload guesses.

## Operations

| Expression | Result | Rule |
| --- | --- | --- |
| `a + b`, `a - b`, `a * b` | `Int` | checked exact `i32`; overflow faults |
| `-a` | `Int` | checked; negating the minimum value faults |
| `a div b` | `Int` | quotient truncates toward zero; zero divisor and minimum value divided by `-1` fault |
| `a % b` | `Int` | remainder has the dividend's sign; zero divisor faults |
| `a / b` for two `Int`s | none | compile error; choose `div` or explicitly convert operands to `Number` |
| `== != < <= > >=` | `Bool` | allowed for two `Int`s |
| any `Int`/`Number` mixture | none | compile error until an explicit conversion is present |

For valid division and remainder, `a == (a div b) * b + (a % b)` holds. Integer
overflow is not converted into `Number`, wrapped or saturated.

## Explicit conversions

The semantic operations are fixed here. `div`, `%` and the following conversion
names are provisional source spellings for R14. Acceptance-vector IDs describe
the semantic operations; N2 substitutes the approved spelling before turning
them into source fixtures.

| Candidate operation | Contract |
| --- | --- |
| `number(i)` | `Int` to `Number`; always exact because every `i32` is exactly representable by `f64` |
| `int_exact(n)` | accepts only an integral in-range `Number`; otherwise faults |
| `int_floor(n)` | mathematical floor, then range check |
| `int_ceil(n)` | mathematical ceiling, then range check |
| `int_trunc(n)` | truncate toward zero, then range check |
| `int_nearest_even(n)` | nearest integer with ties to even, then range check |

There is no generic conversion with a hidden rounding default. Constant invalid
conversions are compile errors; input-dependent invalid conversions are runtime
numeric faults.

## Fault and state semantics

Constant overflow, invalid integer literals and statically invalid conversions
are compile diagnostics. Input-dependent overflow, zero division and invalid
conversion reject the current scan before new state or intents commit. The host
enters its existing execution-fault path and retains the last accepted outcome
as evidence. This language rule does not itself claim that a physical relay has
turned OFF; Driver safe-output handling and physical confirmation remain
separate evidence.

Use distinct stable reasons at the runtime boundary:

- `integer-overflow`
- `integer-division-by-zero`
- `integer-conversion-fractional`
- `integer-conversion-out-of-range`

For the core runtime, a rejected operation leaves the committed tick number,
logical time, state, safe intents and journal unchanged. The framed scan adapter
also clears the rejected candidate inputs and does not advance its accepted scan
ID or logical time. A consumer may retry that identity only if its host policy
allows reuse; the current framed Browser host latches a host-entered execution
fault and requires a fresh instance. Its last accepted outcome remains evidence,
while the current error reports the rejection. N3 must test both the core
transaction and the framed-host recovery boundary.

## Downstream acceptance vectors

N2 owns literal/type/conversion diagnostics, N3 owns runtime operation behavior,
and N4 owns exact binary/host exchange. Each ID is stable even if R14 changes a
surface spelling.

| ID | Input or operation | Expected result | Owner |
| --- | --- | --- | --- |
| N1-LIT-01 | `0`, `2147483647`, `-2147483648` in `Int` context | accepted exact values | N2 |
| N1-LIT-02 | `2147483648`, `-2147483649` | compile range diagnostic | N2 |
| N1-LIT-03 | untyped `30` / `30.0` | `Int(30)` / `Number(30.0)` | N2 |
| N1-TYPE-01 | `Int + Number`, `Int < Number` | compile mixed-type diagnostic | N2 |
| N1-TYPE-02 | two `Int` operands with `/` | compile diagnostic naming `div` or explicit Number conversion | N2 |
| N1-ADD-01 | runtime inputs `MAX + 1`, `MIN - 1` | runtime overflow; no commit | N3 |
| N1-MUL-01 | runtime inputs `46340 * 46340` / `46341 * 46341` | `2147395600` / overflow with no commit | N3 |
| N1-NEG-01 | negate a runtime input holding `MIN` | runtime overflow; no commit | N3 |
| N1-DIV-01 | runtime inputs for `7 div 3`, `-7 div 3`, `7 div -3`, `-7 div -3` | `2`, `-2`, `-2`, `2` | N3 |
| N1-DIV-02 | runtime inputs for `1 div 0`, `MIN div -1` | division-by-zero / overflow; no commit | N3 |
| N1-MOD-01 | runtime inputs for `7 % 3`, `-7 % 3` | `1`, `-1` | N3 |
| N1-CONV-01 | `number(-2147483648)`, `number(2147483647)` | exact corresponding `Number`s | N2/N3 |
| N1-CONV-02 | constants `int_exact(3.0)` / `int_exact(3.5)` | `3` / compile-time fractional diagnostic | N2 |
| N1-CONV-03 | runtime Number inputs `3.0` / `3.5` through exact conversion | `3` / fractional conversion fault with no commit | N3 |
| N1-CONV-04 | floor/ceil/trunc/nearest-even of runtime input `-2.5` | `-3`, `-2`, `-2`, `-2` | N3 |
| N1-GFB-01 | minimum, zero and maximum state defaults | new integer representation round-trips exact bytes on native and WASM | N4 |
| N1-GFB-02 | old GFB1 presented as the new integer-capable format and vice versa | fail closed; never reinterpret `NUMBER_CONST` as `Int` | N4 |
| N1-ABI-01 | minimum/maximum `Int` input and output | exact native/WASM exchange and identical trace values | N4 |

The proposed N4 allocation is intentionally explicit so the vectors can become
byte-level tests:

| Boundary | Integer-capable proposal |
| --- | --- |
| Bytecode envelope | magic `GFB1`, little-endian `u16` format version `2`; version `1` remains immutable |
| Type tag | `3 = Int` (`1 = Bool`, `2 = Number` unchanged) |
| Constant/default | signed little-endian `i32` |
| Opcodes | `23 INT_CONST`, `24 INT_NEG`, `25 INT_ADD`, `26 INT_SUB`, `27 INT_MUL`, `28 INT_DIV`, `29 INT_REM` |
| Conversion opcodes | `30 INT_TO_NUMBER`, `31 NUMBER_TO_INT_EXACT`, `32 ...FLOOR`, `33 ...CEIL`, `34 ...TRUNC`, `35 ...NEAREST_EVEN` |
| Manifest | `GhostFlow/control-v4`, nominal type spelling `Int` |
| Runtime identity | `GhostFlow/runtime-semantics-v2` |
| Framed ABI | `GhostFlow/framed-scan-abi-v2`; input/capability type tag `3`, four little-endian `i32` bytes |
| Package | `GhostFlow/portable-package-v2`; binds bytecode version, manifest and runtime/ABI identities |
| Trace/outcome JSON | JSON number plus manifest-declared `Int`; decoder requires integral `i32` range before exposing it |

The Browser frame encoder selects type tag `3` from the verified manifest, not
from whether a JavaScript number happens to be integral; `Number(3.0)` and
`Int(3)` are distinct. Native and WASM loaders reject unknown format, type or
opcode values before activation. N4 must publish exact minimum/zero/maximum
fixtures and their SHA-256 values; the native and WASM consumers load those same
bytes. It must not reuse version-1 `NUMBER_CONST f64` as an integer encoding.
Existing version-1 packages remain immutable and are rejected when the host does
not explicitly support their declared identities.

Since every `Int` fits the JavaScript safe integer range, JSON-facing adapters
may use JSON numbers only with strict integral/range validation; no lossy parse
is permitted. The numeric tag allocation is a technical compatibility decision;
R14 reviews source spelling rather than byte values.

## R14 review boundary

The technical baseline proposed for implementation is one fixed `Int/i32`,
checked faults, explicit conversion, `div` for integer quotient and `%` for
remainder. R14 needs to review only the human-facing spelling (`Int`, `div`, `%`
and conversion names) using readable examples. It must not reopen the already
confirmed distinction between exact counts and approximate measurements.
