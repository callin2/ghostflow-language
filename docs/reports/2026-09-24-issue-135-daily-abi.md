# Daily pulse execution ABI — 2026-09-24

Issue 135's first slice executes the unchanged `REF-03-024` canonical literate
document. Accepted execution is limited to a literal Daily TimeOfDay, explicit
timezone and DST policies, `pulse`, `trusted_only`, `skip_after`, `baseline`,
`fallback = skip`, and a compiled Bool predicate. Other civil trigger/basis,
calendar and dynamic-start contracts retain their explicit non-executable
descriptor route. Mixed window/certified-interval preludes are rejected.

## Version decision

GFB7 is already the PID profile. Daily uses GFB8 with prelude tag 3. Its wire
descriptor contains site, name, timezone, milliseconds after local midnight,
the two DST policy tags, four zero policy tags, gap milliseconds and the compiled
predicate. `GhostFlow/control-v7` identifies this executable manifest. The
loader requires a Daily descriptor in GFB8 and rejects its tag in older profiles.

The source-bound artifact retains the exact original literate document and
source identities. The public compiler does not substitute a derived control.

## Facts and ownership

`gf_activate_schedules` binds boot epoch and an explicit terminal ledger capacity
of 1–4096 entries per schedule. `gf_tick_schedules` consumes bounded GFSF v2
packets. The packet retains v1's clock snapshot and per-site coverage, adding a
trigger-kind byte and a row fold byte. Limits remain 65536 packet bytes, 128
schedules, 4096 rows per schedule and 128 UTF-8 bytes per revision.

The reference JavaScript encoder is `encodeScheduleFacts`. Its object shape is:

```js
{
  clock: { monotonicMs, bootEpoch, wallMs, trusted, uncertaintyMs, sourceRevision },
  schedules: [{
    kind: 'daily', site, coverageFromWallMs, coverageToWallMs,
    rows: [{ sourceDay, fold, available, scheduledWallMs, providerRevision, contextRevision }]
  }]
}
```

An untrusted clock additionally carries `unknownReason`. Fold 0 means an ordinary
local timestamp; 1 and 2 mean first and second repeated timestamps. The runtime
checks fold tags against the descriptor's repeated-time policy. Terminal
identity is the stable schedule site plus local source day plus fold. Different
folds cannot collide, and a changed planned instant does not create a new identity.

The provider must derive a complete occurrence set from the installed descriptor,
the named IANA timezone database and its declared DST policies. It owns civil-time
conversion and reports revisions. A nonexistent local time with `skip` contributes
no occurrence; an unavailable conversion/context is explicitly unavailable, not
an asserted complete empty set. This slice does not implement an IANA database in
the Rust VM or certify the truth of externally supplied provider facts.

Rust verifies the descriptor, binding, kind, bounds, identities and repeated-fold
policy. Rust evaluates the source predicate, clock gate, crossings, terminal
ledger, `.due`/`.missed`, scalar transitions and requested/safe output transaction.
No fact packet accepts a caller-computed `due` bit. Outer transaction failure
discards staged clock, ledger, scalar and output changes together.

Unavailable facts and stale coverage yield Unknown with their reason and supplied
provider/context revision evidence. Context uncertainty does not relabel the
supplied clock as untrusted. Clock uncertainty preserves its own reason. Rejected
malformed packets create no accepted observation. Capacity exhaustion rejects the
tick; it does not evict duplicate-suppression history.

## Existing Solar consumers

GFB5 and GFSF v1 retain their Solar-only meaning and dedicated entry points.
GFSF v1 cannot carry civil folds; GFB8 rejects the Solar-only activation/tick API.
The shared Rust pulse engine gains tuple identity and reason evidence, while a
`PulseDescriptor` enum distinguishes Daily from Solar. This is shared execution
machinery, not a Daily-to-Solar artifact fallback. Rust consumers inspecting the
descriptor now match that enum. Firmware consuming older pinned revisions is not
changed by this repository work.

## Evidence boundary

Native tests cover typed descriptor rejection, distinct transport, malformed
kind, stale coverage, context absence, atomic rollback, fold identity, duplicate
identity and time bounds. The low-level WASM test compiles the unchanged
REF-03-024 and supplies a fact for 2026-09-24 06:30 Asia/Seoul. It verifies baseline,
accepted crossing, malformed-kind rollback and wall rollback deduplication.
Existing Solar conformance tests remain active. Host simulation integration is a
separate checkpoint; no Device or physical output verification is claimed here.
