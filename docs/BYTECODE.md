# GFB1 bytecode

All integers are little-endian. Strings are `u16 length` followed by UTF-8
bytes. Programs are emitted in postfix order and evaluated by a bounded stack.

## Module envelope

- magic: `GFB1`
- format version: `u16` (`1`)
- module name: string
- module version: `u32`
- inputs: count + `(name, type)`
- states: count + `(name, type, default value)`
- strategies: count + strategy records
- safety constraints: count + constraint records

Types: `1=bool`, `2=number`.

Each strategy contains name, signed priority, query bytecode, transition list,
and intent list. Each expression is length-prefixed, enabling structural bounds
and future skipping.

## Expression opcodes

- `1 BOOL_CONST u8`
- `2 NUMBER_CONST f64`
- `3 INPUT u16`
- `4 STATE u16`
- `5 NEXT_STATE u16`
- `10 NOT`
- `11 AND`
- `12 OR`
- `13 EQ`
- `14 LT`
- `15 LTE`
- `16 GT`
- `17 GTE`
- `18 IF`
- `19 ADD`
- `20 SUB`
- `21 MUL`
- `22 DIV`

Arithmetic consumes two numbers and produces a finite number. Division by zero
and non-finite results reject the entire tick before state/intent commit. `IF`
is postfix/eager: both branch expressions must be valid to evaluate. It does not
provide a way to hide division by zero in an unselected branch.

## Query opcodes

- `1 HAS kind-string name-string type-u8`
- `2 ALL u16-child-count`
- `3 ANY u16-child-count`
- `4 NOT`
- `5 BOOL_CONST u8` (`0` or `1` only)

Query bytecode is also postfix. The verifier checks stack balance, operand
types, indices, expression result types, query result count, and fixed limits.

## Safety records and host manifest

A constraint record is `kind:u8`, `arity:u16`, then that many name strings.
Kinds are `1=requires` (exactly two names), `2=mutex` (2–32 names), and
`3=requires-any` (target then 1–31 alternatives). Names must be distinct Boolean
outputs. Each round reads one candidate snapshot and applies all false-only
blocks together. Rounds stop at a fixed point; at most the output count can turn off.

The envelope remains version 1. Older loaders reject unknown opcodes/kinds;
they must not skip them or guess their meaning. Existing 0.1 artifacts remain valid.
The loader bounds the whole module to 1 MiB, names to 128 UTF-8 bytes, input/state/
intent and constraint counts to 128, strategies to 32, and blobs to 4096 bytes.

New control compilation also writes `.gfb.manifest.json` and `.gfb.map.json`.
The manifest specifies nominal types and generated clock/sensor/schedule inputs;
its `bytecodeSha256` detects accidental mismatching of bytecode. It is **not** a
signature or authentication mechanism. Use only trusted compiler manifests.
Missing generated input is a VM error, not zero or false supplied implicitly.
See [the implementation contract](IMPLEMENTATION.md) for host responsibilities.

## Small executable MVP example

The following complete module is accepted by `tools/ghostc.mjs` and uses only
the implemented S-expression MVP.

```lisp
(module postfix-demo
  (version 1)
  (input boolinput bool)
  (input stop bool)
  (state running bool false)

  (strategy basic 0
    (device (has actuator pump bool))
    (next running (and input.boolinput (not input.stop)))
    (intent pump (and input.boolinput (not input.stop)))))
```

Inputs are indexed in declaration order, starting at zero:

| index | declaration | type |
|---:|---|---|
| `0` | `boolinput` | bool |
| `1` | `stop` | bool |

Therefore `input.boolinput` emits `INPUT 0`, while `input.stop` emits
`INPUT 1`. The same testable expression, `boolinput && !stop` in infix
notation, is written as `(and input.boolinput (not input.stop))` in the
implemented source syntax. The compiler emits both the transition expression
and the intent expression independently; this example happens to produce the
same eight bytes for each.

### Expression lowering and exact bytes

The expression is emitted in postfix order. `u16` indices and all other
integers are little-endian.

| source fragment | opcode bytes | stack effect |
|---|---|---|
| `input.boolinput` | `03 00 00` | push bool input 0 |
| `input.stop` | `03 01 00` | push bool input 1 |
| `(not input.stop)` | `03 01 00 0a` | bool → bool |
| `(and input.boolinput (not input.stop))` | `03 00 00 03 01 00 0a 0b` | bool, bool → bool |

