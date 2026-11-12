# Monitoring plan start conditions

[한국어](MONITORING-PLAN.ko.md)

`GhostFlow/monitoring-plan-v1` describes compiler-checked links between
declared outputs and control logic. The optional `startCondition` field
applies to a `scheduled-timed-latch` pattern.

| Value | Meaning |
|---|---|
| `schedule-only` | The latch starts directly from the schedule's `.due` projection. The compiler checks for a pulse with a literal true start policy, or an unconditional legacy slot. The control has no output constraints. |
| `conditional` | An extra start condition, schedule policy, or output constraint can affect the proposed interval. This is also the consumer default when a signed plan omits the field. |

The Device can attach this classification to a forecast that has a supported
schedule and a trusted clock. A renderer uses `schedule-only` for time-based
planned intervals. Both kinds remain forecasts. Observed transitions come
from the Device output record for the relevant scan. Host authorization,
clock recovery, and physical output evidence have their own contracts.

Portable package replay checks an explicit value against the original source.
An older signed plan that omits the field keeps its original metadata and
conditional display. Replay checks the rest of that plan and its artifact
identity. The field leaves the source and GFB bytes unchanged.
