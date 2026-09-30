<!-- translation-source: docs/reference/04-sensors-constraints-control.md -->
[Korean original](04-sensors-constraints-control.md)

# 4. Sensors, constraints and control

[Full contents](../LANGUAGE-REFERENCE.en.md) · [Previous: 3. Time and schedules](03-time-and-schedules.en.md) ·
[Next: 5. Settings and observation](05-settings-and-observation.en.md)

A GhostFlow sensor value is not a single number. It carries value source, quality, time and faults; output is first calculated as a requested intent, not a device command. Distinguishing local control expressions, shared-resource arbitration, safety constraints, Driver application and physical feedback allows sensor failures and competing controls to be explained without hiding them.

Read the code notation in this chapter as follows:

- **Selected GhostFlow notation** is syntax established in the current language surface.
- Only examples explicitly marked **design notation** are illustrative. Constraints, device queries, objectives, PI/PID, temporal evidence and adaptation established here as selected notation are public syntax.

The basis is [common constraints and sensor contracts](../CONSTRAINTS.md), [selected syntax](../LANGUAGE-SURFACE.md),
[language design §5–8](../LANGUAGE.md), [Programming in GhostFlow chapter 8 and appendix A](../ProgrammingInGhostflow.md),
[#3](https://github.com/callin2/ghostflow-language/issues/3),
[#94](https://github.com/callin2/ghostflow-language/issues/94),
[#95](https://github.com/callin2/ghostflow-language/issues/95),
[#96](https://github.com/callin2/ghostflow-language/issues/96),
[#105](https://github.com/callin2/ghostflow-language/issues/105) and
[#110](https://github.com/callin2/ghostflow-language/issues/110).

## 4.1 sensor and Result quality

In the selected declaration, a sensor's type is its normal payload type.

```ghost
sensor low_water: Bool;
sensor moisture: Percent;
```

The actual type when reading a sensor is conceptually `Result<T, SensorFault>`. Branch on normal samples with `ok(value)` and errors with `fault(reason)`.

```ghost
let water_ok = case low_water {
  ok(low)  => !low;
  fault(_) => false;
};
```

The initial fault set distinguishes these meanings:

| fault | Meaning |
|---|---|
| `Disconnected` | The installed sensor's connection or delivery path is broken. |
| `Stale` | The last actual valid sample has exceeded its freshness limit. |
| `Invalid` | Value, unit, range or encoding violates the declared contract. |
| `NotReady` | Initialization, filter window or continuous recovery conditions are not yet ready. |

Result cannot be compared directly as Bool or Number. Do not implicitly convert all faults to a single zero or false. In the example above, false is the author's chosen control value; the original fault and its time remain recorded. `recover(default)` is a pure transformation with the same meaning. `ok(x)` returns `x`; `fault(e)` returns `default` of the same type as the payload, without reclassifying the fault as normal or advancing sensor recovery state.

Both exhaustive `case` and statically resolved Result transforms are supported.

```ghost
fn normalize(value: Temperature) -> Result<Temperature, SensorFault> {
  ok(value)
}

let dry = moisture |> map(below(30%)) |> recover(false);
let normalized = temperature |> and_then(normalize);
```

`below(limit)` is a static unary function for compatible ordered payloads. `map(fnName)` and `and_then(fnName)` accept only pure functions resolved by name by the compiler, not runtime closures or general HOFs. The former transforms an `ok` payload to `U`; the latter to `Result<U,SensorFault>`. A `fault` is passed through without calling the function. Only `recover(expr)` returns an explicit same-payload-type default on fault. `|>` and `>>` are also compile-time static chains, not function values. No general user ADTs are added, but `Result<T,SensorFault>` is allowed in function arguments/results and supports `ok(value)`/`fault(reason)` constructors. Every transform leaves original fault/provenance in the journal/explanation and does not advance recovery state.

**Why:** Hiding a sensor fault as 0% or false prevents distinguishing normal low water, an actual zero measurement and disconnection. Preserving both substitute value and cause enables conservative control and later explanation.

## 4.2 Sample contracts and sensor processing order

The selected sensor configuration notation is:

```ghost
sensor moisture: Percent {
  sample = 1s;
  valid = 0% .. 100%;
  filter = median(5);
  stale_after = 3s;
  recover_after = 3 samples;
}
```

Each item's meaning and constraints are:

| Item | Type/constraint | Meaning |
|---|---|---|
| `sample` | Positive `Duration` | Expected measurement interval information. Creates no sensor-reading thread or timer. |
| `valid` | Closed range of the same type as the payload | Checks raw normal candidates before filtering. Out-of-range values are `Invalid`. |
| `filter` | Stateful signal operation | Applies only to new valid samples. |
| `stale_after` | Positive `Duration` | Freshness limit from the time of the last actual valid sample. |
| `recover_after` | Positive integer `N samples` | Recovery after a fault requires N consecutive new valid samples. |

The Driver supplies source ID, source epoch, sample ID, sample timestamp and quality. Repeating the same physical sample across ticks contributes only once to the filter window and recovery counter. Recalculating filter output does not refresh freshness.

Processing order is:

```text
Identify a new sample
  → check payload/unit/valid range
  → update filter state
  → check filter readiness
  → stateful predicate (hysteresis, etc.)
  → preserve quality/fault
  → author selects control value with case/recover
```

Explicit `Disconnected` and `Invalid` propagate immediately. Without a sample, the last valid value may be used before `stale_after`; at the limit it becomes `Stale`. Unlimited last-value hold is not the default. Bounded hold requires a separate policy explicitly specifying duration and `Held` quality.

Clear the filter window after a fault. The result is `NotReady` until both filter readiness and `recover_after` conditions are met. median(5) with recover_after=3 requires at least five new valid samples. Do not count a sample with a changed source epoch or time epoch as the next normal sample in the previous continuous sequence.

Default reboot semantics reset sensor state and freshness and prepare again from `NotReady`. Persistent resume is an explicit opt-in validating checkpoint source/time continuity. Do not immediately restore a single old normal value and use it as permission.

## 4.3 Filters and signal operations

### median

Selected `median(n)` returns the middle value after sorting the last `n` valid new payloads. `n` is an odd integer in `1..31`. Until the window contains n samples, the result is `NotReady`, not a normal partial median. The window is empty after fault/reinitialization.

```ghost
filter = median(5);
```

For example, the median of `28%, 29%, 90%, 28%, 29%` is 29%. One spike does not dominate the decision.

### hysteresis

Selected `hysteresis` takes a sensor/result and creates a stateful Bool signal preserving quality.

```ghost
signal dry = hysteresis(moisture,
  on_below: 30%,
  off_above: 35%,
  initial: false);
```

- The first argument is an ordered numeric/quantity `Result<T, SensorFault>`.
- `on_below` and `off_above` have the same type as T. Require `on_below < off_above`.
- A payload below `on_below` transitions to true.
- A payload above `off_above` transitions to false.
- Between boundaries and exactly at either boundary, retain the previous decision.
- `initial` is the Bool state at initialization/after recovery.
- On input fault, propagate the fault instead of presenting the last Bool as normal `ok`.

The two boundaries prevent repeated ON/OFF near the threshold. This memory is explicit signal state, not a hidden host correction.

### Design contract for bounded signal operations

The following is selected notation:

```ghost
sensor moisture: Percent { filter = moving_average(3); }
sensor temperature: Temperature { filter = ema(alpha: 0.25); }
signal stable_start = debounce(start, stable_for: 2s, initial: false);
```

| Operation | Required arguments | State and result semantics |
|---|---|---|
| `debounce` | Bool/finite signal, positive stable `Duration`, initial value | Change the stable value only when the input candidate remains unchanged for the duration. Preserve stable value, candidate value and monotonic candidate start time. |
| `moving_average(n)` | Numeric Result, positive fixed integer n within the profile bound | Arithmetic mean of the last n valid new samples. An empty/partial window is NotReady; state is finite and only for the last n samples. |
| `ema(alpha)` | Numeric Result, finite `0 < alpha <= 1` | Seed with the first valid sample and calculate `alpha*x + (1-alpha)*previous`. No normal result before recovery conditions are met. |
| `stale_after(d)` | Timestamped Result, positive Duration | Stale when the last actual valid sample's age reaches d. Reevaluation or filter-output time does not extend it. |

`filter` accepts one operation only. To compose multiple steps, declare each as a named `signal`. A Temperature filter internally computes an affine weighted mean in the canonical kelvin domain. This does not permit Temperature+Temperature or absolute-temperature scalar multiplication in source expressions. Do not uniformly apply the same filter delay to protective signals and gradual environmental sensors. Each operation must have a fixed state size and computation bound. Update only on new samples; composition preserves quality until `case` or `recover`.

**Why:** Erasing sensor quality in a filter or reusing one sample once per tick lets smoothing hide faults and changes replay results. Named finite state makes delay and resource cost reviewable.

## 4.4 temporal evidence

Time evidence for sensor decisions uses this selected notation, distinct from schedule `within`:

```ghost
signal hot_5m = true_for(hot, duration: 5min, quality: measured);
signal opened = after_event(started, valve_open, window: 10s, quality: measured);
input selected_start: EventId;
output selected_opened, any_opened, all_opened: Bool;
selected_opened <- after_event_for(opened, selected_start) |> recover(false);
any_opened <- after_event_any(opened) |> recover(false);
all_opened <- after_event_all(opened) |> recover(false);
signal avg_temp = window_average(temperature, over: 10min,
  quality: measured, max_age: 2min);
signal low_temp = window_min(temperature, over: 10min,
  quality: measured, max_age: 2min);
signal high_temp = window_max(temperature, over: 10min,
  quality: measured, max_age: 2min);
signal warming = window_rate(temperature, over: 10min,
  quality: measured, max_age: 2min);
signal usable_temp = hold_last(temperature, for_at_most: 2min, quality: measured);
```

- `true_for` is evidence that admissible true continued uninterrupted for a positive duration. False or inadmissible quality resets it; it is true on the first decision reaching the boundary. Continuity joins only intervals certified by the Driver as actually observed. Do not interpolate between separated samples or treat expected cadence, scan cadence, duplicates or clock-only ticks as observation evidence.
- `after_event` computes, per event identity, whether the predicate held within `[e,e+window)` from identified event time `e`. The exact end boundary is excluded. Overlapping events retain independent results per identity; a new start event does not overwrite an earlier pending or completed result.
- An `after_event` signal itself is not scalar and cannot be read directly in a Bool expression. The current compiler lowers it to executable control when explicit `after_event_for`, `after_event_any` or `after_event_all` projections and runtime binding exist. Declarations without projections are not accepted as executable control. `after_event_for(signal, identity)` explicitly selects one `EventId`. Runtime checks whether identity source tag equals the signal's Event source; an identity from another source rejects the scan with an identity binding error rather than becoming false. `EventId` is opaque identity delivered by the Driver, not an arbitrary number or a latest event constructed in source.
- `after_event_any(signal)` and `after_event_all(signal)` aggregate the entire immutable retained identity set of the accepted scan. `any` is true if any is satisfied and false only if all are expired. `all` is false if any is expired and true only if all are satisfied. An empty set or remaining pending identities that can change the result yield `NotReady`. Without a decisive true/false, preserve original predicate/source faults ahead of `NotReady`. Each function returns `Result<Bool, SensorFault>`; fallback such as `recover(false)` is author-explicit.
- Retained identities are bounded by fixed finite runtime-profile capacity. Do not implicitly evict pending or terminal identities or overwrite them with a new start. Capacity overflow atomically rejects the entire scan. Terminal results remain addressable until explicitly acknowledged by the host; pending identities cannot be acknowledged.
- `window_average/min/max` use only admissible actual observations within `(t-d,t]`, without interpolation. No admissible observations, or newest observation age at least `max_age`, means `NotReady`.
- `window_rate` calculates `(last-first)/(lastTime-firstTime)` using the earliest and latest admissible observations in the window. Without two different times, it is `NotReady`. For supported ordered numeric payload `Q`, the result is expression-only `Rate<Q>`. Temperature differences use canonical ΔK; linear quantities use canonical differences of the same nominal quantity. Reference the result through the `signal` name declaring `window_rate`. `Rate<Q>` has no direct literal, general value binding, config/state/input/output storage or free arithmetic. Comparison thresholds are constructed only with `rate(delta: <Q difference>, time: Duration)`. v1 RelativeHumidity, CO2 and Acidity are not `window_rate` inputs.
- `hold_last` supplies the last admissible payload only from its sample timestamp until strictly before `for_at_most`. Runtime/trace records `quality=Held`, source sample ID and age. `Held` is not a source constructor or `Measured`. Hold ends at the exact boundary.

### Time-window types and provenance

Measurement-based time windows take `Result<T, SensorFault>` and return successful Result when observations are sufficient. T for `window_min/max` is `Int`, `Number`, `Percent` or a physical quantity type; the result has the same T. `window_average` accepts those same types; averaging `Int` gives `Number` preserving the fractional part. Others preserve the original type. Absolute-temperature averages use canonical K values. Bool, enum, Duration and calendar types are not payloads of these numeric windows. `window_rate` input types follow chapter 2's [`Rate<Q>` rules](02-types-expressions-state.md#29-물리량과-단위).

`over` and `max_age` are positive constant Durations. Preserve original source, epoch, sample ID and timestamp of actual observations; duplicate receipt or reevaluation of the same observation does not count as a new contribution. An ordinary upstream fault does not erase observations still in the window. Thus sufficiently fresh records can continue providing an aggregate; masked faults and provenance also remain in observation records. A change of original source epoch invalidates that source's previous contributions.

An aggregate's provenance is its time-window declaration, evaluation time and actual contributing observation set. Do not display it as a single directly measured sensor sample. Transformations and branches preserve this aggregate provenance and must not invent a physical sample ID. Subsequent windows must also distinguish original observations from aggregate-result identifiers.

**Why:** Rounding integer averages or changing their physical quantity changes control-threshold meaning. Preserving observation provenance and valid windows prevents communication retransmission from adding average weight or temporary faults from erasing valid past observations.

### Time-window composition

A time-window result can be used as another time-window's input.

```ghost
signal short_average = window_average(temperature, over: 2min,
  quality: measured, max_age: 1min);
signal long_average = window_average(short_average, over: 10min,
  quality: measured, max_age: 2min);
```

- Supply a new aggregate observation to a downstream window only when a new observation accepted by the upstream window produces a successful aggregate. Reevaluation, observation expiry, branch selection change or fault change alone does not create a new observation. The current aggregate changed by expiry remains readable in ordinary expressions.
- Aggregate observation identity is the time-window declaration and observation-acceptance revision within the same program, strategy and run. Distinguish it from physical sample identity. Downstream windows remember revisions of unselected upstream windows too, so a branch switch does not recount an already produced aggregate as a new observation.
- Aggregate observation time is the newest original observation time contributing to that result. Preserve evaluation time separately. Late calculation or recalculation does not refresh the reference time for `max_age`. Different aggregate observations may have the same observation time.
- In a downstream average, each aggregate observation is one equally weighted term. Do not flatten nested averages into one average of original samples. Preserve original observations referenced by each term as provenance evidence. For example, upstream averages of 0, 5 and 15 yield a downstream average of `20 / 3`.
- `quality: measured` accepts aggregate evidence whose original contributing observations are all admissible measurements. The aggregate itself has `Derived` quality. `map`, `and_then` and Result branches preserve selected evidence. Do not assign new measured provenance to `Held` or values constructed with `ok(...)`.
- A change of original source epoch invalidates all aggregate observations depending on that past epoch. An average of A and B cannot discard only A's provenance and retain the existing average value. Separate observations depending only on B remain.
- A failed decision rolls back aggregate observations, revisions and downstream-window acceptance records together. Retrying the same observation must neither omit nor double-count it.

Maximum retention includes upstream-window past observations and provenance evidence for each aggregate. Do not merge multiple aggregates sharing the newest observation time or silently discard valid observations to fit a budget. If required retention cannot be proved, reject activation.

**Why:** Aggregate composition means recalculating already calculated results. Flattening original observations and averaging again changes the weight given to each aggregate. Distinguishing observation acceptance from evaluation prevents scan count and branch switching from influencing the average. Preserving original time and provenance prevents recalculation alone from making old observations fresh.

### `hold_last` values and provenance

`for_at_most` is a positive constant Duration. Measurement-based `hold_last` retains the last admissible observation of `Result<T, SensorFault>` and returns the same Result type. Without a retained observation or after its valid time ends, it returns `fault(NotReady)`. Successful results are `Held` even immediately upon receipt. `map`, Result branches and subsequent transforms do not promote that provenance to `Measured`. Values created with `ok(...)` or `recover(...)` are not new measurement evidence either.

Ordinary sensor faults or branch changes in the input expression do not erase a retained value. For example, selecting B's fault after A's valid value retains A's original sample ID and timestamp. A new admissible observation replaces payload and provenance with that observation's. Retransmission, duplicate samples and rereading cached normal values do not extend retention. A change of the retained value's original source epoch or loss of time continuity makes it unusable.

Trace records the actually returned value's `Held` marker, original source, epoch, sample ID, timestamp and current age. Upstream SensorFault masked by the held value also retains its error and provenance.

**Why:** Choosing to use a last measurement for a bounded time differs from claiming a new measurement. Original measurement time and provenance prevent rereading from extending validity or reuse of held values as measured evidence in subsequent control.

### Common quality and observation rules

`quality` cannot be omitted. Allowing estimated evidence also requires the uncertainty bound set by source/types. Window-operation `max_age` is positive and required.

All windows use only past and present. Simulation does not look ahead at future samples. If the only two samples are 25°C at 09:00 and 31°C at 12:00, one cannot conclude that temperature exceeded 30°C for two hours. Combine with quality policies such as `require measured`, permitted estimate uncertainty and `max_age`.

A missed scan creates no observation. The compiler must calculate maximum retained sample count from duration, max_age, sample contract and runtime profile; if it cannot, reject activation. Checkpoint restoration is allowed only after source/time continuity validation; otherwise the result is NotReady.

### Estimated-value provenance and continuity

An estimate is a value produced by an identified model; it is not a sensor
observation or an applied/confirmed output fact. `Result<T, SensorFault>` expresses
validity or fault for a declared sensor value. `ok(value)` means the source value
met its declared validity contract; it does not make a calculation measured or
physically confirmed. `Estimated` is a conceptual evidence origin. It adds no
`Result` status, `Quality` variant, or executable syntax.

Interpretation requires the model and calibration-parameter revisions, runtime
reference identity and how/by whom it was established, source/program and
installation-binding revisions, run and monotonic time epoch, the source or
application receipt history used, and the declared basis. Retained references and
history must fit a finite bound declared by the deployment profile. If that bound
cannot be supported, reject the use; do not retain unbounded history on an MCU.

The first actuator-progress basis is the Device's acknowledged output-register or
write history. Its acknowledgement means only that the Driver accepted that
register/write; it does not prove motor movement or position. Request time may be
used as a basis only when explicitly declared as requested history. Never
substitute it for applied history. This follows the requested/safe/applied/
confirmed distinction in §4.7.

An estimate interval starts from an admissible declared runtime reference and
qualifying receipt/history. Re-reading or exposing a cached receipt in another
scan creates neither a new write nor new evidence; it does not reset the
origin/start, freshness, or uncertainty. An estimate may advance under normal
monotonic-time evaluation only while verified continuity holds. The complete
qualifying history is required. Do not interpolate across an unobserved gap, a
failure, or an uncertain write. If a new write fails, an earlier cached ACK keeps
its original identity as historical evidence and the current applied-target
history is uncertain. Do not infer continuing application from that old ACK.

A reboot or change to run/time epoch, source epoch, installation binding,
model/calibration revision, or runtime reference breaks live-estimate continuity
unless the owner explicitly validates and re-establishes it. Calibration
parameters may remain after reboot; a runtime position reference or estimate
must not be silently restored or set to zero. A missing or unverified basis makes
the current estimate unavailable/NotReady. Preserve an explicit existing
source/time fault as that fault; convert neither case to zero or automatic
fallback. A timer-only policy remains valid when no estimate is available and
does not need to consume one.

Unknown uncertainty remains unknown. Define no universal formula, confidence,
numeric uncertainty, duration, or expiry. The selected model/source type must
declare which estimates it permits and its uncertainty bound. Existing
`quality: measured`, `hold_last`, and `true_for` measured admission remain
unchanged; any future estimate-capable consumer must explicitly admit estimated
evidence and declare a source/type uncertainty bound.

Continuous example: with an explicit runtime reference, matching model,
calibration and binding, the same run/time epoch, and a gap-free qualifying write
history within the profile bound, the selected model may produce an estimate. It
remains an estimate; a Driver ACK alone does not assert movement. Discontinuous
example: for an applied-history basis, an unacknowledged request, failed or
uncertain new write, reboot, or identity/revision change makes the live estimate
unavailable until a reference is validated again. A separately declared
requested-history basis may use a request as an assumption, but must not label it
applied history. Keep calibration parameters and prior estimates as history with
their own identities.

The estimate semantics are tracked in GhostFlow [#383](https://github.com/callin2/ghostflow-language/issues/383);
follow-on compatibility work is [#385](https://github.com/callin2/ghostflow-language/issues/385).
Calibration/reference semantics are in [System #132](https://github.com/callin2/farm_studio_system/issues/132)
and its [architecture contract](https://github.com/callin2/farm_studio_system/blob/241643c125439c1ec141c8596feec3f4ad143ade/docs/architecture/INPUT-DRIVER-ARCHITECTURE.md#calibration-parameters-and-position-reference--system-132).
The concrete Device output-receipt boundary is in draft [PR #107](https://github.com/callin2/farm-device/pull/107),
head `b85ef02fb546cd5f957c12ab66f091b90f9484f0`, at
[host observation](https://github.com/callin2/farm-device/blob/b85ef02fb546cd5f957c12ab66f091b90f9484f0/rust/firmware/src/host_observation.rs).
The current lowering of `quality: measured` (code `1`) and runtime
`Measured`/`Held`/`Constructed` classifications do not represent `Estimated`.
This contract does not enable runtime consumption; that requires the separate
compatibility work in #385.

## 4.5 Optional sensors and capabilities

```ghost
sensor moisture?: Percent;
```

`?` declares that the sensor capability is optional in the installation profile. It does not merge absence with faults of an installed sensor.

- `Option<T>` or capability absence: that capability does not exist in the device configuration.
- `Result<T, SensorFault>`: an installed sensor was read, yielding normal or fault.

`?` alone creates no substitute strategy. Adaptation such as using a default schedule when absent and moisture correction when present needs a separate strategy contract. Temporary Disconnected must not enter the absence branch.

Optional-capability protection uses only the `adapt`/`strategy` surface in §4.6. The earlier `has` sketch is not v1 syntax. An optional role can be read only inside a strategy matching that role, and still needs `ok/fault` branching there. `?` and `adapt` neither automatically switch strategy on fault nor create default values.

Device supplementary information such as pressure, flow, pump curves, power and pipe loss is also optional. Absence does not become zero, infinite capacity or a normal value. Basic irrigation and explicit valve-count/time interlocks can work without it. Optional analysis returns `Pass | Violation | Unknown(reason)`; insufficient information is Unknown.

## 4.6 Device queries and strategy selection

The following is selected control syntax. The current compiler accepts typed `match` and `match always`. `where` and presence-only matches omitting type are not yet supported. The `where` example below is design notation.

```ghost
adapt irrigation_policy {
  strategy WithMoisture priority 100
    match (moisture: sensor<Percent>)
    where moisture.type == Percent {
      let request = case moisture {
        ok(value) => scheduled && value < 30%;
        fault(_) => false;
      };
      pump <- request;
    }

  strategy Baseline priority 0 match always {
    pump <- scheduled;
  }
}
```

A profile is a finite set of semantic capabilities. Initial keys are `(kind, name, type)`; the same `(kind, name)` cannot appear twice.

- Syntax is `strategy Name priority Int match (...) [where ...] { ... }` and `match always`.
- Each match item is a capability-presence condition; commas mean AND.
- `pump` and `moisture` are semantic role names, not variables iterating database rows.
- `sensor<number>` is the normal payload type; actual samples are Result.
- Omitting type, as in `(moisture:sensor)`, tests presence only.
- `where` reads only matched capability kind/name/type, constant comparisons and Bool `&&`, `||`, `!`, `==`, `!=`.
- `where` does not read input samples, state, next state or current moisture values. Do not mix capability selection with per-tick control decisions.

Each strategy has an i32 literal priority. Every strategy completely defines the same external output contract of the control. Select one matching strategy with the greatest priority. A tie at the top is an ambiguity error. No matching strategy is an activation error. Declaration order and last match do not win.

Common inputs are required by every strategy. Strategy inputs are required only when that strategy is selected. Check selected strategy capabilities and port types against the profile. Do not change the profile mid-tick. Apply a new profile atomically at a boundary after validating the entire candidate and strategy selection. Handle current strategy sensor faults immediately as Result; do not convert them to profile absence and automatically switch to a less protective strategy. `match always` is an ordinary candidate, not implicit fallback.

**Why:** Mixing installation-capability selection with current sensor values can change binding every tick even with the same profile. Unique strategies and boundary application retain decision provenance when device configuration changes.

## 4.7 requested, safe, applied, confirmed

Control results distinguish these stages:

```text
sensor/input + previous state
  → requested output intent
  → arbitration and constraints
  → safe/effective intent
  → command applied by Driver
  → state confirmed by feedback
```

Selected output connections define requested intent.

```ghost
output pump, valve: Bool;
valve <- running';
pump <- running';
require pump => valve;
```

`require pump => valve` means pump=true is permitted only if valve=true. A false prerequisite makes the target pump false. Output constraints do not turn false into true. `require !(forward && reverse)` or mutex makes all simultaneously true members of the conflict group false. Multiple Bool constraints calculate blocked targets from the same candidate snapshot, then iterate only toward false until unchanged. Results do not depend on declaration order.

The result is safe intent. It is neither evidence of actual GPIO/relay application nor evidence that a valve physically opened. Applied commands and confirmed feedback from encoders, limit switches, vision estimates and similar sources have separate provenance and quality.

**Why:** Combining request, constraint result, device application and physical result into one Bool prevents explanation of output blocking and device discrepancy and makes usage accounting targets ambiguous.

## 4.8 Common constraints notation and operations

The following `constraints` block is selected design notation. Rules bind to stable equipment IDs and finite port/resource sets. The current resource-policy named parser accepts only `constraints Name for resource { exclusive at admission { ... }; require at safe_output ...; }`. This syntax does not lower to executable control without resource binding and runtime enforcement. The `ghostrules` standalone parser uses separate `constraints Name { ... }` syntax to validate `exclusive(...)`, `allow`, `limit`, `once` and `check`. Accounting constraints within a control use yet another form, `constraints Name { limit used(account, basis) <= bound { ... } }` (§3.10). Do not regard the three forms' results as the same execution contract.

```ghost
constraints StationRules for station {
  exclusive at admission { automatic, manual, configuring };
  allow enter(Auto, Manual, Configure)
    only when mode == Stopped && stopped(station);
  require at safe_output count_on({ valve1, valve2, valve3 }) <= 2;
  require at safe_output pump1.on => any_on({ valve1, valve2, valve3 });
  limit on_time(pump1) <= 1h per day("Asia/Seoul");
  once starts per occurrence;
  check pump_capacity(pump1);
  warn low_margin when remaining_budget < 5min;
}
```

### Constraint statement semantics

| Notation | Arguments | Application stage and meaning |
|---|---|---|
| `exclusive at admission { a, b, ... }` (resource-policy); `exclusive(a, b, ...)` (`ghostrules`) | At least two modes/activities in the same scope | Do not activate concurrently. Reject conflicting new entry and retain existing state. |
| `allow enter(M...) only when p` (`ghostrules`) | Finite mode set and Bool premise | Check p on mode-entry request. Do not block stop requests themselves. Current parser p is exactly `mode == Stopped && stopped(station)`. |
| `require p` | Bool invariant with a defined output/permission stage | Used for both prestart permission and runtime monitoring; Unknown is not pass. |
| `limit q <= bound per basis` | Typed quantity, same-type bound, day/window basis | Check remaining budget and block further operation at the limit boundary. |
| `once schedule per occurrence` | Schedule ID and occurrence identity | Prevent readmission of the same occurrence. A ledger separate from time budget. |
| `check analysis(args)` | Analysis depending on optional information | Nonblocking analysis yielding `Pass/Violation/Unknown`. |
| `warn id when p` (design) | Stable warning ID and Bool | Emit a diagnostic event with cause and target without changing results. Neither current parser accepts it. |

Current named-parser targets are `admission` for `exclusive` and `safe_output` for finite-set `require`. `monitor` is a selected design target unsupported by the current parser. Existing untargeted Bool `require` within a control means `safe_output`. Each rule has an application stage. Do not treat output relations as mode-entry rules or implicitly promote nonblocking checks to safety requires. All mandatory constraints must hold together as AND. Arbitration is a separate policy choosing which requests to accept within the permitted region. Priority scores do not relax mandatory constraints.

### Common functions

| Function | Input | Result and rules |
|---|---|---|
| `count_on(xs)` | Finite Bool output/resource set | `Int` count of distinct true items in the final candidate. Do not double-count the same physical item; an empty set gives zero. |
| `any_on(xs)` | Explicit finite Bool set | Bool true if at least one is true. An empty set gives false. |
| `on_time(resource)` | Stable physical resource ID and explicit accounting stage | Merged ON Duration of that resource. Do not double-count overlapping requests from multiple controls. |
| `stopped(station)` | Station ID | Whether active sessions and cleanup are finished, usage rights returned and required stop evidence met. Not merely pump=false. |
| `pump_capacity(pump)` | Pump ID, optional capacity context in its profile | `Pass/Violation/Unknown(reason)`. Compare all requests against a pump/system model under the same conditions. |

Do not simply add or compare flow and pressure in `pump_capacity`. Use only unit-compatible models, such as `flow_budget` and zone `demand_flow` under the same validated conditions. Insufficient information means Unknown. `check pump_capacity` does not block operation. Violation and Unknown block new starts only if the author explicitly specifies `require pump_capacity(pump1) == Pass`.

**Why:** Invariants, entry permission, usage limits and nonblocking analysis need different actions on violation. Combining them into one Bool filter can pass Unknown or turn an analysis warning into an operation stop.

Set literals are `{ item, ... }`, finite compile-time lists. After physical binding, aliases of one endpoint count once. If distinct identities change before/after binding, activation diagnostics show both lists. If an empty-set result should mean permission, the author specifies that policy with a separate `require`.

## 4.9 Shared resources and arbitration

When multiple controls use the same physical pump, the resource manager is the sole final writer. Individual control pump outputs are requests. An inactive control's false or a last write does not turn off the current owner's pump.

Default shared-pump policy is an exclusive lease for the entire session. Keep ownership through valve preopening, pump ON, pump OFF between stages, valve cleanup and stop confirmation. A brief pump OFF does not hand it to another control.

Start requests in one tick are evaluated from one snapshot. Admit only requests able to reserve both resource lease and time budget. Decide by explicit policy such as acceptance order and stable request ID; queue length and expiry are bounded. Shared concurrent operation and preemption are opt-in policies.

General arbitration must expose authority and constraint semantics. The following are design categories:

1. safety constraint,
2. manual authority,
3. automatic control objective,
4. adaptive/optimizer proposal.

This list does not imply simple fixed priority for all equipment. Trace the policy/revision selecting the final value, every request and constraint clamp.

```text
temperature objective requested vent 70%
humidity objective requested vent 40%
arbitration selected 70% under policy P
wind safety limited maximum to 20%
final safe target 20%
```

Declare shared resources with the following selected notation. Queue and preemption have no defaults.

```ghost
resource pump1: BoolActuator;
resource_policy shared_pump for pump1 {
  lease = session;
  concurrency = 1;
  admission = reserve_all;
  queue = fifo(max: 8, expires_after: 10min, tie: request_id);
  preempt = never;
}
```

The first surface uses a `session` lease. `concurrency` is a positive static integer at or below capability bounds. `reserve_all` admits only when lease and required budgets can all be acquired from the same snapshot. Queue must be one of `reject`, `fifo(max:N, expires_after:D, tie:request_id)` or `authority_then_fifo(max:N, expires_after:D, tie:request_id)`. `N` and `D` are positive. FIFO key is durable accept position; ties use stable request ID byte order. Overflow and expiry are explicit occurrences with no hidden retry.

Specify preemption as `never` or `higher_authority(cleanup: required, resume: requeue|cancel)`. Here `requeue|cancel` denotes syntax alternatives; actual source uses one. Preemption does not bypass cleanup, stop evidence or safety constraints. Explicitly select a continuous-request policy of `exclusive`, `highest_authority`, `min` or `max` on the resource; trace policy revision and all requests.

## 4.10 Modes and live settings

Modes such as Auto, Manual and Configure are exclusive within the same equipment scope. Auto↔Manual and operation→Configure transitions follow this explicit path:

```text
stop request → suppress new starts → device cleanup → stop evidence → Stopped → new mode entry
```

`stopped(station)` can distinguish `CommandedStop` and `VerifiedStop`. The former is safe command application and completed cleanup; the latter also verifies physical feedback. Do not globally default to VerifiedStop for equipment without feedback. On device-response failure, command transmission alone does not mean stop complete.

Reject all conflicting mode entries in the same tick. Process Stop before new entry/new work and invalidate pending requests. Do not store an in-operation mode-change request for a later hidden transition.

This stop/Configure path may apply to validation/deployment of candidate revisions changing structure and installation meaning, such as programs, dependencies, physical bindings and equipment constraint bundles. The interpretation of the earlier contract's `allow apply(settings) only when ... Configure` as applying to every operator property is superseded by the live-event decision below. The final name and revision boundary for structural-change `apply` targets belong to a separate composition/installation contract.

Operational settings follow subsequent decisions in #105 and #110. An operator-editable property change is an **atomic live event within the same program and run**.

- Validate every value in one event for type, range, step, authority and current program identity.
- If any is invalid, reject the whole event without changing any settings.
- On success, record settings revision and effective event position.
- Controls and schedules can read new values after that position.
- Preserve source/bytecode, program identity and run identity.
- Do not implicitly reset timers or state.
- An actual restart preserves settings but creates a new run identity.

For example, reducing watering limit from ten to five minutes compares current `elapsed` against the new five minutes at the next decision. Do not add a hidden wait-for-new-run policy. Do not generalize this live-event meaning to Auto↔Manual mode switches, program deployment, optional dependency replacement or physical binding changes such as RO3→RO8. Those follow their respective mode, composition and installation/deployment contracts.

## 4.11 Accounting and budgets

If the accounting stage of `on_time(pump1)` is final applied command, merge actual applied ON intervals from automatic/manual operation and multiple controls into one physical resource ledger. Do not count rejected requests, queue waiting or constraint-blocked time. Counting confirmed flow separately requires its feedback capability and quality contract.

Declaration syntax uses `resource`, `account`, `used` and `limit` from [§3.10 Time-based usage constraints](03-time-and-schedules.md#310-시간-기반-사용량-제약).

A local-day budget is not a rolling 24h budget. Each date's budget may be used on either side of midnight. Split ON intervals crossing midnight at trusted date boundaries. Wall rollback or program/settings revision does not reduce or reset already committed usage.

Before starting a new job, reserve budget including worst-case ON duration and stop delay. Manual operation may use a finite lease and cutoff within remaining budget. Settle after use with applied intervals. Use explicit conservative policies for reservations made uncertain by power loss, such as treating them as used or deferring recovery.

A rolling duty limit such as 30 cumulative seconds in the last 60 seconds is a sliding window different from the day ledger. Sum ON Duration of the selected semantic signal within `(t-60s,t]`, including partial overlaps. Block additional ON exactly at the limit and restore only budget corresponding to old intervals leaving. Do not implicitly reset on power cycle.

`once starts per occurrence` prevents duplicates of the same occurrence separately from budget. Even with an hour of budget remaining, the same five-minute occurrence could execute twice; do not substitute one contract for the other.

**Why:** Without physical-resource accounting, multiple controls using one pump can omit or double-count usage. Day, rolling window and occurrence duplication are also different questions.

## 4.12 Continuous control objectives

The higher-level concept of continuous control is a **control objective** maintaining a controlled variable around a setpoint, rather than “run PID.” The following is selected syntax:

```ghost
objective greenhouse_temperature {
  measure = inside_temperature;
  target = target_temperature;
  manipulate = roof_vent.position;
  output = 0% .. 80%;

  controller = pid {
    period = 10s;
    late_after = 30s;
    direction = reverse;
    kp = proportional_gain(output: 2%, error: 1Δ°C);
    ki = integral_gain(output: 0.1%, error: 1Δ°C, time: 1s);
    kd = derivative_gain(output: 1%, time: 1s, error: 1Δ°C);
    bias = 0%;
    anti_windup = conditional_safe;
    disabled = track_safe;
    transfer = track_safe;
    fault = disable;
    restart = reset(output: 0%);
  }
}
```

An objective connects:

- `measure`: process value with quantity and quality/provenance.
- `target`: typed setpoint compatible with measure.
- `manipulate`: semantic target of a continuous actuator.
- `controller`: Hysteresis/On-Off, PI or PID policy.
- `output`: permitted range within actuator capability.

A config-referencing `target` consumes the current §5.2 `Result<T, SettingsFault>` observation. `T` is a quantity compatible with measure. `ok(value)` is the current setpoint; `fault(reason)` goes to the explicit controller fault policy. Do not implicitly substitute initial or last-successful targets. In the executable Temperature/Percent PID profile, `fault = disable` also immediately disables on target fault; recovery follows existing deadline and `track_safe` policy. A successful target change does not itself reset controller state.

A continuous actuator capability expresses value quantity/type, range, optional resolution, safe value, rate/slew limit and feedback availability. 0–10V, PWM, VFD, Modbus and servo are Device bindings, not source objectives.

### Items required for PI/PID semantics

`pi` does not accept `kd`; `pid` requires all three gains. Use `proportional_gain`, `integral_gain` and `derivative_gain` constructors instead of arbitrary unit algebra. A constructor's output numerator is nonnegative, error denominator is a positive compatible delta, and I/D time is positive. Zero output disables that term. These values form nominal gain types bound to output and TemperatureDelta and similar types.

| Item | Meaning |
|---|---|
| sample period | Positive monotonic Duration updating controller state, including missed/late tick rules. |
| setpoint / process value | Compatible quantities. Do not directly calculate with nonfinite values or unresolved faults. |
| direction | direct or reverse. Explicitly state the direction in which error changes the actuator. |
| `Kp`, `Ki`, `Kd` | Gains preserving quantity dimensions. PI has no D term. |
| output min/max | Requested-target clamp; cross-validate against actuator capability range. |
| anti-windup | Integral state update or back-calculation policy during saturation/constraints. |
| enable/disable | Explicitly freeze/reset/track controller state. |
| manual/auto transition | Bumpless transfer following current effective output and authority transition rules. |
| fault policy | Explicit hold/safe fallback/disable policy for stale/missing measures and feedback discrepancy. |
| initialization/restart | Startup/checkpoint rules for integral, derivative memory and previous sample. |

Require `period > 0`, `late_after >= period` and all finite values. Fixed execution rules are:

1. Update at most once per monotonic deadline. Reevaluating the same sample does not change state.
2. Basic error is the delta `target - measure`. `direct` keeps its sign; `reverse` reverses it.
3. `P = Kp * signedError`; I is trapezoidal integration of previous/current signed error.
4. Apply D to measurement change to avoid setpoint kick: `-directionSign * Kd * Δmeasure/dt`.
5. `dt` is monotonic time between the last accepted and current update. Do not synthesize missed samples.
6. `dt > late_after`, nonfinite values or inadmissible measure enter the explicit `fault` branch.
7. Unclamped requested is `bias + P + I + D`. Internal signed accumulators do not follow Percent's external nonnegative range; clamp requested within the objective range.
8. Calculate requested and safe with tentative I. If `(requested-safe) * signedError > 0`, I increases saturation, so recalculate once with previous I. Otherwise commit candidate I.

This bounded two-pass procedure is all of `conditional_safe`; do not create an iterative solver.

Controller output is a requested target. Subsequent arbitration and safety constraints may clamp it.

```text
PID requested 92%
wind safety max 20%
safe target 20%
Driver applied 20%
position feedback 17% with provenance
```

Integral anti-windup follows the safe-tracking rules above, rather than continuously accumulating based only on requested 92%. Do not automatically convert continuous PID output to high-frequency time proportioning for relay-only actuators. Without a separate capability/safety contract, hysteresis/on-off is appropriate for relays.

The first accepted sample initializes previous error and previous measurement to current values, with D=0 and no integration of an imaginary previous interval. Current PID `fault` accepts only `disable`. `degraded Name` is a selected design alternative unsupported by the current compiler. `bias`, `anti_windup`, `disabled`, `transfer`, `fault` and `restart` cannot be omitted. Restart is `reset(output: value)` with typed output. A continuity-validated `checkpoint` is a selected design alternative unsupported by the current compiler. `reset(output:v)` sets integral tracking state at the first accepted sample so its first unclamped requested equals explicit `v`. Disable and manual→auto transfer track the current safe target. Setpoint and gains may be typed operator settings. Live events apply atomically within the same program/run without resetting controller/timer/filter state. At the next normal evaluation, `track_safe` continues bumplessly. Showing a setpoint in the farmer UI does not mean exposing every expert gain with the same permissions.

**Why:** A farmer's goal is maintaining a condition such as temperature or humidity. Making an algorithm name the higher-level intent prevents explaining relay, PI and PID replacement and safety clamps under one objective.

## 4.13 Explicit fallback and degraded control

Sensors, weather, models, cameras and actuator feedback may be unavailable. Fallback must be visible in source/policy and trace, not hidden host behavior.

```text
// Design semantics
primary temperature normal → operate with PI
primary degraded, backup admissible → backup controller with stricter range
all temperature unavailable → conservative ventilation fallback
```

A fallback branch specifies input capabilities, permitted quality, output bounds and authority. Cloud/AI unavailability does not unconditionally make local safety control unavailable. Conversely, low-confidence estimates alone do not release a safety trip. Fallback does not bypass global constraints, resource ownership or modes.

Recovery means new normal evidence is ready. Automatic restart, return to the original objective and accumulated timer restoration are separate decisions. Meeting sensor recover_after does not create a new start request.

Selected notation is:

```ghost
degraded TemperatureFallback for greenhouse_temperature {
  branch Backup priority 100
    when backup_temperature quality in { measured }
    use objective backup_temperature_control
    authority automatic_degraded
    output 0% .. 30%;
  otherwise disable;
  recover primary after 3 samples;
  resume = require_start;
}
```

Select the one satisfied branch with greatest i32 priority; a tie is an ambiguity error. Declaration order is not a selection criterion. `otherwise` is required; the current compiler accepts only `disable`. A complete branch is a selected design alternative not yet supported. Resume must be one of `require_start`, `automatic`, `stay_degraded`. Even `automatic` creates no new start authority and returns to primary only while the existing session remains valid. Fallback authority cannot exceed primary or possess safety authority.

## 4.14 Bounded adaptation

Adaptive models and optimizers have no default authority to modify the entire program or write output registers directly. Their initial meaning is a bounded proposal for a typed setting or objective setpoint.

```ghost
adapt_setting target_vpd_policy for target_vpd {
  allowed = 0.7kPa .. 1.2kPa;
  max_step = 0.05kPa;
  max_change = 0.05kPa per 1h;
  authority = optimizer;
}
```

A proposal requires setting ID, proposed value, source/model, evidence reference, actor/authority, current program and base settings revision, and occurrence time. Local validation checks type, range, one-step change, hourly rate and authority. Apply multiple successful property changes as one atomic settings event creating a new settings revision. Failure changes no values.

“Target temperature 25→26°C” may be a bounded setting. “Always stop the pump at low water” is a safety program change. Adaptation cannot remove safety constraints or raise its own authority. AI authoring workflows generating programs have separate source review and deployment identity.

Rate checks that the sum of absolute accepted changes within `(t-window,t]` plus the new change does not exceed `max_change`, preventing evasion by alternating increases/decreases. A successful adaptation settings event does not reset controller, timer or filter state or switch it to a checkpoint. The next normal control evaluation tracks the current safe target. Trace old, proposed, accepted/effective values, proposal provenance, rejection reason, program identity, settings revision and effective position.

**Why:** Treating adaptation as program modification or direct output authority lets model errors erase safety constraints. Typed bounds and atomic settings events validate the permitted change scope.

## 4.15 Types, resources and explanation rules

Sensor/control operations follow these common rules:

- Do not implicitly compare or sum pressure, flow, percent and temperature of different quantities.
- Do not convert Result or Option to Bool truthiness.
- Filter/window/request counts and state-memory bounds must be statically calculable.
- Tick failure does not partially commit sensor/filter/controller/resource state.
- Analysis timeout or Unknown is not proof success.
- Even if an always-all-outputs-OFF result satisfies safety constraints, separately check reachability of intended operation.

Explanation of a completed decision distinguishes at least:

- raw sample, filtered value, quality/fault and sample identity,
- predicate and temporal evidence,
- setpoint, process value, error and controller requested output,
- competing intents and arbitration policy,
- constraint clamp and final safe intent,
- applied command and confirmed feedback,
- usage target, used/limit, block reason and next release calculated from already recorded intervals,
- program, settings, profile/binding, policy and scan/run identity.

Observation/display layers consume decided values and evidence. Do not create independent control semantics for budgets, PID, fallback or arbitration from animation time or displayed output.

## 4.16 Established control syntax and chapter boundaries

This chapter establishes the surfaces for Result transforms, bounded signals/windows, capability strategies, named constraints, shared resources, objectives/PI/PID, degraded control and bounded adaptation. Only these details refer to their owning chapters' contracts:

- Rolling-budget history, scan boundaries and reboot policy: chapter 3 time/accounting contract.
- General typing rules for quantity, delta, Result and quality predicates: chapter 2 type contract.
- Installation binding and live-settings event records: chapters 5–6 settings/composition contracts.

These references do not change the Result/Option distinction, requested→safe→applied→confirmed sequence, mandatory constraint precedence, bounded state, atomic live settings or explicit fallback semantics.

[Full contents](../LANGUAGE-REFERENCE.md) · [Previous chapter](03-time-and-schedules.md) ·
[Next chapter](05-settings-and-observation.md)
