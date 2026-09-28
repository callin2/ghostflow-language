<!-- translation-source: examples/solar-watering.ghost.md -->
[Korean original](solar-watering.ghost.md)
> Reading translation. Compile the linked original `.ghost.md` file.

# Watering timed to sunrise and sunset

Water according to each day's sunrise and sunset using Seoul's **test
coordinates**. For installation, use verified farm coordinates and timezone.

For an 8DI/8RO layout, name RO1 as the pump and RO2–RO5 as valves. Request
RO2 and RO3 together for five minutes, 30 minutes after sunrise. Request RO4
and RO5 together for five minutes, 30 minutes before sunset. This example runs
each pair of valves simultaneously. If it is unclear whether the user wants
simultaneous or sequential operation, clarify before authoring.

```ghost
control SolarWateringFixture {
  let duration = 5min;

  schedule dawn: Solar {
    timezone = "Asia/Seoul";
    latitude = 37.5665;
    longitude = 126.9780;
    at = sun`rise + 30min`;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }

  schedule dusk: Solar {
    timezone = "Asia/Seoul";
    latitude = 37.5665;
    longitude = 126.9780;
    at = sun`set - 30min`;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }

  input DI1, DI2, DI3, DI4, DI5, DI6, DI7, DI8: Bool;
  output RO1, RO2, RO3, RO4, RO5, RO6, RO7, RO8: Bool;

  state dawn_active: Bool = false;
  state dusk_active: Bool = false;
  timer dawn_elapsed = elapsed(dawn_active);
  timer dusk_elapsed = elapsed(dusk_active);

  dawn_active' = if dawn_active then dawn_elapsed < duration else dawn.due;
  dusk_active' = if dusk_active then dusk_elapsed < duration else dusk.due;

  RO1 <- dawn_active' || dusk_active';
  RO2 <- dawn_active';
  RO3 <- dawn_active';
  RO4 <- dusk_active';
  RO5 <- dusk_active';
  RO6 <- false;
  RO7 <- false;
  RO8 <- false;

  require RO1 => (RO2 || RO3 || RO4 || RO5);
}
```

`dawn_active` and `dusk_active` have independent Bool states and elapsed timers.
Therefore, even if `skip` on an untrusted solar event does not create a new start
signal, the five-minute elapsed-time check for each run already started continues.
