# A complete local output envelope

This software-only example has one control and no imports or hidden bindings.
All four inputs are Bool observations supplied by the test host. All four
outputs are virtual Bool intent endpoints. For these particular virtual
endpoints, false is the explicitly selected inactive value. That choice is
not a safe behavior for arbitrary physical resources.

The request expresses a goal. The local mandatory rules restrict its permitted
outputs: the pump needs a ready valve, and the two direction outputs cannot
be active together. They do not select an automatic/manual arbitration policy
or certify that any output was applied to hardware.

Explicit input-quality-v1 revision: unknown producer data retains this virtual example’s last observation. Initial false initializes source-local observation memory. The original document is preserved separately.

```ghost
control OutputEnvelope {
  input observed_start, observed_valve_ready, observed_forward_request, observed_reverse_request: Bool;
  state remembered_start: Bool = false;
  let start = case observed_start { ok(value) => value; fault(_) => remembered_start; };
  remembered_start' = start;
  state remembered_valve_ready: Bool = false;
  let valve_ready = case observed_valve_ready { ok(value) => value; fault(_) => remembered_valve_ready; };
  remembered_valve_ready' = valve_ready;
  state remembered_forward_request: Bool = false;
  let forward_request = case observed_forward_request { ok(value) => value; fault(_) => remembered_forward_request; };
  remembered_forward_request' = forward_request;
  state remembered_reverse_request: Bool = false;
  let reverse_request = case observed_reverse_request { ok(value) => value; fault(_) => remembered_reverse_request; };
  remembered_reverse_request' = reverse_request;
  output pump, valve, forward, reverse: Bool;
  pump <- start;
  valve <- valve_ready;
  forward <- forward_request;
  reverse <- reverse_request;

  constraints LocalEnvelope {
    require at safe_output pump => valve;
    mutex(forward, reverse);
  }
}
```

For start=true and valve_ready=false, requested pump=true becomes safe
pump=false. When valve_ready becomes true, the same request is permitted.
With both direction requests true, both direction outputs become false.
This is local output projection, not admission or generic shared-resource
enforcement. See the [constraint contract](../docs/CONSTRAINTS.md) for those
separate stages and the explicit binding boundary.
