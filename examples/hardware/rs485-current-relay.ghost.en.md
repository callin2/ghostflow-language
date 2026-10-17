<!-- translation-source: examples/hardware/rs485-current-relay.ghost.md -->

[Korean original](rs485-current-relay.ghost.md)

---
profile: ess3h32@1

devices:
  meter1:
    profile: jsy-mk-333@1
  meter2:
    profile: jsy-mk-333@1
    params: { address: 2 }
  relay:
    profile: rs485-relay-8ch-example@1
    params: { address: 3 }

bindings:
  motor1Current: meter1.currentA
  motor2Current: meter2.currentA
  motor1Run: relay.RO1
  motor2Run: relay.RO2
  auxiliary3: relay.RO3
  auxiliary4: relay.RO4
  auxiliary5: relay.RO5
  auxiliary6: relay.RO6
  auxiliary7: relay.RO7
  auxiliary8: relay.RO8
---

# RS485 Current Inputs and 8-Channel Relay Outputs

[Korean original](rs485-current-relay.ghost.md) · [Design purpose](../../docs/PROFILE-FRONT-MATTER.en.md)

This canonical example extends the preceding design example with two current meters by adding an output device. It shows that logical inputs and outputs can bind to different drivers sharing the same RS485 connection. It does not mean the physical installation of either current meter has been verified.

The relay board reflects the user-confirmed settings: 8 channels, address 3, and 9600 bps. The attached material shows 9600 8 N 1. Because the board's default RS485 connection and the device profile both provide 9600/8N1, the customer YAML does not repeat `bus` or the communication settings. A speed mismatch produces an error during interpretation. Addresses 1 and 2 are assigned to the current meters, and address 3 to the relay.

The profile IDs and `RO1`–`RO8` shown here are **design/verification contract names**, not profiles published for an actual product. The relay fixture is checked against an RS485/Modbus RTU contract. Before publishing a driver/profile, the actual product model, protocol specification, per-channel registers, ON/OFF values, responses, and output-failure handling must be confirmed. The photograph's initial example using address 1 is not an instruction to change the current address 3. This document does not send commands to physical equipment.

<!-- ghostflow:anchor id=CURRENT-RELAY kind=assumption status=unconfirmed origin=ai -->
This example assumes that if a motor's phase-A current is at least 0.1 A, it requests the corresponding relay output 1 or 2 ON; if the current is below that threshold or the input has an error, it requests OFF. This is example behavior to demonstrate the bindings, not a user-approved control policy.

<!-- ghostflow:anchor id=UNUSED-RELAYS kind=assumption status=unconfirmed origin=ai -->
This example assumes that unused relay outputs 3–8 are always requested OFF. Output requests are distinct from confirmation of physical contacts.

```ghost
control CurrentRelayExample {
  // ghostflow:link id=CURRENT-RELAY relation=assumes
  input motor1Current, motor2Current: ElectricalCurrent;
  // ghostflow:link id=CURRENT-RELAY relation=assumes
  output motor1Run, motor2Run: Bool;
  // ghostflow:link id=UNUSED-RELAYS relation=assumes
  output auxiliary3, auxiliary4, auxiliary5, auxiliary6, auxiliary7, auxiliary8: Bool;

  // ghostflow:link id=CURRENT-RELAY relation=assumes
  motor1Run <- (motor1Current |> recover(0A)) >= 0.1A;
  // ghostflow:link id=CURRENT-RELAY relation=assumes
  motor2Run <- (motor2Current |> recover(0A)) >= 0.1A;
  // ghostflow:link id=UNUSED-RELAYS relation=assumes
  auxiliary3 <- false;
  // ghostflow:link id=UNUSED-RELAYS relation=assumes
  auxiliary4 <- false;
  // ghostflow:link id=UNUSED-RELAYS relation=assumes
  auxiliary5 <- false;
  // ghostflow:link id=UNUSED-RELAYS relation=assumes
  auxiliary6 <- false;
  // ghostflow:link id=UNUSED-RELAYS relation=assumes
  auxiliary7 <- false;
  // ghostflow:link id=UNUSED-RELAYS relation=assumes
  auxiliary8 <- false;
}
```
