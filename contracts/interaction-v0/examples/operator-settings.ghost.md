# Renderer-independent operator settings fixture

<!-- ghostflow:anchor id=GF-INT-FIXTURE-OPERATOR-SETTINGS-V0 kind=intent status=confirmed origin=user -->
Expose the authored operating limits and apply policy without choosing controls,
layout, colors, or any other renderer behavior.

```ghost
control OperatorSettings {
  // ghostflow:link id=GF-INT-FIXTURE-OPERATOR-SETTINGS-V0 relation=implements
  config duration: Duration = 5min { min = 1min; max = 20min; step = 1min; access = operator; apply = stopped; label = "Watering duration"; }
  // ghostflow:link id=GF-INT-FIXTURE-OPERATOR-SETTINGS-V0 relation=implements
  config duty: Percent = 50% { min = 0%; max = 100%; step = 10%; access = designer; apply = stopped; label = "Duty"; }
  // ghostflow:link id=GF-INT-FIXTURE-OPERATOR-SETTINGS-V0 relation=implements
  config enabled: Bool = false { access = operator; apply = stopped; label = "Enabled"; }

  output ready: Bool;
  ready <- enabled && duration > 0min && duty > 0%;
}
```
