<!-- translation-source: examples/curriculum/pc-03-motor-contactor.ghost.md -->
[Korean original](pc-03-motor-contactor.ghost.md)
> Reading translation. Compile the linked original `.ghost.md` file.

# PC-03 — Motor contactor command and overload permission

<!-- ghostflow:anchor id=GF-INT-PC03-MOTOR-PERMIT-REARM-V1 kind=intent status=confirmed origin=imported -->
> Learning scenario: Add the motor's overload-protection permission to PC-02's
> latching behavior. This document defines a curriculum learning scenario; it
> does not quote a direct user statement.

The linked Korean original is the only canonical, literate, executable source
for PC-03. It reuses PC-02's fresh-start event and restart inhibition, and it
keeps the basic latching example of lesson
[E03](../../docs/ProgrammingInGhostflow.en.md#ch03) intact.

`stop_ok` and `overload_ok` are permission inputs whose meaning is already
normalized: `true` means the stop path or the overload protection permits
operation. The NC wiring and contact polarity of the real stop button and
overload relay belong to the electrical installation and the device adapter.
This learning example receives only Bool values.

This explicit quality-input revision keeps the healthy-input replay unchanged.
For acquisition faults:

- An unavailable START request cannot start or rearm the control. An existing
  run may continue while STOP and protection stay healthy and permit operation.
- An unavailable STOP or protection input removes permission.
- After recovery, a healthy START release followed by a new START request is
  required.

The previous source is kept as non-executable history at
`tests/fixtures/history/issue531/pc-03-motor-contactor.ghost.en.md.pre-input.txt`.

```ghost
// Source revision: issue531-approved-fault-restart-v1
control MotorContactor {
  input start, stop_ok, overload_ok: Bool;
  output motor_contactor: Bool;

  // ghostflow:link id=GF-INT-PC03-MOTOR-PERMIT-REARM-V1 relation=implements
  state armed: Bool = false;
  // ghostflow:link id=GF-INT-PC03-MOTOR-PERMIT-REARM-V1 relation=implements
  state running: Bool = false;

  let start_good = case start { ok(_) => true; fault(_) => false; };
  let start_value = start |> recover(false);
  let stop_ok_good = case stop_ok { ok(_) => true; fault(_) => false; };
  let stop_ok_value = stop_ok |> recover(false);
  let overload_ok_good = case overload_ok { ok(_) => true; fault(_) => false; };
  let overload_ok_value = overload_ok |> recover(false);

  let permit = stop_ok_value && overload_ok_value;
  let start_event = start_good && armed && start_value;

  running' = permit && (start_event || running);
  armed' = start_good && permit && !start_value;

  motor_contactor <- running';
}
```

`motor_contactor` is the logical command sent to the MC (magnetic contactor)
coil. It does not prove that the main contacts closed, that the motor is
energized, or that it is rotating.

If the overload relay trips during operation (`overload_ok=false`), the next
state and the command turn off in the same tick. When protection recovers,
holding START does not arm the control, so the motor does not restart by
itself. START must be released and then pressed again to permit a fresh start.

In the installation, the two circuits are:

- **Main circuit:** the power path from the breaker through the MC main
  contacts and the overload relay to the motor.
- **Control circuit:** the path that energizes the MC coil from the control
  supply, through the STOP and overload-protection contacts and the latching
  branch formed by START and an MC auxiliary contact.

A software coil command does not replace independent electrical overcurrent,
emergency-stop, or protection functions.

This example has no alarm output, fault latch/reset, timer, sensor feedback,
hardware operation, or new GhostFlow syntax. Later curriculum stages cover
those topics separately.

`tools/check-pc-03.mjs` produces virtual/compiler/WASM learning evidence with
the current compiler and the existing WASM runtime. Its result contains no
physical evidence about the relay, the MC main contacts, motor power, or motor
rotation.
