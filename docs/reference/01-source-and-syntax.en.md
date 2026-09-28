<!-- translation-source: docs/reference/01-source-and-syntax.md -->
[Korean original](01-source-and-syntax.md)

# 1. Source and syntax

[Complete contents](../LANGUAGE-REFERENCE.en.md) · [Next: Types, expressions, and state](02-types-expressions-state.en.md)

The canonical GhostFlow program is one `.ghost.md` document containing both explanation and executable rules. The language's representative surface is the **control syntax**, using `control Name { ... }`, braces, semicolons, expressions, explicit next state, and output connections. This chapter defines the rules for selecting executable source from documents, vocabulary, name scope, and declaration structure.

The `ghost` fragments in this chapter illustrate syntax and semantics.

Rationale: [Selected syntax](../LANGUAGE-SURFACE.md), [Common language contract](../LANGUAGE.md), [Literate source](../LITERATE.md), [Intent anchors](../INTENT-ANCHOR-MAP.md), [Source preservation](../SOURCE-MAP.md), [Design notes](../DESIGN-NOTES.md). The [complete language reference](../LANGUAGE-REFERENCE.md) indexes this chapter and the other detailed chapters.

## 1.1 Why one document is the source

Keeping only control rules separates them from the reasons for conditions and field premises. Keeping only explanations makes it impossible to mechanically verify which rules execute. GhostFlow preserves explanation, comments, intent, and executable code as one revision, providing one starting point for review.

- Product input is one complete `.ghost.md` document.
- An ordinary `.ghost` file is neither executable input nor alternative input.
- Editors, forms, and graphs may be different views of this document, but do not create an independent control source.
- Document revision and executable-structure identity are distinct. Changing only explanation changes the document revision, but identical executable token structure retains the same computational meaning.

### Executable block extraction

From a CommonMark document, extract only **top-level fenced code blocks** whose info string is exactly `ghost`, in document order. Both backtick and tilde fences are permitted. Place a newline at the end of each block body and one blank line between blocks. Do not synthesize headings or explanations into code comments.

The following displays a complete `.ghost.md` example.

````markdown
# 펌프 요청

정지가 시작보다 우선한다.

```ghost
control PumpRequest {
  input start, stop: Bool;
```

두 입력의 판단을 출력에 연결한다.

```ghost
  output pump: Bool;
  pump <- start && !stop;
}
```
````

The two `ghost` blocks form one `control`. Blocks do not each create a separate execution or state commit. Braces or statements are not automatically supplied. Put block boundaries at the ends of declarations or statements; do not split a token, string, comment, or expression in the middle.

The following are not executable code.

- Ordinary paragraphs, tables, links, images, and front matter
- Indented code blocks and fences with other info strings, such as `text`
- Nested `ghost` fences inside lists or quotations
- `ghost` fences written as text inside a longer display fence
- Tags that do not match exactly, such as `ghost-python` or `ghost` with attributes

Unclosed executable fences, documents without executable code, and excluded nested blocks that look executable are diagnostic subjects. Do not emulate Markdown structure with regular expressions and execute nested blocks.

## 1.2 Original source, locations, and intent links

The original document's prose, `//` comments, Unicode, line endings, and final newline are language assets to preserve exactly. Syntax and type diagnostics refer to the file, line, and column of the original `.ghost.md`, rather than merged temporary text. If a closing brace is missing across several fences, the diagnostic must be able to identify both the declaration start and the document end.

Node identity is not derived from Markdown line numbers. Adding explanation at the beginning may move a location, but the same executable structure must remain identifiable as the same computation. Locations always belong to a specific document revision. Digests of the original source and executable artifact prevent mixing different revisions. This preservation does not independently prove the authenticity of the original source.

### Intent anchors

