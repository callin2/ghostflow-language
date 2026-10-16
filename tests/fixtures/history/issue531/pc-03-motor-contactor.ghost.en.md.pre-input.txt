<!-- translation-source: examples/curriculum/pc-03-motor-contactor.ghost.md -->
[Korean original](pc-03-motor-contactor.ghost.md)
> Reading translation. Compile the linked original `.ghost.md` file.

# PC-03 — Motor contactor command and overload permission

<!-- ghostflow:anchor id=GF-INT-PC03-MOTOR-PERMIT-REARM-V1 kind=intent status=confirmed origin=imported -->
> Learning scenario: Add the motor's overload-protection permission to PC-02's
> latching behavior. This document defines a curriculum learning scenario; it
> does not quote a direct user statement.

The linked original is the sole canonical literate executable source for PC-03. It reuses
PC-02's fresh-start event and restart inhibition, and preserves the existing
basic latching example in lesson [E03](../../docs/ProgrammingInGhostflow.md#ch03).

`stop_ok` and `overload_ok` are permission inputs with normalized meanings.
The NC wiring and contact polarity of the actual stop button and overload relay
belong to the electrical installation/device adapter; this learning example
receives only Bool values.

```ghost
control MotorContactor {
  input start, stop_ok, overload_ok: Bool;
  output motor_contactor: Bool;

  // ghostflow:link id=GF-INT-PC03-MOTOR-PERMIT-REARM-V1 relation=implements
  state armed: Bool = false;
  // ghostflow:link id=GF-INT-PC03-MOTOR-PERMIT-REARM-V1 relation=implements
  state running: Bool = false;

  let permit = stop_ok && overload_ok;
  let start_event = armed && start;

  running' = permit && (start_event || running);
  armed' = permit && !start;

  motor_contactor <- running';
}
```

`motor_contactor` is the logical command sent to the MC coil. It does not prove
that the main contacts closed, that the motor is energized, or that it is
rotating. If the overload relay trips and `overload_ok=false` during operation,
the next state and command turn off immediately. When protection recovers,
holding START does not arm the control, so it does not restart automatically.
START must be released and pressed again to permit a fresh start.

In the installation, the main circuit is the power path through the breaker,
MC main contacts, overload relay, and motor. The control circuit energizes the
MC coil from the control supply through STOP/overload protection contacts and
the START/MC auxiliary-contact latching branch. A software coil command does
not replace independent electrical overcurrent, emergency-stop, or protection
functions.

This example has no alarm output, fault latch/reset, timer, sensor feedback,
hardware operation, or new GhostFlow syntax. Later curriculum stages address
those topics separately.

`tools/check-pc-03.mjs` provides virtual/compiler/WASM learning evidence using
the current compiler and existing WASM runtime. Its result does not include
physical evidence for the relay, MC main contacts, motor power, or motor rotation.
