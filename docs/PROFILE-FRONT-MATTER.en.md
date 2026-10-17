<!-- translation-source: docs/PROFILE-FRONT-MATTER.md -->

[Korean original](PROFILE-FRONT-MATTER.md)

# Profile-based Front Matter Design

[English](PROFILE-FRONT-MATTER.en.md) · [Issue #555](https://github.com/callin2/ghostflow-language/issues/555)

## Purpose

GhostFlow's higher-level purpose is to lower the barrier to automation by having AI translate control intent expressed in natural language into control programs, then execute those programs on real equipment in a predictable way that also accounts for intent and abnormal conditions. Because equipment can affect plants, animals, and people, concision must preserve the facts and failure states needed for verification.

**The direct purpose of front matter is to connect the logical inputs and outputs in the control body to the devices actually installed, while avoiding making customers repeat hardware facts already known by the board and driver.** Customers write the configuration they use, values that differ in their actual installation, and logical bindings. The control body does not need to know pins, communication implementations, driver initialization, warm-up, or minimum read intervals. Read failures and recovery states flow through the existing railway-oriented data path.

Separating metadata from the body follows the same division of responsibility. Control intent should remain usable when an installation changes, and the same installation knowledge should be reusable across multiple programs. Removing fields and moving them into hidden firmware constants does not achieve this purpose.

## What the Customer Writes

```yaml
---
profile: ess3h32@1

devices:
  meter1:
    profile: jsy-mk-333@1
  meter2:
    profile: jsy-mk-333@1
    params: { address: 2 }

bindings:
  motor1Current: meter1.currentA
  motor2Current: meter2.currentA
  motor1Run: board.RO1
  motor2Run: board.RO2
---
```

These names are design examples and do not denote published profile IDs. `profile` and `bindings` are required; omit `devices` when there are no additional devices. Each device has only `profile`, optional `params`, and optional `bus`. `board` is the reserved name for channels exposed by the board. Specify a bus such as `bus: board.rs485Aux` only when selecting a different communication connection.
This compact format permits only these three root fields and requires bindings for every logical input and output in the body. These fields are reserved so authored hardware YAML cannot silently become ordinary metadata.

The address 1, communication conditions, channel names, physical quantities, and units for `meter1` come from its device profile. Address 2 for `meter2` is an installation-specific difference. Inheriting an address default does not mean automatically changing the device's physical address. The customer chooses the logical name, while `currentA` is selected from the channel specification bundled with the driver. The canonical unit `A` for `ElectricalCurrent` is carried by the contract; compatible unit literals such as `mA` in the body follow the existing language's unit-conversion rules.

## RS485 Input and 8-Channel Relay Output

Add a **RYR408B** relay expansion board at address **3**, **9600 bps**, with **8 channels** to the preceding two-current-meter setup:

```yaml
---
profile: ess3h32@1

devices:
  meter1:
    profile: jsy-mk-333@1
  meter2:
    profile: jsy-mk-333@1
    params: { address: 2 }
  relay:
    profile: ryr408b@1
    params: { address: 3 }

bindings:
  motor1Current: meter1.currentA
  motor2Current: meter2.currentA
  motor1Run: relay.RO1
  motor2Run: relay.RO2
  auxiliary3: relay.RO3
  auxiliary4: relay.RO4
  auxiliary5: relay.RO5
  auxiliary6: relay.RO6
  auxiliary7: relay.RO7
  auxiliary8: relay.RO8
---
```

The [complete GhostFlow example](../examples/hardware/rs485-current-relay.ghost.en.md) includes intent links, control of outputs 1 and 2 based on current, and OFF requests for unused outputs 3–8.

The input current meters and output relay use the same default RS485 connection. The board/device profiles provide 9600/8N1, so the customer document does not repeat those settings. Addresses 1, 2, and 3 distinguish the devices. `relay.RO1`–`relay.RO8` are Bool output channels from the relay driver/profile and are distinct from built-in board channels such as `board.RO1`. Even for different drivers, duplicate addresses on the same physical bus must be an error.

RYR408B's address and baud rate are set by DIP switches. `address: 3` and the profile's `9600bps` configure communication to match the actual DIP values. Physical settings and declarations must agree; static validation checks agreement among the supplied contracts.

The relay model **RYR408B**, address, speed, and channel count are user-confirmed values; 8N1 is shown in the attached material. `ryr408b@1` and the channel names are proposed design contracts for the confirmed model, not yet published profiles. The static example assumes an RS485/Modbus RTU contract. Confirm the protocol specification, per-channel registers, and ON/OFF values before publishing a driver. Adding the example does not count as verification that a real relay operates.

## Overall Structure and Execution Context

| Execution location / owner | Responsibility | Output / storage location |
| --- | --- | --- |
| Customer / AI authoring tool | Write intent, control body, installation differences, and logical bindings | Canonical `.ghost.md` |
| Board / installation profile provider (Device) | Fixed pins, connected resources, explicit default connections, built-in channels/modules | Version-pinned profile |
| Driver provider (Drivers) | ELF, initialization specification/defaults, communication requirements, channels/units, device behavior constraints | Package published as one version |
| Compiler host / Worker (Language) | Deterministic interpretation and diagnostics for the supplied profile set | Derived binding plan tied to source/profile hashes |
| Packaging host (Device) | Validate actual modules/resources/host ABI and create initialization records | Deployment bundle and provenance |
| MCU shared communication service | Own physical buses, serialize requests, enforce time limits | Runtime resources and communication results |
| MCU driver instance | Per-device protocol, warm-up/read interval/conversion, independent state | Values and quality/errors |
| MCU GhostFlow runtime | Run control and error handling independently of physical bindings | Output requests and execution evidence |

The compile-time interpreter does not access the network, files, or GPIO. Its caller supplies the profile closure to validate. Download/deployment trust policy and caching belong to the provider/deployment tools. SHA-256 checks byte identity; it does not prove trustworthiness or absence of malicious code.

## Profile Interpretation Contract

Provider data is a deployment contract separate from customer YAML. In the first implementation, the `hardwareProfiles` array has `ref`, `sha256`, and `definition` for each item. `ref` is `id@revision`; `latest` is rejected. `sha256` is the SHA-256 of the UTF-8 value of the repository's `canonicalJson(definition)`. Digests for the actual deployed files/ELFs are preserved separately.

`definition.kind` is `board` or `device`. Optional `extends` points to a pinned ref of the same kind. Missing object fields are inherited from the parent, and explicitly supplied values override them. Arrays are replaced in their entirety. Cycles, kind changes, and missing parents are errors. Customer `params` override defaults parameter by parameter. There is no path for customers to arbitrarily override physical pins in their documents.

A Board profile has `connections`, `defaults`, and `channels`. A Connection specifies `resource` (physical resource ID), `transport`, `protocol`, and `settings`. In `defaults`, a protocol name is mapped to `board.<connection>`. Even when there is only one connection, omission is not allowed without an explicit default. Aliases for the same physical resource must have identical communication contracts. A board without an RS485 transceiver cannot provide the RS485 capability.

A Device profile has a fixed `module: { id, revision, sha256 }`, `requires`, `parameters`, and `channels`. `requires` specifies `transport`, `protocol`, and `settings`. Required setting values are constants or parameter references such as `{ param: baudRate }`. A parameter specification has `type` and optional `default`, `minimum`, `maximum`, and `enum`. The first implementation supports `integer`, `number`, `boolean`, and `string`; every defined parameter needs either a default or an explicit value. Schemas for structured initialization values are future scope. Unknown settings are not passed through to the driver. Optional `addressParameter` is used to check address conflicts on shared connections. A Channel has `role` (`input`/`output`), `type`, and optional `unit`.

The interpretation result preserves the selected profile and parent digests, the params actually applied, connection and channel contracts, and source locations. It does not mean that a new UART is created for every device referring to the same connection. The hardware/software implementation of built-in SPI, relay expander chips, multiplexers, built-in RS485, and GPIO mappings is defined once in the board/installation profile. If an external transceiver or expander chip is added, that installation's profile declares the actual additional wiring and resources. General combinations in which devices create connection resources are a later phase; even then, customers will not have to repeat existing board information.

## Verification and Use Cases

| Requirement by purpose | Result to verify |
| --- | --- |
| Customer using only built-in features | Resolve channels using only `profile` + `bindings` |
| Two current meters of the same model | Default address 1 and explicit address 2, separate instances, same physical bus |
| Current inputs and 8-channel relay outputs | Current meter addresses 1 and 2, relay address 3, shared 9600 bps connection, bindings to Bool outputs RO1–RO8 |
| Confirm RS485 use | An explicit path where device requirements match board capability and communication conditions |
| Different device / different communication implementation | Determine the connection through provider contracts without changing the control body |
| Typo / missing information | Error that includes the original YAML location and reason for omission/conflict |
| Errors as control data | Driver read failure flows through the existing quality/error path |

Reject missing profiles, floating revisions, invalid digests, inheritance cycles, parameter type/range/name errors, missing default connections, transport/protocol/settings mismatches, duplicate addresses on the same physical bus, missing channels, duplicate channel bindings, and mismatches between the body and role/type/canonical unit. In the two-meter example, omitting both addresses must fail because both would use address 1.

Static validation confirms that the supplied contracts configure an RS485 path. Actual wiring, device responses, current measurements, and contact/load operation are verified through evidence from the corresponding execution. Existing ESS3 user confirmation remains recorded; this documentation task does not require asking for the same confirmation again.

## Implementation Sequence and Completion Criteria

1. **Language / #555:** Implement compact YAML, bounded profile-closure interpretation, inheritance/explicit defaults, communication/address/channel/body-type validation, and source diagnostics. Pass `hardwareProfiles` through the public compile API; do not infer a missing closure automatically. Test Node/browser results, source preservation, and unchanged existing GFB bytes.
2. **Device + Drivers:** Publish actual board/driver profiles from existing packages and connect the interpretation plan to the configure/bundle path. Pin actual ELF and profile digests, and provide a conversion for migrating existing long-form authored hardware documents. Remove the active legacy authoring path once migration of existing installations is verified.
3. **Device / #249 coordination:** Refine admission and endpoint identity so multiple independent instances can safely share the same RS485 resource. Check that a fault in one device does not become another instance's state, and reject deployment for hosts that do not support this.

The documentation and Language phase alone do not justify declaring deployment of a new source to ESS3 complete. The current Device packager has fixed CURRENT_A/B/C endpoints and a shared-RS485 admission constraint. Actual profile publication, profile delivery by the CLI, package integration, and shared-bus execution on the MCU each need separate completion evidence. Device-sharing rules across imported documents are outside this scope.

The completion question is: **Can the customer clearly connect their installation differences and control intent without rewriting already established hardware facts, while ensuring omissions, conflicts, and abnormal states are not hidden and execution remains predictable?** Link each phase's results and remaining work to #555.
