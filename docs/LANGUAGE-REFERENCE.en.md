<!-- translation-source: docs/LANGUAGE-REFERENCE.md -->
[Korean original](LANGUAGE-REFERENCE.md)

# GhostFlow Language Reference

GhostFlow is a reactive control language that describes **changes in state and output intentions for devices** from sensor and user inputs. This reference is the shared ground truth for the language's philosophy, syntax, semantics, type rules, usage constraints, and the rationale for each feature.

For coding examples by behavior, see the [GhostFlow Coding FAQ](language_faq.md).

## Complete contents

| Chapter | Contents |
|---|---|
| [1. Source and syntax](reference/01-source-and-syntax.en.md) | Literate source, code blocks, intent anchor/link, vocabulary, names, scope, declaration structure |
| [2. Types, expressions, and state](reference/02-types-expressions-state.en.md) | Literals, integers, units, operators and precedence, functions and branching, tick, state, output |
| [3. Time and schedules](reference/03-time-and-schedules.en.md) | Clock time and elapsed time, timers, DailySlots, Solar, Cron, Periodic, calendars, natural events, fallback |
| [4. Sensors, constraints, and control](reference/04-sensors-constraints-control.en.md) | Quality, filters, hysteresis, device capabilities and adaptation, shared resources, modes, time budgets, continuous control |
| [5. Settings and observation](reference/05-settings-and-observation.en.md) | Typed settings and automatic input forms, live changes, temporary values, snapshot, event, command, alarm, explanation |
| [6. Composition and replay](reference/06-composition-and-replay.en.md) | Behavior composition, import, instance, port, binding, semantic DAG, syntax extensions, replay, ghost, replacement |
| [7. Semantic preservation rules and index](reference/07-semantic-rules-and-index.en.md) | Distinguishing errors, transformation equivalence, indexes of all notations, symbols, terms, and original documents |
| [8. FAQ requirements and layer responsibilities](reference/08-language-runtime-and-device-boundaries.en.md) | Language, compiler, runtime, environment, Driver, binding, UI responsibilities across the FAQ, lifecycles and required contracts |

