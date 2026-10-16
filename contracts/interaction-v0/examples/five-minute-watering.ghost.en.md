<!-- translation-source: contracts/interaction-v0/examples/five-minute-watering.ghost.md -->

# Five-minute watering fixture

[Korean canonical source](./five-minute-watering.ghost.md)

## Execution contract

- At logical time 0, `watering` and all outputs are off and `age` is 0.
- DI1 is a momentary watering request. A false-to-true edge starts a new watering cycle; holding it does not restart the cycle. A healthy released sample arms the next press.
- DI2 stop or DI3 low-water immediately clears watering and both outputs. They have priority over a new DI1 request.
- Clearing DI2/DI3 or holding DI1 does not restart watering. Release DI1 and press again to start a new full five-minute cycle.
- RO1 pump and RO2 watering valve follow the accepted watering state together. DI4–DI8 are spare inputs and RO3–RO8 remain off.
- `age = elapsed(watering)` measures time since the Boolean state last changed. The cycle ends at exactly five minutes; a later new DI1 edge restarts the interval.

## Required capability bindings

| Channel | Name | Role |
| --- | --- | --- |
| DI1 | Watering request | button |
| DI2 | Stop | button |
| DI3 | Low water | sensor |
| RO1 | Pump | pump |
| RO2 | Watering valve | valve |

## Original intent and interpretation

<!-- ghostflow:anchor id=GF-INT-FIXTURE-WATERING-V1 kind=intent status=confirmed origin=user -->
Original request (2026-09-15, callin2/ghostflow-language#81, Backlog TASK-121.8.1):
“DI1 momentary request: only a false-to-true edge starts/restarts watering;
DI2 stop and DI3 low-water each stop immediately and have priority; clearing
either condition or holding DI1 must not restart; RO1 pump and RO2 watering
valve operate in lockstep from the accepted watering state; timer age =
elapsed(watering), exact 5min cutoff.”

- DI1 true denotes the asserted button; DI2/DI3 true denotes the corresponding stop condition. The original request does not specify electrical polarity.
- The capability mapping identifies logical channels and makes no assertion about Waveshare polarity or physical wiring.

## New revision with explicit input quality

This revision uses the #531 quality input contract. Healthy false/0 is not a fault.
A DI1 fault prevents new starts and retains existing operation only when DI2/DI3 are healthy and released.
A DI2 or DI3 fault clears operation. Once any input fault has been observed, a healthy DI1 false sample followed by true is required to restart. Recovery alone does not start operation.
The predecessor is preserved in `tests/fixtures/history/issue531/consumer-fixtures.pre-input.json`.

```ghost
control FiveMinuteWatering {
  input DI1, DI2, DI3, DI4, DI5, DI6, DI7, DI8: Bool;
  let request_good = case DI1 { ok(_) => true; fault(_) => false; };
  let stop_good = case DI2 { ok(_) => true; fault(_) => false; };
  let low_water_good = case DI3 { ok(_) => true; fault(_) => false; };
  let request = DI1 |> recover(false);
  let stop = DI2 |> recover(true);
  let low_water = DI3 |> recover(true);
  let watering_limit = 5min;
  output RO1, RO2, RO3, RO4, RO5, RO6, RO7, RO8: Bool;

  // ghostflow:link id=GF-INT-FIXTURE-WATERING-V1 relation=implements
  state request_was_high: Bool = false;
  // ghostflow:link id=GF-INT-FIXTURE-WATERING-V1 relation=implements
  state watering: Bool = false;
  // ghostflow:link id=GF-INT-FIXTURE-WATERING-V1 relation=implements
  timer age = elapsed(watering);

  request_was_high' = if !request_good || !stop_good || !low_water_good then true else request;
  watering' = !stop && !low_water
    && ((request && !request_was_high) || (watering && age < watering_limit));

  // ghostflow:link id=GF-INT-FIXTURE-WATERING-V1 relation=implements
  RO1 <- watering';
  // ghostflow:link id=GF-INT-FIXTURE-WATERING-V1 relation=implements
  RO2 <- watering';
  RO3 <- false;
  RO4 <- false;
  RO5 <- false;
  RO6 <- false;
  RO7 <- false;
  RO8 <- false;
}
```

## Corpus role

This literate document is the canonical parser corpus input. It does not replace imported intent or earlier history, benchmark, replay, or projection evidence.
