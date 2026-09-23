# Semantic compiler diagnostic coverage

Audit date: 2026-09-22. This is a callsite audit, not a code-coverage percentage or a count of distinct language errors. Lines refer to the post-fix control.mjs snapshot.

## Executable evidence

- Public entry: tools/toolchain.mjs compileSource, complete .ghost.md document with prose.
- tests/compiler-semantic-diagnostics.test.mjs imports tests/fixtures/compiler-semantic-diagnostics.mjs. Every case checks a nearby valid document first, then exact ControlCompileError class, filename, line, column and full message. The § fixture marker identifies the expected source owner.
- 257 independent named cases; final focused run 257/257 passed, exit 0, build/compiler-semantic-diagnostics.log. No TODO, skip or catch-any-error acceptance.
- One additional post-compilation artifact boundary case passes separately: compiled-module-byte-limit, exit 0, build/compiler-semantic-module-limit.log. Total registered cases: 258. The prior 257 tests were not repeated for this tests-only addition.
- Initial diagnostic defects: five quantity-helper paths leaked RangeError; schedule member lookup allowed implicit pure-function capture. RED log: build/compiler-semantic-diagnostics-red.log (252 tests, 246 pass, 6 fail, exit 1).
- Separate lexical RED: parameter/member shadow reported the wrong global-capture error; case/member shadow was accepted. build/compiler-semantic-shadow-red.log (2 fail, exit 1). Minimal source fixes preserve quantity messages and resolve locals before global schedules.
- config-solar-combination is explicitly implementation-restriction. It records the current unsupported combination, not a permanent Reference rejection. Future support replaces that test. Resource-limit cases verify current compiler budgets, not arbitrary syntax prohibitions.

## Lowerer and literal callsites

CASE identifiers are fixture IDs (test names prepend GF-DIAG-semantic-). Multiple cases at one guard exercise representative type/operator contexts; this does not claim every possible operand combination. Repeated defensive checks are identified separately from reachable owning checks.

