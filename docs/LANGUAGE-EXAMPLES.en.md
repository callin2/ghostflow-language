<!-- translation-source: docs/LANGUAGE-EXAMPLES.md -->
[Korean original](LANGUAGE-EXAMPLES.md)

# GhostFlow syntax alternatives: three versions of the same watering program

2026-09-05 · For design comparison. The code below proposes new syntax and cannot run with the current `ghostc`.
This document records the initial A/B/C comparison.
The syntax and literate format selected in subsequent discussion are in [control syntax](LANGUAGE-SURFACE.md) and [LITERATE.md](LITERATE.md).
The running MVP example is [irrigation.ghost.md](../examples/irrigation.ghost.md).
Common semantics follow the [language specification](LANGUAGE.md); the reasoning behind stylistic preferences is in the [design notes](DESIGN-NOTES.md).

## Behavior being compared

The three programs express the following behavior with the same inputs, state, strategies, and outputs.

1. A start input begins watering. Previous state latches it even when the start input goes low.
2. Stop takes priority if stop or low-water is true. A low-water sensor error also blocks watering.
3. A configuration without a moisture sensor selects `basic`.
4. A configuration with a moisture sensor selects `moisture_aware`. It starts and continues only below 35. It stops at 35 or above, or on a sensor error.
5. The same watering intent is emitted to the valve and pump, with `pump requires valve` applied.

`start` and `stop` are bool samples each tick, not edge events.
`low_water` is a common mandatory sensor. The `moisture` input is declared only within the enhanced strategy.
A configuration without a moisture sensor does not need a fabricated moisture value.

The 35 in this example is a threshold for a driver-normalized moisture index.
Physical-unit types are a separate extension.
The existing MVP example allows the start signal to bypass the moisture threshold. The new comparison examples deliberately apply the threshold even when starting.

## Alternative A — YAML-centered declarative syntax

Declarations are laid out with a short expression in each field. Device queries are block strings.

```yaml
module: irrigation
version: 1

input:
  start: bool
  stop: bool
  low_water: Result<bool, SensorFault>

state:
  watering: {type: bool, initial: false}

functions:
  latch: (start, stop, held) -> not stop and (start or held)
  is_dry: map(below(35)) >> recover(false)

strategies:
  basic:
    priority: 0
    device: |
      match (pump:actuator<bool>), (valve:actuator<bool>),
            (low_water:sensor<bool>)
    let:
      blocked: input.stop or (input.low_water |> recover(true))
    next:
      watering: latch(input.start, blocked, state.watering)
    intent:
      valve: next.watering
      pump: next.watering

  moisture_aware:
    priority: 10
    device: |
      match (pump:actuator<bool>), (valve:actuator<bool>),
            (low_water:sensor<bool>), (moisture:sensor<number>)
    input:
      moisture: Result<number, SensorFault>
    let:
      blocked: input.stop or (input.low_water |> recover(true))
      dry: input.moisture |> is_dry
    next:
      watering: dry and latch(input.start, blocked, state.watering)
    intent:
      valve: next.watering
      pump: next.watering

safety:
  requires:
    - [pump, valve]
```

After YAML is read, the values of `functions`, `let`, `next`, and `intent` are parsed as GhostFlow expressions.
There is no arbitrary code execution. `state.initial` is a literal matching its type.

This is convenient for editing device lists and settings, or round-tripping with a form UI.
Longer logic, however, looks like a nested configuration document, and error locations from both YAML parsing and expression parsing must be displayed together.
Matching data shapes alone do not make code and data semantically equivalent; the common type graph connects them.

## Alternative B — Literate CoffeeScript-centered flow syntax

Code follows explanation. An editor can attach current values and timelines below that code.
The proposal treats the entire outer Markdown below as one document-form source.

````markdown
# 관수

시작하면 자기유지한다. 정지·저수위·저수위 센서 오류는 시작보다 우선한다.

```ghost
module irrigation
version 1

input
  start: bool
  stop: bool
  low_water: Result<bool, SensorFault>

state
  watering: bool = false

latch = (start, stop, held) -> not stop and (start or held)
is_dry = map(below(35)) >> recover(false)
```

수분 센서가 없으면 시작·정지와 저수위 보호로 운전한다.

```ghost
strategy basic priority 0
  device
    match (pump:actuator<bool>), (valve:actuator<bool>),
          (low_water:sensor<bool>)

  let
    blocked = input.stop or (input.low_water |> recover(true))

  next
    watering = latch(input.start, blocked, state.watering)

  intent
    valve = next.watering
    pump = next.watering
```

수분 센서가 있으면 같은 의도를 수분 조건으로 강화한다.

```ghost
strategy moisture_aware priority 10
  device
    match (pump:actuator<bool>), (valve:actuator<bool>),
          (low_water:sensor<bool>), (moisture:sensor<number>)

  input
    moisture: Result<number, SensorFault>

  let
    blocked = input.stop or (input.low_water |> recover(true))
    dry = input.moisture |> is_dry

  next
    watering = dry and latch(input.start, blocked, state.watering)

  intent
    valve = next.watering
    pump = next.watering
```

출력 의도에는 다음 공통 제약을 적용한다.

```ghost
safety
  pump requires valve
```
````

Ordinary source uses the same code without explanations and fences.
Function composition and intermediate signals are directly visible, making it convenient to connect code, explanation, and execution results.
YAML-style `name: type` declarations and Cypher-style `match` are included in this syntax.

The syntax takes inspiration from CoffeeScript but follows GhostFlow's type and tick rules.
Call parentheses are retained and indentation rules are fixed, so expression boundaries are clear.
Document-form source requires a source map linking back to the original Markdown.

## Alternative C — Cypher-centered query syntax

