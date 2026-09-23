# Pump request with permission

This is revision 1 of document `GF-EXAMPLE-PUMP`. It is a complete literate
candidate. The user confirmed that stop takes priority and that an absent
permission blocks the pump's safe intent.

<!-- ghostflow:anchor id=GF-INT-PUMP-REQUEST kind=intent status=confirmed origin=user -->
> Start requests the pump. Stop cancels the request.

<!-- ghostflow:anchor id=GF-INT-PUMP-PERMIT kind=intent status=confirmed origin=user -->
> The pump must be blocked when permission is absent.

<!-- ghostflow:anchor id=GF-ASM-PUMP-MAX-RUN kind=assumption status=unconfirmed origin=ai -->
> A maximum run duration may be wanted. Its value and restart rule were not supplied. Ask the user before adding a timer.

```ghost
control PumpRequest {
  input start, stop, permit_ok: Bool;
  output pump, permit: Bool;

  // ghostflow:link id=GF-INT-PUMP-REQUEST relation=implements
  pump <- start && ;
  permit <- permit_ok;

  // ghostflow:link id=GF-INT-PUMP-PERMIT relation=constrains
  require pump => permit;
}
```