| Callsite | Diagnostic or guard | Evidence / exclusion proof |
|---|---|---|
| control.mjs:602 (rejectName) | invalid ${label} name ${name} | INTERNAL: lexer and identifier() accept only the same ASCII identifier grammar before rejectName. |
| control.mjs:603 (rejectName) | ${label} name ${name} uses reserved ${RESERVED_PREFIX} prefix | CASE name-reserved-prefix, case-result-reserved-binding |
| control.mjs:604 (rejectName) | ${label} name ${name} is reserved | CASE name-reserved-keyword. |
| control.mjs:605 (rejectName) | ${label} name ${name} is a reserved fault member | CASE name-fault-member, enum-fault-shadow, function-param-shadow, case-result-shadow |
| control.mjs:611 (duration) | Duration literal must use a whole-number unit quantity | CASE duration-fraction-unit |
| control.mjs:613 (duration) | Duration literal exceeds the maximum 2^53-1 milliseconds | CASE duration-literal-overflow |
| control.mjs:618 (solarOffsetMilliseconds) | Solar offset must be an integer duration literal using ms, s, min, or h | CASE solar-offset-whole-unit |
| control.mjs:622 (solarOffsetMilliseconds) | Solar offset magnitude must not exceed 24h | CASE solar-offset-range |
| control.mjs:630 (operatingValue) | ${label} must be Bool | SHARED GUARD, precluded: state/config type and constant checks run before operatingValue; Bool bounds are rejected before settingValue. |
| control.mjs:632 (operatingValue) | ${label} must be a non-negative safe integer Duration | SHARED GUARD, precluded: initial values pass validateNominalConstant; Duration settings pass duration() exact bound checks first. |
| control.mjs:634 (operatingValue) | try { validateTimeValue(type.kind, value, label); } catch (cause) { error(loc, cause.message); } | SHARED GUARD, precluded: time config initial and bounds come from already validated tagged literals; see config-date-setting-invalid-calendar. |
| control.mjs:636 (operatingValue) | ${label} must be finite | CASE config-number-nonfinite. Initial Number finiteness is checked earlier. |
| control.mjs:637 (operatingValue) | ${label} must be between 0% and 100% | CASE config-percent-bound. Initial Percent bounds are checked earlier. |
| control.mjs:638 (operatingValue) | ${label} must be between 0%RH and 100%RH | CASE config-humidity-bound. Initial humidity bounds are checked earlier. |
| control.mjs:644 (locatedQuantityLiteral) | catch (cause) { error(loc, cause.message); } | CASES quantity-decimal-exponent-overflow, quantity-binary64-overflow, quantity-rounded-overflow, quantity-unary-overflow, quantity-setting-overflow. |
| control.mjs:648 (settingValue) | Duration setting must use a duration literal | CASE config-duration-unit |
| control.mjs:650 (settingValue) | Int setting must use a whole decimal literal | CASE config-date-step-fraction |
| control.mjs:652 (settingValue) | Int setting is outside -2147483648..2147483647 | CASE config-date-step-overflow |
| control.mjs:654 (settingValue) | Percent setting must use % | CASE config-percent-unit |
| control.mjs:658 (settingValue) | ${type.kind} setting must use a tagged literal | CASE config-date-tag-required |
| control.mjs:660 (settingValue) | try { parsed = parseTimeLiteral(match[1], match[2]); } catch (cause) { error(loc, cause.message); } | CASE config-date-setting-invalid-calendar (settingValue catch). |
| control.mjs:661 (settingValue) | ${type.kind} setting must use a matching tagged literal | CASE config-date-tag-mismatch |
| control.mjs:666 (settingValue) | ${type.kind} setting must use a ${type.kind} unit literal | CASE config-quantity-unit, config-temperature-step-type |
| control.mjs:696 (validateNominalConstant) | constant Int arithmetic overflows | CASE int-constant-overflow |
| control.mjs:697 (validateNominalConstant) | Percent constant must be between 0% and 100% | CASE percent-overflow |
| control.mjs:698 (validateNominalConstant) | RelativeHumidity constant must be between 0%RH and 100%RH | CASE humidity-literal-bound |
| control.mjs:699 (validateNominalConstant) | Duration constant must be a non-negative integer number of milliseconds | CASE duration-underflow |
| control.mjs:701 (validateNominalConstant) | try { validateTimeValue(type.kind, value, ${type.kind} constant); } catch (cause) { error(loc, cause.message); } | CASE datetime-overflow; Date and TimeOfDay arithmetic is rejected earlier by arithmeticRule. |
| control.mjs:712 (intLiteral) | Int literal is outside -2147483648..2147483647 | CASE int-literal-high, int-literal-low |
| control.mjs:720 (literal) | try { parsed = parseTimeLiteral(tagged[1], tagged[2]); } catch (cause) { error(loc, cause.message); } | CASES date-spelling, date-calendar, time-spelling, time-range, datetime-spelling, datetime-clock-range, datetime-ambiguous-offset, datetime-offset-range, datetime-instant-range. |
| control.mjs:733 (literal) | Percent literal must be between 0% and 100% | CASE percent-literal-bound |
| control.mjs:739 (literal) | number literal must be finite | CASE number-whole-literal-nonfinite. |
| control.mjs:745 (literal) | number literal must be finite | CASE number-nonfinite. |
| control.mjs:746 (literal) | Int literal must be a whole decimal numeral without a decimal point or exponent | CASE int-fraction |
| control.mjs:803 (lower) | GFB1 lowering rejected control: ${message} | CASE output-resource-budget, constraint-resource-budget, lowered-syntax-depth-budget, expression-byte-budget, constraint-duplicate-member, encoded-name-length, device-query-byte-budget, lowered-source-byte-budget |
| control.mjs:808 (lower) | if (!timer) internal(timer ${node.name} has no lowered state binding); | INTERNAL: declared timers are populated/resolved before transitionForms and metadata binding; no public AST mutation ingress. |
| control.mjs:825 (unique) | duplicate name ${name} | CASE duplicate-name |
| control.mjs:830 (resolveType) | Result type requires payload and error types | CASE result-type-parameters-missing |
| control.mjs:833 (resolveType) | Result error type must be a compiler-owned fault enum | CASE result-error-type |
| control.mjs:834 (resolveType) | nested Result payload is not supported | CASE result-nested |
| control.mjs:842 (resolveType) | unknown type ${type.name} | CASE unknown-type |
| control.mjs:847 (declare) | type name ${item.name} is reserved | CASE reserved-type |
| control.mjs:849 (declare) | enum needs at least one member | PRECLUDED: typeDecl calls identifier for the first member before constructing enum; empty syntax belongs to parser diagnostics. |
| control.mjs:853 (declare) | duplicate enum member ${member.name} | CASE duplicate-enum-local, duplicate-enum-global |
| control.mjs:865 (addInput) | duplicate generated input ${name} | PRECLUDED: global names are unique; generated kind/name prefixes are injective; user __gf_ names are rejected; ensureClock emits the shared clock once. |
| control.mjs:879 (validateAndPopulate) | input must use a scalar type | CASE input-result-storage |
| control.mjs:883 (validateAndPopulate) | output must use a scalar type | CASE output-result-storage |
| control.mjs:888 (validateAndPopulate) | Result cannot be stored in state | CASE state-result-storage |
| control.mjs:889 (validateAndPopulate) | state initial value must be a constant of the state type | CASE state-nonconstant, state-wrong-type |
| control.mjs:894 (validateAndPopulate) | Result cannot be stored in config | CASE config-result-storage |
| control.mjs:895 (validateAndPopulate) | config value must be a constant of the declared type | CASE config-nonconstant, config-wrong-type |
| control.mjs:899 (validateAndPopulate) | Solar schedules cannot be combined with operating settings metadata yet | CASE config-solar-combination |
| control.mjs:900 (validateAndPopulate) | operating config initial value must be a supported literal | CASE config-computed-initial |
| control.mjs:903 (validateAndPopulate) | unknown config option ${key} | CASE config-unknown-option |
| control.mjs:904 (validateAndPopulate) | config access must be operator or designer | CASE config-access |
| control.mjs:905 (validateAndPopulate) | config label must be 1 to 128 characters | CASE config-label |
| control.mjs:906 (validateAndPopulate) | Bool config cannot have numeric bounds | CASE config-bool-bounds |
| control.mjs:918 (validateAndPopulate) | numeric config requires valid min, max and positive step | CASE config-missing-step |
| control.mjs:919 (validateAndPopulate) | config initial value is outside settings range | CASE config-outside-range |
| control.mjs:923 (validateAndPopulate) | config initial value is not aligned to settings.step from settings.min | CASE config-default-grid |
| control.mjs:924 (validateAndPopulate) | time config max is not aligned to settings.step from settings.min | CASE config-time-max-grid |
| control.mjs:942 (validateAndPopulate) | output ${output.name} requires exactly one connection (${output.name} <- expression;) | CASE output-unconnected |
| control.mjs:947 (addSensor) | sensor type must be Bool, Number, Percent, or a physical quantity | CASE sensor-type |
| control.mjs:953 (addSensor) | sensor ${item.name} requires ${label} | PRECLUDED: optional read calls have required=false; required=true calls occur only after EMA/window arity and named-argument checks guarantee the expression exists. |
| control.mjs:955 (addSensor) | ${label} must be a constant ${expected.kind} | CASE state-nonconstant, config-nonconstant, state-wrong-type, config-wrong-type, sensor-nonconstant-option |
| control.mjs:960 (addSensor) | valid requires both lower and upper bounds | PRECLUDED: sensor parser assigns validMin and validMax together, requiring .. and both expressions. |
| control.mjs:961 (addSensor) | sensor valid range is inverted | CASE sensor-inverted-range |
| control.mjs:964 (addSensor) | numeric filtering requires a numeric sensor | CASE sensor-filter-type |
| control.mjs:965 (addSensor) | filter must be median(N), moving_average(N), or ema(alpha: Number) | CASE sensor-filter-shape, sensor-filter-name |
| control.mjs:969 (addSensor) | ema filter requires exactly ema(alpha: Number) | CASE sensor-ema-shape |
| control.mjs:971 (addSensor) | ema alpha must be finite and in (0, 1] | CASE sensor-ema-range |
| control.mjs:974 (addSensor) | filter must be median(N), moving_average(N), or ema(alpha: Number) | CASE sensor-filter-shape, sensor-filter-name |
| control.mjs:976 (addSensor) | ${filterName} window must be ${filterName === 'median' ? 'an odd integer' : 'an integer'} from 1 to 31 | CASE sensor-median-window, sensor-moving_average-window |
| control.mjs:982 (addSensor) | recover_after must be an integer from 1 to 31 samples | CASE sensor-recovery-count |
| control.mjs:983 (addSensor) | sensor durations must be positive | CASE sensor-positive-duration |
| control.mjs:992 (addSchedule) | only DailySlots<15min> is supported | CASE schedule-interval |
| control.mjs:993 (addSchedule) | schedule requires timezone | CASE schedule-timezone |
| control.mjs:994 (addSchedule) | schedule requires selected slots | CASE schedule-selected |
| control.mjs:998 (addSchedule) | DailySlots<15min> requires a unique 15-minute HH:MM slot | CASE schedule-slot-grid |
| control.mjs:999 (addSchedule) | duplicate schedule slot | CASE schedule-slot-duplicate |
| control.mjs:1006 (addSolarSchedule) | Solar schedule requires ${field} | CASE solar-missing-timezone, solar-missing-latitude, solar-missing-longitude, solar-missing-at, solar-missing-fallback, solar-empty-timezone |
| control.mjs:1008 (addSolarSchedule) | Solar schedule requires a non-empty timezone | CASE solar-empty-timezone |
| control.mjs:1010 (addSolarSchedule) | Solar timezone must be a supported IANA timezone | CASE solar-unknown-timezone |
| control.mjs:1025 (addSignal) | signal requires hysteresis(sensor, on_below:, off_above:, initial:) | CASE signal-shape |
| control.mjs:1026 (addSignal) | hysteresis first argument must be a declared sensor | CASE signal-sensor-reference |
| control.mjs:1028 (addSignal) | hysteresis requires a numeric sensor | CASE signal-sensor-type |
| control.mjs:1029 (addSignal) | hysteresis requires on_below, off_above, and initial | CASE signal-options |
| control.mjs:1033 (addSignal) | hysteresis thresholds must be constant sensor values | CASE signal-threshold-type |
| control.mjs:1034 (addSignal) | hysteresis on_below must be less than off_above | CASE signal-threshold-order |
| control.mjs:1035 (addSignal) | hysteresis initial must be a Bool constant | CASE signal-initial-type |
| control.mjs:1044 (declareTimer) | timer requires elapsed(state) or continuous_true(Bool) | CASE timer-shape |
| control.mjs:1051 (declareTimer) | elapsed argument must be a declared state | CASE timer-state-reference |
| control.mjs:1066 (resolveTimer) | const timer = this.timers.get(name); if (!timer) internal(missing timer definition ${name}); | INTERNAL: resolveTimer is invoked from the timer map or already-declared timer symbols. |
| control.mjs:1069 (resolveTimer) | cyclic timer definition involving ${name} | CASE timer-cycle |
| control.mjs:1072 (resolveTimer) | continuous_true argument must be Bool | CASE timer-condition-type |
| control.mjs:1084 (addFunction) | duplicate function ${item.name} | PRECLUDED: declare() unique-name check rejects duplicate function names before validateAndPopulate/addFunction. CASE duplicate-name covers the shared global-name guard. |
| control.mjs:1087 (addFunction) | duplicate function parameter ${parameter.name} | CASE function-param-duplicate |
| control.mjs:1096 (validateFunctionBodies) | function ${fn.name} returns ${typeNameOf(value.type)}, expected ${typeNameOf(fn.resultType)} | CASE function-return-type, result-error-mismatch, result-payload-mismatch |
| control.mjs:1103 (resolveLet) | const item = this.lets.get(name); if (!item) internal(missing let definition ${name}); | INTERNAL: resolveLet is invoked for registered lets, from a let symbol or guarded lets.has transform lookup. |
| control.mjs:1106 (resolveLet) | cyclic let definition involving ${name} | CASE let-cycle |
| control.mjs:1125 (resolveLet) | let ${item.name} does not match annotation ${resolvedAnnotation.kind} | CASE let-annotation |
| control.mjs:1131 (addNext) | unknown state ${item.name} | CASE unknown-next-state, next-unknown-reference |
| control.mjs:1132 (addNext) | duplicate next state ${item.name} | CASE duplicate-next-state |
| control.mjs:1134 (addNext) | next state ${item.name} must be ${state.type.kind} | CASE next-type |
| control.mjs:1138 (addConnection) | unknown output ${item.name} | CASE unknown-output |
| control.mjs:1139 (addConnection) | duplicate output connection ${item.name} | CASE duplicate-output |
| control.mjs:1141 (addConnection) | output ${item.name} must be ${output.type.kind} | CASE output-type |
| control.mjs:1154 (addConstraint) | unsupported require: use output => output, output => (a \|\| b), or !(a && b) | CASE constraint-shape |
| control.mjs:1157 (outputName) | ${label} must be a Bool output | CASE constraint-target-type, constraint-mutex-member, constraint-prerequisite-type |
| control.mjs:1158 (outputName) | ${label} must be a Bool output | CASES constraint-target-nonbool-output, constraint-prerequisite-nonbool-output, constraint-mutex-nonbool-output: declared output has non-Bool type. |
| control.mjs:1162 (addMutex) | mutex needs 2 to 32 Bool outputs | CASE constraint-mutex-count, constraint-mutex-upper-bound |
| control.mjs:1164 (expression) | function expansion exceeds ${EXPANSION_NODE_LIMIT} node budget | CASE lowering-visit-budget. |
| control.mjs:1177 (expression) | ambiguous fault member ${node.name} requires an expected fault type | CASE fault-ambiguous |
| control.mjs:1178 (expression) | unknown identifier ${node.name} | CASE unknown-reference, dead-branch-name |
| control.mjs:1179 (expression) | fn ${options.pureFunction} cannot capture global ${node.name} | CASE function-capture. |
| control.mjs:1188 (expression) | schedule ${node.name} must be read as ${node.name}.due | CASE schedule-direct-reference |
| control.mjs:1198 (expression) | function ${node.name} requires arguments | CASE function-as-value |
| control.mjs:1199 (expression) | unsupported reference ${node.name} | CASE enum-type-as-value |
| control.mjs:1203 (expression) | removed qualified reference ${node.base}.${node.member}; use the direct canonical name | CASE removed-qualified-input, removed-qualified-state, removed-qualified-next |
| control.mjs:1206 (expression) | fn ${options.pureFunction} cannot capture global ${node.base} | CASE function-schedule-member-capture. |
| control.mjs:1209 (expression) | unknown member ${node.base}.${node.member} | CASE unknown-member, function-local-member-shadow, case-local-member-shadow |
| control.mjs:1212 (expression) | fn ${options.pureFunction} cannot read primed state ${node.name}' | CASE function-primed-capture |
| control.mjs:1213 (expression) | next state references are allowed only in output expressions | CASE let-next-reference |
| control.mjs:1214 (expression) | unknown state ${node.name} | CASE next-unknown-reference. |
| control.mjs:1225 (expression) | ! requires Bool | CASE not-type |
| control.mjs:1227 (expression) | unary - requires numeric value | CASE negation-type |
| control.mjs:1228 (expression) | unary - is not defined for ${value.type.kind} | CASE temperature-negation |
| control.mjs:1246 (expression) | if condition must be Bool / if branches must have the same type | CASE if-condition, dead-branch-type |
| control.mjs:1251 (expression) | in values must match the tested value type | CASE set-type |
| control.mjs:1257 (expression) | unsupported expression node ${node.kind} | INTERNAL: expression consumes only parser-produced literal/reference/member/nextReference/unary/binary/if/in/case/call kinds; all are dispatched. |
| control.mjs:1264 (binary) | >> is valid only inside a static Result transform pipeline | CASE pipeline-composition-context |
| control.mjs:1279 (binary) | ${op} requires Bool operands | CASE logic-&&, logic-|| |
| control.mjs:1280 (binary) | ${op} requires values of the same type | CASE equality-==, equality-!= |
| control.mjs:1281 (binary) | ${op} requires matching ordered types | CASE ordered-<, ordered-<=, ordered->, ordered->= |
| control.mjs:1299 (binary) | => is only valid in require declarations | PRECLUDED: => is absent from BIN_PREC; only requirement() constructs it, and addConstraint consumes that node without expression(). |
| control.mjs:1300 (binary) | unsupported operator ${op} | INTERNAL: BIN_PREC operators are exhausted by binary handlers; require => has its dedicated non-expression path. |
| control.mjs:1305 (applyTransform) | ${node.name} is not a static Result transform | CASE pipeline-not-static-alias |
| control.mjs:1311 (applyTransform) | Result pipeline requires a compiler-known static transform | CASE pipeline-shape |
| control.mjs:1313 (applyTransform) | map expects one transform and a Result value | CASE map-arity, map-input-type |
| control.mjs:1315 (applyTransform) | map transform must return a non-Result value | CASE map-result-return |
| control.mjs:1319 (applyTransform) | and_then expects one transform and a Result value | CASE and-then-arity, and-then-input-type |
| control.mjs:1321 (applyTransform) | and_then transform must return Result<U, E> with the same error type | CASE and-then-nonresult-return, and-then-error-enum |
| control.mjs:1333 (applyTransform) | recover expects one default and a Result value | CASE recover-arity, recover-input-type |
| control.mjs:1335 (applyTransform) | recover default must be ${typeNameOf(value.type.value)} | CASE recover-default-type |
| control.mjs:1342 (applyTransform) | unsupported Result transform ${node.name} | CASE pipeline-unknown-transform |
| control.mjs:1346 (applyValueTransform) | below expects one limit | CASE below-arity |
| control.mjs:1347 (applyValueTransform) | below is not defined for ${typeNameOf(value.type)} | CASE below-payload-type |
| control.mjs:1349 (applyValueTransform) | below limit must be ${typeNameOf(value.type)} | CASE below-limit-type |
| control.mjs:1352 (applyValueTransform) | map/and_then requires a named fn or below(limit) | CASE callback-shape |
| control.mjs:1354 (applyValueTransform) | transform ${node.name} must name a unary fn | CASE callback-unknown-name, callback-arity |
| control.mjs:1355 (applyValueTransform) | transform ${node.name} expects ${typeNameOf(fn.params[0].resolvedType)} | CASE callback-parameter-type |
| control.mjs:1356 (applyValueTransform) | recursive fn ${node.name} is not supported | CASE callback-recursion. |
| control.mjs:1359 (applyValueTransform) | function ${node.name} returns ${typeNameOf(out.type)}, expected ${typeNameOf(fn.resultType)} | SHARED DEFENSIVE GUARD: validateFunctionBodies checks monomorphic result type before callback application. CASE function-return-type reaches the first owning guard. |
| control.mjs:1368 (recordResultSite) | } else if (entry.kind !== kind \|\| entry.errorType !== errorType) internal(Result trace site ${node.id} changed meaning); | INTERNAL: parser node IDs are unique and kind fixed; explicit monomorphic fn/Result types fix errorType across repeated inlining; validation mode records no sites. |
| control.mjs:1376 (callExpression) | removed alias ifthenelse; use if condition then value else value | CASE removed-ifthenelse |
| control.mjs:1378 (callExpression) | ${node.name} is only valid in its declaration | CASE declaration-only-elapsed, declaration-only-hysteresis, declaration-only-median |
| control.mjs:1380 (callExpression) | ${node.name} expects one argument | CASE ok-arity, fault-arity |
| control.mjs:1381 (callExpression) | ${node.name} requires an expected Result<T, E> type | CASE ok-missing-context, fault-missing-context |
| control.mjs:1384 (callExpression) | ok payload must be ${typeNameOf(expected.value)} | CASE ok-payload-type |
| control.mjs:1388 (callExpression) | fault reason must be ${typeNameOf(expected.error)} | CASE fault-enum-type |
| control.mjs:1396 (callExpression) | number expects one Int argument | CASE number-conversion-arity |
| control.mjs:1398 (callExpression) | number argument must be Int | CASE number-conversion-type |
| control.mjs:1406 (callExpression) | ${node.name} expects one Number argument | CASE int_exact-arity, int_floor-arity, int_ceil-arity, int_trunc-arity, int_nearest_even-arity |
| control.mjs:1408 (callExpression) | ${node.name} argument must be Number | CASE int_exact-type, int_floor-type, int_ceil-type, int_trunc-type, int_nearest_even-type |
| control.mjs:1411 (callExpression) | int_exact constant must be integral | CASE int-exact-fraction |
| control.mjs:1414 (callExpression) | integer conversion constant is outside -2147483648..2147483647 | CASE int_exact-range, int_floor-range, int_ceil-range, int_trunc-range, int_nearest_even-range |
| control.mjs:1422 (callExpression) | unknown function ${node.name} | CASE unknown-function |
| control.mjs:1423 (callExpression) | function ${node.name} expects ${fn.params.length} arguments | CASE function-arity |
| control.mjs:1424 (callExpression) | recursive fn ${node.name} is not supported | CASES function-recursive, function-cycle. |
| control.mjs:1426 (callExpression) | argument ${i + 1} to ${node.name} must be ${fn.params[i].resolvedType.kind} | CASE function-argument-type |
| control.mjs:1428 (callExpression) | function ${node.name} returns ${value.type.kind}, expected ${fn.resultType.kind} | SHARED DEFENSIVE GUARD: validateFunctionBodies checks monomorphic result types before ordinary calls. CASE function-return-type owns the first check. Argument-dependent constants may fail inside a body but cannot change its static type. |
| control.mjs:1433 (caseExpression) | case requires an enum or sensor/signal result | CASE case-not-enum |
| control.mjs:1434 (caseExpression) | enum case members do not take bindings / unknown ${value.type.kind} member ${branch.name} / duplicate case member ${branch.name} | CASE case-enum-binding, case-enum-unknown, case-enum-duplicate |
| control.mjs:1435 (caseExpression) | case for ${value.type.kind} must be exhaustive | CASE case-enum-incomplete |
| control.mjs:1438 (caseExpression) | case branches must have the same type | CASE case-enum-branch-type. |
| control.mjs:1445 (resultCase) | Result case supports only ok(...) and fault(...) / duplicate ${branch.name} branch / ${branch.name} branch requires a binding | CASE case-result-pattern, case-result-duplicate, case-result-binding |
| control.mjs:1446 (resultCase) | Result case must handle ok(...) and fault(...) | CASE case-result-incomplete |
| control.mjs:1454 (resultCase) | case branches must have the same type | CASE case-result-branch-type. |
| control.mjs:1492 (checkBudgets) | input budget exceeded (${INPUT_LIMIT}) | CASE input-resource-budget |
| control.mjs:1493 (checkBudgets) | state budget exceeded (${STATE_LIMIT}) | CASE state-resource-budget |
| control.mjs:1494 (checkBudgets) | strategy budget is invalid | INTERNAL: STRATEGY_LIMIT is the immutable positive constant 32. |
| control.mjs:1495 (checkBudgets) | constraint arity exceeds 32 | CASE constraint-prerequisite-arity |
| control.mjs:1499 (checkExpressionStacks) | function expansion exceeds ${EXPANSION_NODE_LIMIT} node budget | CASE expanded-tree-budget. |
| control.mjs:1501 (checkExpressionStacks) | expression stack budget exceeded (128) for ${form[1]} | CASE expression-stack-budget |
| control.mjs:1514 (arithmeticRule) | ${op} is not defined for ${left.kind} and ${right.kind} | CASE datetime-wrong-arithmetic. |
| control.mjs:1515 (arithmeticRule) | ${op} requires numeric operands | CASE bool-arithmetic |
| control.mjs:1530 (arithmeticRule) | ${op} is not defined for ${left.kind} and ${right.kind} | CASES quantity-arithmetic, humidity-arithmetic. |
| control.mjs:1533 (arithmeticRule) | ${op} does not implicitly mix ${left.kind} and ${right.kind} | CASE int-number-mixing. |
| control.mjs:1534 (arithmeticRule) | / is not defined for Int operands; use div or convert both operands to Number | CASE int-slash |
| control.mjs:1537 (arithmeticRule) | ${op} requires Int operands | CASE number-div, number-% |
| control.mjs:1538 (arithmeticRule) | ${op} does not implicitly mix ${left.kind} and ${right.kind} | CASE nominal-addition. |
| control.mjs:1539 (arithmeticRule) | * requires a Number scale factor | CASE nominal-scale |
| control.mjs:1540 (arithmeticRule) | / requires a Number divisor or matching units | CASE nominal-division |
| control.mjs:1541 (arithmeticRule) | unsupported arithmetic ${op} | INTERNAL: binary dispatch calls arithmeticRule only for +,-,*,/,div,%; all six terminate in a rule or a preceding typed diagnostic. |
| control.mjs:1544 (arithmetic) | if ((op === '/' \|\| op === 'div' \|\| op === '%') && right === 0) error(loc, op === '/' ? 'constant division by zero' : 'constant integer division by zero'); | CASES constant-zero-/, constant-zero-div, constant-zero-%. |
| control.mjs:1547 (arithmetic) | constant arithmetic result is not finite | CASE number-operation-overflow |
| control.mjs:1583 (compileControl) | if (typeof filename !== 'string' \|\| !filename) internal('filename must be a non-empty string'); | DELEGATED API guard: non-empty filename; no semantic-source fixture claims direct compileControl options coverage. |
| control.mjs:1590 (typeCheckControl) | if (typeof filename !== 'string' \|\| !filename) internal('filename must be a non-empty string'); | DIRECT INTERNAL API guard: typeCheckControl options are outside canonical compileSource ingress. |

