<!-- translation-source: docs/BOOLEAN-OUTPUT-EXPLANATION.md -->
[English source](BOOLEAN-OUTPUT-EXPLANATION.md)

# Boolean 요청 출력 설명

이 계약은 [issue283](https://github.com/callin2/ghostflow-language/issues/283)의
제한된 인수 범위이며 [issue88](https://github.com/callin2/ghostflow-language/issues/88)의
일부다. Reference 5.3의 실제 평가 경로 지원 계약에 따라 하나의 완료된 scan의
요청 Boolean 결과를 설명한다. safe, applied, 물리적 confirmed 출력이 같은 값이라고
주장하지 않는다.

## 컴파일 artifact와 실행

canonical 컴파일은 바뀌지 않은 GFB bytes 옆에 `explanationArtifact`를 생성한다.
sidecar는 source와 bytecode SHA-256, 불투명 semantic node ID, 기존 source node/span과
intent link, 컴파일러와 같은 typed IR 및 byte writer의 instruction 완료 지점을 연결한다.
branch 내부 지점은 삽입 시 위치를 보정한다. AND/OR는 실제 각 경로의 완료 지점을 가지며
short-circuit용 암묵 literal은 source child가 아니다. 공유 semantic node는 descriptor
하나를 유지하고 parent/output별 실행 occurrence를 구별한다.

`Runtime::enable_instruction_witnesses()`는 새 run 전에 선택적 수집을 켠다.
framed WASM의 `enableInstructionWitnesses()`를 `load()`와 `activate()` 사이에서
호출한다. native 테스트 runner는 마지막 `--instruction-witnesses` 인수를 받는다.
VM은 실행 후 실제 instruction 시작, 순차 끝, 다음 PC와 stack 결과를 기록한다.
생략된 표현식 끝에 도착한 것만으로 평가 증거가 되지 않는다. 새로운 표현식 opcode나
별도 평가 엔진은 없다. 일반 실행에서는 수집이 꺼져 있다.

scan이 완료되어야 증거가 TickRecord에 붙는다. 실패한 평가의 부분 기록은 폐기된다.
거부된 framed 시도는 이전 outcome을 history로 유지하지만 `accepted=false`여서 새 proof를
만들지 못한다. install은 수집 설정을 초기화한다. 관찰은 tick하거나 live state를 읽거나
생략된 branch를 평가하지 않는다.

## 공개 projection과 join

```js
import { prepareOutputExplanation, joinOutputExplanation } from '../tools/toolchain.mjs';
const producer = prepareOutputExplanation({ compilation, runId });
const proof = producer.emit({ runId, result: { accepted: true, outcome }, outputId: 'output.pump' });
const join = joinOutputExplanation(compilation.interactionSchema, proof, snapshot, producer.expected, producer.descriptor, { accepted: true, outcome });
```

준비 단계는 canonical source를 재컴파일하여 모든 mapping과 bound를 검증하고 immutable
artifact를 소유한다. 공개 `evaluations`는 semantic node와 실행 occurrence를 함께 식별한다.
`evaluated`, 실제 `value`, `status`, output 경로의 `supportsResult`는 별개다.
생략된 occurrence는 unavailable이며 실제 값과 support가 없다. 다른 output이 같은
semantic node를 평가했어도 이 규칙은 같다. `edges`는 parent별 support를 가진다.

AND와 OR는 parent의 Boolean 값과 같은 실제 평가 child를 지원 경로로 연결한다.
NOT은 평가된 operand를 연결한다. predicate와 수치 연산은 0을 포함한 실제 operand를
유지한다. conditional은 평가된 조건과 선택 arm을 유지한다. output 경로 support는
root에서 지원 edge만 따라간다. 이는 구조적 proof이며 반사실적 인과 주장과 다르다.
runtime fault는 scan을 거부하며 false나 완료된 error proof로 바뀌지 않는다. 수집 비활성화와
미지원 kind는 실제 요청 출력의 false 값과 별개인 명시적 unavailable 결과다.

proof는 Interaction schema/module/source/run identity와 완료 scan/time을 재사용한다.
소비자는 출력 snapshot 및 예상 run과 join한다. 이전 run의 scan zero는 stale이다.
소비자 경계도 accepted 출력 sample을 요구한다. Language library가 실제 instruction
witness와 전체 proof payload가 일치하는지 검사한다.
producer는 새 framed run(`trace.tick = scanId + 1`)과 accepted outcome만 받는다.
신뢰된 host adapter가 run epoch와 scan logical time을 제공한다. 임의의 JSON을 인증하거나
과거 outcome의 identity를 바꿀 권한을 주는 계약은 아니다. run 재시작 시 producer를 폐기한다.

## bound와 남은 범위

sidecar는 semantic/occurrence node 최대 512개, edge 1024개, 깊이 64를 허용한다.
미지원 또는 초과 output은 명시적으로 unavailable이다. runtime 수집은 strategy별 intent
표현식 byte 길이 합이 8192 이하여야 한다. 이는 instruction 수의 보수적 상한이며 초과 시
실행 전에 활성화를 거부한다. scan마다 그 이하의 instruction record 공간을 예약하고 기존
journal capacity가 보존 상한을 정한다. 선택적 진단 모드는 MCU 배포 profile이 아니다.
꺼진 모드는 instruction record를 할당하지 않는다. host는 수집용 journal 메모리를 확보한다.

Bool literal/state snapshot, NOT, AND, OR, predicate, 산술/변환, conditional을 지원한다.
candidate state는 관찰된 scalar이며 transition 설명은 아니다. timer, schedule, composition,
safety, Result/recovery, transition proof는 명시적으로 미지원이다. 품질이 있는 공개 input의
Result proof를 꾸며내지 않는다. 관련 통합, 더 풍부한 provenance, 전체 공개 package/host
lifecycle 작업을 위해 issue88은 열린 상태를 유지한다.

feature catalog의 정확한 native/WASM 인수 selector는 `tests/explanation-path.test.mjs`의
`REF-05-023 native/WASM requested OFF explanation keeps the false left support and the skipped faulting right unevaluated`다.
canonical fixture는 `tests/fixtures/explanation-short-circuit.ghost.md`다. 0인 divisor를
state로 두어 컴파일러는 이를 허용하고 실제 VM이 평가 여부를 결정하게 한다.
