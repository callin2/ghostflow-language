<!-- translation-source: docs/reference/07-semantic-rules-and-index.md -->
[Korean original](07-semantic-rules-and-index.md)

# 7. Semantic preservation rules and syntax index

[Language Reference](../LANGUAGE-REFERENCE.en.md) · [Previous: Composition and replay](06-composition-and-replay.en.md) · [Next: Layer responsibilities](08-language-runtime-and-device-boundaries.en.md)

## 7.1 Purpose of this chapter

Knowing the syntax of one feature differs from preserving the same meaning when several features are combined. This chapter provides language-wide semantic preservation rules and index tables. The table's terms include keywords, settings keys, built-in operations, and design concepts together. The entire list is not a set of reserved words. Each item's syntax and applicable positions follow its linked chapter.

## 7.2 Invalid programs and external failures

**Why.** Treating an incorrect control expression and a failed sensor as the same thing makes it impossible to distinguish programs needing correction from field situations needing a response.

| Category | Example | Meaning in the language |
|---|---|---|
| Name/syntax error | Undefined name, ambiguous declaration, isolated intent link | The rule cannot be uniquely interpreted. |
| Type error | Implicit mixing of Int and Number variables, confusion between Duration and counts | Values with different meanings were treated as the same. |
| Branch/definition error | Missing enum case, duplicate connections to one output | The result is not completely or uniquely defined. |
| State-boundary error | Reading another next state in a next-state expression, combinational cycle | Hidden ordering or infinite dependency was created within one decision. |
| Value computation error | Out-of-range integer operation, division by zero, invalid numeric conversion | No normal result can be produced. Do not partially commit as a successful tick. |
| Sensor fault | Disconnected, Invalid, Stale, NotReady | Input data does not satisfy normal measurement conditions. Handle through explicit error flow. |
| Schedule Unknown | Missing time, location, prediction, or calendar information | No evidence determines whether an occurrence happens. Do not disguise it as False or permission. |
| Known unmet condition | Normal moisture value does not satisfy irrigation conditions | The decision completed normally; the condition result is False. |
| Settings change rejection | Range, increment, or permission violation | Do not apply the whole requested settings event. Preserve existing effective settings. |
| Missing/mismatched observation | No value, snapshot from another source revision or execution | Do not merge it as a normal observation of the current program. |

Do not directly use sensor faults in arithmetic or logic as normal payloads. Expressions choosing substitutes must expose the meaning of the choice. A substitute does not erase the original error or origin. Settings request rejection and control tick computation failure are also different events.

## 7.3 False, absent, and uncertain are different

**Why.** Control permission needs evidence. Negating the absence of a value cannot create permission.

| Value or status | Interpretation |
|---|---|
| `false` | Normal Bool value |
| `0` | Normally represented value of that type |
| Missing optional capability | Installation configuration does not supply that capability |
| sensor fault | Installed sensor cannot be read normally |
| `Unknown(reason)` | Insufficient information for the decision |
| Empty observation list | Program has no internal observation items to expose |

Do not mix Bool computation, quality processing, and presence checks. For example, “no moisture sensor,” “moisture sensor failed,” and “moisture 0%” are three distinct conditions. Do not interpret `!Unknown` as operating permission.

## 7.4 Transformations that preserve meaning

**Why.** If shortening expressions or combining common computations changes control results, the actual meaning differs from the program reviewed by the author.

Even when representation changes, preserve the following together.

1. Input and value types, and the boundary between previous and next state.
2. The meaning of successful state transitions and requested/safe outputs.
3. Error conditions and the meaning that errors prevent a successful decision.
4. The order in which time, schedule occurrences, and settings events affect decisions.
5. Trace relationships to original declarations and explanations.

Even replacing `a * 0` with `0` is not justified by equal values alone. Also assess whether the transformation removes errors observed in the original expression or required dependencies. Static dependency lists are “inputs that may be read,” rather than the paths that actually supported results during execution.

