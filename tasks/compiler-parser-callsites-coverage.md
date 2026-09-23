# Compiler parser callsite coverage

Scope: reachable lexer-independent `ControlParser` diagnostics in
`tools/control.mjs`. Tests invoke the public canonical `.ghost.md`
`compileSource` API. Semantic, literate, CLI, and resource diagnostics remain in
their existing suites.

## Active callsites

| Parser area | Existing coverage | Added or equivalent coverage |
|---|---|---|
| `parse` and declaration dispatch (272–311) | `parser-removed-prelude-purefn` through `parser-unexpected-declaration`; EOF and trailing-token cases in the syntax fixture/boundaries | All active branches mapped. `check` and `limit` share one direct-error callsite and each has a fixture. |
| Repeated names and `typeName` (314–327) | `parser-input-name`, `parser-type-name`, `parser-result-type-comma`, `parser-result-type-close`, boundary `result-error-type-eof` | New `repeated-port-name-after-comma` and `result-payload-type-after-generic-open` cover the repeated-name state and first recursive Result type. The second recursive Result type is the existing EOF case. |
| Ports, state, config, let and type declarations (330–390) | Dedicated fixture cases cover each `expect`, identifier and direct config error; `config-body-eof` covers its option loop | New `repeated-enum-member-after-pipe` covers the loop member callsite. Input/output share `port`; their different names, colon and semicolon messages already have separate fixtures. Let annotations reuse the tested `typeName` helper without a separate error branch. |
| Functions, sensors and signals (409–446) | Dedicated function/sensor/signal fixture cases; structural tests cover trailing parameter comma and malformed nested function expressions | Function parameter/result types reuse `typeName`. Sensor option loop EOF is equivalent to its tested `expected sensor option` callsite. |
| DailySlots and Solar schedules (448–524) | Every `expect`, identifier and direct option/value error has a syntax fixture; schedule EOF and selected-entry EOF are boundary cases | `solarCoordinate` is one shared callsite: latitude literal and latitude/longitude ranges cover its dynamic label branches. |
| Timers, transitions, connections and constraints (527–555) | Timer, next-state, connection, require and mutex fixtures cover all active checks | New `repeated-mutex-name-after-comma` covers the repeated names state. Connection-name parsing is selected only after identifier+`<-` lookahead, so its identifier/`<-` checks cannot fail independently. |
| Expressions, calls, sets and cases (563–638) | Generic expression, if, member, grouping, call, set and case fixtures; syntax boundaries/structure cover RHS EOF, named-argument RHS, pipeline, branch and delimiter contexts | `window_*` and `rate(...)` use this same call parser. `parser-call-close` and structural `nested-named-argument-missing-expression` cover their parser callsites; operation-specific failures are semantic diagnostics. |
| Parser limits (256–267) | `compiler-syntax-diagnostics.test.mjs` covers AST node and nesting limits | No new case. |

## Genuinely unreachable guards

- `enumDecl` (392–407) cannot be entered: declaration dispatch rejects the
  removed `enum` alias first. Its legacy inner diagnostics are not authored-source
  diagnostics.
- `nextStatement(true)` is unreachable because declaration dispatch rejects the
  removed `next` keyword. The active apostrophe form is covered.
- `connection()` is entered only after identifier+`<-` lookahead, so its internal
  output-name and `<-` guards cannot independently reject authored input.
- `call()` is entered only while `(` already matches, so its opening-parenthesis
  guard cannot independently fail.
- Declaration-loop EOF is converted to the located `unclosed control block`
  diagnostic before `declaration()` can report an end-of-file declaration.

## Added evidence

`tests/compiler-parser-callsites.test.mjs` adds four independently named cases.
Each case first compiles an adjacent valid canonical document and then asserts the
exact `ControlCompileError`, filename, line, column, and complete message.
