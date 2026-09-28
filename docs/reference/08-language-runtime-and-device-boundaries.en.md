<!-- translation-source: docs/reference/08-language-runtime-and-device-boundaries.md -->
[Korean original](08-language-runtime-and-device-boundaries.md)

# 8. FAQ requirements and language, execution, and device responsibilities

[Complete contents](../LANGUAGE-REFERENCE.en.md) · [Previous: Semantic preservation rules and index](07-semantic-rules-and-index.en.md)

This chapter classifies requirements from the [Coding FAQ](../language_faq.md) by what the language, tools, runtime, execution environment, Driver, installation connections, and UI must each own. It does not define implementation progress or code placement in particular repositories. Feature syntax and semantics follow linked Reference sections. Where notation differs from earlier design sketches, use the notation settled in this Reference.

## 8.1 Classification principle: meaning and execution means

**The language defines what a program means; the runtime makes decisions according to that meaning.** Drivers and execution environments supply the facts and time needed for decisions and apply output effects. Whether an operation runs inside a VM or is computed in a host adapter is separate from ownership of its meaning.

For example, “start once every day at local time 6 a.m.” is language schedule semantics. Where clocks and time-zone data come from belongs to the execution environment. Even when adapters supply schedule occurrences, deduplication, missed observations, and DST policies follow the same language contract. Screens and Drivers do not reinterpret starting conditions through separate rules.

FAQ fragments such as `input is_holiday: Bool` and `input used: Duration` show **how to consume values**. Declarations alone do not create holiday calculators or accumulated records. Full support requires input-producer contracts covering meaning, validity, time, and recovery.

User-selected policies are also distinguished. Which device moves after cancellation, whether cleaning happens once daily, and whether operating-duration changes affect ongoing work are choices of the authored program. These cases do not each require new keywords or built-in control modes.

**Why:** Adding syntax does not automatically provide clocks or physical feedback. Conversely, even if a Driver can read values, coherent control cannot be explained without program semantics for time, errors, and state.

## 8.2 Layer responsibilities

| Layer | Required responsibilities | Boundary with other layers |
|---|---|---|
| Language specification | Meaning of types, state transitions, time, errors, settings, output intentions; resource bounds and failure rules | Do not turn device addresses, UI appearance, or storage media into control syntax. |
| Compiler/tools | Interpret canonical documents; check types, names, branches; transform to executable representations; preserve declaration, intent, and settings descriptions | Static type checks alone do not prove physical wiring or actual operation. |
| Control runtime | Evaluate state, expressions, timers, constraints from input snapshots and commit results atomically; retain execution positions of settings events and observations | Do not arbitrarily add program policy or treat outputs as physical confirmation. |
| Execution environment/data providers | Clocks and trust, date/natural-event data, execution lifetimes, persistence/restoration of settings, checkpoints, installation records | Expose supplied data revisions, scope, validity, and failures. Do not create a separate control language. |
| Driver | Device communication, raw-signal interpretation/normalization, sample identity/time/quality, output application results, physical outputs at boot/failure | Do not hide control sequences, interlocks, or date policies outside source. |
| Installation profile/binding | Logical-role to actual-endpoint connections, compatibility such as capability/polarity/range, installation revision | Distinguish connection-only changes from source-rule changes. |
| UI/renderer | Edit/display using described types, labels, ranges, permissions; submit typed requests; display results and errors | Do not regenerate control meaning through separate timers, aggregation, or constraint decisions. |

Here, **execution environment (host) means the device or process that executes the control program**. It does not require an Android gateway or cloud. A device with necessary clocks and valid data locally can fulfill the contract without Internet access. Network disconnection, data expiry, and unknown time are distinct states.

