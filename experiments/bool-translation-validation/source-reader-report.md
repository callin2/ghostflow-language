# Original source byte reader proof report

Work item [#590](https://github.com/callin2/ghostflow-language/issues/590) asks for compiler correctness evidence with explicit remaining trust boundaries.
This experiment independently reads the original `.ghost.md` bytes in Lean and binds the resulting module to the actual compiler artifact.
It extends the Bool module loader experiment without changing production parsing or runtime behavior.

## Accepted reference grammar

`SourceReader.readSource` receives a `List UInt8`, with a limit of 65536 bytes.
It validates UTF-8, rejects carriage returns, and splits lines at byte 10.
UTF-8 admission rejects overlong sequences, isolated continuation bytes, surrogate encodings, truncated sequences, and scalars above U+10FFFF.
All code tokens and identifiers use ASCII bytes.
There is no JavaScript UTF-16 position conversion.

The literate envelope permits exactly one column-zero opener containing three backticks followed by `ghost`, followed by one column-zero closer containing exactly three backticks.
Neither fence permits extra spaces or suffixes.
Outside that block, blank lines, `# ` headings, and prose beginning with an ASCII letter, underscore, or non-ASCII byte are admitted.
Prose rejects control bytes, `<`, `>`, backticks, and tildes.
The code block rejects backticks and tildes anywhere, including comments.
This deliberately conservative envelope excludes frontmatter, HTML contexts, alternate and outer fences, indented fences, list and quote containers, and additional fenced blocks.
It cannot accidentally accept a raw fence inside an HTML comment or outer code fence.
These are admission restrictions for this experiment, not changes to the GhostFlow language.

The independent lexer reads whitespace and `//` line comments, ASCII identifier tokens, and the exact supported punctuation.
Keywords must be whole tokens.
Identifiers with the production-reserved `__gf_` prefix are rejected.
The parser accepts one complete `control Name { ... }` declaration with an empty remaining token list.
Declarations are Bool states with literal initial values, Bool outputs, next assignments, and output connections.
Expressions include Bool literals, previous and candidate state names, negation, conjunction, disjunction, conditional expressions, and grouping.
Conjunction binds more tightly than disjunction, both associate left, and grouping is explicit in `SurfaceExpr`.
Conditional branches parse complete expressions.
Unsupported declarations, imports, config, external inputs, constraints, numeric values, and trailing programs fail admission.
The parser is structurally recursive with a fuel limit of 1024; fuel exhaustion returns `none`.
Lexing uses the code byte count plus one as its fuel bound.
These bounds establish termination and finite admission, not a real-time cost guarantee.

`Declaration` and `SurfaceExpr` retain names until elaboration.
The elaborator first collects every state in declaration order, including forward references.
It rejects duplicate state/output names, duplicate next assignments or output connections, undeclared targets and reads, and missing output connections.
Each absent next assignment becomes the corresponding previous-state read.
The existing `Expr false` type disallows candidate reads in transitions; outputs elaborate to `Expr true`.
Conjunction and disjunction elaborate through the existing proved Boolean branch definitions.
The final `ModuleEnvelope.valid` check applies the existing module bounds and scope checks.
Output connections are resolved by name and placed in output declaration order.
The JavaScript witness bridge additionally requires the connections themselves to appear in declaration order.
Consequently, the bounded reference grammar can admit sources that the current witness bridge refuses to certify.
The two admission profiles are not claimed identical, and complete production name restrictions remain part of the unproved correspondence boundary.

## Kernel contract and witnesses

Each fixture certificate carries these two independent obligations:

```lean
SourceReader.readSource originalSourceBytes = some sourceModule
ModuleLoader.load artifactBytes = some sourceModule
```

`sourceModule` remains a candidate witness emitted from the JavaScript projection.
That witness cannot establish acceptance by itself.
The Lean kernel reduces the original-byte reader to check the first equality, and the independent raw loader checks the second.
The verifier reads original fixture files as byte buffers before converting text for the production compiler.
The source certificate receives that original buffer separately from any parsed source metadata.
Changing or omitting decoded artifact metadata and changing the text metadata cannot change the source input bytes.

`SourceReader.initialized_trace` composes those obligations with the existing generic `ModuleLoader.initialized_trace` theorem.
For every natural tick count, the actual raw artifact's byte-machine trace equals the reference interpretation obtained by reading the original source bytes and starting from its declared Bool initial values.
The byte-machine trace preserves simultaneous state transitions, retained state, and the separation between old and candidate reads.
The source reference interpretation is defined by successful elaboration into the existing typed Bool module semantics.
The theorem does not assert that every production program belongs to this bounded grammar.

The three real fixtures cover literals, old and candidate state reads, retained state, simultaneous swap, nested branches, and branch byte offsets with a nonzero high byte.
The kernel checks each exact source equality and raw artifact equality and then the all-tick-count theorem.
Admission cases additionally cover safe UTF-8 prose, comments, forward declarations, malformed UTF-8, unsafe Markdown contexts, unsupported syntax, duplicate declarations, keyword prefixes, and confusable identifiers.
Direct parser cases check precedence, explicit grouping, and exhausted fuel.
Six source mutations retain the original module witness and artifact, then require certificate failure for changed initialization, changed candidate reads, grouping, operators, an inserted unsupported declaration, and a trailing program.
All previous proof gates remain in the same verifier.

Run the focused checks from the repository root:

```sh
node --test tests/bool-translation-validation.test.mjs
node experiments/bool-translation-validation/verify.mjs \
  --lean /path/to/lean-4.19.0/bin/lean \
  --evidence-dir build/bool-source-reader-590
```

The generated report records exact source identity, original fixture hashes, artifact hashes, every Lean invocation and expected failure, proof input and log hashes, and observed timestamps.
The report's `productionCompilerProof` remains `false`.
Proof sources exclude `sorry`, `admit`, `axiom`, and `native_decide`, and successful invocations reject logs containing `sorryAx`.

The pre-review-fix full run passed at `2026-10-28T19:05:35.710Z` with 183 expected outcomes.
It contains 172 actual Lean invocations, comprising 105 successes and 67 expected rejections, plus 11 JavaScript admission assertions.
Its source identity is `3f6e9d3b2347a66cf414b000190381fbb0b2d30e864ef97d60755e1ac129e2ea`, and its report SHA-256 is `bf411a9b09da43da90ff2d7b93d6647a1019ab3a5573b4138d981eace8ade402`.
Independent review then identified acceptance of production-reserved `__gf_` names.
The final source adds that rejection and its negative admission case.
The pre-fix receipt remains unchanged; the parent integration run must establish fresh complete verification of the final committed source.

## Remaining trust and scope

The formal reader and its reference interpretation cover only the stated bounded grammar.
Correspondence between this conservative envelope and full CommonMark extraction, and between this grammar/elaboration and the complete production language semantics, remains unproved.
The kernel checks the actual original bytes of each fixture against its compiled artifact; the production source AST is no longer an unchecked source-side premise for those certificates.
File-to-Lean-literal transport and the Lean kernel with its reported standard logical foundations remain trusted.
The canonical module model and Boolean byte-machine semantics remain unproved against the production Rust loader, f64 representation, and runtime.
This experiment does not replace the production parser or loader and establishes no official build, hardware behavior, deployment, or product acceptance.
