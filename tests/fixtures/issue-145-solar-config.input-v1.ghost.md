# Solar settings transaction fixture

Two Solar schedules consume one addressed settings vector. The unused setting
must not affect schedule availability. Division failure tests atomic rollback.

```ghost
// Source revision: issue531-quality-solar-settings-v1
control SolarSettings {
  input divisor: Number;
  state previous_divisor: Number = 1.0;
  let effective_divisor = case divisor { ok(value) => value; fault(_) => previous_divisor; };
  previous_divisor' = effective_divisor;
  config enabled: Bool = true { access = operator; }
  config duration: Duration = 5min {
    min = 1min; max = 20min; step = 1min; access = operator;
  }
  config unused: Duration = 5min {
    min = 1min; max = 20min; step = 1min; access = operator;
  }
  let permitted = case enabled { ok(value) => value; fault(_) => false; };
  let effective_duration = case duration { ok(value) => value; fault(_) => 0ms; };
  schedule dawn: Solar {
    timezone = "Asia/Seoul"; latitude = 37.5665; longitude = 126.9780;
    at = sun`rise + 30min`; basis = pulse; when = permitted;
    clock = trusted_only; gap = skip_after(60s); recovery = baseline; fallback = skip;
  }
  schedule mirror: Solar {
    timezone = "Asia/Seoul"; latitude = 37.5665; longitude = 126.9780;
    at = sun`rise + 30min`; basis = pulse; when = permitted;
    clock = trusted_only; gap = skip_after(60s); recovery = baseline; fallback = skip;
  }
  state running: Bool = false;
  timer age = elapsed(running);
  running' = if running then age < effective_duration else dawn.due;
  output due, mirrored, active: Bool;
  output quotient: Number;
  output elapsed_age: Duration;
  due <- dawn.due; mirrored <- mirror.due; active <- running';
  quotient <- 1.0 / effective_divisor;
  elapsed_age <- age;
}
```
