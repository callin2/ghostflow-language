---
profile: waveshare-esp32-s3-eth-8di-8ro-r8n16@1
bindings:
  pump: board.RO1
---

# DevelopmentRollingDemand

<!-- ghostflow:anchor id=GF-ASSUME-HIL-ROLLING kind=assumption status=unconfirmed origin=ai -->
Development fixture with continuous demand on unloaded RO1 and an applied rolling budget of 30 seconds in 60 seconds.

```ghost
control DevelopmentRollingDemand {
  resource irrigation: BoolActuator;
  account applied = on_time(irrigation, stage: applied, persistence: durable, output: pump);
  constraints Budget { limit used(applied, rolling(60s)) <= 30s { reserve = 30s; on_unknown = block; } }
  output pump: Bool;
  // ghostflow:link id=GF-ASSUME-HIL-ROLLING relation=assumes
  pump <- true;
}
```