Thus the complete expression stream is:

```text
postfix: INPUT(0) INPUT(1) NOT AND
opcode:  03 00 00 03 01 00 0a 0b
length:  8 bytes
```

There is no per-opcode or per-operand length field. The expression is stored as
a blob in a transition or intent record, and that enclosing record has a
`u32` byte-length prefix. For this example the encoded fragment is therefore
`08 00 00 00 03 00 00 03 01 00 0a 0b`; the first four bytes are the blob
length, not an opcode. Query blobs use the same `u32` blob-length convention,
but query `HAS` terms additionally contain length-prefixed UTF-8 strings.

The bounded stack evaluates this as push `input[0]`, push `input[1]`, negate,
then `AND`. The verifier checks indices, bool operands, and the final single
value; transitions may not use `NEXT_STATE`, which is intent-only.

### In-memory compiler check

This uses the real compiler API in memory; no source or output file is needed:

```sh
node --input-type=module <<'EOF'
import { compile, parse, tokenize } from './tools/ghostc.mjs';

const source = `(module postfix-demo (version 1)
  (input boolinput bool) (input stop bool) (state running bool false)
  (strategy basic 0 (device (has actuator pump bool))
    (next running (and input.boolinput (not input.stop)))
    (intent pump (and input.boolinput (not input.stop)))))`;
const bytes = compile(parse(tokenize(source)));
const expected = Buffer.from([0x03, 0x00, 0x00, 0x03, 0x01, 0x00, 0x0a, 0x0b]);
const first = bytes.indexOf(expected); const second = bytes.indexOf(expected, first + 1);
console.log(bytes.length, first, second, expected.toString('hex'));
EOF
```

The observed output is `132 101 122 0300000301000a0b`: a 132-byte GFB1 module,
with the transition and intent blobs at those offsets; `08 00 00 00` precedes
each. `Module::load` in `crates/ghostflow-core/src/lib.rs` verifies the bytes.

## Implementation boundary

This page describes current GFB1, not the later language design. `docs/LANGUAGE-SURFACE.md`
and `docs/CONSTRAINTS.md` are the selected follow-up
syntax/contract; their `control`, `sensor`, `schedule`, `check`, and mode
examples are design examples and do not compile to GFB1 yet. Do not infer a new
opcode from them.

The compiler/core support only bool/number values, the listed opcodes, `requires`/`mutex`,
and bounded in-memory execution. Pressure, flow, pump
curves, other device metadata, and feedback sensors are optional: no mandatory
GFB1 field or basic-safety requirement forces them. Capacity analysis or
verified feedback must be an explicit future opt-in, not MVP bytecode behavior.

## Tracked GFB1 golden vector

`tests/fixtures/gfb1-golden-v1.ghost.md` is the authoritative literate source
for the tracked `tests/fixtures/gfb1-golden-v1.gfb` artifact. The accompanying
`gfb1-golden-v1.json` fixes these regression digests:

- source SHA-256: `af7e2a824c337ace94e38ff82ef5a1344d75f2374e2581ef390f76f8ce8d92a0`
- GFB SHA-256: `2a8ff8e4e26ce6ed7bd92404f0c94ca4d469dbcb672e5ea6e1243c06805a079b`

`tests/gfb1-golden.test.mjs` recompiles the literate source with Node and with
the existing GFB1 compiler in a Buffer-less browser-like VM. Both results must
match the tracked artifact byte for byte and reproduce the fixed GFB digest.
The same test sends those exact valid bytes, plus deterministic corruptions, to
the release native and WASM loaders. Magic, format version, truncation, trailing
bytes, query structure, and expression structure are independent fail-closed
checks. These hashes are regression identities, not signatures or trust claims.

The format version is the `u16` immediately after the `GFB1` magic; it is not the
module's own version field. Current loaders accept format version `1` only. An
unsupported format version must fail during load, before activation, without
guessing, down-conversion, or fallback acceptance. Migration to a later bytecode
format requires an explicit compiler/runtime compatibility decision and its own
golden/conformance evidence; a later format is not accepted as GFB1 merely
because part of its envelope resembles version 1.

For distribution, [Portable GFB package v1](PORTABLE-PACKAGE.md) preserves these
exact bytes and binds them to the authoritative literate source, manifest,
source map, compiler/runtime identity, capabilities and installation binding.
Packaging does not add, remove or rewrite a GFB1 byte.
