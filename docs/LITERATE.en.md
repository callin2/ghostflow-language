<!-- translation-source: docs/LITERATE.md -->
[Korean original](LITERATE.md)

# GhostFlow literate source

Status: CommonMark 0.31.2-based extraction, control compilation, and original-location mapping are implemented.
See the [executable tutorial](TUTORIAL.md) and [verification record](VERIFICATION.md).
This is a way to write the selected [control syntax](LANGUAGE-SURFACE.md) inside a Markdown document.
Literate is a source packaging format. It does not change the control language's execution model.

## Files and extraction rules

- `.ghost.md`: the only GhostFlow product source, from which executable code blocks in Markdown are extracted.
- `.ghost`: if retained, it is only non-executable historical evidence, not compiler input or a fallback.
- An ordinary `.md` is not treated as executable GhostFlow merely because of its extension.

Only top-level fenced code blocks whose information string is exactly `ghost` are extracted, in document order.
Fences use Markdown backticks or tildes. Original code indentation inside each fence is preserved.
The last line of each body ends with a newline. One additional newline separates blocks with a blank line.
Headings and prose are not inserted into code as comment strings.

Descriptions, tables, links, images, front matter, ordinary indented code blocks, and code blocks in other languages are not included in executable source.
Nested blocks inside lists or quotations are also excluded.
A `ghost` fence shown as an example inside a longer fence is text in the outer block and is excluded.
Block recognition must follow Markdown structure; a simple regular expression must not search for nested fences.

Improperly closed executable fences, unknown `ghost-...` tags, extra attributes after `ghost`, and literate documents without executable code produce diagnostics.
Diagnostics also explain that `ghost` blocks inside quotations or lists are not executed.
The preview distinguishes content recognized as code from excluded content.

## Blocks are fragments of one program

One `control` scope may span several code blocks.
Braces are not automatically added or closed. The source formed by joining every fragment must be valid under the ordinary syntax.
Place block boundaries at declaration or statement ends, or brace boundaries.
Do not split a token, string, comment, or expression across explanatory paragraphs.

````markdown
# 관수 제어

프로그램의 이름과 출력이다.

```ghost
control Irrigation {
  input start, stop: Bool;
  output pump, valve: Bool;
  state watering: Bool = false;
```

정지가 시작보다 우선하며, 시작 후에는 이전 상태로 자기유지한다.

```ghost
  watering' = !stop && (start || watering);
```

두 출력에 같은 관수 의도를 연결한다.

```ghost
  valve <- watering';
  pump  <- watering';
  require pump => valve;
}
```
````

Document layout determines only the order in which source fragments are joined.
Blocks do not execute or re-execute independently, and do not commit state separately.
Every state's next value and all outputs follow the original tick contract.
Observations attached to the document are not automatically fed back as program inputs.

### Extraction result of the document example

The following is an example of the code the compiler extracts from the preceding `Irrigation` document example.
It is an internal extraction result that joins `ghost` blocks in document order, not an independent file or separate input format.
Descriptions, tables, and links in the file are excluded. The `text` fence below is for display.

```text
control Irrigation {
  input start, stop: Bool;
  output pump, valve: Bool;
  state watering: Bool = false;

  watering' = !stop && (start || watering);

  valve <- watering';
  pump  <- watering';
  require pump => valve;
}
```

### A small example distinguishing executable and excluded fences

The following is a **display-only outer fence** showing the contents of a `.ghost.md` file.
The outer fence itself is not executable code in this document. Only the top-level `ghost` inside it is a candidate for execution.
`text` and the quoted `ghost` are excluded. The unknown `ghost-python` is not executed either.

````markdown
```ghost
control Demo {
  output pump: Bool;
  pump <- false;
}
```

```text
control NotExecutable { }
```

> ```ghost
> control Quoted { }
> ```
````

In this example only the first `ghost` block is eligible for extraction.
Within this LITERATE document, all inner fences are text in the outer fence. Pasting an example does not mean an extractor has been implemented.

