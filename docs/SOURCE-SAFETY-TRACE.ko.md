<!-- translation-source: docs/SOURCE-SAFETY-TRACE.md -->
[영어 원문](SOURCE-SAFETY-TRACE.md)

# Source와 safety 관측 계약

추적: language 이슈 #8 / TASK-58.8. 진단만의 추가 사항이다. GFB1, execution ABI,
output 의미, constraint priority, device release 변경은 없다.

## Compiler companion

`compileControl().traceMetadata`는 `GhostFlow/source-trace-v1` format이며 module fingerprint,
binding, constraint mapping을 가진다. binding은 권위 AST node ID, logical name,
관측 field인 inputs, stateBefore/stateAfter, requested/safe를 식별한다. constraint index는
UI 추론 순서가 아니라 실제 lowering된 GFB constraint 순서를 따른다. literate adapter는
추출 좌표를 유지하고 실제 mapping이 있을 때만 원본 위치를 map한다.

elapsed timer에는 compiler 생성 runtime state 두 개가 있다. 각각 `stateBefore`/
`stateAfter`의 일반 binding이지만 생성됐음을 계속 표시한다. `generated: {declaration,
role}`은 작성 timer 이름과 정확한 role인 `since`/`initialized` 중 하나를 사용한다.
두 항목은 권위 `timer` 선언 node를 가리킨다. 합성 작성 assignment가 아니며 선언만으로
이후 output을 동적으로 유발했다고 주장하지 않는다.

FNV module fingerprint는 기존 core 진단 identifier이며 암호학적 무결성 증명이 아니다.
consumer는 같은 compilation/run의 source/compiler/runtime/SHA-256 identity를 유지해야 한다.
comment가 다른 source 두 개가 같은 bytecode를 만들 수 있다. fingerprint 일치만으로
source를 선택할 수 없다.

## Static dependency companion

language 이슈 #11 / TASK-58.12.1은 compiler companion에 `dependencies`를 추가한다.
각 entry는 `target: {field, name}`과 중복 제거된 `reads: [{field, name}]`을 가진다.
transition target은 `stateAfter`, intent target은 `requested`를 사용한다. read는 `inputs`,
`stateBefore`, `stateAfter` phase를 유지한다. compiler가 이미 lowering한 식에서 나오며
확장 function/implicit hold를 포함한다. 두 conditional branch를 포함한 가능한 static
read다. executed-branch trace나 모든 read가 선택 output의 원인이었다는 주장이 **아니다**.

consumer는 기존 binding으로 source 위치를 해소한다. 생성 timer state 두 개는 timer 선언에
해소된다. 주입 monotonic clock input 같은 binding 없는 다른 generated field는 명시 unmapped로
남으며 source 위치를 만들어 붙이지 않는다. previous-state edge는 이전 scan 경계에서 끝난다.
이를 same-scan transition으로 따라가면 거짓 feedback causality가 생긴다. global safety
constraint는 실제 round observation과 함께 별도 relation으로 남는다. companion은 GFB
byte/runtime output 의미를 바꾸지 않는다.

## Artifact 저장과 strict recovery

`compileSource` 결과는 기존 trace companion을 `GhostFlow/source-map-v1` envelope의
`traceMetadata`로 저장한다. GFB/strict control manifest는 불변이다. 저장 companion은
`sourceDocumentSha256`/`bytecodeSha256`을 포함한다. 내부 `compileControl` lowerer는
source-container에 독립적으로 유지된다. 제품 compiler API가 아니다.
제품 caller는 literate-only `compileSource`를 사용한다. `restoreArtifactSourceMap`은
먼저 정확한 source-document SHA-256/GFB SHA-256을 companion identity와 검증한다.
다음으로 runtime module fingerprint, binding/node 위치, generated timer 쌍, dependency
target, 완전한 constraint-node coverage를 검증한다. 이후에만 source/map/trace metadata를
하나의 revision 결속 결과로 반환한다.

> 번역 주: 원문의 `while the direct low-level` 구절은 문장이 미완성이다.
> 위 번역은 완결된 문장의 의미를 옮겼으며, 미완성 구절의 관계를 추정하지 않았다.

strict recovery는 trace metadata 없는 traceable control map과 중복/부재/불일치 generated
timer binding을 거부한다. 이전 `verifyArtifactSourceMap` source-only API는 trace 저장 이전
v1 map과 호환되지만 field가 있으면 trace metadata를 검증한다. output-to-source navigation을
약속하는 consumer는 source-only 검증을 trace acceptance로 취급하지 말고 strict recovery를
사용해야 한다.

## Runtime 관측

`TickRecord.to_json()`은 `GhostFlow/safety-trace-v1` format의 `safetyTrace`를 추가한다.
각 entry는 index, kind, names, firstViolation, final을 기록한다. 관측은 기존 fixed-point
safety loop 안에서 해당 round 갱신 전에 포착한다.

- `firstViolation`은 null 또는 `{round, values, blocked}`다. 해당 rule의 첫 위반 평가만
  기록하며 실제 읽은 member 값과 rule이 차단한 output을 담는다. round 0은 requested
  output snapshot을 평가한다.
