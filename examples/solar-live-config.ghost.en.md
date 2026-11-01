<!-- translation-source: examples/solar-live-config.ghost.md -->
[한국어 원문](solar-live-config.ghost.md)

# Allowing sunrise schedules through shared settings observations

Sunrise is an event calculated for the declared location and timezone. The
setting that permits it to run (`enabled`) is something else: a separate typed
`Result` observation. This virtual example reads that same observation in two
places, the ordinary outputs and the sunrise schedule's `when` condition.

- If the setting has a fault, no new sunrise event is admitted.
- When the setting recovers, that moment becomes a baseline. An event that has
  already passed is not started.

The outputs are requested intent. They do not establish physical operation or
an installation.

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
supplies clock and solar facts plus authenticated settings observations. Rust
commits the settings `Result`s and the event admission together. Each
occurrence is consumed only once, and a rejected evaluation rolls both back.
