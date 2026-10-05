<!-- translation-source: examples/curriculum/pc-02-start-stop.ghost.md -->
[Korean original](pc-02-start-stop.ghost.md)
> Reading translation. Compile the linked original `.ghost.md` file.

# PC-02 — START / STOP latching and fresh-start permission

<!-- ghostflow:anchor id=GF-INT-PC02-START-STOP-REARM-V1 kind=intent status=confirmed origin=imported -->
> Learning scenario: Press START to begin operation and stop immediately when
> STOP is asserted. After STOP clears, operation may restart only after START
> has been released and pressed again, even if it was held during the stop.

The linked original is the sole executable source for PC-02. The basic latching behavior and
the requirement that `pump` implies `valve` are preserved in lesson
[E03](../../docs/ProgrammingInGhostflow.md#ch03). This example adds the stop
path, a fresh-start event, and restart inhibition.

`stop_ok` is a logical input indicating that the stop path permits operation.
It is supplied as `false` while STOP is active. The NO/NC polarity of the actual
STOP contact and the electrical safety circuit belong to the device adapter's
input semantics; this virtual example receives a normalized Bool payload and
acquisition quality.

This explicit new source revision preserves the existing healthy START/STOP scenario.
A START acquisition fault prevents a new start but retains an active run while
STOP is healthy and permits operation. A STOP acquisition fault clears running
and requests OFF. A fault on either input clears `armed`. Restart then requires
observing a healthy released START while STOP is healthy and permits operation,
followed by another press. An acquisition fault never counts as a healthy release
for rearming. The predecessor is retained in
`tests/fixtures/history/issue531/pc-02-start-stop.ghost.en.md.pre-input.txt`.

```ghost
// issue531-approved-fault-restart-v1: rearm requires healthy START release.
control StartStopPump {
  input start, stop_ok: Bool;
  output valve, pump: Bool;

  // ghostflow:link id=GF-INT-PC02-START-STOP-REARM-V1 relation=implements
  state armed: Bool = false;
  // ghostflow:link id=GF-INT-PC02-START-STOP-REARM-V1 relation=implements
  state running: Bool = false;

  let start_good = case start { ok(_) => true; fault(_) => false; };
  let stop_good = case stop_ok { ok(_) => true; fault(_) => false; };
  let start_requested = start |> recover(false);
  let stop_permitted = stop_ok |> recover(false);
  let start_event = start_good && armed && start_requested;

  running' = stop_permitted && (start_event || running);
  armed' = start_good && stop_good && stop_permitted && !start_requested;

  valve <- running';
  pump <- running';

  require pump => valve;
}
```

`running` is the previous operating state; `running'` is the next state for
this tick. `armed` remembers whether START was last observed released. Thus
`start_event` is false even if START is already pressed on a new runtime's first
input, and operation remains inhibited after STOP clears until START is released.

This example does not verify physical relay contacts, motor rotation, or a
wired safety circuit. Its focused checker compares `stateBefore`, `stateAfter`,
`requested`, and `safe` frames using the actual GhostFlow compiler and existing
WASM `ControlRuntime`.
