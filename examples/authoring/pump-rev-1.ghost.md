# Pump request with permission

This is revision rev-1-input-v1 of document `GF-EXAMPLE-PUMP`. It is a complete literate
candidate. The user confirmed that stop takes priority and that an absent
permission blocks the pump's safe intent.

<!-- ghostflow:anchor id=GF-INT-PUMP-REQUEST kind=intent status=confirmed origin=user -->
> Start requests the pump. Stop cancels the request.

<!-- ghostflow:anchor id=GF-INT-PUMP-PERMIT kind=intent status=confirmed origin=user -->
> The pump must be blocked when permission is absent.

<!-- ghostflow:anchor id=GF-ASM-PUMP-MAX-RUN kind=assumption status=unconfirmed origin=ai -->
> A maximum run duration may be wanted. Its value and restart rule were not supplied. Ask the user before adding a timer.

Explicit input-quality-v1 source revision. Unknown requests retain authored state and cannot create a new request; known STOP or a known released START cancels it. Original source bytes and dated benchmark evidence remain separately preserved.

```ghost
control PumpRequest {
  input start, stop, permit_ok: Bool;
  output pump, permit: Bool;
  // ghostflow:link id=GF-INT-PUMP-REQUEST relation=implements
  state requested: Bool = false;
  let start_good = case start { ok(_) => true; fault(_) => false; };
  let stop_good = case stop { ok(_) => true; fault(_) => false; };
  let start_value = case start { ok(value) => value; fault(_) => requested; };
  let stop_value = case stop { ok(value) => value; fault(_) => false; };
  requested' = if stop_good && stop_value then false
    else if start_good && !start_value then false
    else if start_good && stop_good then start_value && !stop_value
    else requested;

  // ghostflow:link id=GF-INT-PUMP-PERMIT relation=implements
  state permission: Bool = false;
  permission' = case permit_ok { ok(value) => value; fault(_) => permission; };

  // ghostflow:link id=GF-INT-PUMP-REQUEST relation=implements
  pump <- start && ;
  permit <- permission';

  // ghostflow:link id=GF-INT-PUMP-PERMIT relation=constrains
  require pump => permit;
}
```
