# Canonical Bool sensor source byte proof report

Work item [#590](https://github.com/callin2/ghostflow-language/issues/590) requires actual source bytes to participate in the sensor recovery proof.
`SensorSourceReader.lean` independently reads the unchanged canonical `recover-false.ghost.md` fixture, including its intent anchor and quotation.
The resulting profile and source node identities are checked against the actual compiled artifact and metadata before composing the existing sensor observation theorem.
Production parser, compiler, and runtime behavior are unchanged.

## Bounded document and program

The reader reuses `SourceReader` UTF-8 validation, LF line splitting, safe prose, ASCII lexing, and name validation.
The existing 65536-byte source bound applies.
Malformed UTF-8 and carriage returns fail admission.
The shared lexer adds only the two-byte `|>` token.
The pure Bool expression parser cannot consume that token; its existing grammar remains separate.

The sensor-local envelope permits safe prose followed by the same single exact column-zero ghost fence used by the Bool reader.
It additionally permits at most one canonical anchor before that fence.
The anchor must occupy exactly one line, with this field order and single-space separators:

```text
<!-- ghostflow:anchor id=ID kind=KIND status=STATUS origin=ORIGIN -->
```

The ID starts with an ASCII letter, contains at most 128 bytes, and otherwise contains only ASCII letters, digits, underscore, dot, colon, or hyphen.
The accepted kind values are `intent`, `premise`, and `assumption`.
Status is `confirmed`, `unconfirmed`, or `superseded`.
Origin is `user`, `operator`, `engineer`, `ai`, or `imported`.
The immediately following line must begin with exactly `> ` and contain nonempty safe prose.
HTML delimiters, backticks, tildes, nested quotation markers, additional quotation lines, and missing text are rejected.
An empty line must follow the quotation before the envelope returns to its ordinary top-level state.
Generic HTML, unclosed or multiline anchors, list containers, outer fences, and quoted or indented fences remain rejected.
After the exact opener, the existing Bool envelope reads the original code lines and validates the closing fence and all remaining prose.
No JavaScript extraction or trusted substring supplies the Lean reader's code.

The program grammar accepts exactly this declaration order:

```text
control NAME {
  input SENSOR: Bool;
  output OUTPUT: Bool;
  OUTPUT <- SENSOR |> recover(false);
}
```

Whitespace, tabs, line breaks, and `//` comments are permitted by the shared lexer.
Sensor and output names must be distinct, and both connection references must match their declarations.
The shared name check rejects the reserved `__gf_` prefix.
This profile also rejects `restart_reason` and `restart_event`, which have separate production lifecycle behavior.
Extra or reordered declarations, optional inputs, options, default values, alternate fallbacks, additional expressions, and trailing programs fail admission.
Complete production name restrictions and full language admission equivalence remain unproved.

## Independently constructed source identity

The parser owns a token cursor and a next-node counter initialized to 1.
Each supported syntax node takes an ID from that counter, which then advances by one.
Construction order is sensor declaration, output declaration, sensor reference, false literal, recover call, pipe, and connection.
Thus the supported source allocates the sensor origin at 1 and the recover call site at 5.
Comments and whitespace allocate no nodes.
The program reader is split by its concrete syntactic constructs; this also bounds Lean code generation for the sequential parser.

`ParsedSource` owns the profile, allocated origin, and allocated site.
Final admission checks an empty token remainder and the allocated 1/5 identity required by the existing fixed recovery bytecode profile.
The generic `readSource_ids` theorem proves that every accepted source has those identities.
The counter values are computed inside Lean; neither external AST IDs nor metadata IDs enter the parser.
A counter-increment mutation must fail the concrete original-source certificate.

`metadataOf parsed` builds the sensor rails, recover site, and sensor origin from that owned result.
`metadata_expected` connects those values to the existing sensor model once the accepted source identities are established.
Each certificate checks three independent conditions:

```lean
SensorSourceReader.readSource originalSourceBytes = some parsedSource
SensorProfile.load artifactBytes = some ⟨parsedSource.profile, recoverCode⟩
actualMetadata = SensorSourceReader.metadataOf parsedSource
```

The JavaScript projection supplies only a proposed witness.
Kernel reduction of the complete original byte list must agree with that witness.
The verifier reads a byte buffer directly from the fixture, checks lossless UTF-8 round-tripping for production compilation, and separately passes the unchanged buffer to the Lean source certificate.
Changing diagnostic source text or decoded metadata cannot replace those bytes.

`SensorSourceReader.loaded_observation` combines the three conditions with `readSource_ids` and the existing raw-code observation theorem.
For every admitted `Reading` and every stale payload, the actual artifact's typed byte-PC execution produces the bounded original source interpretation.
The theorem explicitly assumes `SmallNumberLaws` for its number operations.
Healthy false remains a healthy observation; every acquisition fault produces a recovered false observation with its fault identity.
This claim concerns the modeled execution of the actual raw bytecode, not a new production runtime proof.

## Verification and retained boundaries

The sensor verifier retains its existing artifact, metadata, and machine mutation gates.
New gates cover anchor structure and enums, UTF-8, unsafe document contexts, fallback changes, incorrect references, declaration order, options and defaults, source-only changes, and source identity allocation.
Artifact-only and metadata-only changes fail their respective source-linked certificate obligations.
Changing projection, artifact, and metadata together while keeping the original source bytes fixed must also fail.
Valid module, sensor, and output renames are recompiled and certified against their changed original bytes.
Whitespace and ordinary comments retain both bytecode and node metadata.
The three pure Bool fixture certificates run against the modified shared lexer, and a pipe expression remains rejected by the pure Bool source reader.

Run the focused checks from the repository root:

```sh
node --test tests/bool-sensor-validation.test.mjs tests/bool-translation-validation.test.mjs
node experiments/bool-sensor-validation/verify.mjs \
  --lean /path/to/lean-4.19.0/bin/lean \
  --evidence-dir build/bool-sensor-source-reader-590
```

The generated report records source hashes, original source SHA-256, actual Lean process outcomes, proof input and log hashes, and observation timestamps.
Successful proofs reject `sorryAx`; source inputs exclude `sorry`, `admit`, `axiom`, and `native_decide`.
The report keeps `productionCompilerProof` false.
Without explicit runtime paths, the runtime differential check remains reported as not run.

The anchor's natural-language intent and its agreement with program behavior are not proved.
The code-comment link directive is ordinary lexical trivia in this bounded reference reader; full production directive validation is outside its claim.
The envelope and fixed program grammar do not implement or prove complete CommonMark, production syntax, or general production node numbering correspondence.
The generic number theorem assumes `SmallNumberLaws`; production f64 and complete Rust runtime correspondence remain outside this proof.
File-to-Lean-literal transport and Lean's kernel and reported standard logical foundations remain trusted.
There is no firmware, physical input/output, official build, deployment, or product acceptance claim.
