# Canonical external input and explicit revision migration

The pre-1.0 external declaration is `input name: T;`. Reading it yields
`Result<T, SensorFault>`, preserving the former sensor quality contract. Supported
payloads are Bool, Int, Number, Percent, Duration, Date, TimeOfDay, DateTime
and physical quantities. `let` computes a
binding, `state` remembers between ticks, and `output` declares requested intent.

```ghost
control ExplicitQuality {
  input request: Bool;
  output enabled: Bool;
  enabled <- request |> recover(true);
}
```

This example deliberately chooses true on fault; it is an illustrative authored
policy, not a recommended installation policy. Healthy false remains false.
Neither false/zero nor an all-off policy is automatically substituted on fault.
Case analysis and Result transforms retain NotReady, Disconnected, Stale and
Invalid provenance even when the author explicitly recovers a value.

Grouped names, `input observation?: Bool;`, units, cadence, valid ranges,
median/moving-average/EMA filters, stale limits and recovery counts use the
existing sensor contracts. Optional absence selects the authored adaptation
strategy; installed faults do not mean absence. In capability matches,
`sensor<Bool>` names the quality capability category, not a declaration alias.

## Source and history

The old `sensor` declaration is rejected with a migration diagnostic. No product
or raw compiler fallback accepts it. An old sensor program can become a new
reviewed revision by changing the declaration spelling while retaining its
existing explicit fault policy. Source bytes, source digest, revision and
approval identity must identify that new document. Keep its predecessor intact.

An old plain input program requires reviewing its use sites, not just a rename.
`request && !stop` cannot consume Result inputs. Establish a fault policy before
introducing exhaustive case analysis or an explicit recovery transform. Do not
infer that policy from healthy replay frames, labels or a target mode. A compiler
error neither edits the stored source nor creates a replacement revision.

Changing browser, USB or physical acquisition selects adapters and installation
bindings for the same approved document. It does not rewrite the source or
substitute a canned program. Keep source revision and artifact identity together.
The API owns persisted revisions and new-candidate approval.

All supported scalar payloads use typed quality samples. Int remains signed i32;
Duration remains a nonnegative safe integer in milliseconds; Date, TimeOfDay and
DateTime retain their existing exact integer domains. Fractional or out-of-range
numeric observations become Invalid before conditioning; malformed host record
types still reject. No conversion to Number, rounding or clock trust is inferred.
Exact types use the unchanged default identity filter. Explicit numeric filters
and hysteresis remain limited to Number, Percent and physical quantities.
Old plain scalar use sites still require an explicit authored Result policy.

## Acquisition and wire compatibility

The source keyword does not rename the wire-level quality category. Retain
`manifest.sensors`, `__gf_sensor_*` slots, existing Result origin/trace categories,
capability records, selected GFB versions and the WASM ABI. `manifest.inputs` no
longer contains authored plain external declarations. Internal VM slots still
carry scalar values, quality and fault codes through the existing lowering.

The reference Host accepts a producer observation as
`samples[name] = {epoch, id, timestampMs, quality, value}`. Quality is explicit;
Bool values remain booleans and numeric/quantity payloads use their canonical
unit. Timestamp must not exceed the scan time. A software producer may use its
own session epoch, observation sequence and monotonic observation timestamp.
This packet does not require a physical board ID. The producer supplies actual
observations, not a fresh sequence number for every clock-only scan.

Repeated sample identity contributes once to filters/recovery. A source epoch
change breaks continuity; processing prepares again from NotReady. Without new
samples, freshness is measured from the actual last valid timestamp. A literal
`ok(false)` in a pure expression creates none of this acquisition evidence.
Driver, USB and software adapters must separately establish their session,
binding, disconnect and delivery guarantees. A packet shape alone does not
prove provenance or physical acquisition.

## Ownership and adoption gates

| Owner | Contract to adopt |
| --- | --- |
| Language | Canonical syntax, typed Result, lowering, current wire formats and reference Host conformance |
| Simulator/browser | Same source/artifact; quality packets, producer continuity and existing generic sensor UI |
| Authoring | New candidates use input and explicit fault handling; preserve requested intent and original history |
| API | Immutable compiler/authoring pins, stored revisions and explicit candidate approval; no target-switch rewrite |
| Device/SDK | Immutable compiler/core pin, package/admission checks, existing typed samples and session fences |
| Driver | Source acquisition and metadata; generic Driver9 implementation remains separately owned |

Integration-v1 currently validates `manifest.inputs/outputs` bindings; that
validator does not establish `manifest.sensors` acquisition continuity. Do not
reuse a plain software endpoint binding pass as proof of quality acquisition.

Owner conformance, installed-consumer tests, browser execution, USB delivery and
physical output/contact evidence are separate gates. Consumer pins must name an
immutable reviewed owner candidate. No keyword change implies a Device release,
approved deployment, live source migration or physical hardware acceptance.

See [Reference 4](reference/04-sensors-constraints-control.en.md) and
[#531](https://github.com/callin2/ghostflow-language/issues/531).