Each chapter is part of this document. Read the relevant chapter directly from the contents for a particular feature. Use the [syntax index](reference/07-semantic-rules-and-index.md#75-선언과-표기-찾아보기) to find all notations. See the [Chapter 8 responsibility table](reference/08-language-runtime-and-device-boundaries.md#83-faq-전체-책임표) for what each layer needs to support the FAQ requirements.

## Reading conventions

- **Syntax** explains the notation used in source and its meaning.
- **Design notation** explains concepts from design documents and discussions. Do not arbitrarily mix it with settled notation.
- **Rules** define the meaning of types, scope, evaluation, errors, time, and state.
- **Why** explains why a feature is needed and which language principles it preserves.
- An example **fragment** omits surrounding declarations for explanation. Distinguish it from a complete document example.
- Technical syntax and semantic decisions follow the rules in each chapter. Field operating choices remain explicit arguments and are not filled with hidden policy.

The syntax policy consolidation of 2026-09-22 is a normative decision of this Reference. Where earlier design sketches and notations conflict, follow the precise type, syntax, and evaluation rules in this document. [§8.6](reference/08-language-runtime-and-device-boundaries.md#86-언어-결정과-작성자가-정하는-정책) distinguishes user-selected operating values and external responsibilities.

When documents from different periods conflict, follow the subsequent decision that explicitly changes that scope. For example, operating settings follow the **atomic live event within the same program and the same execution** semantics of [#105](https://github.com/callin2/ghostflow-language/issues/105) and [#110](https://github.com/callin2/ghostflow-language/issues/110). This decision does not also change the meaning of installation mode transitions or arbitrary state writes.

## Design philosophy

### 1. Read intent and rules together

A control program should contain both “what happens under which conditions” and “why it happens.” Even when a condition is readable, losing the reason for choosing it makes the validity of a change difficult to assess. GhostFlow puts explanation and code in the same document and connects intent, premises, and assumptions to declarations and expressions. Unconfirmed assumptions do not become user intent.

**Related features:** literate `.ghost.md`, intent anchor/link, original revisions and provenance, the meaning of explanation graphs and change history.

### 2. Expose the boundaries of inputs, decisions, and effects

The language computes output intentions from inputs. The Driver applies those intentions to the actual environment. Physical device locations and wiring must not be hidden in decision expressions. This boundary allows the same rules to be used for actual operation, explanation, and virtual execution. A true output intention is not confirmation that a physical device moved.

**Related features:** typed input/output, `<-`, requested/safe intent, logical ports and binding, ghost execution without effects.

### 3. Put memory in state and computation in pure functions

Self-holding, accumulated counts, and operating stages require memory. Do not entrust that memory to hidden function-call side effects or statement execution order. Pure functions transform values; `state` holds memory between the previous and next decisions. Feedback must pass through an explicit state boundary.

**Related features:** `state`, next-state expressions, `let`, pure functions, combinational cycle restrictions, explicit delays and state isolation in composition.

### 4. Obtain the same decision under the same execution conditions

Identical inputs, previous state, effective settings, and time conditions must produce identical results. Within one tick, state expressions read the same previous state and commit their results together. Arbitrary statement order or hidden clock reads must not change control results.

**Related features:** input snapshot, atomic state transitions, explicit time, the application point of settings events, replay and branch comparison.

### 5. Preserve the meaning of values through types

Counts, time, moisture percentage, pressure, and true/false are different kinds of values. Do not erase their distinctions merely because they can all be displayed as numbers. Expose the conversions and rounding selected during computation; do not hide precision loss.

**Related features:** `Int`, `Number`, `Duration`, `Percent`, finite enum, explicit integer conversions, physical quantities, units and dimensions, typed settings.

### 6. Time is a relationship between control inputs and state

“Start at 6 a.m.” and “run for 5 minutes” have different meanings. Stop and sensor inputs must still be evaluated while waiting. Distinguish schedule occurrences, continuous elapsed time, accumulated usage, recurring periods, and calendar conditions.

**Related features:** DateTime and monotonic time, elapsed and continuous Bool timers, Pulse, Window, Run, occurrence identity, time budgets and natural-event fallback.

### 7. Do not hide errors or missing information

A missing or failed sensor is not a normal value of 0. Unknown predictions for natural events also do not mean an operating condition is false. Make alternative decisions explicit and preserve the original error, uncertainty, and reason for the choice.

**Related features:** distinguishing Option and Result, `ok`/`fault`, quality preservation, NotReady, Stale, Unknown, explicit fallback, recovery, and decision evidence.

### 8. Make constraints and decision evidence readable

The behavior an individual control wants can differ from what the installation as a whole permits. Copying constraints into multiple expressions makes omissions and inconsistent changes likely. Expose permission conditions and arbitration rules so that blocked requests can be explained.

**Related features:** `require`, `mutex`, common constraints, shared resources and modes, operating time limits, requested/safe distinction and explanation.

### 9. Connect operating adjustment points and screens through the same meaning

An operator-adjustable “5 minutes” is a setting with a name, type, default, range, and access permissions. A screen should receive this meaning and create a time input field. Changing a setting must not become rewriting control rules or arbitrarily changing internal state.

**Related features:** typed config metadata, defaults and effective values, atomic live changes, screen-independent descriptors, settings revision.

### 10. Keep responsibilities and costs traceable through composition

When reusing behavior, it must be possible to identify its origin, its connections, and who uses the same physical resources. Complex compositions must not create nonterminating computation or unlimited hidden work.

**Related features:** import identity, behavior instance, typed logical port, explicit binding, finite contracts, bounded state, time and resources, semantic DAG and intent tracing.

## Perspectives that influenced the design

The [original language design](LANGUAGE.md#1-언어의-방향) connects the following preferences with language choices. This table explains what each perspective contributed; it is not a list of syntax aliases.

| Perspective | What GhostFlow considered important |
|---|---|
| YAML | Declaration hierarchy and readable names, types, and settings |
| Literate CoffeeScript | Reading explanation and executable rules in the same document |
| Functional and function-level composition | Composing pure value transformations and making memory explicit |
| Railway-oriented programming | Handling normal values and errors within the same explicit flow |
| Cycle.js | Input Source, output Intent, and the Driver boundary for actual effects |
| Cypher query | Explicitly selecting meaningful device capabilities |
| Meta Lua | Treating code as data while validating the meaning and boundaries of syntax extensions |
| Observable, marimo, D3.js | Observing values, state, changes, and decisions in connection with code |
| Elm, Rust | Clear error boundaries and predictable execution through type and branch checking |

## Rules for maintaining this reference

When language semantics change, update the relevant chapter's **syntax, rules, examples, and Why** together. When a new requirement is added to the FAQ, connect it to the [Chapter 8 responsibility table and contract boundaries](reference/08-language-runtime-and-device-boundaries.md). Link design rationale to the relevant section and the [original-document index](reference/07-semantic-rules-and-index.md#78-원문에서-reference로-찾아가기). This reference is one document set. Do not split its meaning by creating independently maintained copies in other projects.
