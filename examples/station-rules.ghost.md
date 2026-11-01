# Shared station policy

This canonical literate document declares host-owned station limits and mode
interlocks for one shared pump. It is the bounded **Station adapter profile**:
a fixed, finite rule set consumed by `ghostrules` and `bindStationPolicy`. It is
not the general control-owned constraints grammar.

The profile has two concrete consumers: the station demo and the
programming-book Station WASM test. This profile is kept so that those consumers
keep working. It does not enable arbitrary shared-resource output policies.

The host must explicitly bind:

- the station, pump1, settings and starts identities;
- the mode and activity aliases;
- the finite valve-count configuration.

The complete binding and the executable Station lifecycle are checked in
`tests/programming-book-simulation.test.mjs` and `tests/policy.test.mjs`.
The fixed Station contract owns its stop behavior; this source does not define
a generic physical safe sequence. `check pump_capacity` is advisory only.
For a complete local envelope owned by one control, see
[constraint-envelope.ghost.md](constraint-envelope.ghost.md).

`Station::session_actual_on_ms(session_id)` (Rust) and the WASM wrapper's
`sessionActualOnMs(sessionId)` read the accumulated applied pump ON time, in
milliseconds, of the matching active session:

- The WASM result is an exact `BigInt`.
- The getter does not advance time. Existing timestamped Station operations,
  including `advance`, integrate the host's `reportApplied` state.
- OFF gaps preserve the session total. For example, ten seconds ON, ten OFF,
  then twenty ON give `30_000n` at time 40,000ms.
- `dailyUsedMs` stays unsettled until the session's durable finish.
- A missing, mismatched, finished, or restored session does not return zero.
  Rust returns `SessionMismatch`, and the wrapper throws.
- Restore keeps the existing conservative reservation and recovery contract.
  It does not restore the active session's counter.

This observation belongs to the bounded Station adapter only. It does not
define a generic job counter, phase age, continuous ON timer, or accounting of
requested, safe, or confirmed outputs. Applied states in host tests are
fixtures, not physical feedback. The distinctions drawn in
[Reference §3.4](../docs/reference/03-time-and-schedules.en.md#34-cumulative-time-and-rolling-budget)
remain separate contracts under [#208](https://github.com/callin2/ghostflow-language/issues/208).

```ghost
constraints StationRules {
  exclusive(automatic, manual, configuring);

  allow enter(Auto, Manual, Configure)
    only when mode == Stopped && stopped(station);
  allow apply(settings)
    only when mode == Configure && stopped(station);

  require count_on(pump1.valves) <= 2;
  require pump1.on => any_on(pump1.valves);
  limit on_time(pump1) <= 1h per day("Asia/Seoul");
  once starts per occurrence;
  check pump_capacity(pump1);
}
```
