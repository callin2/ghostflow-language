# Compiler diagnostics inventory

Initial mechanical discovery snapshot. Previous aggregate callsite counts are withdrawn. Each row is a source match for `throw`, `error()`, `fail()`, `internal()`, `.expect()`, or `.identifier()`; multiline and multiple calls on one line are not inferred. The original `UNMAPPED` status below is retained as discovery history. It is not the current acceptance status. Line numbers precede the diagnostic fixes.

## Reconciled audit locations

| Initial scope | Current classification and evidence |
|---|---|
| `control.mjs` (327 matched lines) | Parser cases and `siteCoverage`/`unreachable` in `tests/fixtures/compiler-syntax-diagnostics.json`; lowerer guards and internal exclusions in `compiler-semantic-diagnostics-coverage.md`. Helper definitions and rethrows are not additional diagnostics. |
| `literate.mjs` (10), `compile-source.mjs` (8), `ghostc.mjs` (2) | Syntax fixture mapping and `tests/compiler-syntax-diagnostics.test.mjs`; compiled-module size guard additionally covered by the semantic suite's public module-size boundary test. |
| `time-literals.mjs` (14), `quantities.mjs` (8), `gfb1.mjs` (61) | Literal-helper and public GFB lowering tables in `compiler-semantic-diagnostics-coverage.md`; malformed raw IR and direct helper misuse are explicitly distinguished from canonical source diagnostics. |
| `toolchain.mjs` (20) | This module re-exports public `compileSource`. Its local throwing guards validate restored/persisted artifacts or generated artifact consistency: source envelope shape, hashes, replay bytes, manifest and interaction identity. They are artifact-integrity paths, not syntax/type rejection paths. Existing coverage is in `tests/toolchain.test.mjs`, `tests/source-trace.test.mjs`, and `tests/result-provenance.test.mjs`; this source-diagnostic task does not claim exhaustive artifact-guard coverage. |
| Additional authored intent and interaction paths | Syntax fixture maps public `source-trace.mjs` intent errors. `compiler-interaction-diagnostics-coverage.md` maps optional schema emission, identity and authored provenance errors. |

These classifications cover compiler-owned diagnostics reachable from canonical authored source and CLI ingress. They do not claim measured branch coverage, all runtime faults, every malformed-input combination, or all operating-system failures.

## Current bounded Int operating-settings mapping

The `UNMAPPED` labels in the discovery table are historical mechanical-discovery status. They are not current verdicts for the bounded mappings below. This section maps diagnostic families by behavior; it does not claim one independent test for every callsite or complete branch coverage.

| Current source guard | Existing case or test | Evidence boundary |
|---|---|---|
| `tools/control.mjs:923-924` — unsupported/nonliteral operating config initial | `tests/int-operating-settings.test.mjs`, `compiler rejects invalid Int setting literals at exact authored locations`; semantic fixture `config-computed-initial` | Int-specific initial literal family covered; not every source spelling combination. |
| `tools/control.mjs:926-929` — unknown option, access, label, Bool bounds | `tests/fixtures/compiler-semantic-diagnostics.mjs`: `config-unknown-option`, `config-access`, `config-label`, `config-bool-bounds` | Existing semantic diagnostic harness asserts class/location/message and valid neighbors. |
| `tools/control.mjs:930-935` — Int min/max/step literal typing and i32 limits | `tests/int-operating-settings.test.mjs`, same exact-location test; semantic cases `config-date-step-fraction` and `config-date-step-overflow` | Covers fractional and out-of-range Int setting literals; not arbitrary malformed option ordering. |
| `tools/control.mjs:941-946` — initial range and min-relative Int grid | `tests/int-operating-settings.test.mjs`, `exact grid mismatch`; semantic cases `config-outside-range` and `config-default-grid` | Covers family behavior and exact location; not exhaustive numeric combinations. |
| `tools/control.mjs:947` — Int maximum not aligned to step | `tests/int-operating-settings.test.mjs`, `max exact grid mismatch` | Explicit Int max-grid case. |
| `tools/operating-settings.mjs:91-108` — candidate stale/type/range/modulo/span rejection | `tests/int-operating-settings.test.mjs`, `candidate validation uses exact Int type range and min-relative modulo` | Host candidate path is covered separately from compiler diagnostics. |
| `runtimes/wasm/control-runtime.mjs` Int manifest metadata guards | `tests/int-settings-artifacts.test.mjs`, runtime malformed Int setting metadata cases; `tests/int-settings-package.test.mjs` | Runtime/package validation evidence, not canonical source diagnostic coverage. |

## Original discovery rows

Candidate source-match rows: **450**.