All audited semantic rows have a case, shared owning guard, or exclusion proof. Two filename API rows are delegated and are not counted as source-path coverage. This does not claim the cross-file 450-row mechanical inventory is fully mapped.

## Literal helper branches

Function and diagnostic fragment are the stable anchors. Direct helper misuse is distinct from canonical source compilation.

| Function / diagnostic fragment | Public evidence or exclusion |
|---|---|
| control.numberAtom / cannot lower finite number | Internal formatting invariant: String of a finite Number has decimal or the accepted single-digit scientific mantissa syntax. Finite validation precedes callers. |
| quantities module catalog / inconsistent canonical unit | Import-time assertion over the fixed catalog, not user text. |
| quantities.rational / denominator must not be zero | Literal denominators are powers of ten multiplied by fixed nonzero catalog scale and offset denominators. Direct helper misuse is outside compiler ingress. |
| quantities.decimalRational / exceeds source characters | Public tokenization rejects a document over 256 KiB before one literal can exceed the helper's 256 KiB bound. Parser resource tests own the earlier diagnostic. |
| quantities.decimalRational / invalid decimal literal | quantityLiteral extracts its numeral with the same decimal grammar before calling decimalRational. Canonical lexer input cannot supply a malformed numeral here. |
| quantities.decimalRational / finite binary64 range, decimal order | quantity-decimal-exponent-overflow; quantity-unary-overflow; quantity-setting-overflow. |
| quantities.rationalToBinary64 / finite binary64 range, initial exponent | quantity-binary64-overflow uses 1.8e308, greater than 2^1024. |
| quantities.rationalToBinary64 / finite binary64 range, rounding carry | quantity-rounded-overflow uses 1.79769313486231581e308, below 2^1024 but above the max-finite rounding midpoint. Valid neighbor is 1.7976931348623158e308. |
| quantities.formatCanonicalQuantityLiteral / finite catalog value | Output formatting is not called by control literal parsing. Direct helper API guard, not a source diagnostic. |
| time.validateTimeValue / unknown type | Compiler callers are gated by isTimeType. An unknown source type cannot reach this helper argument. |
| time.validateTimeValue / integer range | datetime-overflow. Tagged Date/TimeOfDay bounds are checked by parseTimeLiteral first; their arithmetic is rejected. |
| time.parseTimeLiteral / tag and text must be strings | Lexer/raw literal regex always supplies strings. Direct helper misuse excluded. |
| time.dateParts / invalid date and date range | date-spelling, date-calendar, config-date-setting-invalid-calendar. |
| time.parseTimeLiteral time / invalid spelling and range | time-spelling, time-range. |
| time.parseTimeLiteral datetime / invalid spelling and clock range | datetime-spelling, datetime-clock-range. |
| time.parseTimeLiteral datetime / negative zero offset, offset bounds, UTC instant bounds | datetime-ambiguous-offset, datetime-offset-range, datetime-instant-range. |
| time.parseTimeLiteral / unknown tag | Both lexer tagged-token recognition and lowerer raw regex restrict tags to date/time/datetime. Direct helper misuse excluded. |