Rationale: [§1.1 Canonical source](01-source-and-syntax.md#11-왜-문서-하나가-소스인가), [§2.8 Execution semantics](02-types-expressions-state.md#28-tick과-상태-snapshot), [§4.2 Input contracts](04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서), [§5.3 Observation model](05-settings-and-observation.md#53-renderer-독립-관찰-모델), [§6.2 Logical connections](06-composition-and-replay.md#62-definition-instance와-논리-port).

## 8.3 Complete FAQ responsibility table

This table assigns FAQ 1–41 to rows. “Required” means contractual responsibility, rather than implementation status. Shared Driver/UI responsibilities follow §8.2; each row lists external responsibilities important to that requirement.

| FAQ and requirement | Language/compiler requirements | Runtime requirements | Execution environment/Driver/installation/UI requirements |
|---|---|---|---|
| [1](../language_faq.md#q01), [41](../language_faq.md#q41) Canonical document/compiler tools | Literate interpretation, preservation and validation of source/intent locations (§1) | Execute identified Program | Tools retain and deliver complete documents/revisions; distinguish compile checking from physical behavior verification |
| [2](../language_faq.md#q02), [3](../language_faq.md#q03), [18](../language_faq.md#q18) Buttons/self-holding | Bool, previous/next state (§2.8) | Evaluate and commit authored restart conditions from snapshots | Driver supplies pressed meaning; connect actual buttons or explicit software inputs |
| [4](../language_faq.md#q04)–[6](../language_faq.md#q06) Timed operation/delays | Duration, per-state elapsed (§3.2) | Monotonic time and timer state | Execution environment supplies monotonic time and decision opportunities |
| [8](../language_faq.md#q08), [19](../language_faq.md#q19) Sequential/post-cancellation behavior | enum/case and per-state output expressions (§2.4, §2.8) | Per-tick state transitions following authored sequence/cancellation priority | Driver supplies stop/home feedback; subsequent actions are program policy |
| [9](../language_faq.md#q09), [10](../language_faq.md#q10) Sensor conditions/tank control | Result, thresholds, filters, hysteresis, state (§4.1–4.3) | Identify new samples; evaluate freshness, recovery, filter state | Driver supplies values, units, sample times, quality |
| [11](../language_faq.md#q11) Counts | Exact integers, previous input state, conditions (§2.3, §2.8) | Preserve authored edge, limit, initialization expressions and integer-error semantics | Input producer supplies observable events; do not count a long pulse's ticks as event count |
| [13](../language_faq.md#q13) Alarm holding | Bool state/conditions; public alarm meaning is separate (§5.3) | Evaluate authored latch/reset expressions; preserve raise/clear meaning of explicit alarms | UI displays alarm state; notification/record media are external choices |
| [14](../language_faq.md#q14), [17](../language_faq.md#q17) Interlocks | require/mutual exclusion, distinction between state and output restriction (§4.7) | requested→safe decisions | Driver/installation own actual effects and feedback; logical constraints are not physical emergency-stop devices |
| [16](../language_faq.md#q16) Computational reuse | Pure functions, types, name scopes (§2.7) | Same computation for the same inputs | Do not put device access or hidden state in pure functions |
| [7](../language_faq.md#q07), [15](../language_faq.md#q15), [20](../language_faq.md#q20) Clock-time/sunrise schedules | DailySlots/Solar, offsets, separation of occurrence and operation (§3.5–3.9) | Contractual occurrence handling/deduplication and operating timers | Supply clocks, location, time zones, natural-event data; preserve occurrence records |
| [21](../language_faq.md#q21), [27](../language_faq.md#q27)–[29](../language_faq.md#q29) Weekdays/holidays/DST | Date filters/conditions, gap/fold and Unknown semantics (§3.8) | Apply the same date decisions and admission policies | Supply calendar/time-zone data, revisions, coverage; display selectable settings in UI |
| [30](../language_faq.md#q30), [31](../language_faq.md#q31) Tides/moon | Type distinction between timed events and interval conditions, offsets/fallback (§3.9) | Preserve event IDs, revisions, omissions, ongoing-operation semantics | Prediction provider supplies station/model, revision, coverage, expiry, stable event IDs |
| [22](../language_faq.md#q22), [23](../language_faq.md#q23) Accumulated duration/daily cleaning | Aggregation subject/period, exact counts, state/enum (§3.4, §3.10) | Evaluate authored cleaning conditions/sequences with valid aggregation snapshots | Environment updates, stores, restores ledger using common installation identity and applied/confirmed evidence; author policies in §8.6 |
| [12](../language_faq.md#q12), [24](../language_faq.md#q24), [26](../language_faq.md#q26) Duration/range changes | config type/default/min/max/step/access and descriptor (§5.1–5.2) | Whole-request validation/atomic live application; preserve state/timers | UI submits typed requests; execution boundary checks permission; environment persists ordinary settings |
| [25](../language_faq.md#q25) Labels/input UI | label and semantic metadata (§5.1, §5.3) | Supply effective values, revisions, rejection outcomes | Renderer selects time fields, lists, sliders; same validation on all paths |
| [32](../language_faq.md#q32) Power-outage recovery | Initial values, state transitions, execution identity (§2.8, §5.2) | New run; specified initialization/restoration and authored resume-condition evaluation | Environment supplies checkpoints/restart causes; Driver manages outputs before first decision |
| [33](../language_faq.md#q33)–[36](../language_faq.md#q36) Sensor replacement/lifecycle/specification | Logical device contracts; retain Program on compatible replacement (§6.2–6.3) | Evaluate contract-compliant inputs through the same rules | Manage Driver changes, installation binding revisions, compatibility; 36 is rationale for principles, not new syntax |
| [37](../language_faq.md#q37)–[40](../language_faq.md#q40) GPIO/relays/expanded I/O | Logical ports independent of device locations (§6.2–6.3) | Preserve input/safe output contracts | Driver handles buses, addresses, channels, polarity, failures; binding selects actual endpoints |

Range notation includes all FAQs in the interval. For example, 27–29 means 27, 28, and 29. Related chapters: [2](02-types-expressions-state.md), [3](03-time-and-schedules.md), [4](04-sensors-constraints-control.md), [5](05-settings-and-observation.md), [6](06-composition-and-replay.md).

## 8.4 Boundaries each feature must preserve

### Ordinary control composition and built-in features

Self-holding, tank filling, and stage-specific cancellation are compositions of existing state, Bool, enum, and case. The runtime provides state-transition semantics; the author chooses restart, cancellation, and completion policies. Do not hide separate self-holding or cancellation sequences in Drivers. The FAQ's Bool alarm latch also does not automatically become an alarm record or external notification service. FAQ 11's `done` is a Bool value held after reaching 3 occurrences, rather than a one-shot completion pulse. Stopping the count at 3 also comes from that example's condition expression, rather than saturation rules of Int arithmetic itself. Edge counters count input changes observed by the runtime. Counting physical pulses that arise and disappear between decisions requires a Driver/input-producer capture and delivery contract. Exact integer types alone do not guarantee lossless observation of physical events.

**Why:** Special instructions for each application would require maintaining the same state transitions under several meanings. Rationale: [§2.8](02-types-expressions-state.md#28-tick과-상태-snapshot), [§5.3 Events and alarms](05-settings-and-observation.md#event-command-result와-alarm).

### Time decisions and data provision

The language distinguishes monotonic time and local dates and defines DST, fallback, and occurrence identity. Execution environments supply trusted time, calendars, and predictions. Even if some schedule computation is placed in adapters, identical data, times, and records must produce identical results. Do not reduce generated inputs to arbitrary Bool pulses that lose their causes and revisions.

**Why:** Changing how clocks are obtained must not change the meaning of duplicate execution, omissions, or operating durations. Rationale: [§3.1](03-time-and-schedules.md#31-시간값과-시계-영역), [§3.5](03-time-and-schedules.md#35-schedule의-공통-의미), [§3.9](03-time-and-schedules.md#39-solar-달과-조석).

### Accumulated usage and persistent storage

Language contracts specify what is counted (requested/safe/applied/confirmed), scope and date boundaries, initialization, and unknown status. Internal control edge counters can be computed with ordinary state. Persistent installation ledgers spanning controls and modes are updated, stored, and restored by execution-environment providers using stable installation identity and Driver application/confirmation evidence; they supply identified aggregation snapshots to the control runtime. Pure aggregation computation inside providers also follows the same language contract; storage media do not change aggregation meaning. One device's usage differs from adding its automatic and manual control requests. Do not substitute accumulated screen-on time for installation usage.

**Why:** Temporary execution memory and installation records that must survive restart have different lifetimes. Rationale: [§3.4](03-time-and-schedules.md#34-누적-시간과-rolling-budget), [§3.10](03-time-and-schedules.md#310-시간-기반-사용량-제약).

### Settings, validation, and screens

The language declares types, permitted ranges, increments, permissions, and labels; tools preserve these descriptions. Execution boundaries validate entire requests, and runtimes atomically apply approved values within the same Program/run. UI prevalidation alone is not approval; apply the same conditions even when components change. The program's control expressions determine whether ongoing work reads new durations or remembers values at startup.

**Why:** Changing a time input field into a slider must retain permitted values and execution results. Rationale: [§5.1](05-settings-and-observation.md#51-config-선언), [§5.2](05-settings-and-observation.md#52-소스-변경과-운영-설정-변경).

### Device independence and actual effects

Compiled Programs use logical roles. Direct GPIO, expanded channels, and RS485 device addresses belong to installation bindings and Drivers. Compatible replacements alone do not require source edits or recompilation. Adding logical ports or new control behavior is a source change. Atomic logical-result commitment, bus command application, and actual contact/mechanical operation confirmation are different facts.

**Why:** Abstracting device access does not eliminate physical delays or failures. Rationale: [§4.7](04-sensors-constraints-control.md#47-requested-safe-applied-confirmed), [§6.3 Compatible replacement](06-composition-and-replay.md#호환-장치-교체와-재컴파일-독립성).

## 8.5 Change and restart lifecycles

| Change or data | Owner of meaning | Revision/execution/persistence boundary |
|---|---|---|
| Control expressions, sensor filters, stale_after, source defaults | Language and canonical source | New source revision; new Program candidate when executable rules change |
| Effective operator config values | Language live settings contract | Same Program/run, new settings revision; ordinary settings survive actual restart |
| Compatible sensor/GPIO/relay/bus channel connections | Installation binding and Driver | Relevant installation/Driver revision changes; reuse same Program without guaranteeing uninterrupted operation/same run |
| Internal state/timer/filter memory | Language execution semantics | Updated during execution; restart restoration requires explicit policy and checkpoint contract |
| Schedule deduplication records/installation usage | Language installation-record contract and execution environment | Lifetime independent of ordinary state initialization/source replacement; no initialization without a contract |
| Calendar/tide prediction data | Provider and consuming temporal contract | Retain data revisions, coverage, expiry, and event identity |
| Label declarations / component appearance | Source metadata / renderer | Label source edits change document revisions; screen appearance does not change control meaning |

This distinction does not determine file counts. Independently of `.ghost.md` being canonical source, installation information, settings overrides, and execution-record storage formats belong to the environment. Do not treat firmware updates, Driver updates, Program replacement, and settings changes as the same kind of update.

Sensors, filters, and freshness initialize by default after reboot and prepare again from `NotReady`. Persistent resumption of sensor state is an explicit choice verifying source/time continuity. An ordinary checkpoint alone does not justify restoring old normal values or filter continuity.

Rationale: [§4.2 Sensor recovery](04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서), [§5.2](05-settings-and-observation.md#52-소스-변경과-운영-설정-변경), [§5.4](05-settings-and-observation.md#54-정체성과-물리적-사실의-경계), [§6.3](06-composition-and-replay.md#63-parameters-settings-dependencies와-bindings).

## 8.6 Language decisions and author-selected policies

The language defines types, syntax, evaluation, and time boundaries. Actual values of the operating policies below are chosen by program authors or installation operators. Reject declarations omitting required policy values; UI or runtime must not invent automatic operating policy on behalf of users.

| Target FAQ | Settled language contract | Author or execution environment supplies |
|---|---|---|
| 11, 23 Exact counts | §2.3 Int, explicit conversions, error rules | What counts as one occurrence, whether cleaning is included, every N occurrences or once daily |
| 21, 27–29 Weekdays/holidays/DST | §3.8 Date/calendar/gap/fold contracts | Site time zone, calendar and revision, operating choices for repeated/missing times |
| 24 Operating durations/schedule times | Duration config and §3 typed slot settings are different types; both are atomic live events | Settings to expose, ranges, actual operating durations/schedule times |
| 30–31 Tides/moon | §3.9 Events, periods, fallback, occurrence identity | Prediction locations/data, spring/neap tide classification, permitted actions without data |
| 22 Accumulated duration | §3.4/§3.10 Scope, aggregation, boundaries, persistent records | Evidence basis such as applied or confirmed, limits/unknown-interval handling, storage media |
| 23 Daily counts/cleaning | Compose exact counts, date boundaries, stages, request memory | Cleaning sequence/devices/interruption conditions/completion criteria |
| 32 Resumption after power outage | §5.2 New run, initialization, cause input, explicit checkpoint restoration | Automatic resumption or waiting for a new start, permitted restoration scope, physical boot outputs |
| 33 Temperature sensors | §2.9 Physical-quantity types/units and §4 Result | Contract-compliant devices/Drivers and actual installation evidence |
| 34–40 Connections/replacement | §6.2–6.4 Logical ports, external bindings, recompilation independence | Installation storage format, actual pins/addresses, Driver deployment methods |

The operating choices in this table are not unresolved language-design decisions. Fixing one global answer would change intent across different installations, so they remain explicit source/installation-contract arguments. Storage media, UI components, and communication protocols are also not prerequisites for deciding language syntax.

### Items that do not substitute for user judgment

- Whether to restart after power outages, faults, or cancellation, and which devices actually move.
- Operating durations, counts, cleaning conditions, time zones, calendars, natural-event data, and alternative actions.
- Permitted sensor quality, maximum age, estimation tolerance, and physical feedback criteria.
- Shared-resource waiting/preemption/permissions, PI/PID targets/gains/output limits/failure behavior.
- Temporary setting values/lifetimes and automatic correction ranges/rates/approval permissions.

Confirm user intent when writing programs needing these values. It is unnecessary to choose site-specific values collectively now to define syntax, types, and error rules.

Rationale: [§2.3](02-types-expressions-state.md#23-정확한-정수-설계), [§2.9](02-types-expressions-state.md#29-물리량과-단위), [Chapter 3 time contracts](03-time-and-schedules.md), [§5.2 Lifecycles](05-settings-and-observation.md#생명주기와-임시-설정).

## 8.7 Classifying new requirements

1. Check whether the requirement is user policy composable from existing expressions, state, and timers.
2. If it adds meaning that must be identical across execution environments, state the language contract and Why explicitly.
3. Identify producers, validity, errors, and revisions for every time, sensor, calendar, prediction, and aggregation input.
4. Separate runtime memory from records to preserve after restart.
5. Connect actual device connections/output effects through Driver and binding contracts.
6. Give UI descriptors and observations with the same meaning and leave display/input methods to it.

**Decision criterion:** Given the same Program, inputs, logical time, settings events, and starting state, the same control decision must be explainable. If device or UI kinds introduce hidden differences in that decision, the boundary between language semantics and environmental responsibilities is insufficiently defined. Rationale: [§6.8 Replay](06-composition-and-replay.md#68-replay-ghost와-branch), [§7 Semantic preservation](07-semantic-rules-and-index.md).

[Complete contents](../LANGUAGE-REFERENCE.md) · [Previous chapter](07-semantic-rules-and-index.md)
