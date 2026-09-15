# Enum phase age interaction fixture

<!-- ghostflow:anchor id=GF-INT-FIXTURE-ENUM-PHASE-AGE-V0 kind=intent status=confirmed origin=user -->
The authored phase is a nominal state, and its age measures time since the
phase most recently changed, regardless of which phase is active.

```ghost
control EnumPhaseAge {
  input advance: Bool;
  output active: Bool;

  type Phase = Idle | Running;

  // ghostflow:link id=GF-INT-FIXTURE-ENUM-PHASE-AGE-V0 relation=implements
  state phase: Phase = Idle;
  // ghostflow:link id=GF-INT-FIXTURE-ENUM-PHASE-AGE-V0 relation=implements
  timer age = elapsed(phase);

  phase' = if advance then Running else Idle;
  active <- phase' == Running;
}
```