## Public GFB lowering boundaries

These cases start with real canonical source. They do not substitute hand-built IR.

| GFB function / guard | Fixture evidence or reachability |
|---|---|
| tokenize / source byte > 1 MiB | lowered-source-byte-budget: compact named-function expansion and 15 outputs cross the bound; 10 outputs compile. |
| parse.one / syntax nesting > 128 | lowered-syntax-depth-budget: shallow source aliases expand to deep left-associated IR without exceeding source parser nesting. |
| assertName / 128-character bound | encoded-name-length: 129-character module name vs valid 128. The same guard validates input/state/capability/intent/constraint names; not every label is independently exercised. |
| compile / module constraint count > 128 | constraint-resource-budget. Source input/state limits reject before identical GFB count checks. Source emits exactly one strategy. |
| compile / strategy intent count > 128 | output-resource-budget. |
| compile / strategy query bytes > 4096 | device-query-byte-budget: 32 distinct 128-character output names; valid 20-name neighbor. |
| compile / strategy expression bytes > 4096 | expression-byte-budget: function duplication emits large real expressions while passing source tree and stack limits. |
| compile / invalid constraint names or arity | constraint-duplicate-member. Source arity is checked earlier by constraint-prerequisite-arity and constraint-mutex-upper-bound. |
| Writer.str / string length > 65535 | Precluded for canonical emission: serialized names first pass assertName <=128; capability kind is fixed actuator. |
| compileExpr / complexity depth and nodes | Lowerer tree budget counts array heads and children, at least emitter visit count. Serialized syntax depth is checked before emitter depth. The earlier guards own public diagnostics. |
| compileExpr / u16 branch extent | At <=4096 tree nodes and <=9 bytes per value instruction, with branch overhead <=6 bytes per three children, one expression cannot reach a 65535-byte branch span before earlier limits. |
| tokenize/parse / malformed S-expression, delimiters, multiple forms | Canonical emission uses sexpr(module), which constructs balanced parentheses and one module. Names follow identifier grammar, numbers use numberAtom. Raw malformed IR tests own these paths. |
| compile / module/strategy/query shape, version, priority, duplicate declarations/transitions | Lowerer emits a fixed module/version/strategy/query schema. Source declaration uniqueness and next/output connection checks run first. Source emits one strategy and one query with fixed priority. |
| compileQuery / capability type, has/all/any/not arity, unknown query | Public queries consist solely of true or nonempty all(has actuator NAME TYPE). Types are scalarized by gfbType. Other raw query forms are not emitted. |
| compileExpr / opcode arity, type mismatch, unknown input/state/next, malformed literals | Typed expression lowering emits only its fixed opcode templates. Name lookup, expected types, primed-state context and constant validity are checked before emission. Malformed internal inputs belong to raw GFB tests, not public-source coverage. |
| compile / constraint intent missing or not Bool | outputName checks declared Bool outputs before constraints are emitted. constraint-target/prerequisite/mutex cases exercise those owning checks. |

