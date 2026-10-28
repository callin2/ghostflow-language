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
artifact를 소유한다. 이 program provenance replay는 이미 승인된 compact-profile source를
외부 hardware profile 없이도 받는다. 정확한 bytes에서 sidecar와 source metadata를
재구성하며 hardware installation을 승인하지 않는다. 공개 컴파일은 계속 고정된 profile을
요구한다. 공개 `evaluations`는 semantic node와 실행 occurrence를 함께 식별한다.
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

## 합성 제어와 settings owner

`TemporarySettingsHost.instantiate(wasm, compilation, { runId, grants, context,
outputExplanations: true })`는 framed 활성화 전에 수집을 켠다. 기본값은 수집하지 않는다.
legacy host, 없는 Interaction Schema, 미지원 WASM witness ABI, 수집 budget 초과는
run 시작 전에 opt-in을 거부한다. proof projection을 직접 소유하는 host는
`ControlRuntime.instantiateFramed`의 `instructionWitnesses: true`를 사용할 수 있다.

settings owner는 scan과 settings event를 commit한 뒤 실제 accepted `outcome.vm`과
`outcome.frame`을 projection한다. 반환한 `result.explanation`에는 `proofs`와 `error`가
있다. 같은 result를 `joinOutputExplanation`에 전달한다. 보존된 outcome을 새 wrapper로
감쌀 필요가 없다. `explanationSnapshot()`은 최신 projection의 소유권이 분리된 복사본을,
`explanationDescriptor`는 검증된 compiler descriptor의 복사본을 반환한다.
조회는 runtime을 tick하지 않는다.

합성 Bool 상태식은 기존 실제 평가 경로 규칙을 유지한다. 상태 label은 `east.running`,
`west.running`처럼 작성된 instance 경로를 사용한다. 컴파일러는 source map의 `instance`와
`definitionNodeId`에서 canonical closure의 선언으로 경로를 연결한다. 생성된 storage 이름을
해독하지 않는다. 상태 source에는 instance, 확장 node ID, 원래 definition node ID,
import filename, revision, SHA-256, 선언 span이 있다. 같은 import 정의도 instance별
증거를 구별한다. compound 식과 literal의 정확한 import 식 span이 없으면 명시적인
`output-connection` source role을 유지한다. 이 role은 root 출력 연결을 가리키며
import 식의 span을 주장하지 않는다.
각 합성 occurrence와 evaluation은 자신의 source record를 유지한다. 같은 literal이
semantic node를 공유해도 다른 출력의 provenance를 빌리지 않는다.

proof는 snapshot과 정확히 같은 composition 및 commit된 `settingsRevision`을 갖는다.
producer는 host의 run, 완료 정보, 보존된 commit outcome, Rust settings revision 관찰을
검증한다. 소비자는 다른 closure, run, 완료 scan, settings revision, instruction 경로를
거부한다. scan을 시도하면 admission 전에 최신 설명을 비운다. runtime이 이전 완료
outcome을 보존해도 실패한 시도에 새 proof를 붙이지 않는다. commit 후 projection이
실패하면 빈 proof 목록과 `completed-scan-explanation-failed`를 반환하고 제어 결과는
accepted를 유지한다. commit된 settings event를 재시도할 수 없다. 다음 성공한 scan은
새 설명을 공개할 수 있다.

`tests/composed-explanation.test.mjs`는 실제 WASM settings owner에서 서로 다른 값을 가진
east/west 상태, short-circuit 생략, settings 변경, identity 거부, 호출자 mutation,
commit 후 실패를 검증한다.

## bound와 남은 범위

sidecar는 semantic/occurrence node 최대 512개, edge 1024개, 깊이 64를 허용한다.
미지원 또는 초과 output은 명시적으로 unavailable이다. runtime 수집은 strategy별 intent
표현식 byte 길이 합이 8192 이하여야 한다. 이는 instruction 수의 보수적 상한이며 초과 시
실행 전에 활성화를 거부한다. scan마다 그 이하의 instruction record 공간을 예약하고 기존
journal capacity가 보존 상한을 정한다. 선택적 진단 모드는 MCU 배포 profile이 아니다.
꺼진 모드는 instruction record를 할당하지 않는다. host는 수집용 journal 메모리를 확보한다.

Bool literal/state snapshot, NOT, AND, OR, predicate, 산술/변환, conditional을 지원한다.
candidate state는 관찰된 scalar이며 transition 설명은 아니다. timer, schedule,
safety, Result/recovery, transition proof는 명시적으로 미지원이다. 품질이 있는 공개 input의
Result proof를 꾸며내지 않는다. 관련 통합, 더 풍부한 provenance, 전체 공개 package/host
lifecycle 작업을 위해 issue88은 열린 상태를 유지한다. 생성된 rail에 의존하는 합성 config와
timer 식은 계속 명시적으로 unavailable이다.
[Issue290](https://github.com/callin2/ghostflow-language/issues/290)과
[issue302](https://github.com/callin2/ghostflow-language/issues/302)는 installation/binding
identity와 더 넓은 합성 식 profile을 다룬다.

feature catalog의 정확한 native/WASM 인수 selector는 `tests/explanation-path.test.mjs`의
`REF-05-023 native/WASM requested OFF explanation keeps the false left support and the skipped faulting right unevaluated`다.
canonical fixture는 `tests/fixtures/explanation-short-circuit.ghost.md`다. 0인 divisor를
state로 두어 컴파일러는 이를 허용하고 실제 VM이 평가 여부를 결정하게 한다.
