# Bounded adaptation settings host

`runtimes/wasm/adaptation-settings-host.mjs` implements Reference §4.14 proposal
admission around the actual Rust context settings owner. It does not evaluate
GhostFlow expressions or provide output authority. The compiler carries typed
`allowed`, `maxStep`, `maxChange` and `windowMs` values from canonical source;
Temperature changes use TemperatureDelta, and other quantities retain canonical
units. Unknown fields, ambiguous targets and invalid bounds fail compilation.
Activation consumes a trusted canonical compiler artifact. Policy metadata is
not authenticated by the bytecode digest alone; structural validation does not
certify arbitrary caller-supplied manifests or source provenance.

Create `AdaptationSettingsHost.instantiate(wasm, artifact, { context,
authorities: { model: 'optimizer' }, historyCapacity: 256 })`. The trusted host
supplies the actor-to-authority mapping at fresh activation. Policies must target
operator-editable numeric context configs. `step(packet, proposal)` takes the
normal ControlRuntime packet and a proposal with `eventId`, `actor`, `authority`,
`source`, `evidence`, `sourceSha256`, `policySha256`, `programFingerprint`, `baseRevision`, `atMs`, and `changes`
of `{ configId, type, value }`. Obtain current identity from `snapshot().core.state`.
Use `snapshot().sourceSha256` for canonical source identity: policy-only source
changes can retain identical bytecode and core fingerprints and must still
reject proposals addressed to an older policy source.
`snapshot().policySha256` captures the checked policy descriptors as canonical
JSON. Activation and step arguments are privately copied before validation.
Occurrence time must equal the packet's monotonic clock. Every proposal property
must pass type, setting grid/range, allowed range, step, authority and rolling
absolute-change checks before one atomic core settings event is submitted.

For example, with a 10% hourly limit, an accepted change 20%→30% followed by
30%→25% within the hour exceeds the absolute-change budget. A second proposed
property in that event also stays unchanged. Rejection returns `outcome: null`
and an adaptation trace containing old/proposed/effective values, provenance,
reason, actual program/settings identity and the next one-based core position.
It commits no tick, clock, history or revision. Success returns actual core output
and the new revision; histories are recorded only after core acceptance. The
window excludes its exact left boundary. Int and Duration grids use exact remainder.

This bounded reference profile owns a private fresh core, offers copy-only
snapshots and exposes no restore or out-of-band settings API. `historyCapacity`
(1–4096) bounds both live change entries and total accepted event identities;
exhaustion rejects, and expired history never erases duplicate protection.
Integrating checkpoint recovery requires preserving both states and is outside
this profile. Rejected proposals are not accepted clock observations. Optimizer
provenance lives in the host trace; the existing `operatorEdit` wire origin means
an authorized operating edit here, not proof that a human edited it. The adapter
does not establish API publishing run identity, Device application or hardware
verification. REF-04-064 in `tests/adaptation-settings-host.test.mjs` verifies
actual activation, atomic rejection, accepted values and revision boundaries.