| File:line | Source excerpt | Status |
|---|---|---|
| `tools/control.mjs:46` | `function error(loc, message) { throw new ControlCompileError(message, loc); }` | UNMAPPED |
| `tools/control.mjs:47` | `function internal(message) { throw new ControlCompileError(message); }` | UNMAPPED |
| `tools/control.mjs:68` | `if (!match) internal(\`cannot lower finite number ${text}\`);` | UNMAPPED |
| `tools/control.mjs:110` | `if (typeof source !== 'string') internal('control source must be a string');` | UNMAPPED |
| `tools/control.mjs:111` | `if (source.length > 256 * 1024) internal('control source exceeds 256 KiB parser limit');` | UNMAPPED |
| `tools/control.mjs:121` | `if (tokens.length >= 8192) error(start, 'token limit exceeded (8192)');` | UNMAPPED |
| `tools/control.mjs:141` | `if (!closed) error(start, \`unterminated ${tagged[1]} literal\`);` | UNMAPPED |
| `tools/control.mjs:159` | `if (!closed) error(start, 'unterminated string literal');` | UNMAPPED |
| `tools/control.mjs:160` | `try { add('string', JSON.parse(raw), start); } catch { error(start, 'invalid string literal'); }` | UNMAPPED |
| `tools/control.mjs:187` | `error(start, \`unexpected character ${JSON.stringify(c)}\`);` | UNMAPPED |
| `tools/control.mjs:206` | `if (!this.matches(value)) error(this.current(), message);` | UNMAPPED |
| `tools/control.mjs:211` | `if (token.kind !== 'identifier') error(token, message);` | UNMAPPED |
| `tools/control.mjs:216` | `if (this.nodes.length >= NODE_LIMIT) error(loc, \`AST node limit exceeded (${NODE_LIMIT})\`);` | UNMAPPED |
| `tools/control.mjs:226` | `if (++this.depth > PARSER_DEPTH_LIMIT) error(loc, \`parser nesting exceeds ${PARSER_DEPTH_LIMIT}\`);` | UNMAPPED |
| `tools/control.mjs:231` | `if (this.matches('purefn')) error(this.current(), 'removed alias purefn; use fn');` | UNMAPPED |
| `tools/control.mjs:233` | `const start = this.expect('control', 'expected control declaration');` | UNMAPPED |
| `tools/control.mjs:234` | `const name = this.identifier('expected control name');` | UNMAPPED |
| `tools/control.mjs:235` | `this.expect('{', 'expected { after control name');` | UNMAPPED |
| `tools/control.mjs:238` | `if (this.current().kind === 'eof') error(start, 'unclosed control block');` | UNMAPPED |
| `tools/control.mjs:242` | `this.expect('');` | UNMAPPED |
| `tools/control.mjs:254` | `case 'enum': error(token, 'removed alias enum; use type Name = A \| B;');` | UNMAPPED |
| `tools/control.mjs:256` | `case 'purefn': error(token, 'removed alias purefn; use fn');` | UNMAPPED |
| `tools/control.mjs:263` | `case 'next': error(token, "removed alias next; use stateName' = expression;");` | UNMAPPED |
| `tools/control.mjs:264` | `case 'adapt': error(token, 'unsupported construct adapt');` | UNMAPPED |
| `tools/control.mjs:265` | `case 'constraints': error(token, 'unsupported construct constraints; use the named-constraints parser');` | UNMAPPED |
| `tools/control.mjs:266` | `case 'check': case 'limit': error(token, \`unsupported construct ${token.value}\`);` | UNMAPPED |
| `tools/control.mjs:270` | `error(token, \`unexpected declaration ${token.value \|\| 'end of file'}\`);` | UNMAPPED |
| `tools/control.mjs:274` | `const names = [this.identifier(message)];` | UNMAPPED |
| `tools/control.mjs:275` | `while (this.maybe(',')) names.push(this.identifier(message));` | UNMAPPED |
| `tools/control.mjs:279` | `const token = this.identifier('expected type name');` | UNMAPPED |
| `tools/control.mjs:283` | `this.expect(',', 'Result type requires payload and error types');` | UNMAPPED |
| `tools/control.mjs:285` | `this.expect('>', 'Result type requires closing >');` | UNMAPPED |
| `tools/control.mjs:292` | `this.expect(':', \`expected : after ${kind} name\`);` | UNMAPPED |
| `tools/control.mjs:295` | `error(this.current(), 'output declarations are type-only; connect each output with \`name <- expression;\`');` | UNMAPPED |
| `tools/control.mjs:299` | `this.expect(';', \`expected ; after ${kind} declaration\`);` | UNMAPPED |
| `tools/control.mjs:303` | `const start = this.take(), name = this.identifier('expected state name');` | UNMAPPED |
| `tools/control.mjs:304` | `this.expect(':'); const type = this.typeName(); this.expect('=', 'state requires an initial value');` | UNMAPPED |
| `tools/control.mjs:305` | `const initial = this.expression(); this.expect(';', 'expected ; after state declaration');` | UNMAPPED |
| `tools/control.mjs:309` | `const start = this.take(), name = this.identifier('expected config name');` | UNMAPPED |
| `tools/control.mjs:310` | `this.expect(':'); const type = this.typeName(); this.expect('=', 'config requires a value');` | UNMAPPED |
| `tools/control.mjs:315` | `const key = this.identifier('expected config option');` | UNMAPPED |
| `tools/control.mjs:316` | `if (settings[key.value] !== undefined) error(key, \`duplicate config option ${key.value}\`);` | UNMAPPED |
| `tools/control.mjs:317` | `this.expect('=', \`expected = after config option ${key.value}\`);` | UNMAPPED |
| `tools/control.mjs:321` | `if (minus) error(minus, 'config label must be a string');` | UNMAPPED |
| `tools/control.mjs:322` | `if (option.kind !== 'string') error(option, 'config label must be a string');` | UNMAPPED |
| `tools/control.mjs:325` | `if (minus && option.kind !== 'number') error(option, 'config option negative value must be a number literal');` | UNMAPPED |
| `tools/control.mjs:326` | `if (option.kind !== 'identifier' && option.kind !== 'number' && option.kind !== 'time-literal') error(option, \`config option ${key.value} must be a literal\`);` | UNMAPPED |
| `tools/control.mjs:329` | `this.expect(';', 'expected ; after config option');` | UNMAPPED |
| `tools/control.mjs:333` | `if (!settings \|\| Object.keys(settings).length === 0) this.expect(';', 'expected ; after config declaration');` | UNMAPPED |
| `tools/control.mjs:338` | `const start = this.take(), name = this.identifier('expected let name');` | UNMAPPED |
| `tools/control.mjs:341` | `this.expect('=', 'let requires ='); const value = this.expression(); this.expect(';', 'expected ; after let declaration');` | UNMAPPED |
| `tools/control.mjs:345` | `const start = this.take(), name = this.identifier('expected type name');` | UNMAPPED |
| `tools/control.mjs:346` | `this.expect('=', 'type requires ='); const members = [this.identifier('expected enum member')];` | UNMAPPED |
| `tools/control.mjs:347` | `while (this.maybe('\|')) members.push(this.identifier('expected enum member'));` | UNMAPPED |
| `tools/control.mjs:348` | `this.expect(';', 'expected ; after type declaration');` | UNMAPPED |
| `tools/control.mjs:352` | `const start = this.take(), name = this.identifier('expected enum name');` | UNMAPPED |
| `tools/control.mjs:355` | `members.push(this.identifier('expected enum member'));` | UNMAPPED |
| `tools/control.mjs:356` | `while (this.maybe('\|')) members.push(this.identifier('expected enum member'));` | UNMAPPED |
| `tools/control.mjs:357` | `this.expect(';', 'expected ; after enum declaration');` | UNMAPPED |
| `tools/control.mjs:359` | `this.expect('{', 'expected { after enum name');` | UNMAPPED |
| `tools/control.mjs:361` | `members.push(this.identifier('expected enum member'));` | UNMAPPED |
| `tools/control.mjs:369` | `const start = this.take(), name = this.identifier('expected function name');` | UNMAPPED |
| `tools/control.mjs:370` | `this.expect('(', 'expected ( after function name'); const params = [];` | UNMAPPED |
| `tools/control.mjs:373` | `const param = this.identifier('expected parameter name'); this.expect(':', 'parameter requires a type');` | UNMAPPED |
| `tools/control.mjs:377` | `this.expect(')'); this.expect('->', 'function requires -> result type'); const result = this.typeName();` | UNMAPPED |
| `tools/control.mjs:378` | `this.expect('{', 'expected { before function body'); const body = this.expression(); this.maybe(';');` | UNMAPPED |
| `tools/control.mjs:379` | `this.expect('}', 'expected } after function body'); this.maybe(';');` | UNMAPPED |
| `tools/control.mjs:383` | `const start = this.take(), name = this.identifier('expected sensor name'); const optional = !!this.maybe('?');` | UNMAPPED |
| `tools/control.mjs:384` | `this.expect(':'); const type = this.typeName(); const options = {};` | UNMAPPED |
| `tools/control.mjs:387` | `const key = this.identifier('expected sensor option'); this.expect('=', \`expected = after ${key.value}\`);` | UNMAPPED |
| `tools/control.mjs:389` | `options.validMin = this.expression(); this.expect('..', 'valid expects ..'); options.validMax = this.expression();` | UNMAPPED |
| `tools/control.mjs:394` | `options.recoverAfter = this.expression(); this.expect('samples', 'recover_after expects samples');` | UNMAPPED |
| `tools/control.mjs:395` | `} else error(key, \`unsupported sensor option ${key.value}\`);` | UNMAPPED |
| `tools/control.mjs:396` | `this.expect(';', 'expected ; after sensor option');` | UNMAPPED |
| `tools/control.mjs:399` | `} else this.expect(';', 'expected ; after sensor declaration');` | UNMAPPED |
| `tools/control.mjs:403` | `const start = this.take(), name = this.identifier('expected signal name'); this.expect('=', 'signal requires =');` | UNMAPPED |
| `tools/control.mjs:404` | `const call = this.expression(); this.expect(';', 'expected ; after signal declaration');` | UNMAPPED |
| `tools/control.mjs:408` | `const start = this.take(), name = this.identifier('expected schedule name'); this.expect(':');` | UNMAPPED |
| `tools/control.mjs:409` | `const kind = this.identifier('expected schedule type');` | UNMAPPED |
| `tools/control.mjs:411` | `if (kind.value !== 'DailySlots') error(kind, 'only DailySlots<15min> schedules are supported (or Solar)');` | UNMAPPED |
| `tools/control.mjs:412` | `this.expect('<'); const interval = this.expression(5); this.expect('>', 'expected > after DailySlots interval');` | UNMAPPED |
| `tools/control.mjs:413` | `this.expect('{', 'expected { after schedule type'); let timezone = null, selected = null;` | UNMAPPED |
| `tools/control.mjs:415` | `const key = this.identifier('expected schedule option'); this.expect('=');` | UNMAPPED |
| `tools/control.mjs:416` | `if (key.value === 'timezone') { const value = this.current(); if (value.kind !== 'string') error(value, 'timezone must be a string'); timezone = this.take().value; }` | UNMAPPED |
| `tools/control.mjs:418` | `this.expect('['); selected = [];` | UNMAPPED |
| `tools/control.mjs:419` | `if (!this.matches(']')) do { const time = this.current(); if (time.kind !== 'time') error(time, 'selected entries must be HH:MM'); selected.push(this.take()); } while (this.maybe(','));` | UNMAPPED |
| `tools/control.mjs:420` | `this.expect(']');` | UNMAPPED |
| `tools/control.mjs:421` | `} else error(key, \`unsupported schedule option ${key.value}\`);` | UNMAPPED |
| `tools/control.mjs:422` | `this.expect(';', 'expected ; after schedule option');` | UNMAPPED |
| `tools/control.mjs:428` | `this.expect('{', 'expected { after Solar');` | UNMAPPED |
| `tools/control.mjs:432` | `const key = this.identifier('expected Solar schedule option');` | UNMAPPED |
| `tools/control.mjs:433` | `if (seen.has(key.value)) error(key, \`duplicate Solar schedule option ${key.value}\`);` | UNMAPPED |
| `tools/control.mjs:435` | `this.expect('=', \`expected = after Solar schedule option ${key.value}\`);` | UNMAPPED |
| `tools/control.mjs:438` | `if (value.kind !== 'string') error(value, 'Solar timezone must be a string');` | UNMAPPED |
| `tools/control.mjs:445` | `const value = this.identifier('Solar fallback must be skip');` | UNMAPPED |
| `tools/control.mjs:446` | `if (value.value !== 'skip') error(value, 'Solar fallback must be skip');` | UNMAPPED |
| `tools/control.mjs:448` | `} else error(key, \`unsupported Solar schedule option ${key.value}\`);` | UNMAPPED |
| `tools/control.mjs:449` | `this.expect(';', 'expected ; after Solar schedule option');` | UNMAPPED |
| `tools/control.mjs:458` | `error(value, \`Solar ${label} must be a signed finite numeric literal\`);` | UNMAPPED |
| `tools/control.mjs:464` | `error(value, \`Solar ${label} must be between ${-limit} and ${limit}\`);` | UNMAPPED |
| `tools/control.mjs:469` | `const tag = this.identifier('Solar at must use sun\`rise\` or sun\`set\`');` | UNMAPPED |
| `tools/control.mjs:470` | `if (tag.value !== 'sun') error(tag, 'Solar at must use sun\`rise\` or sun\`set\`');` | UNMAPPED |
| `tools/control.mjs:471` | `this.expect('\`', 'Solar at must use a sun tagged literal');` | UNMAPPED |
| `tools/control.mjs:472` | `const event = this.identifier('Solar event must be rise or set');` | UNMAPPED |
| `tools/control.mjs:473` | `if (event.value !== 'rise' && event.value !== 'set') error(event, 'Solar event must be rise or set');` | UNMAPPED |
| `tools/control.mjs:478` | `if (duration.kind !== 'number') error(duration, 'Solar offset must be an integer duration literal');` | UNMAPPED |
| `tools/control.mjs:482` | `this.expect('\`', 'Solar at tagged literal must end with \`');` | UNMAPPED |
| `tools/control.mjs:486` | `const start = this.take(), name = this.identifier('expected timer name'); this.expect('=');` | UNMAPPED |
| `tools/control.mjs:487` | `const call = this.expression(); this.expect(';', 'expected ; after timer declaration');` | UNMAPPED |
| `tools/control.mjs:491` | `const start = this.take(); const name = withKeyword ? this.identifier('expected state name') : start;` | UNMAPPED |
| `tools/control.mjs:492` | `if (!withKeyword) this.expect("'");` | UNMAPPED |
| `tools/control.mjs:493` | `this.expect('=', 'next state requires ='); const value = this.expression(); this.expect(';', 'expected ; after next state');` | UNMAPPED |
| `tools/control.mjs:497` | `const name = this.identifier('expected output name'), start = name;` | UNMAPPED |
| `tools/control.mjs:498` | `this.expect('<-', 'output connection requires <-'); const value = this.expression(); this.expect(';', 'expected ; after output connection');` | UNMAPPED |
| `tools/control.mjs:506` | `const left = this.expression(1); this.expect('=>', 'require supports an implication with =>'); const right = this.expression();` | UNMAPPED |
| `tools/control.mjs:509` | `this.expect(';', 'expected ; after require');` | UNMAPPED |
| `tools/control.mjs:513` | `const start = this.take(); this.expect('('); const names = this.names('expected mutex output'); this.expect(')'); this.expect(';');` | UNMAPPED |
| `tools/control.mjs:537` | `const test = this.expression(); this.expect('then', 'if requires then'); const yes = this.expression(); this.expect('else', 'if requires else');` | UNMAPPED |
| `tools/control.mjs:541` | `if (token.value === 'adapt' \|\| token.value === 'constraints') error(token, \`unsupported construct ${token.value}\`);` | UNMAPPED |
| `tools/control.mjs:544` | `const member = this.identifier('expected member after .');` | UNMAPPED |
| `tools/control.mjs:559` | `const value = this.expression(); this.expect(')', 'expected )');` | UNMAPPED |
| `tools/control.mjs:564` | `error(token, \`expected expression, found ${token.value \|\| 'end of file'}\`);` | UNMAPPED |
| `tools/control.mjs:567` | `this.expect('('); const args = [], named = [];` | UNMAPPED |
| `tools/control.mjs:575` | `this.expect(')', 'expected ) after arguments');` | UNMAPPED |
| `tools/control.mjs:579` | `this.expect('{', 'in requires {'); const values = [];` | UNMAPPED |
| `tools/control.mjs:581` | `this.expect('}', 'expected } after in set');` | UNMAPPED |
| `tools/control.mjs:582` | `if (!values.length) error(token, 'in set must not be empty');` | UNMAPPED |
| `tools/control.mjs:586` | `const value = this.expression(); this.expect('{', 'case requires {'); const branches = [];` | UNMAPPED |
| `tools/control.mjs:588` | `const pattern = this.identifier('expected case pattern'); let binding = null;` | UNMAPPED |
| `tools/control.mjs:589` | `if (this.maybe('(')) { const bound = this.current(); if (bound.kind !== 'identifier') error(bound, 'expected case binding'); binding = this.take().value; this.expect(')'); }` | UNMAPPED |
| `tools/control.mjs:590` | `this.expect('=>', 'case pattern requires =>'); const body = this.expression(); this.maybe(';');` | UNMAPPED |
| `tools/control.mjs:602` | `if (!isName(name)) error(loc, \`invalid ${label} name ${name}\`);` | UNMAPPED |
| `tools/control.mjs:603` | `if (isReserved(name)) error(loc, \`${label} name ${name} uses reserved ${RESERVED_PREFIX} prefix\`);` | UNMAPPED |
| `tools/control.mjs:604` | `if (KEYWORDS.has(name)) error(loc, \`${label} name ${name} is reserved\`);` | UNMAPPED |
| `tools/control.mjs:605` | `if (FAULT_MEMBER_NAMES.has(name)) error(loc, \`${label} name ${name} is a reserved fault member\`);` | UNMAPPED |
| `tools/control.mjs:611` | `if (match[1].includes('.')) error(loc, 'Duration literal must use a whole-number unit quantity');` | UNMAPPED |
| `tools/control.mjs:613` | `if (milliseconds > 9007199254740991n) error(loc, 'Duration literal exceeds the maximum 2^53-1 milliseconds');` | UNMAPPED |
| `tools/control.mjs:618` | `if (!match) error(loc, 'Solar offset must be an integer duration literal using ms, s, min, or h');` | UNMAPPED |
| `tools/control.mjs:622` | `if (magnitude > day) error(loc, 'Solar offset magnitude must not exceed 24h');` | UNMAPPED |
| `tools/control.mjs:630` | `if (typeof value !== 'boolean') error(loc, \`${label} must be Bool\`);` | UNMAPPED |
| `tools/control.mjs:632` | `if (!Number.isSafeInteger(value) \|\| value < 0) error(loc, \`${label} must be a non-negative safe integer Duration\`);` | UNMAPPED |
| `tools/control.mjs:634` | `try { validateTimeValue(type.kind, value, label); } catch (cause) { error(loc, cause.message); }` | UNMAPPED |
| `tools/control.mjs:636` | `if (!Number.isFinite(value)) error(loc, \`${label} must be finite\`);` | UNMAPPED |
| `tools/control.mjs:637` | `if (type.kind === 'Percent' && (value < 0 \|\| value > 100)) error(loc, \`${label} must be between 0% and 100%\`);` | UNMAPPED |
| `tools/control.mjs:638` | `if (type.kind === 'RelativeHumidity' && (value < 0 \|\| value > 1)) error(loc, \`${label} must be between 0%RH and 100%RH\`);` | UNMAPPED |
| `tools/control.mjs:644` | `if (type.kind === 'Duration') { value = duration(raw, loc); if (value === null) error(loc, 'Duration setting must use a duration literal'); }` | UNMAPPED |
| `tools/control.mjs:646` | `if (!/^-?\d+$/.test(String(raw))) error(loc, 'Int setting must use a whole decimal literal');` | UNMAPPED |
| `tools/control.mjs:648` | `if (!Number.isInteger(value) \|\| value < -2147483648 \|\| value > 2147483647) error(loc, 'Int setting is outside -2147483648..2147483647');` | UNMAPPED |
| `tools/control.mjs:650` | `else if (type.kind === 'Percent') { if (!String(raw).endsWith('%')) error(loc, 'Percent setting must use %'); value = Number(String(raw).slice(0, -1)); }` | UNMAPPED |
| `tools/control.mjs:654` | `if (!match) error(loc, \`${type.kind} setting must use a tagged literal\`);` | UNMAPPED |
| `tools/control.mjs:656` | `try { parsed = parseTimeLiteral(match[1], match[2]); } catch (cause) { error(loc, cause.message); }` | UNMAPPED |
| `tools/control.mjs:657` | `if (parsed.type !== type.kind) error(loc, \`${type.kind} setting must use a matching tagged literal\`);` | UNMAPPED |
| `tools/control.mjs:662` | `if (!parsed \|\| parsed.type !== type.kind) error(loc, \`${type.kind} setting must use a ${type.kind} unit literal\`);` | UNMAPPED |
| `tools/control.mjs:692` | `if (type.kind === 'Int' && (!Number.isInteger(value) \|\| value < -2147483648 \|\| value > 2147483647)) error(loc, 'constant Int arithmetic overflows');` | UNMAPPED |
| `tools/control.mjs:693` | `if (type.kind === 'Percent' && (!Number.isFinite(value) \|\| value < 0 \|\| value > 100)) error(loc, 'Percent constant must be between 0% and 100%');` | UNMAPPED |
| `tools/control.mjs:694` | `if (type.kind === 'RelativeHumidity' && (!Number.isFinite(value) \|\| value < 0 \|\| value > 1)) error(loc, 'RelativeHumidity constant must be between 0%RH and 100%RH');` | UNMAPPED |
| `tools/control.mjs:695` | `if (type.kind === 'Duration' && (!Number.isSafeInteger(value) \|\| value < 0)) error(loc, 'Duration constant must be a non-negative integer number of milliseconds');` | UNMAPPED |
| `tools/control.mjs:697` | `try { validateTimeValue(type.kind, value, \`${type.kind} constant\`); } catch (cause) { error(loc, cause.message); }` | UNMAPPED |
| `tools/control.mjs:708` | `if (value < -2147483648n \|\| value > 2147483647n) error(loc, 'Int literal is outside -2147483648..2147483647');` | UNMAPPED |
| `tools/control.mjs:716` | `try { parsed = parseTimeLiteral(tagged[1], tagged[2]); } catch (cause) { error(loc, cause.message); }` | UNMAPPED |
| `tools/control.mjs:729` | `if (!Number.isFinite(value) \|\| value < 0 \|\| value > 100) error(loc, 'Percent literal must be between 0% and 100%');` | UNMAPPED |
| `tools/control.mjs:735` | `if (!Number.isFinite(value)) error(loc, 'number literal must be finite');` | UNMAPPED |
| `tools/control.mjs:741` | `if (!Number.isFinite(value)) error(loc, 'number literal must be finite');` | UNMAPPED |
| `tools/control.mjs:742` | `if (expected?.kind === 'Int') error(loc, 'Int literal must be a whole decimal numeral without a decimal point or exponent');` | UNMAPPED |
| `tools/control.mjs:799` | `error(this.ast.loc, \`GFB1 lowering rejected control: ${message}\`);` | UNMAPPED |
| `tools/control.mjs:804` | `if (!timer) internal(\`timer ${node.name} has no lowered state binding\`);` | UNMAPPED |
| `tools/control.mjs:821` | `if (this.symbols.has(name)) error(loc, \`duplicate name ${name}\`);` | UNMAPPED |
| `tools/control.mjs:826` | `if (!Array.isArray(type.args) \|\| type.args.length !== 2) error(type.loc, 'Result type requires payload and error types');` | UNMAPPED |
| `tools/control.mjs:829` | `if (!FAULT_ENUMS.has(fault.kind)) error(type.args[1].loc, 'Result error type must be a compiler-owned fault enum');` | UNMAPPED |
| `tools/control.mjs:830` | `if (value.kind === 'Result') error(type.args[0].loc, 'nested Result payload is not supported');` | UNMAPPED |
| `tools/control.mjs:838` | `error(type.loc, \`unknown type ${type.name}\`);` | UNMAPPED |
| `tools/control.mjs:843` | `if (FAULT_ENUMS.has(item.name) \|\| item.name === 'Result' \|\| SCALAR_TYPES.has(item.name)) error(item.loc, \`type name ${item.name} is reserved\`);` | UNMAPPED |
| `tools/control.mjs:845` | `if (!item.members.length) error(item.loc, 'enum needs at least one member');` | UNMAPPED |
| `tools/control.mjs:849` | `if (values.has(member.name) \|\| this.enumMembers.has(member.name)) error(member.loc, \`duplicate enum member ${member.name}\`);` | UNMAPPED |
| `tools/control.mjs:861` | `if (this.gfbInputs.some(x => x[1] === name)) error(loc, \`duplicate generated input ${name}\`);` | UNMAPPED |
| `tools/control.mjs:875` | `const type = this.resolveType(item.type); if (!SCALAR_TYPES.has(type.kind)) error(item.type.loc, 'input must use a scalar type');` | UNMAPPED |
| `tools/control.mjs:879` | `const type = this.resolveType(item.type); if (!SCALAR_TYPES.has(type.kind)) error(item.type.loc, 'output must use a scalar type');` | UNMAPPED |
| `tools/control.mjs:884` | `if (type.kind === 'Result') error(item.type.loc, 'Result cannot be stored in state');` | UNMAPPED |
| `tools/control.mjs:885` | `if (!sameType(initial.type, type) \|\| initial.constant === undefined) error(item.loc, 'state initial value must be a constant of the state type');` | UNMAPPED |
| `tools/control.mjs:890` | `if (type.kind === 'Result') error(item.type.loc, 'Result cannot be stored in config');` | UNMAPPED |
| `tools/control.mjs:891` | `if (!sameType(value.type, type) \|\| value.constant === undefined) error(item.loc, 'config value must be a constant of the declared type');` | UNMAPPED |
| `tools/control.mjs:895` | `if (this.hasSolarSchedule) error(item.loc, 'Solar schedules cannot be combined with operating settings metadata yet');` | UNMAPPED |
| `tools/control.mjs:896` | `if (!isOperatingConfigLiteral(item.value, type)) error(item.value.loc, 'operating config initial value must be a supported literal');` | UNMAPPED |
| `tools/control.mjs:899` | `for (const key of Object.keys(settings)) if (!allowed.has(key)) error(item.loc, \`unknown config option ${key}\`);` | UNMAPPED |
| `tools/control.mjs:900` | `if (!['operator', 'designer'].includes(settings.access ?? '')) error(item.loc, 'config access must be operator or designer');` | UNMAPPED |
| `tools/control.mjs:901` | `if (settings.label !== undefined && (settings.label.length === 0 \|\| settings.label.length > 128)) error(item.loc, 'config label must be 1 to 128 characters');` | UNMAPPED |
| `tools/control.mjs:902` | `if (type.kind === 'Bool' && ['min', 'max', 'step'].some(key => settings[key] !== undefined)) error(item.loc, 'Bool config cannot have numeric bounds');` | UNMAPPED |
| `tools/control.mjs:914` | `if ((!['Number', 'Duration', 'Percent'].includes(type.kind) && !isQuantityType(type.kind) && !isTimeType(type.kind)) \|\| settings.min === undefined \|\| settings.max === undefined \|\| settings.step === undefined \|\| settings.step <= 0 \|` | UNMAPPED |
| `tools/control.mjs:915` | `if (value.constant < settings.min \|\| value.constant > settings.max) error(item.value.loc, 'config initial value is outside settings range');` | UNMAPPED |
| `tools/control.mjs:919` | `if (initialMisaligned) error(item.value.loc, 'config initial value is not aligned to settings.step from settings.min');` | UNMAPPED |
| `tools/control.mjs:920` | `if (isTimeType(type.kind) && (settings.max - settings.min) % settings.step !== 0) error(item.loc, 'time config max is not aligned to settings.step from settings.min');` | UNMAPPED |
| `tools/control.mjs:938` | `if (!output.expression) error(output.loc, \`output ${output.name} requires exactly one connection (${output.name} <- expression;)\`);` | UNMAPPED |
| `tools/control.mjs:943` | `const type = this.resolveType(item.type); if (!['Bool', 'Number', 'Percent'].includes(type.kind) && !isQuantityType(type.kind)) error(item.type.loc, 'sensor type must be Bool, Number, Percent, or a physical quantity');` | UNMAPPED |
| `tools/control.mjs:949` | `if (!node) { if (required) error(item.loc, \`sensor ${item.name} requires ${label}\`); return null; }` | UNMAPPED |
| `tools/control.mjs:951` | `if (!sameType(out.type, expected) \|\| out.constant === undefined) error(node.loc, \`${label} must be a constant ${expected.kind}\`);` | UNMAPPED |
| `tools/control.mjs:956` | `if ((validMin === null) !== (validMax === null)) error(item.loc, 'valid requires both lower and upper bounds');` | UNMAPPED |
| `tools/control.mjs:957` | `if (validMin !== null && validMin > validMax) error(item.loc, 'sensor valid range is inverted');` | UNMAPPED |
| `tools/control.mjs:960` | `if (!['Number', 'Percent'].includes(type.kind) && !isQuantityType(type.kind)) error(opts.filter.loc, 'numeric filtering requires a numeric sensor');` | UNMAPPED |
| `tools/control.mjs:961` | `if (opts.filter.kind !== 'call') error(opts.filter.loc, 'filter must be median(N), moving_average(N), or ema(alpha: Number)');` | UNMAPPED |
| `tools/control.mjs:965` | `if (opts.filter.args.length \|\| opts.filter.named.length !== 1 \|\| !named.has('alpha')) error(opts.filter.loc, 'ema filter requires exactly ema(alpha: Number)');` | UNMAPPED |
| `tools/control.mjs:967` | `if (!Number.isFinite(alpha) \|\| !(alpha > 0 && alpha <= 1)) error(opts.filter.loc, 'ema alpha must be finite and in (0, 1]');` | UNMAPPED |
| `tools/control.mjs:970` | `if (!['median', 'moving_average'].includes(filterName) \|\| opts.filter.args.length !== 1 \|\| opts.filter.named.length) error(opts.filter.loc, 'filter must be median(N), moving_average(N), or ema(alpha: Number)');` | UNMAPPED |
| `tools/control.mjs:972` | `if (!Number.isInteger(n) \|\| n < 1 \|\| n > 31 \|\| (filterName === 'median' && n % 2 === 0)) error(opts.filter.loc, \`${filterName} window must be ${filterName === 'median' ? 'an odd integer' : 'an integer'} from 1 to 31\`);` | UNMAPPED |
| `tools/control.mjs:978` | `if (opts.recoverAfter) { recoverSamples = read(opts.recoverAfter, NUMBER, 'recover_after'); if (!Number.isInteger(recoverSamples) \|\| recoverSamples < 1 \|\| recoverSamples > 31) error(opts.recoverAfter.loc, 'recover_after must be an integ` | UNMAPPED |
| `tools/control.mjs:979` | `if (sampleMs !== null && sampleMs <= 0 \|\| staleMs !== null && staleMs <= 0) error(item.loc, 'sensor durations must be positive');` | UNMAPPED |
| `tools/control.mjs:988` | `if (!sameType(interval.type, DURATION) \|\| interval.constant !== 900_000) error(item.interval.loc, 'only DailySlots<15min> is supported');` | UNMAPPED |
| `tools/control.mjs:989` | `if (!item.timezone \|\| !item.timezone.trim()) error(item.loc, 'schedule requires timezone');` | UNMAPPED |
| `tools/control.mjs:990` | `if (!item.selected) error(item.loc, 'schedule requires selected slots');` | UNMAPPED |
| `tools/control.mjs:994` | `if (hours > 23 \|\| minutes > 59 \|\| minuteOfDay % 15 !== 0) error(time, 'DailySlots<15min> requires a unique 15-minute HH:MM slot');` | UNMAPPED |
| `tools/control.mjs:995` | `if (seen.has(minuteOfDay)) error(time, 'duplicate schedule slot'); seen.add(minuteOfDay); slots.push(minuteOfDay);` | UNMAPPED |
| `tools/control.mjs:1002` | `if (item[field] === null) error(item.loc, \`Solar schedule requires ${field}\`);` | UNMAPPED |
| `tools/control.mjs:1004` | `if (!item.timezone.trim()) error(item.loc, 'Solar schedule requires a non-empty timezone');` | UNMAPPED |
| `tools/control.mjs:1006` | `catch { error(item.loc, 'Solar timezone must be a supported IANA timezone'); }` | UNMAPPED |
| `tools/control.mjs:1021` | `if (call.kind !== 'call' \|\| call.name !== 'hysteresis' \|\| call.args.length !== 1 \|\| call.named.length !== 3) error(call.loc, 'signal requires hysteresis(sensor, on_below:, off_above:, initial:)');` | UNMAPPED |
| `tools/control.mjs:1022` | `const sensorRef = call.args[0]; if (sensorRef.kind !== 'reference' \|\| !this.sensors.has(sensorRef.name)) error(sensorRef.loc, 'hysteresis first argument must be a declared sensor');` | UNMAPPED |
| `tools/control.mjs:1024` | `if (!['Number', 'Percent'].includes(sensor.type.kind) && !isQuantityType(sensor.type.kind)) error(sensorRef.loc, 'hysteresis requires a numeric sensor');` | UNMAPPED |
| `tools/control.mjs:1025` | `if (named.size !== 3 \|\| !named.has('on_below') \|\| !named.has('off_above') \|\| !named.has('initial')) error(call.loc, 'hysteresis requires on_below, off_above, and initial');` | UNMAPPED |
| `tools/control.mjs:1029` | `if (!sameType(below.type, sensor.type) \|\| below.constant === undefined \|\| !sameType(above.type, sensor.type) \|\| above.constant === undefined) error(call.loc, 'hysteresis thresholds must be constant sensor values');` | UNMAPPED |
| `tools/control.mjs:1030` | `if (below.constant >= above.constant) error(call.loc, 'hysteresis on_below must be less than off_above');` | UNMAPPED |
| `tools/control.mjs:1031` | `if (!sameType(initial.type, BOOL) \|\| initial.constant === undefined) error(call.loc, 'hysteresis initial must be a Bool constant');` | UNMAPPED |
| `tools/control.mjs:1040` | `error(call.loc, 'timer requires elapsed(state) or continuous_true(Bool)');` | UNMAPPED |
| `tools/control.mjs:1047` | `if (stateRef.kind !== 'reference' \|\| !this.states.has(stateRef.name)) error(stateRef.loc, 'elapsed argument must be a declared state');` | UNMAPPED |
| `tools/control.mjs:1062` | `const timer = this.timers.get(name); if (!timer) internal(\`missing timer definition ${name}\`);` | UNMAPPED |
| `tools/control.mjs:1065` | `if (status === 'visiting') error(timer.loc, \`cyclic timer definition involving ${name}\`);` | UNMAPPED |
| `tools/control.mjs:1068` | `if (!sameType(condition.type, BOOL)) error(timer.conditionNode.loc, 'continuous_true argument must be Bool');` | UNMAPPED |
| `tools/control.mjs:1080` | `if (this.functions.has(item.name)) error(item.loc, \`duplicate function ${item.name}\`);` | UNMAPPED |
| `tools/control.mjs:1083` | `rejectName(parameter.name, parameter.loc, 'function parameter'); if (names.has(parameter.name)) error(parameter.loc, \`duplicate function parameter ${parameter.name}\`); names.add(parameter.name);` | UNMAPPED |
| `tools/control.mjs:1092` | `if (!sameType(value.type, fn.resultType)) error(fn.loc, \`function ${fn.name} returns ${typeNameOf(value.type)}, expected ${typeNameOf(fn.resultType)}\`);` | UNMAPPED |
| `tools/control.mjs:1099` | `const item = this.lets.get(name); if (!item) internal(\`missing let definition ${name}\`);` | UNMAPPED |
| `tools/control.mjs:1102` | `if (status === 'visiting') error(item.loc, \`cyclic let definition involving ${name}\`);` | UNMAPPED |
| `tools/control.mjs:1121` | `if (!sameType(resolvedAnnotation, value.type)) error(item.loc, \`let ${item.name} does not match annotation ${resolvedAnnotation.kind}\`);` | UNMAPPED |
| `tools/control.mjs:1127` | `const state = this.states.get(item.name); if (!state) error(item.loc, \`unknown state ${item.name}\`);` | UNMAPPED |
| `tools/control.mjs:1128` | `if (this.nexts.has(item.name)) error(item.loc, \`duplicate next state ${item.name}\`);` | UNMAPPED |
| `tools/control.mjs:1130` | `if (!sameType(value.type, state.type)) error(item.loc, \`next state ${item.name} must be ${state.type.kind}\`);` | UNMAPPED |
| `tools/control.mjs:1134` | `const output = this.outputs.get(item.name); if (!output) error(item.loc, \`unknown output ${item.name}\`);` | UNMAPPED |
| `tools/control.mjs:1135` | `if (output.expression) error(item.loc, \`duplicate output connection ${item.name}\`);` | UNMAPPED |
| `tools/control.mjs:1137` | `if (!sameType(value.type, output.type)) error(item.loc, \`output ${item.name} must be ${output.type.kind}\`);` | UNMAPPED |
| `tools/control.mjs:1150` | `error(item.loc, 'unsupported require: use output => output, output => (a \|\| b), or !(a && b)');` | UNMAPPED |
| `tools/control.mjs:1153` | `if (node.kind !== 'reference' \|\| !this.outputs.has(node.name)) error(node.loc, \`${label} must be a Bool output\`);` | UNMAPPED |
| `tools/control.mjs:1154` | `const output = this.outputs.get(node.name); if (!sameType(output.type, BOOL)) error(node.loc, \`${label} must be a Bool output\`); return node.name;` | UNMAPPED |
| `tools/control.mjs:1158` | `addMutex(names, loc) { if (names.length < 2 \|\| names.length > 32) error(loc, 'mutex needs 2 to 32 Bool outputs'); for (const name of names) this.outputName({ kind: 'reference', name, loc }, 'mutex member'); this.constraints.push(['mutex',` | UNMAPPED |
| `tools/control.mjs:1160` | `if (++this.expansionNodes > EXPANSION_NODE_LIMIT) error(node.loc, \`function expansion exceeds ${EXPANSION_NODE_LIMIT} node budget\`);` | UNMAPPED |
| `tools/control.mjs:1173` | `if (faultCandidates.length > 1) error(node.loc, \`ambiguous fault member ${node.name} requires an expected fault type\`);` | UNMAPPED |
| `tools/control.mjs:1174` | `const symbol = this.symbols.get(node.name); if (!symbol) error(node.loc, \`unknown identifier ${node.name}\`);` | UNMAPPED |
| `tools/control.mjs:1175` | `if (options.pureFunction && symbol.category !== 'function') error(node.loc, \`fn ${options.pureFunction} cannot capture global ${node.name}\`);` | UNMAPPED |
| `tools/control.mjs:1184` | `if (symbol.category === 'schedule') error(node.loc, \`schedule ${node.name} must be read as ${node.name}.due\`);` | UNMAPPED |
| `tools/control.mjs:1194` | `if (symbol.category === 'function') error(node.loc, \`function ${node.name} requires arguments\`);` | UNMAPPED |
| `tools/control.mjs:1195` | `error(node.loc, \`unsupported reference ${node.name}\`);` | UNMAPPED |
| `tools/control.mjs:1199` | `error(node.loc, \`removed qualified reference ${node.base}.${node.member}; use the direct canonical name\`);` | UNMAPPED |
| `tools/control.mjs:1202` | `error(node.loc, \`unknown member ${node.base}.${node.member}\`);` | UNMAPPED |
| `tools/control.mjs:1205` | `if (options.pureFunction) error(node.loc, \`fn ${options.pureFunction} cannot read primed state ${node.name}'\`);` | UNMAPPED |
| `tools/control.mjs:1206` | `if (!options.allowNext) error(node.loc, 'next state references are allowed only in output expressions');` | UNMAPPED |
| `tools/control.mjs:1207` | `const state = this.states.get(node.name); if (!state) error(node.loc, \`unknown state ${node.name}\`);` | UNMAPPED |
| `tools/control.mjs:1218` | `if (node.op === '!') { if (!sameType(value.type, BOOL)) error(node.loc, '! requires Bool'); return { type: BOOL, sexpr: ['not', value.sexpr], constant: value.constant === undefined ? undefined : !value.constant }; }` | UNMAPPED |
| `tools/control.mjs:1220` | `if (!isNumeric(value.type)) error(node.loc, 'unary - requires numeric value');` | UNMAPPED |
| `tools/control.mjs:1221` | `if (isQuantityType(value.type.kind) && !LINEAR_QUANTITIES.has(value.type.kind)) error(node.loc, \`unary - is not defined for ${value.type.kind}\`);` | UNMAPPED |
| `tools/control.mjs:1239` | `if (!sameType(test.type, BOOL)) error(node.test.loc, 'if condition must be Bool'); if (!sameType(yes.type, no.type)) error(node.loc, 'if branches must have the same type');` | UNMAPPED |
| `tools/control.mjs:1244` | `const left = recurse(node.left); const values = node.values.map(value => recurse(value)); for (const value of values) if (!sameType(left.type, value.type)) error(value.type?.loc ?? node.loc, 'in values must match the tested value type');` | UNMAPPED |
| `tools/control.mjs:1250` | `error(node.loc, \`unsupported expression node ${node.kind}\`);` | UNMAPPED |
| `tools/control.mjs:1257` | `if (node.op === '>>') error(node.loc, '>> is valid only inside a static Result transform pipeline');` | UNMAPPED |
| `tools/control.mjs:1272` | `if (op === '&&' \|\| op === '\|\|') { if (!sameType(left.type, BOOL) \|\| !sameType(right.type, BOOL)) error(node.loc, \`${op} requires Bool operands\`); return { type: BOOL, sexpr: [op === '&&' ? 'and' : 'or', left.sexpr, right.sexpr], con` | UNMAPPED |
| `tools/control.mjs:1273` | `if (['==', '!='].includes(op)) { if (!sameType(left.type, right.type)) error(node.loc, \`${op} requires values of the same type\`); const eq = left.constant === undefined \|\| right.constant === undefined ? undefined : left.constant === rig` | UNMAPPED |
| `tools/control.mjs:1274` | `if (['<', '<=', '>', '>='].includes(op)) { if ((!isNumeric(left.type) && !['DateTime', 'TimeOfDay'].includes(left.type?.kind)) \|\| !sameType(left.type, right.type)) error(node.loc, \`${op} requires matching ordered types\`); const values =` | UNMAPPED |
| `tools/control.mjs:1292` | `if (op === '=>') error(node.loc, '=> is only valid in require declarations');` | UNMAPPED |
| `tools/control.mjs:1293` | `error(node.loc, \`unsupported operator ${op}\`);` | UNMAPPED |
| `tools/control.mjs:1298` | `if (alias.type.kind !== 'StaticTransform') error(node.loc, \`${node.name} is not a static Result transform\`);` | UNMAPPED |
| `tools/control.mjs:1304` | `if (node.kind !== 'call' \|\| node.named.length) error(node.loc, 'Result pipeline requires a compiler-known static transform');` | UNMAPPED |
| `tools/control.mjs:1306` | `if (node.args.length !== 1 \|\| value.type.kind !== 'Result') error(node.loc, 'map expects one transform and a Result value');` | UNMAPPED |
| `tools/control.mjs:1308` | `if (mapped.type.kind === 'Result') error(node.loc, 'map transform must return a non-Result value');` | UNMAPPED |
| `tools/control.mjs:1312` | `if (node.args.length !== 1 \|\| value.type.kind !== 'Result') error(node.loc, 'and_then expects one transform and a Result value');` | UNMAPPED |
| `tools/control.mjs:1314` | `if (chained.type.kind !== 'Result' \|\| !sameType(chained.type.error, value.type.error)) error(node.loc, 'and_then transform must return Result<U, E> with the same error type');` | UNMAPPED |
| `tools/control.mjs:1326` | `if (node.args.length !== 1 \|\| value.type.kind !== 'Result') error(node.loc, 'recover expects one default and a Result value');` | UNMAPPED |
| `tools/control.mjs:1328` | `if (!sameType(fallback.type, value.type.value)) error(node.args[0].loc, \`recover default must be ${typeNameOf(value.type.value)}\`);` | UNMAPPED |
| `tools/control.mjs:1335` | `error(node.loc, \`unsupported Result transform ${node.name}\`);` | UNMAPPED |
| `tools/control.mjs:1339` | `if (node.args.length !== 1 \|\| node.named.length) error(node.loc, 'below expects one limit');` | UNMAPPED |
| `tools/control.mjs:1340` | `if (!isNumeric(value.type) && !['DateTime', 'TimeOfDay'].includes(value.type.kind)) error(node.loc, \`below is not defined for ${typeNameOf(value.type)}\`);` | UNMAPPED |
| `tools/control.mjs:1342` | `if (!sameType(limit.type, value.type)) error(node.args[0].loc, \`below limit must be ${typeNameOf(value.type)}\`);` | UNMAPPED |
| `tools/control.mjs:1345` | `if (node.kind !== 'reference') error(node.loc, 'map/and_then requires a named fn or below(limit)');` | UNMAPPED |
| `tools/control.mjs:1347` | `if (!fn \|\| fn.params.length !== 1) error(node.loc, \`transform ${node.name} must name a unary fn\`);` | UNMAPPED |
| `tools/control.mjs:1348` | `if (!sameType(value.type, fn.params[0].resolvedType)) error(node.loc, \`transform ${node.name} expects ${typeNameOf(fn.params[0].resolvedType)}\`);` | UNMAPPED |
| `tools/control.mjs:1349` | `if (callStack.includes(node.name)) error(node.loc, \`recursive fn ${node.name} is not supported\`);` | UNMAPPED |
| `tools/control.mjs:1352` | `if (!sameType(out.type, fn.resultType)) error(fn.loc, \`function ${node.name} returns ${typeNameOf(out.type)}, expected ${typeNameOf(fn.resultType)}\`);` | UNMAPPED |
| `tools/control.mjs:1361` | `} else if (entry.kind !== kind \|\| entry.errorType !== errorType) internal(\`Result trace site ${node.id} changed meaning\`);` | UNMAPPED |
| `tools/control.mjs:1369` | `error(node.loc, 'removed alias ifthenelse; use if condition then value else value');` | UNMAPPED |
| `tools/control.mjs:1371` | `if (node.name === 'elapsed' \|\| node.name === 'hysteresis' \|\| node.name === 'median') error(node.loc, \`${node.name} is only valid in its declaration\`);` | UNMAPPED |
| `tools/control.mjs:1373` | `if (node.args.length !== 1 \|\| node.named.length) error(node.loc, \`${node.name} expects one argument\`);` | UNMAPPED |
| `tools/control.mjs:1374` | `if (expected?.kind !== 'Result') error(node.loc, \`${node.name} requires an expected Result<T, E> type\`);` | UNMAPPED |
| `tools/control.mjs:1377` | `if (!sameType(payload.type, expected.value)) error(node.args[0].loc, \`ok payload must be ${typeNameOf(expected.value)}\`);` | UNMAPPED |
| `tools/control.mjs:1381` | `if (!sameType(reason.type, expected.error)) error(node.args[0].loc, \`fault reason must be ${typeNameOf(expected.error)}\`);` | UNMAPPED |
| `tools/control.mjs:1389` | `if (node.args.length !== 1 \|\| node.named.length) error(node.loc, 'number expects one Int argument');` | UNMAPPED |
| `tools/control.mjs:1391` | `if (!sameType(value.type, INT)) error(node.args[0].loc, 'number argument must be Int');` | UNMAPPED |
| `tools/control.mjs:1399` | `if (node.args.length !== 1 \|\| node.named.length) error(node.loc, \`${node.name} expects one Number argument\`);` | UNMAPPED |
| `tools/control.mjs:1401` | `if (!sameType(value.type, NUMBER)) error(node.args[0].loc, \`${node.name} argument must be Number\`);` | UNMAPPED |
| `tools/control.mjs:1404` | `if (node.name === 'int_exact' && !Number.isInteger(value.constant)) error(node.loc, 'int_exact constant must be integral');` | UNMAPPED |
| `tools/control.mjs:1407` | `if (!Number.isInteger(constant) \|\| constant < -2147483648 \|\| constant > 2147483647) error(node.loc, 'integer conversion constant is outside -2147483648..2147483647');` | UNMAPPED |
| `tools/control.mjs:1415` | `const fn = this.functions.get(node.name); if (!fn) error(node.loc, \`unknown function ${node.name}\`);` | UNMAPPED |
| `tools/control.mjs:1416` | `if (node.named.length \|\| node.args.length !== fn.params.length) error(node.loc, \`function ${node.name} expects ${fn.params.length} arguments\`);` | UNMAPPED |
| `tools/control.mjs:1417` | `if (callStack.includes(node.name)) error(node.loc, \`recursive fn ${node.name} is not supported\`);` | UNMAPPED |
| `tools/control.mjs:1419` | `for (let i = 0; i < args.length; i++) if (!sameType(args[i].type, fn.params[i].resolvedType)) error(node.args[i].loc, \`argument ${i + 1} to ${node.name} must be ${fn.params[i].resolvedType.kind}\`);` | UNMAPPED |
| `tools/control.mjs:1421` | `const value = this.expression(fn.body, scope, { ...options, pureFunction: node.name }, [...callStack, node.name], fn.resultType); if (!sameType(value.type, fn.resultType)) error(fn.loc, \`function ${node.name} returns ${value.type.kind}, ex` | UNMAPPED |
| `tools/control.mjs:1426` | `if (!this.types.has(value.type.kind)) error(node.value.loc, 'case requires an enum or sensor/signal result');` | UNMAPPED |
| `tools/control.mjs:1427` | `const members = this.types.get(value.type.kind); const byName = new Map(); for (const branch of node.branches) { if (branch.binding !== null) error(branch.loc, 'enum case members do not take bindings'); if (!members.has(branch.name)) error(` | UNMAPPED |
| `tools/control.mjs:1428` | `if (byName.size !== members.size) error(node.loc, \`case for ${value.type.kind} must be exhaustive\`);` | UNMAPPED |
| `tools/control.mjs:1431` | `const branch = byName.get(member); const body = this.expression(branch.body, locals, options, callStack, expected ?? resultType); if (resultType && !sameType(resultType, body.type)) error(branch.loc, 'case branches must have the same type')` | UNMAPPED |
| `tools/control.mjs:1438` | `for (const branch of node.branches) { if (!['ok', 'fault'].includes(branch.name)) error(branch.loc, 'Result case supports only ok(...) and fault(...)'); if (byName.has(branch.name)) error(branch.loc, \`duplicate ${branch.name} branch\`); if` | UNMAPPED |
| `tools/control.mjs:1439` | `if (!byName.has('ok') \|\| !byName.has('fault')) error(node.loc, 'Result case must handle ok(...) and fault(...)');` | UNMAPPED |
| `tools/control.mjs:1447` | `if (!sameType(yes.type, no.type)) error(node.loc, 'case branches must have the same type');` | UNMAPPED |
| `tools/control.mjs:1485` | `if (this.gfbInputs.length > INPUT_LIMIT) error(this.ast.loc, \`input budget exceeded (${INPUT_LIMIT})\`);` | UNMAPPED |
| `tools/control.mjs:1486` | `if (this.gfbStates.length > STATE_LIMIT) error(this.ast.loc, \`state budget exceeded (${STATE_LIMIT})\`);` | UNMAPPED |
| `tools/control.mjs:1487` | `if (STRATEGY_LIMIT < 1) error(this.ast.loc, 'strategy budget is invalid');` | UNMAPPED |
| `tools/control.mjs:1488` | `if (this.constraints.some(x => x.length - 1 > 32)) error(this.ast.loc, 'constraint arity exceeds 32');` | UNMAPPED |
| `tools/control.mjs:1492` | `if (expressionTreeNodes(form[2]) > EXPANSION_NODE_LIMIT) error(this.ast.loc, \`function expansion exceeds ${EXPANSION_NODE_LIMIT} node budget\`);` | UNMAPPED |
| `tools/control.mjs:1494` | `if (peak > 128) error(this.ast.loc, \`expression stack budget exceeded (128) for ${form[1]}\`);` | UNMAPPED |
| `tools/control.mjs:1507` | `if (isTimeType(left.kind) \|\| isTimeType(right.kind)) error(loc, \`${op} is not defined for ${left.kind} and ${right.kind}\`);` | UNMAPPED |
| `tools/control.mjs:1508` | `if (!isNumeric(left) \|\| !isNumeric(right)) error(loc, \`${op} requires numeric operands\`);` | UNMAPPED |
| `tools/control.mjs:1523` | `error(loc, \`${op} is not defined for ${left.kind} and ${right.kind}\`);` | UNMAPPED |
| `tools/control.mjs:1526` | `if (!sameType(left, right)) error(loc, \`${op} does not implicitly mix ${left.kind} and ${right.kind}\`);` | UNMAPPED |
| `tools/control.mjs:1527` | `if (op === '/') error(loc, '/ is not defined for Int operands; use div or convert both operands to Number');` | UNMAPPED |
| `tools/control.mjs:1530` | `if (op === 'div' \|\| op === '%') error(loc, \`${op} requires Int operands\`);` | UNMAPPED |
| `tools/control.mjs:1531` | `if (op === '+' \|\| op === '-') { if (!sameType(left, right)) error(loc, \`${op} does not implicitly mix ${left.kind} and ${right.kind}\`); return { type: left }; }` | UNMAPPED |
| `tools/control.mjs:1532` | `if (op === '*') { if (sameType(left, NUMBER)) return { type: right }; if (sameType(right, NUMBER)) return { type: left }; error(loc, '* requires a Number scale factor'); }` | UNMAPPED |
| `tools/control.mjs:1533` | `if (op === '/') { if (sameType(right, NUMBER)) return { type: left }; if (sameType(left, right)) return { type: NUMBER }; error(loc, '/ requires a Number divisor or matching units'); }` | UNMAPPED |
| `tools/control.mjs:1534` | `error(loc, \`unsupported arithmetic ${op}\`);` | UNMAPPED |
| `tools/control.mjs:1537` | `if ((op === '/' \|\| op === 'div' \|\| op === '%') && right === 0) error(loc, op === '/' ? 'constant division by zero' : 'constant integer division by zero');` | UNMAPPED |
| `tools/control.mjs:1540` | `if (!Number.isFinite(value)) error(loc, 'constant arithmetic result is not finite'); return value;` | UNMAPPED |
| `tools/control.mjs:1576` | `if (typeof filename !== 'string' \|\| !filename) internal('filename must be a non-empty string');` | UNMAPPED |
| `tools/control.mjs:1583` | `if (typeof filename !== 'string' \|\| !filename) internal('filename must be a non-empty string');` | UNMAPPED |
| `tools/literate.mjs:29` | `if (typeof markdown !== 'string') throw new TypeError('markdown must be a string');` | UNMAPPED |
| `tools/literate.mjs:30` | `if (new TextEncoder().encode(markdown).byteLength > MAX_INPUT_BYTES) throw new RangeError('literate byte limit exceeded');` | UNMAPPED |
| `tools/literate.mjs:32` | `if (lines.length > MAX_INPUT_LINES) throw new RangeError('literate line limit exceeded');` | UNMAPPED |
| `tools/literate.mjs:36` | `if (frontMatterEnd < 0) throw new LiterateError(filename, 1, 1, 'unclosed front matter');` | UNMAPPED |
| `tools/literate.mjs:59` | `if (rawInfo !== 'ghost') throw new LiterateError(filename, first, column,` | UNMAPPED |
| `tools/literate.mjs:63` | `throw new LiterateError(filename, first, column, 'unclosed ghost fence');` | UNMAPPED |
| `tools/literate.mjs:82` | `throw new LiterateError(filename, originalLine, directiveColumn(line, 'ghostflow:link'), 'malformed ghostflow link directive');` | UNMAPPED |
| `tools/literate.mjs:87` | `if (!chunks.length) throw new LiterateError(filename, 1, 1, 'no executable ghost code');` | UNMAPPED |
| `tools/literate.mjs:94` | `throw new LiterateError(filename, firstLine, directiveColumn(lines[firstLine - 1], 'ghostflow:anchor'), 'malformed ghostflow anchor directive');` | UNMAPPED |
| `tools/literate.mjs:100` | `throw new LiterateError(filename, firstLine, firstColumn, 'ghostflow anchor requires one following top-level paragraph or block quote');` | UNMAPPED |
| `tools/compile-source.mjs:13` | `if (!isWellFormedUnicode(text)) throw new Error(\`${label} must be a well-formed UTF-8 string\`);` | UNMAPPED |
| `tools/compile-source.mjs:14` | `if (utf8ByteLength(text) > SOURCE_LIMIT) throw new Error(\`${label} byte limit exceeded\`);` | UNMAPPED |
| `tools/compile-source.mjs:19` | `throw new Error(\`${label} must be a non-empty well-formed UTF-8 string\`);` | UNMAPPED |
| `tools/compile-source.mjs:45` | `if (!options \|\| typeof options !== 'object' \|\| Array.isArray(options)) throw new TypeError('compile options must be an object');` | UNMAPPED |
| `tools/compile-source.mjs:47` | `throw new Error('interactionSchema is not a compile option; supply interactionSourceIdentity explicitly');` | UNMAPPED |
| `tools/compile-source.mjs:52` | `if (!filename.endsWith('.ghost.md')) throw new Error(\`${filename}: GhostFlow product compilation requires a canonical .ghost.md literate source\`);` | UNMAPPED |
| `tools/compile-source.mjs:66` | `throw error;` | UNMAPPED |
| `tools/compile-source.mjs:82` | `if (bytes.byteLength > SOURCE_LIMIT) throw new Error('compiled module byte limit exceeded');` | UNMAPPED |
| `tools/ghostc.mjs:14` | `console.error('usage: ghostc <input.ghost.md> <output.gfb>\n       ghostc --check <input.ghost.md>');` | UNMAPPED |
| `tools/ghostc.mjs:23` | `console.error(\`ghostc: ${error.message}\`);` | UNMAPPED |
| `tools/toolchain.mjs:24` | `if (!isWellFormedUnicode(text)) throw new Error(\`${label} must be a well-formed UTF-8 string\`);` | UNMAPPED |
| `tools/toolchain.mjs:25` | `if (utf8ByteLength(text) > SOURCE_LIMIT) throw new Error(\`${label} byte limit exceeded\`);` | UNMAPPED |
| `tools/toolchain.mjs:30` | `throw new Error(\`${label} must be a non-empty well-formed UTF-8 string\`);` | UNMAPPED |
| `tools/toolchain.mjs:36` | `throw new Error(\`${label} must be a lowercase SHA-256 hex digest\`);` | UNMAPPED |
| `tools/toolchain.mjs:43` | `throw new Error('artifact bytes must be a Buffer or Uint8Array');` | UNMAPPED |
| `tools/toolchain.mjs:52` | `if (!equalBytes(replay.bytes, bytes)) throw new Error('canonical source does not reproduce artifact bytecode');` | UNMAPPED |
| `tools/toolchain.mjs:76` | `if (!map \|\| typeof map !== 'object' \|\| Array.isArray(map)) throw new Error('source map must be an object');` | UNMAPPED |
| `tools/toolchain.mjs:77` | `if (map.format !== SOURCE_MAP_FORMAT) throw new Error(\`unsupported source map format ${String(map.format)}\`);` | UNMAPPED |
| `tools/toolchain.mjs:78` | `if (!Array.isArray(map.nodes)) throw new Error('source map nodes must be an array');` | UNMAPPED |
| `tools/toolchain.mjs:79` | `if (map.lines !== null && !Array.isArray(map.lines)) throw new Error('source map lines must be an array or null');` | UNMAPPED |
| `tools/toolchain.mjs:83` | `if (!document \|\| typeof document !== 'object' \|\| Array.isArray(document)) throw new Error('source map sourceDocument must be an object');` | UNMAPPED |
| `tools/toolchain.mjs:84` | `if (document.format !== SOURCE_DOCUMENT_FORMAT) throw new Error(\`unsupported source document format ${String(document.format)}\`);` | UNMAPPED |
| `tools/toolchain.mjs:85` | `if (document.kind !== 'literate') throw new Error('source document kind must be canonical literate');` | UNMAPPED |
| `tools/toolchain.mjs:89` | `if (sha256Hex(document.text) !== document.sha256) throw new Error('source document SHA-256 does not match text');` | UNMAPPED |
| `tools/toolchain.mjs:92` | `if (sha256Hex(artifactBytes) !== map.bytecodeSha256) throw new Error('source map bytecode SHA-256 does not match artifact');` | UNMAPPED |
| `tools/toolchain.mjs:95` | `if (document.sha256 !== expectedSourceSha256) throw new Error('source document SHA-256 does not match expected revision');` | UNMAPPED |
| `tools/toolchain.mjs:112` | `throw new Error('source map trace metadata is missing for a traceable control');` | UNMAPPED |
| `tools/toolchain.mjs:117` | `throw new Error('interaction schema and explicit source identity must be persisted together');` | UNMAPPED |
| `tools/toolchain.mjs:128` | `throw new Error('interaction schema source identity does not match its persisted immutable identity');` | UNMAPPED |
| `tools/toolchain.mjs:165` | `if (result.manifest.bytecodeSha256 !== envelope.bytecodeSha256) throw new Error('manifest bytecode SHA-256 does not match artifact');` | UNMAPPED |
| `tools/time-literals.mjs:15` | `if (!bounds) fail(\`unknown time type ${String(type)}\`);` | UNMAPPED |
| `tools/time-literals.mjs:17` | `fail(\`${label} must be an integer in [${bounds.min}, ${bounds.max}]\`);` | UNMAPPED |
| `tools/time-literals.mjs:22` | `function fail(message) { throw new Error(message); }` | UNMAPPED |
| `tools/time-literals.mjs:35` | `if (!match) fail('invalid date literal');` | UNMAPPED |
| `tools/time-literals.mjs:37` | `if (!validDate(...parts)) fail('date literal is out of range');` | UNMAPPED |
| `tools/time-literals.mjs:43` | `if (typeof tag !== 'string' \|\| typeof text !== 'string') fail('time literal tag and text must be strings');` | UNMAPPED |
| `tools/time-literals.mjs:50` | `if (!match) fail('invalid time literal');` | UNMAPPED |
| `tools/time-literals.mjs:52` | `if (hour > 23 \|\| minute > 59 \|\| second > 59) fail('time literal is out of range');` | UNMAPPED |
| `tools/time-literals.mjs:57` | `if (!match) fail('invalid datetime literal');` | UNMAPPED |
| `tools/time-literals.mjs:60` | `if (hour > 23 \|\| minute > 59 \|\| second > 59) fail('datetime literal is out of range');` | UNMAPPED |
| `tools/time-literals.mjs:64` | `if (offset === '-00:00') fail('negative zero offset is ambiguous');` | UNMAPPED |
| `tools/time-literals.mjs:67` | `if (oh > 14 \|\| om > 59 \|\| (oh === 14 && om !== 0)) fail('datetime offset is out of range');` | UNMAPPED |
| `tools/time-literals.mjs:72` | `if (value < 0 \|\| value > max) fail('datetime instant is out of range');` | UNMAPPED |
| `tools/time-literals.mjs:75` | `fail('unknown time literal tag');` | UNMAPPED |
| `tools/quantities.mjs:55` | `if (prior && prior !== entry.canonicalUnit) throw new Error(\`inconsistent canonical unit for ${entry.type}\`);` | UNMAPPED |
| `tools/quantities.mjs:73` | `if (denominator === 0n) throw new RangeError('quantity rational denominator must not be zero');` | UNMAPPED |
| `tools/quantities.mjs:81` | `if (text.length > MAX_DECIMAL_SOURCE_LENGTH) throw new RangeError(\`decimal literal exceeds ${MAX_DECIMAL_SOURCE_LENGTH} source characters\`);` | UNMAPPED |
| `tools/quantities.mjs:83` | `if (!match) throw new SyntaxError(\`invalid decimal literal ${JSON.stringify(text)}\`);` | UNMAPPED |
| `tools/quantities.mjs:92` | `if (decimalOrder > BINARY64_DECIMAL_MARGIN) throw new RangeError('quantity literal exceeds finite binary64 range');` | UNMAPPED |
| `tools/quantities.mjs:144` | `if (exponent > 1023) throw new RangeError('quantity literal exceeds finite binary64 range');` | UNMAPPED |
| `tools/quantities.mjs:154` | `if (exponent > 1023) throw new RangeError('quantity literal exceeds finite binary64 range');` | UNMAPPED |
| `tools/quantities.mjs:208` | `if (!isQuantityType(type) \|\| typeof value !== 'number' \|\| !Number.isFinite(value)) throw new TypeError('quantity source formatting requires a finite catalog value');` | UNMAPPED |
| `tools/gfb1.mjs:6` | `if (UTF8.encode(source).byteLength > 1024 * 1024) throw new CompileError('source byte limit exceeded');` | UNMAPPED |
| `tools/gfb1.mjs:16` | `if (j === i) throw new CompileError(\`unexpected character at ${i}\`);` | UNMAPPED |
| `tools/gfb1.mjs:26` | `if (depth > 128) throw new CompileError('syntax nesting limit exceeded');` | UNMAPPED |
| `tools/gfb1.mjs:28` | `if (token === undefined) throw new CompileError('unexpected end of input');` | UNMAPPED |
| `tools/gfb1.mjs:29` | `if (token === ')') throw new CompileError('unexpected )');` | UNMAPPED |
| `tools/gfb1.mjs:33` | `if (at >= tokens.length) throw new CompileError('unclosed (');` | UNMAPPED |
| `tools/gfb1.mjs:40` | `if (at !== tokens.length) throw new CompileError('multiple top-level forms');` | UNMAPPED |
| `tools/gfb1.mjs:59` | `str(s) { const b=UTF8.encode(s); if (b.length>65535) throw new CompileError('string too long'); this.u16(b.length); this.bytes(b); }` | UNMAPPED |
| `tools/gfb1.mjs:65` | `throw new CompileError(\`invalid ${label} name: ${name}\`);` | UNMAPPED |
| `tools/gfb1.mjs:69` | `if (!TYPE[name]) throw new CompileError(\`unknown type ${name}\`);` | UNMAPPED |
| `tools/gfb1.mjs:81` | `if (emit(condition)!==TYPE.bool) throw new CompileError(logicalOperator ? \`${logicalOperator} expects bools\` : 'if condition must be bool');` | UNMAPPED |
| `tools/gfb1.mjs:86` | `if (yesType!==noType) throw new CompileError(logicalOperator ? \`${logicalOperator} expects bools\` : 'if branches must have same type');` | UNMAPPED |
| `tools/gfb1.mjs:87` | `if (yesBytes.length+3>65535 \|\| noBytes.length>65535) throw new CompileError('expression complexity limit exceeded');` | UNMAPPED |
| `tools/gfb1.mjs:94` | `if (++depth > 128 \|\| ++nodes > 4096) throw new CompileError('expression complexity limit exceeded');` | UNMAPPED |
| `tools/gfb1.mjs:101` | `if (!Number.isFinite(value)) throw new CompileError('non-finite number');` | UNMAPPED |
| `tools/gfb1.mjs:107` | `const dot=n.indexOf('.'); if (dot<1) throw new CompileError(\`unknown atom ${n}\`);` | UNMAPPED |
| `tools/gfb1.mjs:109` | `if (ns==='input') { const x=env.inputs.get(name); if(!x) throw new CompileError(\`unknown input ${name}\`); w.u8(OP.input); w.u16(x.index); return x.type; }` | UNMAPPED |
| `tools/gfb1.mjs:110` | `if (ns==='state') { const x=env.states.get(name); if(!x) throw new CompileError(\`unknown state ${name}\`); w.u8(OP.state); w.u16(x.index); return x.type; }` | UNMAPPED |
| `tools/gfb1.mjs:111` | `if (ns==='next') { if(!allowNext) throw new CompileError('next.* is allowed only in intents'); const x=env.states.get(name); if(!x) throw new CompileError(\`unknown state ${name}\`); w.u8(OP.next); w.u16(x.index); return x.type; }` | UNMAPPED |
| `tools/gfb1.mjs:112` | `throw new CompileError(\`unknown namespace ${ns}\`);` | UNMAPPED |
| `tools/gfb1.mjs:114` | `if (!Array.isArray(n) \|\| n.length<1) throw new CompileError('invalid expression');` | UNMAPPED |
| `tools/gfb1.mjs:117` | `if(args.length!==4 \|\| typeof args[0]!=='string' \|\| !/^\d+$/.test(args[0]) \|\| Number(args[0])<1 \|\| Number(args[0])>4294967295) throw new CompileError('trace-result expects a positive u32 site, payload, Number choice and Number origin` | UNMAPPED |
| `tools/gfb1.mjs:119` | `if(emit(args[2])!==TYPE.number \|\| emit(args[3])!==TYPE.number) throw new CompileError('trace-result metadata must be Number');` | UNMAPPED |
| `tools/gfb1.mjs:122` | `if (head==='int') { if(args.length!==1 \|\| typeof args[0] !== 'string' \|\| !/^-?\d+$/.test(args[0])) throw new CompileError('int expects one signed decimal i32 literal'); const value=BigInt(args[0]);if(value < -2147483648n \|\| value > 21` | UNMAPPED |
| `tools/gfb1.mjs:123` | `if (head==='int-neg') { if(args.length!==1 \|\| emit(args[0])!==TYPE.int) throw new CompileError('int-neg expects Int');usesInt=true;w.u8(OP[head]);return TYPE.int; }` | UNMAPPED |
| `tools/gfb1.mjs:124` | `if (['int-add','int-sub','int-mul','int-div','int-rem'].includes(head)) { if(args.length!==2)throw new CompileError(\`${head} expects 2 arguments\`);const a=emit(args[0]),b=emit(args[1]);if(a!==TYPE.int\|\|b!==TYPE.int)throw new CompileErro` | UNMAPPED |
| `tools/gfb1.mjs:125` | `if (head==='not') { if(args.length!==1 \|\| emit(args[0])!==TYPE.bool) throw new CompileError('not expects bool'); w.u8(OP.not); return TYPE.bool; }` | UNMAPPED |
| `tools/gfb1.mjs:126` | `if (head==='and' \|\| head==='or') { if(args.length!==2) throw new CompileError(\`${head} expects 2 arguments\`); return head==='and' ? emitBranch(args[0],args[1],'false',head) : emitBranch(args[0],'true',args[1],head); }` | UNMAPPED |
| `tools/gfb1.mjs:127` | `if (['eq','lt','lte','gt','gte'].includes(head)) { if(args.length!==2) throw new CompileError(\`${head} expects 2 arguments\`); const a=emit(args[0]),b=emit(args[1]); if(a!==b \|\| (head!=='eq'&&a!==TYPE.number&&a!==TYPE.int)) throw new Com` | UNMAPPED |
| `tools/gfb1.mjs:128` | `if (['add','sub','mul','div'].includes(head)) { if(args.length!==2) throw new CompileError(\`${head} expects 2 arguments\`); const a=emit(args[0]),b=emit(args[1]); if(a!==TYPE.number\|\|b!==TYPE.number) throw new CompileError(\`${head} expe` | UNMAPPED |
| `tools/gfb1.mjs:129` | `if (head==='if') { if(args.length!==3) throw new CompileError('if expects 3 arguments'); return emitBranch(...args); }` | UNMAPPED |
| `tools/gfb1.mjs:132` | `if (args.length!==1 \|\| emit(args[0])!==sourceType) throw new CompileError(\`${head} expects one ${sourceType===TYPE.int?'Int':'Number'} operand\`);` | UNMAPPED |
| `tools/gfb1.mjs:138` | `if (args.length!==1 \|\| emit(args[0])!==TYPE.number) throw new CompileError(\`${head} expects one Number operand\`);` | UNMAPPED |
| `tools/gfb1.mjs:141` | `throw new CompileError(\`unknown expression ${head}\`);` | UNMAPPED |
| `tools/gfb1.mjs:150` | `if (!Array.isArray(n)\|\|n.length<1) throw new CompileError('invalid device query');` | UNMAPPED |
| `tools/gfb1.mjs:152` | `if(head==='has') { if(args.length!==3) throw new CompileError('has expects kind name type'); assertName(args[0],'capability kind'); assertName(args[1],'capability'); w.u8(1); w.str(args[0]); w.str(args[1]); w.u8(scalarType(args[2])); return` | UNMAPPED |
| `tools/gfb1.mjs:153` | `if(head==='all'\|\|head==='any') { if(args.length<1) throw new CompileError(\`${head} needs children\`); for(const a of args) emit(a); w.u8(head==='all'?2:3); w.u16(args.length); return; }` | UNMAPPED |
| `tools/gfb1.mjs:154` | `if(head==='not') { if(args.length!==1) throw new CompileError('query not expects one child'); emit(args[0]); w.u8(4); return; }` | UNMAPPED |
| `tools/gfb1.mjs:155` | `throw new CompileError(\`unknown device query ${head}\`);` | UNMAPPED |
| `tools/gfb1.mjs:161` | `if (!Array.isArray(ast)\|\|ast[0]!=='module'\|\|typeof ast[1]!=='string') throw new CompileError('expected (module NAME ...)');` | UNMAPPED |
| `tools/gfb1.mjs:165` | `if(!Array.isArray(form)\|\|!form.length) throw new CompileError('invalid module form');` | UNMAPPED |
| `tools/gfb1.mjs:167` | `if(head==='version') { version=Number(args[0]); if(args.length!==1\|\|!Number.isInteger(version)\|\|version<0\|\|version>0xffffffff) throw new CompileError('invalid version'); }` | UNMAPPED |
| `tools/gfb1.mjs:168` | `else if(head==='input') { if(args.length!==2) throw new CompileError('input expects name type'); assertName(args[0],'input'); inputs.push({name:args[0],type:scalarType(args[1])}); }` | UNMAPPED |
| `tools/gfb1.mjs:169` | `else if(head==='state') { if(args.length!==3) throw new CompileError('state expects name type default'); assertName(args[0],'state'); const type=scalarType(args[1]); let value; if(type===TYPE.bool){if(!['true','false'].includes(args[2]))thr` | UNMAPPED |
| `tools/gfb1.mjs:171` | `else if(head==='requires') { if(args.length!==2) throw new CompileError('requires expects target prerequisite'); constraints.push({kind:1,names:args}); }` | UNMAPPED |
| `tools/gfb1.mjs:172` | `else if(head==='requires-any') { if(args.length<2\|\|args.length>32) throw new CompileError('requires-any expects target and prerequisites'); constraints.push({kind:3,names:args}); }` | UNMAPPED |
| `tools/gfb1.mjs:173` | `else if(head==='mutex') { if(args.length<2) throw new CompileError('mutex needs at least 2 intents'); constraints.push({kind:2,names:args}); }` | UNMAPPED |
| `tools/gfb1.mjs:174` | `else throw new CompileError(\`unknown module form ${head}\`);` | UNMAPPED |
| `tools/gfb1.mjs:176` | `const unique=(xs,label)=>{const s=new Set();for(const x of xs){if(s.has(x.name))throw new CompileError(\`duplicate ${label} ${x.name}\`);s.add(x.name);}};` | UNMAPPED |
| `tools/gfb1.mjs:178` | `if(inputs.length>128\|\|states.length>128\|\|strategies.length>32\|\|constraints.length>128)throw new CompileError('module resource limit exceeded');` | UNMAPPED |
| `tools/gfb1.mjs:179` | `for(const c of constraints){if(c.names.length>32\|\|new Set(c.names).size!==c.names.length)throw new CompileError('invalid constraint names or arity');for(const n of c.names)assertName(n,'constraint');}` | UNMAPPED |
| `tools/gfb1.mjs:182` | `const [,sname,priorityAtom,...forms]=raw; assertName(sname,'strategy'); const priority=Number(priorityAtom); if(!Number.isInteger(priority)\|\|priority < -2147483648\|\|priority > 2147483647)throw new CompileError('strategy priority must be` | UNMAPPED |
| `tools/gfb1.mjs:184` | `for(const f of forms){if(!Array.isArray(f))throw new CompileError('invalid strategy form');const [h,...a]=f;` | UNMAPPED |
| `tools/gfb1.mjs:185` | `if(h==='device'){if(a.length!==1\|\|query)throw new CompileError('strategy needs one device query');query=compileQuery(a[0]);}` | UNMAPPED |
| `tools/gfb1.mjs:186` | `else if(h==='next'){if(a.length!==2)throw new CompileError('next expects state expression');const st=env.states.get(a[0]);if(!st)throw new CompileError(\`unknown state ${a[0]}\`);const e=compileExpr(a[1],env,false);if(e.type!==st.type)throw` | UNMAPPED |
| `tools/gfb1.mjs:187` | `else if(h==='intent'){if(a.length!==2)throw new CompileError('intent expects name expression');assertName(a[0],'intent');const e=compileExpr(a[1],env,true);intents.push({name:a[0],type:e.type,usesInt:e.usesInt,usesFormat3:e.usesFormat3,expr` | UNMAPPED |
| `tools/gfb1.mjs:188` | `else throw new CompileError(\`unknown strategy form ${h}\`);` | UNMAPPED |
| `tools/gfb1.mjs:190` | `if(!query)throw new CompileError(\`strategy ${sname} has no device query\`); const seen=new Set();for(const t of transitions){if(seen.has(t.index))throw new CompileError('duplicate state transition');seen.add(t.index);} unique(intents,'inte` | UNMAPPED |
| `tools/gfb1.mjs:191` | `if(intents.length>128\|\|query.length>4096\|\|transitions.some(t=>t.expr.length>4096)\|\|intents.some(i=>i.expr.length>4096))throw new CompileError('strategy resource limit exceeded');` | UNMAPPED |
| `tools/gfb1.mjs:194` | `unique(compiledStrategies,'strategy'); if(!compiledStrategies.length)throw new CompileError('module needs a strategy');` | UNMAPPED |
| `tools/gfb1.mjs:195` | `for(const c of constraints)for(const s of compiledStrategies){const available=new Map(s.intents.map(i=>[i.name,i.type]));for(const n of c.names){if(!available.has(n))throw new CompileError(\`constraint intent ${n} is missing from strategy $` | UNMAPPED |

## Helper ownership

- Sol owns lexer/parser token spelling, literate extraction, `compile-source.mjs`, and `ghostc.mjs` CLI diagnostics.
- Astra owns semantic/lowerer/helper diagnostics and GFB lowering/verifier diagnostics.
- This file records candidates only. It does not claim that a message match proves the source path, and it does not claim any candidate is unreachable.
