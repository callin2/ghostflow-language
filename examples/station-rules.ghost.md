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
