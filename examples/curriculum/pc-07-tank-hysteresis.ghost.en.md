<!-- translation-source: examples/curriculum/pc-07-tank-hysteresis.ghost.md -->
[Korean original](pc-07-tank-hysteresis.ghost.md)
> Reading translation. Compile the linked original `.ghost.md` file.

# PC-07 — Two-point tank-level control and conflict safety

<!-- ghostflow:anchor id=GF-INT-PC07-TANK-HYSTERESIS-V1 kind=intent status=confirmed origin=imported -->
> Learning scenario: Learn upper/lower tank-level control from the PLC-replacement
> curriculum using two digital level switches and explicit state transitions.
> This document is not a direct user quote.

The linked original is the sole canonical literate executable source for PC-07. It preserves
and references the distinct [tutorial/03-moisture](../tutorial/03-moisture.ghost.md),
which covers a continuous moisture sensor with median filtering, quality states,
and hysteresis. This lesson addresses tank filling with physical upper/lower
switches rather than analog values or continuous-sensor processing.

When `low_level_reached` is true, water has reached and wetted the lower switch;
when `high_level_reached` is true, water has reached and wetted the upper switch.
The normal sequence reaches the lower switch before the upper one, so
`high_level_reached=true` with `low_level_reached=false` is a sensor conflict.
Common stop/protection permission such as `stop_ok` is not mixed into this lesson's
inputs; it is combined again in PC-08/PC-10. `fill_pump` is a logical command to
the filling contactor, not feedback that the pump actually runs.

```ghost
control TankLevelHysteresis {
  input low_level_reached, high_level_reached: Bool;
  output fill_pump: Bool;

  type Phase = Idle | Filling | SensorConflict;
  // ghostflow:link id=GF-INT-PC07-TANK-HYSTERESIS-V1 relation=implements
  state phase: Phase = Idle;

  let conflict = high_level_reached && !low_level_reached;

  phase' = case phase {
    Idle =>
      if conflict then SensorConflict
      else if !low_level_reached then Filling
      else Idle;

    Filling =>
      if conflict then SensorConflict
      else if high_level_reached then Idle
      else Filling;

    SensorConflict =>
      if conflict then SensorConflict
      else Idle;
  };

  fill_pump <- phase' == Filling;
}
```

Conflict is handled first in every state and turns off the pump command. While
filling, `Filling` remains active even while the lower switch stays wet; when
the upper switch becomes wet, the phase changes to `Idle`. By evaluating
`phase` alongside the current switch values, the control preserves the state
between lower and upper levels instead of deriving every scan only from the
two current switch values.

At startup, `low_level_reached=true, high_level_reached=false` means the level
is already above the lower switch, so the pump stays off. If both switches are
false at startup, the tank is treated as below the lower level and filling
starts on the next scan. The scan that clears a conflict deliberately recovers
to `Idle/off` once. Normal automatic evaluation resumes only on the following
scan, preventing an immediate restart from incomplete or unresolved inputs just
after the conflict. If both switches are false after the conflict clears, the
next scan may evaluate below-level demand and start filling.

Within this example's assumption that both normalized inputs are healthy,
`low_level_reached=false, high_level_reached=false` means below the lower level.
It does not infer wire breaks, stuck switches, or unknown quality from the same
Bool combination. Those diagnostics and common stop/protection permissions remain
in PC-08/PC-10. Correct physical switch wiring, water movement, pump rotation,
and flow are outside the evidence provided by this logic example and checker.
PC-10 extends this boundary with timeout, fault latch, and reset.

`tools/check-pc-07.mjs` creates a fresh WASM `ControlRuntime` for each case and
does not rebuild the existing WASM. A checker PASS means the literate source
compiled with the current compiler and its logical command trace matched
expectations on the existing WASM. It prints SHA-256 values for the source,
checker, compiler, toolchain, literate extractor, WASM, adapter, and expected
values to identify the evidence under test.
