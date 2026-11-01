# A complete local output envelope

This software-only example contains exactly one control, with no imports and no
hidden bindings. The test host supplies all four inputs as Bool observations.
All four outputs are virtual Bool intent endpoints. For these particular virtual
endpoints, `false` is the explicitly chosen inactive value. That choice does
not make `false` a safe behavior for arbitrary physical resources.

The request states a goal. Local mandatory rules then limit which outputs are
permitted: the pump needs a ready valve, and the two direction outputs must not
be active at the same time. These rules do not choose an automatic/manual
arbitration policy, and they do not certify that any output reached hardware.

This is the explicit input-quality-v1 revision. When producer data is unknown (a fault), the example keeps its last observation of that input. The initial `false` only initializes this source-local observation memory. The original document is preserved separately.

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

The `constraints LocalEnvelope` block holds two local rules. Each scan, the
control first computes the *requested* outputs from the inputs. The rules then
project them onto the *safe* outputs that the host actually receives:

| Situation | Inputs | Requested outputs | Safe outputs | Rule that applies |
| --- | --- | --- | --- | --- |
| Valve not ready | `start=true`, `valve_ready=false` | `pump=true`, `valve=false` | `pump=false`, `valve=false` | `require at safe_output pump => valve` |
| Valve ready | `start=true`, `valve_ready=true` | `pump=true`, `valve=true` | `pump=true`, `valve=true` | Rule satisfied; the same request is now permitted |
| Both directions requested | `forward_request=true`, `reverse_request=true` | `forward=true`, `reverse=true` | `forward=false`, `reverse=false` | `mutex(forward, reverse)` |

This is local output projection only. It is not admission control and not
generic shared-resource enforcement. The [constraint contract](../docs/CONSTRAINTS.md)
describes those separate stages and the explicit binding boundary.
