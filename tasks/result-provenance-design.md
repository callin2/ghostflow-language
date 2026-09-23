# Result lowering and executed recovery evidence

Status: implementation decision; acceptance remains pending.

Normative basis: Reference §2.5 preserves the original fault and fallback choice;
§2.6 preserves lazy evaluation; §2.8 rejects a failed tick atomically;
§7.4 preserves observable meaning through lowering.

## Representation

Result is a transient compiler value with typed `ok`, `value`, `faultCode` and
`originTag` expressions. It is not a new VM value or a storable input/output/state
type. Result type equality includes both payload and error type. Built-in fault
members resolve from the expected error type; ambiguity is a source error.

Fault codes and origin tags use the existing Number representation for finite
enums. Sensor quality codes are explicitly mapped to the declared SensorFault
members; their numeric ordering is not assumed to match. Source metadata binds
origin tags to sensor identity or an explicit fault-construction source node.

## Actual recovery choice

GFB3 opcode 56, `trace-result <u32 site>`, consumes
`[payload: T, choice: Number, origin: Number]` and leaves the identical payload.
The internal expression is
`['trace-result', String(site), payload, choice, origin]`.

The Rust tick record exposes a dedicated `resultTrace` array of
`{site, choice, origin}` events. It never inserts diagnostic names into requested
or safe actuator intents. Existing native/WASM trace JSON carries this field;
no new C ABI entry point is required.

- `site` is a positive u32 linked to the compiled source node identity. Repeated
  expansions of the same function body may emit the same site; it is not a
  unique runtime invocation ID.
- `choice = 0` means an evaluated Ok branch; a positive choice is the fault
  member ordinal plus one (maximum 65535).
- `origin = 0` means no fault origin; positive u32 tags resolve through source
  metadata to the sensor or explicit fault-construction node.
- Events retain evaluation order and repeats. An absent site does not imply Ok;
  it has no completed evaluation recorded in that tick.
- The event is appended after its payload expression succeeds. Unselected
  branches produce no event. Constant folding must preserve executed markers.

All event metadata is checked for exact integer range. The buffer belongs to the
candidate tick and commits with state/intents. Any later fault discards its
events. Journaling and replay use the same committed record; there is no separate
mutable recovery-history checkpoint.

## Bounds and evidence

Forward-only expressions and the existing module/expression byte budgets bound
marker execution. The strategy bound counts every transition/intent occurrence,
including repeated emitted expressions. No separate arbitrary 256-marker limit
is introduced.

Static source dependencies describe possible reads. They cannot establish which
fallback executed. Hosts join core-produced events to verified source metadata
and sensor quality; they do not evaluate language expressions in JavaScript.

Source metadata records each recovery site and its permitted origins. Canonical
source replay supplies the expected site table to restoration/package validation.
Exact comparison is required: deleting a site or origin must not pass merely
because the remaining metadata is structurally valid. The table remains bound to
the document and bytecode identities.

Required acceptance includes malformed instruction/profile/stack rejection,
structural Result typing, skipped callback faults, exact fault identity, actual
native/WASM events, faulted-tick rollback, source restoration/tampering and
journal/replay behavior. Focused success does not imply whole Reference support.

## Consumer boundary still requiring final audit

Canonical source replay and exact recovery-site metadata comparison are performed
by the Node restoration API and JavaScript signed-package verifier. The Rust
package verifier checks signatures, artifact digests, envelope identities and
manifest contracts; it does not run the source compiler or independently prove
the same Result-site lowering. Native execution tests prove VM events, not that
stronger source-replay claim. Final package/deployment acceptance must preserve
this distinction and check it against the required trust boundary.