- `final`은 종료 no-block round의 `{round, values, satisfied}`다. false target으로 만족한
  implication은 해당 target을 켜라는 허가가 아니다.
- `values`는 그 rule의 member만 담는다. 기존 constraint 128개/member 32개 상한으로
  constraint마다 최대 snapshot 두 개를 보존한다. 무제한 round history가 아니며 고유
  causal root를 주장하지 않는다.

이전 requested/safe map과 fault string은 정확한 의미를 유지한다. snapshot은 algorithm을
관측한다. output 결정에 영향을 줘서는 안 된다.

## Window 증거

`windowSites`는 각 aggregate 선언을 operation, nominal payload, duration, physical source,
선택적 이전 `upstreamWindows`에 bind한다. canonical source replay가 binding과
source/consumer dependency를 검사한다.

Rust `windowTrace` record는 평탄화 sensor sample 집합이 아니라 immediate contributor를
기록한다. physical contributor는 `{sourceTag, epoch, id, timestampMs, value}`를 유지한다.
derived contributor는 `{kind: "derived", site, timeEpoch, admissionRevision, timestampMs,
evaluatedAtMs, value, proofRoot}`를 유지한다. identity는 검증 module, 선택 strategy,
execution session의 local identity다. time epoch만으로는 전역 고유 session identity가 아니다.

derived contributor가 있는 record는 `proof` array를 소유한다. 각 `proofRoot`는 flat preorder
arena의 aggregate tree를 가리킨다. 모든 node는 `childCount`/`subtreeSize`를 가진다.
physical leaf는 child 0개, size 1이다. derived node는 aggregate operation, 원본 aggregate
`value`, evaluation time, observation identity를 보존한다. `suppliedValue`는 순수 변환 후
parent에 공급된 payload다. physical leaf의 `value`는 이미 admit된 변환 observation payload라
`suppliedValue`와 같다. 별도 raw driver reading 보존을 주장하지 않는다.

`observeSourceTrace`는 tree 경계, 이전 window identity, physical root membership, scalar
domain, observation/evaluation time, 완전한 proof coverage를 검증한다. aggregate 산술을
재계산하지 않고 소유 proof를 `windowEvents`에 노출한다. nested average는 proof tree가
physical sample identity를 공유해도 immediate aggregate contributor를 각각 한 번 센다.
저장/외부 trace data에서 local site identity를 해석하려면 여전히 검증된 artifact/source
envelope가 필요하다.

## Public runtime 값

`observeRuntimeValues(metadata, trace)`는 같은 compiler 소유 binding에서 completed-scan
값을 투영한다. `GhostFlow/runtime-values-v1` 결과는 현재 작성 `state`/`timer` 값을
포함한다. timer 값은 source 선언 이름, `Duration`, 정확한 nonnegative integer millisecond를
사용한다. generated `__gf_` 저장 이름은 결과에 나타나지 않는다.

helper는 trace에 clock, initialized flag, start time이 있을 때만 elapsed timer를 계산한다.
없는 field는 0을 만들어 넣지 않고 부재로 남는다. 정확한 module fingerprint 일치를
요구하며 임의 numeric state에서 counter를 추론하지 않는다. 향후 `Int`/counter 언어
표면은 UI 이름 관례에 의존하지 말고 이 계약을 명시 확장해야 한다.

## Join과 증거

공식 `observeSourceTrace` helper는 일치 module/safety format과 순서 있는 constraint
index/kind/names를 요구한다. 없는 field는 미관측이며 0/false 값을 만들지 않는다.
실제 field를 join하며 식을 다시 해석하거나 전기/기계 동작을 추론하지 않는다.
frontend binding/physical feedback은 별도 후속 gate다. companion이 `compileSource`에서
왔으면 source observation은 `sourceDocumentSha256`/`bytecodeSha256`을 유지해 downstream
navigation이 선택 revision identity를 조용히 버리지 못하게 한다.

acceptance에는 명시적인 first-pass/cascading violation, mutex/satisfied 사례,
source 위치, 정확한 native/WASM 동등성이 필요하다. source map unit test 통과만으로
runtime 관측 correctness를 확립할 수 없다.

## Interaction v0 완료 snapshot

`tools/interaction-runtime-snapshot.mjs`는 이미 완료된 runtime trace를
`GhostFlow/runtime-snapshot-v0`로 바꾸는 좁은 #72 adapter다. 정확한 canonical literate
compilation에서 schema를 다시 만들고 schema/module/source/run identity를 join하며
작성 Interaction descriptor ID로만 값을 emit한다. `observeRuntimeValues`로 내부 generated
timer 저장소를 해소할 수 있지만 generated slot 이름은 경계를 넘어 나가지 않는다.
없는 값은 명시 `unavailable`, 잘못된 observable state는 명시 `error`가 된다.
`stale`은 consumer-only expected-identity join 결과로 남는다.

adapter는 `tick`을 호출하거나 runtime을 변경하거나 command를 보내거나 output을 적용하지
않는다. native/WASM corpus test는 disabled/eager/delayed 관측 run을 비교해 이 성질을
문서상이 아니라 실행 가능하게 한다.