Each strategy reads as clauses: `match → where → with → next → emit`.
Device conditions, intermediate computations, state transitions, and outputs appear in sequence.

```ghost
module irrigation version 1

input start: bool, stop: bool, low_water: Result<bool, SensorFault>
state watering: bool = false

let latch = (start, stop, held) -> not stop and (start or held)
let is_dry = map(below(35)) >> recover(false)

strategy basic priority 0
match (pump:actuator<bool>), (valve:actuator<bool>),
      (low_water:sensor<bool>)
with input.stop or (input.low_water |> recover(true)) as blocked
next watering = latch(input.start, blocked, state.watering)
emit valve = next.watering, pump = next.watering
end

strategy moisture_aware priority 10
match (pump:actuator<bool>), (valve:actuator<bool>),
      (low_water:sensor<bool>), (moisture:sensor)
where moisture.type is number
input moisture: Result<number, SensorFault>
with input.stop or (input.low_water |> recover(true)) as blocked,
     input.moisture |> is_dry as dry
next watering = dry and latch(input.start, blocked, state.watering)
emit valve = next.watering, pump = next.watering
end

safety
  requires pump, valve
end
```

`where moisture.type is number` spells out the type condition of `(moisture:sensor<number>)`.
Here `where` checks a device profile, not the sensor's current value.
`with` is a pure computation for one tick; `next` defines next state; `emit` corresponds to `intent` in the other alternatives.
`end` closes strategy and safety blocks.

This code does not execute directly in Cypher or Lua, and is not a database query updating multiple rows.
This draft's `match` checks the presence of named capabilities.

This is easy to read around device queries and graphs.
When composing long transition expressions, however, more clauses are needed, and readers must understand that device selection and per-tick computation run at different times.

## Where does Meta Lua syntax extension fit?

All three alternatives lower an AST into a common type graph, so syntax extension need not belong exclusively to one alternative.
The following is a separate extension sketch using alternative B notation.
The complete examples above use the ordinary `latch` function and do not require this extension.

```ghost
syntax hold(start: Expr<bool>, stop: Expr<bool>, held: Expr<bool>)
  quote
    not $(stop) and ($(start) or $(held))

# strategy 안의 next 블록에서 사용
next
  watering = @hold(input.start, blocked, state.watering)
```

`quote` constructs syntax and `$(...)` inserts supplied syntax. `@hold(...)` expands at compile time.
This notation is a GhostFlow proposal; it does not replicate Metalua's original syntax.
The preceding function suffices for simple reuse. Macros are used when generating new domain notation or structure.

Expansion finishes in the host compiler and must pass type, cycle, and resource validation again.
Generated names do not capture caller names. The compiler displays original and expanded code together.
No parser is loaded onto the runtime and no dynamic `eval` is executed.

## Behavior comparison criteria

The following expectations are specification scenarios for all of A/B/C.
They are not yet results verified by executing each syntax parser.
Below, `L` is the low-water input and `M` is the moisture input.
Each row is independent and explicitly injects `previous state`.
`—` means that field is absent from the basic strategy's input schema.

| Strategy | Previous state | start | stop | L | M | next.watering | valve / pump intent |
|---|---|---|---|---|---|---|---|
| basic | false | true | false | Ok(false) | — | true | true / true |
| basic | true | false | false | Ok(false) | — | true | true / true |
| basic | true | true | true | Ok(false) | — | false | false / false |
| basic | true | false | false | Ok(true) | — | false | false / false |
| basic | true | false | false | Err(Disconnected) | — | false | false / false |
| moisture_aware | false | true | false | Ok(false) | Ok(20) | true | true / true |
| moisture_aware | true | false | false | Ok(false) | Ok(20) | true | true / true |
| moisture_aware | true | true | false | Ok(false) | Ok(35) | false | false / false |
| moisture_aware | true | false | false | Ok(false) | Err(Stale) | false | false / false |
| moisture_aware | false | false | false | Ok(false) | Ok(20) | false | false / false |

An `Err` input remains recorded as a fault in the journal even after a recovery value is used.
If start is false after a sensor error releases watering, sensor recovery does not automatically restore the latched state.
If start stays true, watering can restart when conditions recover.
Requiring a fresh button press to restart needs a separate edge/rearming policy.

The basic device profile provides pump, valve, and low_water.
Adding moisture makes both strategies match, but selects the strategy with priority 10.
Missing mandatory low_water is an activation error.
If moisture fails while the enhanced strategy runs, its Err input stops operation. Replacement by the basic strategy follows a separate profile-change procedure.

The watering example always has equal outputs, so `requires` does not intervene.
An independent verification condition for the constraint itself is that a `pump=true, valve=false` request makes pump false.
Interlock comparison uses a separate `mutex forward, reverse` constraint; when both requests are true, both final outputs must be false.
A valve-open command does not prove actual opening.
Devices requiring actual feedback need separate inputs and constraints.

## Selection proposal

| Comparison | A: YAML declarative | B: Literate flow | C: Cypher query |
|---|---|---|---|
| What appears first | Configuration and fields | Explanation and computation flow | Device conditions and execution clauses |
| Function composition | Inside expression strings | At the center of code | Inside with expressions |
| Visual editing connection | Suited to forms/configuration editing | Suited to notebooks/timelines | Suited to device graphs |
| Reading burden | Deep nesting | Indentation and document boundaries | Clause roles and execution timing |
| Recommended use | Declarations and interchange format | Default authoring syntax | Device-selection expressions |

The initial recommendation was to use B as the default, incorporating A's declaration style and C's device queries.
Meta Lua code extension belongs in the common compilation layer.
There was no decision to implement all three parsers as products.
Subsequently, control syntax centered on expressions and output connections was selected as the basic direction. This comparison is retained as design history.
