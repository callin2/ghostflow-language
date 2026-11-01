# Pump request with permission

This file is revision `rev-1-input-v1` of document `GF-EXAMPLE-PUMP`: a complete
literate candidate, checked before any correction. The user confirmed two rules:
STOP takes priority, and missing permission blocks the pump's safe intent.

<!-- ghostflow:anchor id=GF-INT-PUMP-REQUEST kind=intent status=confirmed origin=user -->
> Start requests the pump. Stop cancels the request.

<!-- ghostflow:anchor id=GF-INT-PUMP-PERMIT kind=intent status=confirmed origin=user -->
> The pump must be blocked when permission is absent.

<!-- ghostflow:anchor id=GF-ASM-PUMP-MAX-RUN kind=assumption status=unconfirmed origin=ai -->
> A maximum run duration may be wanted. Its value and restart rule were not supplied. Ask the user before adding a timer.

This is an explicit input-quality-v1 source revision: each input carries producer quality (`ok` or `fault`). An unknown (faulted) request keeps the stored request state and can never create a new request. A known STOP, or a known released START, cancels the request. The original source bytes and dated benchmark evidence are preserved separately. The `pump` assignment below is deliberately incomplete (`pump <- start && ;`): `ghostc` rejects it with a `GF_PARSE` diagnostic, and [revision 2](pump-rev-2.ghost.md) corrects it.

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