Two documents that differ only in their descriptions yield the same code.
Even when only comments inside `ghost` change, the program excluding comments is the same, so its execution graph and executable bytecode must remain the same.
For example, changing a comment in the same `control Demo` fence from `// 설명 A` to `// 설명 B`, or changing only an explanatory paragraph outside the fence, leaves executable statements unchanged; only original content and the source map differ.
This is the verification criterion based on equivalence of extracted code, rather than running literate through a separate executor.

This rule replaces the restriction in the 0.2 comparison proposal that "each fence is a complete top-level declaration."
The choice allows explanations to be placed naturally inside a control while preserving the ordinary language structure.

## Relationship between compilation and runtime

```text
.ghost.md → code extraction → same parser → same type/time/resource checks → .gfb
```

If the extracted code is the same, the type graph and execution semantics must be the same.
Executable bytecode, excluding debug information, must also be identical with the same compiler and options.
The source map containing document locations, and the document package's contents and hash, may differ.

As before, the MCU receives only executable bytecode.
The MCU does not need prose, a Markdown parser, or a code extractor.
Literate itself does not increase tick cost or state memory.
Additional work is in host-side Markdown extraction, original-location mapping, and editor integration.

When only the document changes, it must be possible to update only the document and source map while retaining the execution graph and logical hash.
Signing and deployment policy for the document package are separate matters.
Saving a document or editing a code block does not automatically authorize deployment to physical devices; existing verification and activation procedures apply.

## Error locations and observation

The extractor maps generated-source file, line, and column to those of the original `.ghost.md`.
Syntax and type errors must point to the original Markdown location.
If a control spanning block boundaries lacks its closing brace, diagnostics identify both its starting location and the document end.

For example, the following is a display-only outer fence showing an entire separate `.ghost.md` file.
Line numbers are not placed inside the fence; the explanation below counts them in the original file.

````markdown
```ghost
control Demo {
  output pump: Bool;
  require pump => ;
}
```
````

In this sample the executable fence starts at line 1, and `require pump => ;` is original line 4.
The semicolon is at line 4, column 19, so the invalid-expression diagnostic must point to that original line and column.
It must not report the line number in joined temporary source.

The following joins two blocks with a missing closing brace.
The fence at line 4 of the first block closes normally, but the combined source lacks the `control`'s `}`.

````markdown
```ghost
control Demo {
  output pump: Bool;
```

설명을 이어 쓴다.

```ghost
  pump <- false;
```
````

Here the diagnostic identifies both the original start of `control Demo`, line 2, column 1, and the document end (after line 10).
These two examples are design criteria for source maps, not diagnostics currently provided by the parser and extractor.

Execution node IDs are not made from the line numbers of explanatory paragraphs.
Even if added explanations move code downward, the same computations and state must remain identifiable on the timeline.
Preserve the original document and source map for the corresponding code revision.

An editor may display current values, errors, and timelines beside code.
This is observation functionality; it does not add a notebook-cell execution scheduler.
Execution timing and determinism are determined by the control's tick model.

## Examples and verification criteria

An [annotated scheduled-watering document](../examples/scheduled-watering.ghost.md) is provided.
Only that document can be used as `ghostc` input. Markdown is interpreted only on the host and is not put on the MCU.

The criteria to check when implementing the syntax and extractor are:

1. Two canonical documents differing only in explanation produce identical extracted source and state/output traces.
2. Changing explanation alone preserves the execution graph and executable bytecode.
3. Plain `.ghost` input, nested fences, and examples inside lists or quotations are not executed.
4. Invalid fences and split tokens or expressions are diagnosed at their original document locations.
5. A control spanning several blocks uses the same tick model and state scope.

Extraction and location-diagnostic tests are in `tests/literate.test.mjs` and `tests/toolchain.test.mjs`.
Canonical literate compilation and actual VM trace equivalence are in `tools/tutorial.mjs`.
