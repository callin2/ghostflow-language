# Live settings stream

The interval and run duration are independent addressed settings. Both are
consumed as typed `Result` values from the same runtime settings revision.

```ghost
control LiveSettingsPeriodic {
  config interval: Duration = 1h {
    min = 10min;
    max = 2h;
    step = 10min;
    access = operator;
    label = "Cycle interval";
  }
  config duration: Duration = 10min {
    min = 1min;
    max = 30min;
    step = 1min;
    access = operator;
    label = "Run duration";
  }

  let interval_ready = case interval {
    ok(_) => true;
    fault(_) => false;
  };
  let effective_duration = case duration {
    ok(value) => value;
    fault(_) => 0ms;
  };

  schedule cycle: Periodic {
    every = interval;
    anchor = instant(datetime`2026-10-01T00:00:00Z`);
    interval_change = preserve_anchor;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(2h);
    recovery = baseline;
    fallback = skip;
  }

  state running: Bool = false;
  timer age = elapsed(running);
  running' = if cycle.due then true else if running && age >= effective_duration then false else running;

  output due, active: Bool;
  due <- cycle.due;
  active <- running';
}
```
