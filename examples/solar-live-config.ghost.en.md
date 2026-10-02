<!-- translation-source: examples/solar-live-config.ghost.md -->
[한국어 원문](solar-live-config.ghost.md)

# Allowing sunrise schedules through shared settings observations

Sunrise is an event calculated for the declared location and timezone. Its
permission setting is a separate typed Result observation. This virtual example
reads the same observation in ordinary outputs and the sunrise predicate. A
settings fault prevents new admission. Recovery establishes a baseline rather
than starting an event that has already passed. Outputs are requested intent;
they do not establish physical operation or an installation.

```ghost
control SolarLiveConfig {
  config enabled: Bool = true { access = operator; }
  schedule dawn: Solar {
    timezone = "Asia/Seoul";
    latitude = 37.5665;
    longitude = 126.978;
    at = sun`rise`;
    basis = pulse;
    when = case enabled { ok(v) => v; fault(_) => false; };
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  output settings_ok, current_enabled, due: Bool;
  settings_ok <- case enabled { ok(_) => true; fault(_) => false; };
  current_enabled <- case enabled { ok(v) => v; fault(_) => false; };
  due <- dawn.due;
}
```

Location, timezone and event definition are fixed in the program. The host
supplies clock/solar facts and authenticated settings observations; Rust commits
the settings Results and admission together. An occurrence is consumed once,
and rejected evaluation rolls both back.
