# Shared station policy

This canonical literate document is the bounded **Station adapter profile**
consumed by `ghostrules` and `bindStationPolicy`, not the general control-owned
constraints grammar. Its concrete consumers are the station demo and the
programming-book Station WASM test. Keeping this profile preserves those
consumers; it does not enable arbitrary shared-resource output policies.

The host must explicitly bind station, pump1, settings and starts identities,
mode/activity aliases and the finite valve-count configuration. The complete
binding and executable Station lifecycle are checked in
`tests/programming-book-simulation.test.mjs` and `tests/policy.test.mjs`.
The fixed Station contract owns its stop behavior; this source does not define
a generic physical safe sequence. `check pump_capacity` remains advisory.
For a complete one-control local envelope, see
[constraint-envelope.ghost.md](constraint-envelope.ghost.md).

`Station::session_actual_on_ms(session_id)` and the WASM wrapper's
`sessionActualOnMs(sessionId)` read the matching active session's accumulated
applied pump ON milliseconds. The WASM result is an exact `BigInt`.
The getter does not advance time. Existing timestamped Station operations,
including `advance`, integrate the host's `reportApplied` state.
Ten seconds ON, ten OFF, then twenty ON produce `30_000n` at time 40,000ms.
OFF gaps preserve the session total. `dailyUsedMs` remains unsettled until
durable finish. A missing, mismatched, finished, or restored session returns
`SessionMismatch` in Rust and throws in the wrapper, rather than returning zero.
Restore retains the existing conservative reservation and recovery contract;
it does not restore the active session's counter.

This observation belongs to the bounded Station adapter. It does not define a
generic job counter, phase age, continuous ON timer, or requested, safe, or
confirmed output accounting. Applied states in host tests are fixtures, not
physical feedback. The distinctions in
[Reference §3.4](../docs/reference/03-time-and-schedules.md#34-누적-시간과-rolling-budget)
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