The design record for this contract links to [#31](https://github.com/callin2/ghostflow-language/issues/31) and [#60](https://github.com/callin2/ghostflow-language/issues/60).

An anchor is a non-executable top-level Markdown HTML comment that identifies the immediately following top-level paragraph or quotation block as its original text. One blank line is allowed.

```markdown
<!-- ghostflow:anchor id=GF-INT-PUMP-001 kind=intent status=confirmed origin=user -->
> 급수 요청이 있고 정지가 없을 때 펌프를 요청한다.
```

Field order and values are fixed.

- `id`: `[A-Za-z][A-Za-z0-9._:-]{0,127}`, unique within the document and stable for the same intent.
- `kind`: `intent | premise | assumption`
- `status`: `confirmed | unconfirmed | superseded`
- `origin`: `user | operator | engineer | ai | imported`
- An `assumption` cannot be `confirmed`. Once confirmed, reclassify it as `intent` or `premise`.

A heading, list, nested block, code fence, another anchor, or document end is not an anchor body. Split multi-block explanations across multiple anchors.

### Executable node links

The following whole-line comment inside an executable `ghost` fence identifies exactly one immediately following traceable statement.

```ghost
// ghostflow:link id=GF-INT-PUMP-001 relation=implements
pump <- request;
```

`relation` is one of `implements | constrains | fallback | assumes`. `assumes` refers only to an `unconfirmed assumption`; other relations do not refer to assumptions. A `superseded` anchor cannot link to a current node. Several consecutive link lines may refer to the same next statement. Encountering a blank line, ordinary comment, nested expression, `control` header, or fence end creates an orphan link.

Link targets are `input`, `output`, `state`, `config`, `let`, enum, function, `sensor`, `signal`, `schedule`, `timer`, `require`, `mutex`, next-state definitions, and output connections. Links do not interpret natural language or discover tacit knowledge. They preserve the written classifications and relations and do not turn unconfirmed relations into proof or approval.

## 1.3 Vocabulary

### Identifiers and case sensitivity

Identifiers are `[A-Za-z_][A-Za-z0-9_]*` and are case-sensitive. `start` and `Start` are different names. `.` is a settled path separator, as in `starts.due`, `Alias.name`, and `instance.port`, rather than an identifier character. Inputs and previous state are read directly as `start` and `running`; the old aliases `input.start`, `state.running`, and `next.running` are rejected. Likewise, `'` is next-state notation in `running'`, rather than an identifier character.

The following language words cannot be user-defined names.

```text
control fn input output state config let type sensor signal schedule timer
calendar provider event require mutex if then else case in true false
div ok fault syntax adapt constraints check limit quote instance connect elapsed
```

`purefn`, `enum`, `next`, `ifthenelse`, `not`, `and`, `or`, `is`, and `isnt` are also reserved and rejected with migration diagnostics so that removed notation is not reinterpreted with another meaning. `Bool`, `Int`, `Number`, `Percent`, `Duration`, `Result`, `SensorFault`, `Expr`, `Date`, `TimeOfDay`, `DateTime`, `TimeSlots`, `WorkCalendar`, `HolidayCalendar`, `TidePredictions`, `LunarEphemeris`, `BoolActuator`, `Event`, `ClockFault`, `CalendarFault`, `TemporalContextFault`, `AccountingFault`, and the physical-quantity types in Chapter 2 are the built-in type namespace. `number`, `int_exact`, `int_floor`, `int_ceil`, `int_trunc`, `int_nearest_even`, `elapsed`, `median`, `hysteresis`, `date`, `time`, `datetime`, `cron5`, `sun`, `tide`, `day`, `moon`, `continuous_true`, `instant`, `civil`, `on_time`, `count_events`, `local_day_is`, `calendar_is`, `tide_is`, `moon_is`, `used`, `rolling`, `local_day`, and the Result conversion names are the built-in callable namespace. User declarations cannot shadow these names. The internal `__gf_` prefix and discard pattern `_` also cannot be declaration names.

The `.due`, `.open`, `.active`, and `.count` supplied by schedules and accounts are projections of their respective built-in types. A schedule's `.missed` is also a projection. Do not infer members with these names on other types or redefine them as user projections. For `.missed` semantics, see [§3.5](03-time-and-schedules.md#35-schedule의-공통-의미).

`parameter`, `resource`, `account`, `import`, `from`, `revision`, `sha256`, `timezone`, `selected`, `basis`, `when`, `clock`, `gap`, `recovery`, `fallback`, `dst_missing`, `dst_repeated`, `sample`, `valid`, `filter`, `stale_after`, `recover_after`, `samples`, `min`, `max`, `step`, `access`, and `label` are special **contextual words** only in their respective syntax positions. They do not globally reserve identifiers in other positions. The context of `has` is defined in [Chapter 4](04-sensors-constraints-control.md). `adapt`, `constraints`, `check`, `limit`, `quote`, `instance`, and `connect` are reserved regardless of syntax position.

### Whitespace, statement endings, and comments

Whitespace and indentation separate tokens and help people read structure, but do not create blocks. Tabs or a particular number of columns are not semantic rules of the representative control syntax. Declarations and expression definitions generally end with `;`; line breaks do not replace it.

`input`, `output`, `state`, `config`, `let`, next-state definitions, output connections, `require`, `mutex`, `signal`, `timer`, `type X = ...`, and entries in settings blocks require `;`. The semicolon may be omitted after a function's final result expression, closing `}`, or a `case` branch.

A code comment extends from `//` to the end of the line. `#` comments and `/* ... */` comments are not comments in the representative control syntax. Write document explanations in the Markdown body.

### Symbols and delimiters

| Notation | Role |
|---|---|
| `{ }` | control, functions, case, settings blocks, and `in` sets |
| `( )` | Expression grouping, function calls, parameters |
| `[ ]` | Lists of selected schedule times; not general-purpose list syntax |
| `:` | Names and types, named built-in arguments |
| `,` | Separating names, arguments, elements |
| `=` | Definitions and initial values |
| `'` | Next-state definitions and references |
| `<-` | Output intent connection |
| `->` | Function result type |
| `=>` | `case` branch or output constraint relation |
| `?` | Optional sensor capability declaration |
| `..` | Sensor valid range |

`=>` is not a logical operator used in ordinary expressions.

## 1.4 Grammar notation

The grammar summaries in this reference use the following metanotation.

- Characters inside single quotes are literal tokens.
- Non-italic lowercase names such as `name` are other grammar items.
- `[ item ]` means optional; `{ item }` means zero or more repetitions.
- `(a | b)` selects one of two alternatives. Actual GhostFlow `{}`, `[]`, and `|` tokens are written in single quotes.

This is a summary that explains this chapter's rules unambiguously, rather than a generation specification replacing the entire parser grammar.

```text
document       ::= Markdown containing one or more top-level ghost fences
program        ::= { import_decl | top_level_function | top_level_type | syntax_decl }
                   control_decl
control_decl   ::= 'control' Identifier '{' { control_item } '}'
top_level_function ::= function_decl
top_level_type ::= enum_decl

control_item   ::= declaration | function_decl | next_definition
                 | output_connection | constraint | parameter_decl
                 | instance_decl | connect_decl
declaration    ::= input_decl | sensor_decl | output_decl | config_decl
                 | state_decl | let_decl | enum_decl | signal_decl
                 | schedule_decl | timer_decl
```

A program has exactly one `control` execution root. Document-scope imports pin a complete `.ghost.md` definition revision and digest; imported functions and types are referenced only as `Alias.name`. `instance` and `connect` inside the control compose imported controls. There is no wildcard import, implicit export, or second root control. Exact import, parameter, instance, connect, and typed expression macro syntax is defined in [Chapter 6](06-composition-and-replay.md#64-import와-연결의-문법).

The declaration forms established by the selected syntax are below. Detailed rules for `expr`, `type`, and `pattern` are covered in the [next chapter](02-types-expressions-state.md).

```text
input_decl       ::= 'input' name_list ':' type [ '=' expr ] ';'
sensor_decl      ::= 'sensor' Identifier [ '?' ] ':' type
                     ( ';' | '{' { sensor_setting ';' } '}' )
output_decl      ::= 'output' name_list ':' type ';'
config_decl      ::= 'config' Identifier ':' type '=' expr
                     ( ';' | '{' { config_setting ';' } '}' )
parameter_decl   ::= 'parameter' Identifier ':' type '=' constant_expr ';'
state_decl       ::= 'state' Identifier ':' type '=' constant_expr ';'
let_decl         ::= 'let' Identifier '=' expr ';'
enum_decl        ::= 'type' Identifier '=' Identifier { '|' Identifier } ';'
function_decl    ::= 'fn' Identifier '(' [ parameter_list ] ')' '->' type
                     '{' expr [ ';' ] '}'
next_definition  ::= Identifier "'" '=' expr ';'
output_connection ::= Identifier '<-' expr ';'
signal_decl      ::= 'signal' Identifier '=' expr ';'
timer_decl       ::= 'timer' Identifier '=' ( 'elapsed' '(' Identifier ')'
                     | 'continuous_true' '(' expr ')' ) ';'
constraint       ::= 'require' ( '!' expr | expr '=>' expr ) ';'
                   | 'mutex' '(' name_list ')' ';'
name_list        ::= Identifier { ',' Identifier }
parameter_list   ::= Identifier ':' type { ',' Identifier ':' type }
```

The current parser reads an `input` initializer but does not use it as an initial executable input value. The host supplies inputs. Do not use initializers in source expecting executable semantics.

Unlike the general declaration structure, `schedule` has settings blocks specific to each type. The settled daily-slot form is below.

```ghost
schedule starts: DailySlots<15min> {
  timezone = "Asia/Seoul";
  selected = [06:00, 18:45];
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
  dst_missing = skip;
  dst_repeated = first;
}
```

`timezone`, `selected`, times, and lists are syntax in this schedule position. Do not extrapolate them into general strings, general lists, or arbitrary generic type syntax.

## 1.5 Representative declaration structure

```ghost
fn allowed(request: Bool, enabled: Bool) -> Bool {
  request && enabled
}

control Example {
  input start, stop: Bool;
  sensor moisture?: Percent;
  output pump: Bool;
  config threshold: Percent = 30%;
  type Phase = Idle | Running;
  state phase: Phase = Idle;
  let request = start && !stop;
  timer age = elapsed(phase);

  phase' = if request then Running else Idle;
  pump <- phase' == Running;
}
```

Different keywords separate roles because external inputs, operating settings, memory, temporary computation, and output requests have different change and observation semantics. `let` creates no memory; an `output` declaration creates neither a value nor a safe default.

### Name scope and resolution

- Function parameters exist only inside their function and are unique within one parameter list. Because pure functions do not capture control values, they may use the same spelling as a control value, but do not shadow other functions, types, enum cases, or built-in names.
- Functions receive required control values and state through parameters. They do not implicitly capture outer inputs or state.
- The document's control, functions, types, enum cases, import aliases, syntax names, and control value names must be unambiguous. `input`, `output`, `state`, `config`, `parameter`, `let`, `sensor`, `signal`, `schedule`, `timer`, functions, and instances share one value namespace; names cannot be reused even across declaration kinds. Enum cases are also unique within the document. Imported internal names remain under `Alias.name`.
- Each output has exactly one direct connection expression or `connect`.
- The source order of `let` does not establish dependency order. It is interpreted as an acyclic dependency graph; mutually dependent cycles are errors.
- Local computation does not shadow function names or reserved namespaces.

Conflicts produce compile diagnostics rather than being resolved through declaration order or kind-specific shadowing.

## 1.6 Representative notation, reference aliases, and historical alternatives

New documents use only the following representative notation. The older notation on the right is historical information for reading and migration diagnostics, rather than syntax aliases, and is rejected as executable input.

| Representative notation | Rejected older notation |
|---|---|
| `fn` | `purefn` |
| `type Mode = Off \| On;` | `enum Mode { Off, On }`, `enum Mode = Off \| On;` |
| `running' = expr;` | `next running = expr;` |
| `running'` in an output expression | `next.running` |
| `start`, `running` | `input.start`, `state.running` |
| `if c then a else b` | `ifthenelse(c, a, b)` |

The compiler does not automatically convert the right-hand notation or execute it under a separate profile. If a conversion tool is needed, explicitly revise the original into a new canonical `.ghost.md` revision and review it again.

The YAML hierarchical notation, CoffeeScript-style indentation and `not/and/or`, and Cypher-style `MATCH/WHERE/WITH/NEXT/EMIT` from the initial A/B/C comparison are design history. They are not permitted aliases of the selected control syntax. Individual reference aliases described in the table do not imply that the complete block structures and operators of the initial alternatives can be used together.

## 1.7 Chapter boundaries for source rules

This chapter defines canonical document extraction, vocabulary, namespaces, and root program structure. Detailed feature syntax belongs to the following chapters of the same reference.

- Values, Result, expressions, and state: [Chapter 2](02-types-expressions-state.md)
- Time values and schedules: [Chapter 3](03-time-and-schedules.md)
- `adapt`, `has`, capabilities, and constraints: [Chapter 4](04-sensors-constraints-control.md)
- Immutable import, parameter, instance, connect, and typed expression macro: [Chapter 6](06-composition-and-replay.md)

Each syntax combines only at its explicitly declared position in the respective chapter. There is no implicit import, wildcard export, compatibility alias fallback, runtime macro execution, or runtime search for files outside the document.