Merging or removing expressions does not remove links to original intent, comments, or source revisions. The transformed representation does not become a new independent canonical source. Rationale: [Language design](../LANGUAGE.md), [Original source and safety observation](../SOURCE-SAFETY-TRACE.md), [#42 decisions on semantic equivalence and original-source preservation](https://github.com/callin2/ghostflow-language/issues/42).

## 7.5 Declaration and notation index

| Notation/concept | Chapter |
|---|---|
| `.ghost.md`, `ghost` fence, comments, paragraphs, multiple code blocks | [1. Source and syntax](01-source-and-syntax.md) |
| `ghostflow:anchor`, `ghostflow:link`, intent/premise/assumption | [1. Source and syntax](01-source-and-syntax.md) |
| `control`, identifiers, scope, name resolution, semicolons | [1. Source and syntax](01-source-and-syntax.md) |
| `input`, `output`, `state`, `config`, `let` | [2. Types, expressions, state](02-types-expressions-state.md), [5. Settings](05-settings-and-observation.md) |
| `fn`, argument/result types, pure functions | [2. Types, expressions, state](02-types-expressions-state.md) |
| `type`, `case`, `in` | [2. Types, expressions, state](02-types-expressions-state.md) |
| `Bool`, `Int`, `Number`, `Percent`, `Duration` | [2. Types, expressions, state](02-types-expressions-state.md) |
| Physical quantities, units, dimensions, display units, control meaning | [2. Types, expressions, state](02-types-expressions-state.md) |
| `if ... then ... else`, evaluation and errors | [2. Types, expressions, state](02-types-expressions-state.md) |
| `x'`, `<-`, tick | [2. Types, expressions, state](02-types-expressions-state.md) |
| `+`, `-`, `*`, `/`, `div`, `%`, comparisons, `!`, `&&`, `\|\|` | [2. Types, expressions, state](02-types-expressions-state.md) |
| `number`, `int_exact`, `int_floor`, `int_ceil`, `int_trunc`, `int_nearest_even` | [2. Types, expressions, state](02-types-expressions-state.md) |
| Function composition, value piping, `>>`, `\|>`, `map`, `and_then`, `recover` | [2. Types, expressions, state](02-types-expressions-state.md), [4. Sensors and control](04-sensors-constraints-control.md) |
| `Date`, `TimeOfDay`, `DateTime`, wall clock, monotonic time, logical time | [3. Time and schedules](03-time-and-schedules.md) |
| `timer`, `elapsed`, phase age, continuous Bool time | [3. Time and schedules](03-time-and-schedules.md) |
| `schedule`, `DailySlots`, `TimeSlots`, `timezone`, `selected`, `.due`, `.missed` | [3. Time and schedules](03-time-and-schedules.md) |
| `Solar`, sunrise, sunset, moon, tides, location/prediction context | [3. Time and schedules](03-time-and-schedules.md) |
| `Schedule`, TriggerRule, DayRule, Pulse, Window, Run, Range | [3. Time and schedules](03-time-and-schedules.md) |
| Cron, Periodic, workdays, holidays, excluded days, DST | [3. Time and schedules](03-time-and-schedules.md) |
| fallback, Unknown, late starts, observation gaps, duplicate occurrences | [3. Time and schedules](03-time-and-schedules.md) |
| `sensor`, `sensor?`, `signal`, `ok`, `fault`, Result/Option | [4. Sensors and control](04-sensors-constraints-control.md) |
| `sample`, `valid`, `filter`, `stale_after`, `recover_after`, `samples` | [4. Sensors and control](04-sensors-constraints-control.md) |
| median, moving average, EMA, hysteresis, on_below, off_above, initial | [4. Sensors and control](04-sensors-constraints-control.md) |
| `adapt`, capability, strategy selection | [4. Sensors and control](04-sensors-constraints-control.md) |
| Device query `match`, `where`, `strategy`, `priority` | [4. Sensors and control](04-sensors-constraints-control.md) |
| `require`, `mutex`, `constraints`, `exclusive`, `allow` | [4. Sensors and control](04-sensors-constraints-control.md) |
| `check`, `limit`, `once ... per occurrence`; `warn` (design, unsupported by parser) | [4. Sensors and control](04-sensors-constraints-control.md) |
| count_on, any_on, shared resources, modes, arbitration | [4. Sensors and control](04-sensors-constraints-control.md) |
| Daily ON-time, rolling-window budget | [4. Sensors and control](04-sensors-constraints-control.md) |
| objective, PI/PID, continuous actuator feedback | [4. Sensors and control](04-sensors-constraints-control.md) |
| temporal evidence, fallback, bounded adaptation | [4. Sensors and control](04-sensors-constraints-control.md) |
| min/max/step, access, label, defaults/effective values | [5. Settings and observation](05-settings-and-observation.md) |
| atomic live setting, settings revision, temporary values, expiry, return | [5. Settings and observation](05-settings-and-observation.md) |
| Observation contract: counter, descriptor, snapshot, event, command result, alarm | [5. Settings and observation](05-settings-and-observation.md) |
| explanation, evaluated/value/supportsResult, provenance | [5. Settings and observation](05-settings-and-observation.md) |
| Behavior composition, import, instance, logical ports, binding | [6. Composition and replay](06-composition-and-replay.md) |
| semantic DAG, explicit delays, state boundaries, execution isolation | [6. Composition and replay](06-composition-and-replay.md) |
| syntax/quote/splice, hygienic syntax extensions | [6. Composition and replay](06-composition-and-replay.md) |
| checkpoint, replay, ghost, branch, program replacement | [6. Composition and replay](06-composition-and-replay.md) |

Permitted positions and required fields follow the linked body sections. Removed aliases follow the rejection rules in §1.6. Do not infer source keywords from general concepts in the index.

## 7.6 Symbol index

| Symbol | Contextual role |
|---|---|
| `{ }` | Scope, function, case, settings block, or finite set in `in` |
| `( )` | Call arguments or expression grouping |
| `[ ]` | Lists permitted by declarations, such as selected schedule times |
| `:` | Type declaration or named argument |
| `;` | Boundary of a declaration or expression definition |
| `,` | Separates multiple names, arguments, set elements |
| `=` | Definition, initial value, settings entry |
| `'` | Next state |
| `<-` | Output connection |
| `->` | Function result type |
| `=>` | Case branch or constraint relation; not an arbitrary operator in general expressions |
| `\|` | Enum alternatives |
| `?` | Optional sensor |
| `.` | Member/namespace reference defined by context |
| `..` | Sensor valid range |
| `_` | Unused fault pattern binding |
| `//` | Single-line code comment |

## 7.7 Terms

| Term | Definition |
|---|---|
| Canonical source | Original document preserving explanation, intent, and executable rules together |
| Program | Program with executable-rule identity |
| Run | Identity of an execution started once and continued for that program |
| Tick / scan | Unit receiving inputs and committing a logical decision. Read the contextual observation boundary together with it. |
| Previous / candidate state | Committed state before a decision / next state computed during this decision |
| Requested / safe intent | Output requested by a control expression / output intent after constraints |
| Setting | Adjustment value whose changeability is declared by the program |
| Occurrence | One identifiable occurrence produced by a schedule rule |
| Provenance | Links showing which original source and intent a value, decision, or explanation came from |
| Logical port / physical binding | Meaningful control connection point / relationship connecting it to an actual installation |
| Semantic DAG | Graph representing control meaning and dependencies. Distinct from a screen-layout graph. |
| Driver | Boundary connecting logical inputs to physical signals and output intentions to actual effects |

## 7.8 From original documents to the reference

This table locates design items. It does not indicate issue status or work progress.

| Design rationale | Reference location |
|---|---|
| [DESIGN-NOTES](../DESIGN-NOTES.md), [LANGUAGE](../LANGUAGE.md) §1–2 | [1.1 Why one document is the source](01-source-and-syntax.md#11-왜-문서-하나가-소스인가), [2.8 Tick and state snapshots](02-types-expressions-state.md#28-tick과-상태-snapshot) |
| LANGUAGE §3–4, [LANGUAGE-SURFACE](../LANGUAGE-SURFACE.md), [Programming in GhostFlow](../ProgrammingInGhostflow.md) §2·5·9·Appendix A/B | [Chapter 1 source and syntax](01-source-and-syntax.md#11-왜-문서-하나가-소스인가), [Chapter 2 types, expressions and state](02-types-expressions-state.md#21-값-종류) |
| [LITERATE](../LITERATE.md), [INTENT-ANCHOR-MAP](../INTENT-ANCHOR-MAP.md), [#31](https://github.com/callin2/ghostflow-language/issues/31), [#60](https://github.com/callin2/ghostflow-language/issues/60) | [1.1 Why one document is the source](01-source-and-syntax.md#11-왜-문서-하나가-소스인가), [1.2 Original source, positions and intent links](01-source-and-syntax.md#12-원문-위치와-의도-연결) |
| [Integer contract](../EXACT-INTEGER-CONTRACT.md), [#22](https://github.com/callin2/ghostflow-language/issues/22), [#93](https://github.com/callin2/ghostflow-language/issues/93) | [2.3 Exact integer design](02-types-expressions-state.md#23-정확한-정수-설계), [2.9 Physical quantities and units](02-types-expressions-state.md#29-물리량과-단위) |
| [Time contract](../TIME-AND-SCHEDULE-CONTRACT.md), [Continuous timers](../CONTINUOUS-BOOL-TIMER-CONTRACT.md), [Solar](../SOLAR-SCHEDULE.md), [#23](https://github.com/callin2/ghostflow-language/issues/23), [#46](https://github.com/callin2/ghostflow-language/issues/46), [#90](https://github.com/callin2/ghostflow-language/issues/90) | [Chapter 3 time and schedules](03-time-and-schedules.md#31-시간값과-시계-영역) |
| [CONSTRAINTS](../CONSTRAINTS.md), LANGUAGE §5–8, [#3](https://github.com/callin2/ghostflow-language/issues/3) | [4.1 Sensors and Result quality](04-sensors-constraints-control.md#41-sensor와-result-품질), [4.7 Requested, safe, applied, confirmed](04-sensors-constraints-control.md#47-requested-safe-applied-confirmed), [4.8 Common constraints syntax and operations](04-sensors-constraints-control.md#48-공통-constraints-표기와-연산) |
| [#94](https://github.com/callin2/ghostflow-language/issues/94), [#95](https://github.com/callin2/ghostflow-language/issues/95), [#96](https://github.com/callin2/ghostflow-language/issues/96) | [4.11 Accounting and budgets](04-sensors-constraints-control.md#411-accounting과-budget), [4.12 Continuous control objective](04-sensors-constraints-control.md#412-continuous-control-objective), [4.14 Bounded adaptation](04-sensors-constraints-control.md#414-bounded-adaptation) |
| [#68](https://github.com/callin2/ghostflow-language/issues/68), [#70](https://github.com/callin2/ghostflow-language/issues/70), [#73](https://github.com/callin2/ghostflow-language/issues/73), [#74](https://github.com/callin2/ghostflow-language/issues/74), [#88](https://github.com/callin2/ghostflow-language/issues/88), [interaction contract](../../contracts/interaction-v0/README.md) | [5.1 `config` declarations](05-settings-and-observation.md#51-config-선언), [5.3 Renderer-independent observation model](05-settings-and-observation.md#53-renderer-독립-관찰-모델), [5.4 Identity and physical-fact boundaries](05-settings-and-observation.md#54-정체성과-물리적-사실의-경계) |
| [#89](https://github.com/callin2/ghostflow-language/issues/89), [#105](https://github.com/callin2/ghostflow-language/issues/105), [#110](https://github.com/callin2/ghostflow-language/issues/110) | [5.2 Source changes and operational settings changes](05-settings-and-observation.md#52-소스-변경과-운영-설정-변경) |
| [#99](https://github.com/callin2/ghostflow-language/issues/99) and linked #100–108 design records | [6.1 One semantic model and multiple graphs](06-composition-and-replay.md#61-하나의-의미-모델과-여러-그래프), [6.3 Parameters, settings, dependencies and bindings](06-composition-and-replay.md#63-parameters-settings-dependencies와-bindings), [5.2 Source changes and operational settings changes](05-settings-and-observation.md#52-소스-변경과-운영-설정-변경) |
| LANGUAGE §9–12, [Syntax extensions in the syntax comparison](../LANGUAGE-EXAMPLES.md), Programming in GhostFlow §10–12 | [1.6 Canonical notation, reference aliases and historical alternatives](01-source-and-syntax.md#16-대표-표기-참고-별칭과-역사적-대안), [6.8 Replay, ghost and branches](06-composition-and-replay.md#68-replay-ghost와-branch), [6.10 Syntax, quote and splice syntax](06-composition-and-replay.md#610-syntax-quote-splice의-문법) |
| [SOURCE-SAFETY-TRACE](../SOURCE-SAFETY-TRACE.md), [#42](https://github.com/callin2/ghostflow-language/issues/42) | [5.3 Renderer-independent observation model](05-settings-and-observation.md#53-renderer-독립-관찰-모델), [7.4 Transformations that preserve meaning](07-semantic-rules-and-index.md#74-의미가-유지되는-변환) |
| [Coding FAQ 1–41](../language_faq.md) | [Chapter 8 complete responsibility table](08-language-runtime-and-device-boundaries.md#83-faq-전체-책임표), [Language decisions and author policies](08-language-runtime-and-device-boundaries.md#86-언어-결정과-작성자가-정하는-정책) |

When adding a new language decision, update the feature's body, Why, examples, and this index together.

[Complete contents](../LANGUAGE-REFERENCE.md) · [Next: Layer responsibilities](08-language-runtime-and-device-boundaries.md)
