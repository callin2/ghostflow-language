<!-- translation-source: examples/solar-watering.ghost.md -->
[Korean original](solar-watering.ghost.md)
> Reading translation. Compile the linked original `.ghost.md` file.

# Watering timed to sunrise and sunset

This example waters according to each day's sunrise and sunset, using Seoul's
**test coordinates**. For a real installation, write in the verified farm
coordinates and timezone.

The example uses an 8DI/8RO layout (eight digital inputs, eight relay outputs)
and names the relays as follows:

| Relay | Role | Requested |
|---|---|---|
| RO1 | Pump | whenever either pair runs |
| RO2, RO3 | Valve pair | together, for 5 minutes, starting 30 minutes after sunrise |
| RO4, RO5 | Valve pair | together, for 5 minutes, starting 30 minutes before sunset |
| RO6–RO8 | Unused | always off |

This example runs the two valves of each pair at the same time. If it is
unclear whether the user wants simultaneous or sequential operation, clarify
that before authoring.

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

`dawn_active` and `dusk_active` each have their own Bool state and elapsed
timer. When `skip` handling of an untrusted solar event creates no new start
signal, the five-minute elapsed-time check of each run that has already started
still continues.
