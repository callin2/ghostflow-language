# Hardware declarations in canonical source

[한국어](HARDWARE-FRONT-MATTER.ko.md) · [Reference 1.1](reference/01-source-and-syntax.en.md)

The reserved top-level YAML `hardware` field in a `.ghost.md` document declares
installation dependencies and logical bindings for input drivers and output
renderers. The source document remains authoritative. The compiler returns a
derived `hardwarePlan`; the declaration does not execute code or change GFB bytes,
the runtime ABI, or the portable package format. Work: [#555](https://github.com/callin2/ghostflow-language/issues/555).

## Declaration

This example shows JSY as one input module and a relay as an output module.
The example digests are placeholders: deployment requires the actual exact-byte
profile/module digests and reviewed immutable revisions.

```yaml
hardware:
  schema: GhostFlow/hardware-v1
  profile:
    id: ess3h32
    revision: r1
    sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  modules:
    meter:
      id: jsy-mk
      revision: r1
      sha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    relay:
      id: relay-bank
      revision: r1
      sha256: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
  buses:
    serial:
      service: modbus-rtu
      config: { port: 1, baud: 9600, parity: none }
  instances:
    power:
      module: meter
      role: input
      config: { bus: serial, address: 1 }
    panel:
      module: relay
      role: output
      config: { channels: [{ pin: 3, inverted: false }] }
  bindings:
    inputs:
      current: { instance: power, channel: current }
    outputs:
      pump: { instance: panel, channel: relay1 }
```

Place the YAML between opening and closing `---` lines at the document start,
followed by Markdown and normal `ghost` fences. Closing `...` is also accepted.
The corresponding logical declarations can be:

```ghost
control MeterRequest {
  input current: Number;
  output pump: Bool;
  pump <- (current |> recover(0.0)) > 1.0;
}
```

All six hardware fields are required. `profile` and each `modules` value contain
exactly `id`, `revision`, and lowercase 64-hex `sha256`; `latest` is rejected.
Module aliases, bus/instance names and logical binding names are bounded to
`[A-Za-z_][A-Za-z0-9_.:-]{0,127}`. Pin IDs, revisions, service and channel strings
use `[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}`. Empty named maps are allowed.
Every bus has `service` and `config`. Every instance has `module`, `role`
(`input` or `output`) and `config`. Every binding has `instance` and `channel`.
Structural fields are closed; misspelled or missing fields fail compilation.

`config` is an object containing arbitrary nested JSON-compatible data. The
language does not special-case JSY, baud rates, addresses, GPIO or channel types.
The deployment owner must resolve the pinned profile and modules, validate each
configuration using its provider-supplied schema, validate service availability,
bus references, channel identity and types, then check admission before activation.
Parsing is not provider validation, module installation or physical verification.

Bindings refer to declared logical inputs and outputs in the compiler manifest.
Missing modules/instances, wrong instance roles, undeclared logical ports, and
duplicate instance/channel bindings within either role fail. Unbound logical
ports may use separately declared host context; the language does not synthesize
bindings. Two logical Number inputs can independently select different drivers.
Input acquisition quality and output requested/applied/confirmed evidence retain
their existing contracts. Executable import composition containing hardware in
the root or an imported document is rejected until composition semantics exist.

## Public helper and diagnostics

`parseHardwareFrontMatter(source, { filename })` from
`tools/hardware-frontmatter.mjs` returns `null` without the reserved field,
otherwise `{ format: 'GhostFlow/hardware-plan-v1', source: { filename, sha256 },
hardware, locations }`. `hardware` is the validated declaration; `locations`
maps JSON pointers such as `/hardware/instances/power/config/address` to
`{ filename, line, column, endLine, endColumn }` in the canonical document.
Locations are one-based; ends are exclusive. The digest covers the exact source
bytes, including prose and line endings. `validateHardwareBindings(plan, manifest)`
checks logical port membership separately. `compileSource` and `compileSourceSync`
return `hardwarePlan` only when the declaration exists.

The pinned YAML parser enforces unique keys. Hardware-bearing front matter rejects
aliases, anchors, explicit tags, merge keys, non-string keys, non-finite values and
prototype-sensitive object keys, with bounded nesting and node counts. Errors
carry canonical line/column and a `GhostFlow/diagnostics-v1` envelope with
`GF_HARDWARE` and source digest. Front matter without `hardware` retains its
existing non-executable behavior.

Why: colocating installation intent with control source keeps driver selection
reviewable and revision-bound without creating another editable control program.
The generic provider boundary accommodates measurement drivers, switches,
relays, motors and screens without embedding board behavior in the language.
