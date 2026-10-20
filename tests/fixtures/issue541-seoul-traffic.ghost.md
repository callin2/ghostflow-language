# Seoul traffic schedule simulation fixture

Deterministic compiler/runtime acceptance input for language #541 and frontend #387.
This fixture uses a one-second complete yellow cycle: 500 ms on, 500 ms off.
It is a virtual intent test, with no road equipment or physical output claim.

```ghost
control SeoulTraffic {
  schedule day: DailySlots<15min> {
    timezone = "Asia/Seoul";
    selected = [05:00];
    dst_missing = skip;
    dst_repeated = first;
    basis = range(17h);
    when = true;
    cancel_when = false;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  schedule night: DailySlots<15min> {
    timezone = "Asia/Seoul";
    selected = [22:00];
    dst_missing = skip;
    dst_repeated = first;
    basis = range(7h);
    when = true;
    cancel_when = false;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  state phase: Int = -1;
  timer phase_age = elapsed(phase);
  phase' = if !day.active then -1
    else if day.due then 0
    else if phase == 0 && phase_age >= 60s then 1
    else if phase == 1 && phase_age >= 20s then 2
    else if phase == 2 && phase_age >= 3s then 0
    else phase;
  state flashing: Bool = false;
  timer flash_age = elapsed(flashing);
  flashing' = if !night.active then false
    else if night.due then true
    else if flash_age >= 500ms then !flashing
    else flashing;
  output red, green, yellow: Bool;
  red <- day.active && phase' == 0;
  green <- day.active && phase' == 1;
  yellow <- (day.active && phase' == 2) || (night.active && flashing');
  require !(red && green);
  require !(red && yellow);
  require !(green && yellow);
}
```