### Post-compilation module envelope

`compile-source.mjs::compileSource` checks `compiled module byte limit exceeded`
after bytecode generation. This guard is reachable independently of the GFB
source-size and per-expression limits.

`compiled-module-byte-limit` constructs one balanced Number expression with
409 leaves of `16.0` and 408 additions. Its bytecode is 4089 bytes, within the
4096-byte expression limit. A typed `let` reuses it for 128 state transitions
and 128 output intents. The expression payloads alone occupy 1,046,784 bytes;
declaration, query and frame overhead pushes the complete module past 1 MiB.
The canonical control source is only 13,127 characters. Public compilation
passes the earlier source, tree, stack, query and lower-IR limits and reaches
the exact post-compilation guard.

The nearby valid document retains 128 state transitions and uses 126 outputs.
Its emitted bytecode is exactly **1,044,663 bytes**, verified through the public
compiler. The negative case asserts the exact plain `Error` constructor and
message, with absent filename/line/column. It is an artifact-envelope failure
without an AST source owner, so it is deliberately separate from the located
`ControlCompileError` harness. No production change was needed.

## Remaining scope and limitations

- Parser, lexer, CLI and public API diagnostics are owned separately. Their mapping must be reconciled with the original inventory before claiming complete compiler diagnostic coverage. No percentage is inferred from its 450 mechanical matching lines.
- Direct helper misuse, repeated defensive checks and internal IR guards are excluded only with the reasons above. They are not claimed as executed branches.
- Compound guards have representative invalid operands and boundary cases. This is not a measured branch-coverage result or an exhaustive malformed-input cross-product.
- The current Solar/settings combination is explicitly an implementation restriction. Supporting it must replace that negative case. This suite does not turn other unimplemented Reference features into permanent rejections.
- No known reachable semantic diagnostic family remains without a case in this bounded audit. Two filename option guards remain with the parser/API owner. That scope statement does not cover unimplemented language features or all runtime faults.
