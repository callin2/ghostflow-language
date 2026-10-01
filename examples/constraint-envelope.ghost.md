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

```ghost
control OutputEnvelope {
  input start, valve_ready, forward_request, reverse_request: Bool;
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
