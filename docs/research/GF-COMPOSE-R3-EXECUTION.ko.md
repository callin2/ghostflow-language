<!-- translation-source: docs/research/GF-COMPOSE-R3-EXECUTION.md -->
[영어 원문](GF-COMPOSE-R3-EXECUTION.md)

# GF-COMPOSE R3: 실행 조합

## 사용자 문제

동작 추가가 숨은 순서, 공유 상태, 시계, fault 처리로 기존 동작을 바꿔서는 안 된다.
설계는 노력 감소, 설명 가능성, 추적 가능성 목표를 보존해야 한다. 이 문서는 하나의
실행 module로 compiler가 조합하는 방식과 명시적으로 조정하는 여러 VM instance라는
두 선택지만 비교한다.

## 조사한 revision의 증거

조사한 언어 revision은 `ffdbc96461eca67908252507fb851fa4dabd9a2c`다. 이 문서 작성 전에
working tree를 변경하지 않았다. `compileSource`는 하나의 canonical `.ghost.md`를 받고
`compileControl`을 거쳐 lowering하며 하나의 GFB1 byte sequence를 내보내고 source/bytecode
digest와 trace metadata를 기록한다([`tools/compile-source.mjs`](../../tools/compile-source.mjs)).
`compileControl`은 하나의 control을 하나의 GFB1 `module`로 lowering한다. 현재 상태에서
state transition을 평가한 뒤 intent가 `next.*`를 읽을 수 있다
([`tools/control.mjs`](../../tools/control.mjs)).

`Runtime::tick`은 선언된 모든 입력을 요구하고 선택적인 명시적 `__gf_now_ms`를 검증한다.
intent 전에 모든 next state를 계산하고 safety를 적용하며 state와 safe intent를 atomic하게
commit한다. 입력을 지우고 상한이 있는 journal record를 추가한다. `tick_at`이 명시적
clock을 공급한다. VM은 wall clock을 읽지 않는다
([`crates/ghostflow-core/src/lib.rs`](../../crates/ghostflow-core/src/lib.rs)).
`install`은 입력, safe intent, active strategy, clock을 reset한다. 같은 이름/타입의 state는
보존할 수 있다. `hot_swap`은 호환되는 named state를 보존하지만 safe intent를 지우고
module 이름이나 state 타입 변경을 거부한다.

이 사실은 core tick과 framed complete-frame adapter를 설명한다. 비동기 CEP ingress나
occurrence 전달을 명세하지 않는다. occurrence는 개별 의미를 유지해야 한다. 값 관측은
interrupt/scan 포착과 독립적이다. 기본적으로 지원 용량 안에서 관측을 보존한다. 입력별
명시 opt-in일 때만 latest-pending-value 교체를 허용한다. loss/overflow는 거부하거나
보고해야 하며 조용히 허용해서는 안 된다. 이 합의된 전달 요구사항은 무제한 영속 history를
뜻하지 않는다. ingress 순서, event-to-tick 대응, declared-source batching, 상한, 복구는
미해결이다. hard deadline이나 priority scheduler는 제공되지 않았다.
[`LANGUAGE-SURFACE.md`](../LANGUAGE-SURFACE.md)와 [`IMPLEMENTATION.md`](../IMPLEMENTATION.md) 참조.

framed host는 하나의 완전한 input frame을 포착하고 한 번 dispatch하며 마지막 승인 결과를
게시한다. conditioning이나 dispatch 실패 후 fault를 latch한다. 이후 step에는 새 host
instance가 필요하다. conditioning 전 거부된 검증은 다시 시도할 수 있다
([`docs/FRAMED-CONTROL-HOST.md`](../FRAMED-CONTROL-HOST.md)). 따라서 “마지막 완료 결과”와
“새 run”은 기존 host 계약 사실이다.

station module은 host-driven이며 상한이 있다. `prepare_start_batch`는 같은 tick snapshot에서
하나의 요청을 고른다. `authorize_output`은 durable reservation, owner/session, valve 상한,
safe output을 검사한다([`crates/ghostflow-core/src/station.rs`](../../crates/ghostflow-core/src/station.rs)).
이는 물리 pump-station arbiter이며 범용 동작 조합의 증거가 아니다. GFB1 상한에는 입력 128개,
상태 128개, strategy 32개, constraint 128개, 식 깊이/node 128/4096과 상한이 있는 식/query
크기가 포함된다([`tools/gfb1.mjs`](../../tools/gfb1.mjs)).

[R2: 권한과 identity](GF-COMPOSE-R2-AUTHORITY-IDENTITY.md)에서 설명했듯 source/instance 구분은
canonical source의 권위를 유지한다. instance에는 격리된 상태/provenance와 불투명 identity가
필요하다. R2는 대화 memory가 provenance/작성 문맥이며 자동 실행 규칙 또는 physical binding
권한이 아니라는 것도 확정한다. memory-to-decision-to-source 연결, retention, tombstone 동작은
R2/API-system 질문으로 남는다. 설치 constraint 경계도 미해결이다. 이 문서는 constraint
artifact, overlay, enforcement 소유자를 선택하지 않는다. 관련 호환성/증거 제안은
[R5: 조합 계약과 진단](GF-COMPOSE-R5-CONTRACTS.md)도 참조한다.

## 표와 예

### 선택지 비교

| 선택지 | Input sampling | Clock | 이전/다음 상태 가시성 | Reset/fault 범위 | 출력 해소 | Provenance | 기존 상한 | 새 mechanism |
|---|---|---|---|---|---|---|---|---|
| 하나의 실행 module로 compiler 조합 *(제안)* | Complete-frame tick 동작은 있음. 비동기 occurrence/value ingress는 미명세. 공유 이름은 한정 필요 | tick마다 하나의 제공된 logical clock | 모든 전이는 같은 입력/이전 상태 snapshot을 읽음. next 참조는 출력 식에만 있고 다른 next transition이나 let에는 없음 | 하나의 module/runtime 경계. 실패가 조합 scan에 영향 | 하나의 requested-intent bank에 한 safety pass. 중복 권위 출력 정의는 compile error이며 last-writer 정책이 아님 | 하나의 module fingerprint/source closure. R2가 instance 한정 trace 제안 | 합산된 input/state/strategy/constraint budget 하나 | Import/한정 lowering, dependency 검증, ingress 대응, ABI trace 표현 |
| 명시적 조정이 있는 여러 VM instance *(제안)* | 각 instance ingress는 명시된 전달 규칙으로 occurrence/value 관측 보존 필요. complete-frame snapshot adapter는 batching/순서를 결정하지 않음 | Coordinator가 각 clock 제공. 공유 clock 정책은 명시 필요 | 각 instance가 이전/다음 격리 유지. instance 간 wiring은 next 참조를 재정의하지 못함. 미지원 공유는 compile error | Instance별 VM fault와 coordinator/fan-out 정책. framed failure 경계 정의 필요 | 중복 직접 작성자는 계속 compile error. 명시적으로 모델링한 station 요청만 기존 station arbitration 사용 가능 | Instance별 module fingerprint와 instance/run/scan join | module별 상한 적용. coordinator/전체 자원 상한은 미명세 | Coordinator, ingress-to-tick 대응, 순서 독립 join, 해당될 때 station 통합 |

### 격리된 instance: east와 west

다음은 수작업 예이며 실행 증거가 아니다. 두 instance는 같은 정의를 사용한다. 각각 독립
`running` 상태와 `pump` 출력을 가진다. scan 1에서 `start`는 east에만 true다. `t`는 똑같이 제공된다.

| Scan/read 시점 | Instance | 입력 | 이전 상태 | 이후 상태 | Requested / safe output | 읽기 시점 |
|---|---|---|---|---|---|---|
| 1, 같은 complete frame | east | `start=true`, `t=1000` | `running=false` | `running=true` | `pump=true` / `pump=true` | east 입력과 east 이전 상태 읽음 |
| 1, 같은 complete frame | west | `start=false`, `t=1000` | `running=false` | `running=false` | `pump=false` / `pump=false` | west 입력과 west 이전 상태 읽음 |
| 2, 같은 complete frame | east | `start=false`, `t=2000` | `running=true` | `running=true` | `pump=true` / `pump=true` | east의 이전 committed state 읽음 |
| 2, 같은 complete frame | west | `start=false`, `t=2000` | `running=false` | `running=false` | `pump=false` / `pump=false` | west의 이전 committed state 읽음 |

불변조건: east 시작은 west를 시작하지 않는다. 이는 조합 실행 계약의 제안이며 현재
multi-instance ABI 사실이 아니다.

### 선언 순서를 반대로 바꿔도 identity 불변

수작업 제안이다. 같은 east/west instance ID, 입력, frame을 사용한다. 선언 순서만 바뀐다.
“Trace”는 array 위치가 아니라 identity를 key로 하는 sequence다.

| 선언 순서 | Instance | 입력 | 이전 → 이후 상태 | Requested / safe | 읽기 시점 |
|---|---|---|---|---|---|
| east, west | east | `start=true` | `false → true` | `true / true` | frame 1, 이전 east 상태 |
| east, west | west | `start=false` | `false → false` | `false / false` | frame 1, 이전 west 상태 |
| west, east | east | `start=true` | `false → true` | `true / true` | frame 1, 이전 east 상태 |
| west, east | west | `start=false` | `false → false` | `false / false` | frame 1, 이전 west 상태 |

identity를 key로 하는 trace는 같다. 선언 순서 변경이 암묵 scheduler가 되어서는 안 된다.
wired dependency를 바꾸는 것이 동등하다는 뜻은 아니다.

### 다른 결과를 소비하는 동작

별도로 조정하는 한 쌍에 대한 수작업 가상 의미이며 atomic composed-module tick이 아니다.
`producer.ok`는 east 결과다. `consumer`는 `valve=producer.ok`를 요청하고 초기 상태는
`running=false`다. 현재 compiler에는 cross-module result 참조나 lowering 규칙이 없으므로
표가 read phase를 명시한다. “Step” label은 scenario 순서이며 native instance별 scan ID가
아니다. 1행에서 consumer 거부와 함께 보인 가상 producer 진행은 partial-progress 정책을
채택하지 않는다. 그 step에는 완전한 composed result가 없다.

| Scenario step | 입력 | 이전 → 이후 상태 | Requested / safe output | 읽기 시점 |
|---|---|---|---|---|
| 1 | producer 입력 `sensor=1`; consumer의 나머지 입력은 완전함 | producer `false→true`; 필요한 producer 값이 없으므로 consumer에는 유효한 평가 없음 | producer `ok=true`; consumer에는 requested/safe 결과 없음 | Consumer가 same-scan producer 결과를 읽지 않음. 없는 dependency를 false로 대체하지 않음 |
| 2 | producer 입력 `sensor=0`; consumer frame 완전함 | producer `true→false`; consumer `false→true` | producer `ok=false`; consumer `valve=true / true` | Consumer가 producer의 마지막 완료 scan-1 결과 읽음 |

이 가상 비교는 실행 가능한 현재 동작을 설명하지 않는다. compiler/runtime에는 cross-module
value 참조가 없다. 필수 값 부재는 유효한 평가 없음이지 만들어 낸 fallback이 아니다.
same-scan instance 간 wiring은 다른 instance의 `next` 값을 사용할 수 있게 하거나 next 참조
규칙을 재정의하지 못한다. 미지원 instance 간 공유는 compile error다. 예는 지원되는
completed-scan 경계의 값을 대비한다. FIFO ingress, same-scan lowering, scheduler를 채택하지 않는다.

### 거부되는 cycle과 reset/failure

거부되는 cycle *(수작업 invalid dependency. dependency 표기이며 source 문법 아님)*:
`east.pump[n] <- west.pump[n]` 및 `west.pump[n] <- east.pump[n]`. `n`은 같은 scan을 식별한다.
east 결과는 west 결과를 요구하고 west 결과는 east 결과를 요구한다. 이 두 edge가 cycle을
닫는다. dependency 순서로 어느 결과도 먼저 평가할 수 없다. 실행 전에 이 순간 cycle을
거부한다. 순간 expression cycle과 중복 output 정의는 invalid compiler 입력이며 열린 정책
질문이 아니다.

대신 committed prior-scan state를 읽으면 scan `n` 전에 고정된 값을 사용한다. dependency
하나를 그런 읽기로 교체하면 이 same-scan cycle을 끊는다. 현재 VM은 next state commit 전에
이전 상태에서 transition을 평가한다. 이 구분이 새 cross-instance read나 초기값 의미를
정의하지는 않는다.

Reset/failure *(계약으로 제한됨)*: 성공한 frame 후 framed host는 마지막 완료 결과를 노출한다.
conditioning이나 VM dispatch가 실패하면 그 committed result는 계속 이용 가능하다. host가
fault를 latch하고 다음 step에는 새 host instance가 필요하다. 새 run은 새 `runId`를 사용해야
한다. 새 run의 `scanId=0`은 이전 occurrence가 아니다. 조합은 이 경계를 보존해야 한다.
한 instance를 부분 reset하면서 composed result를 완전한 것으로 제시해서는 안 된다.
정확한 multi-instance fault fan-out은 미해결이다.

## 권고

정적 compiler 조합은 선호 가설이며 선택된 lowering이나 ABI가 아니다. 기존 tick 불변조건을
보존해야 한다. 모든 transition은 같은 입력/이전 상태 snapshot을 읽는다. next 참조는 output
expression에만 합법적이며 다른 next transition이나 let에는 허용되지 않는다. 논리 state와
output commit은 동시다. cycle과 중복 output 정의를 거부한다. 각 출력 채널에는 하나의
권위 있는 정의가 있다. 경쟁하는 직접 작성자는 컴파일에 실패하며 배포할 수 없다.
이는 명시적 station 단일 작성자 자원 arbitration을 없애지 않는다. station 요청은 경쟁하는
직접 쓰기가 아니다. 조합은 next 참조 의미를 바꾸는 same-scan instance 간 wiring을 승인하지
않는다. complete-frame scheduling이 event ingress, 순서, batching, overflow를 결정하지 않는다.

station 재사용을 일반화하지 않는다. same-tick 선택과 durable output 권한 검사는 동작 결과가
생긴 뒤 공유 pump를 중재할 수 있지만 pump/valve 정책은 범용 composition resolver가 아니다.
더 넓은 arbitration/fallback 의미는 #95의 책임으로 남는다.

## 미해결 질문과 소유자

- Language compiler 소유자: composition이 imported control을 하나의 GFB1 module로 lowering하는지,
  name, state, input, output, source map을 어떻게 한정하는지 정의. 위 이전/다음 및 cycle
  규칙 보존. 열린 의미 선택으로 취급하지 않음.
- Language/runtime ABI 소유자: composed manifest, instance 한정 trace field, result 가시성,
  하나의 TickRecord가 계속 canonical인지 정의. 현재 ABI field에는 cross-instance result 정의 없음.
- Language/runtime 소유자: ingress 순서, event-to-tick 대응, declared-source batching, 용량,
  clock 대응 정의. core tick/framed host는 비동기 ingress를 결정하지 않음. deadline/priority
  scheduler를 가정하지 않음.
- Language/runtime 소유자: 중복 직접 output 정의가 compile error라는 불변조건을 유지하면서
  composed safety 적용 정의. station resource arbitration은 별도로 지원되는 개념 유지.
- API/deployment 소유자와 R2 소유자: 미해결 설치 constraint 경계 보존. 조합이 별도 constraint
  컴파일과 명시적 프로젝트 간 경계 revision의 선택을 해결한다고 추론하지 않음.
- API/시스템 운영 memory 소유자: memory 검색/LLM 해석을 runtime 입력 밖에 유지. R2가 lineage,
  retention/tombstone, decision 연결을 소유. 이 실행 문서는 해당 lifecycle을 정의하지 않음.
- #95/station 소유자: 공유 물리 자원과 동작 결과의 상호작용 결정. 기존 station 정책을 범용으로
  취급해서는 안 됨.
- Framed-host 소유자: composed fault fan-out, 마지막 완료 결과 게시, 새 run 동작 정의.
  현재 framed 문서는 하나의 host instance를 명세하며 composed graph를 명세하지 않음.

## 검증

- [x] 조사한 revision 기록: `ffdbc96461eca67908252507fb851fa4dabd9a2c`.
- [x] 요구된 모든 column에서 정확히 두 선택지를 비교. 현재 사실과 제안 구분.
- [x] 수작업 scan 표 세 개에 입력, 이전 상태, 이후 상태, requested/safe output, read 시점 포함.
  격리와 선언 순서 불변조건 명시.
- [x] Same-scan cycle과 reset/failure 사례 포함. framed last-result/new-run 경계 보존.
- [x] 현재 상한, station 재사용 경계, 정확한 미답 lowering/ABI 질문 명시. scheduler/ABI 도입 없음.
- [x] 예에 수작업 표시. runtime 실행 주장 없음.
- [x] 문서만의 task 요구대로 runtime test suite 미실행. coordinator는 `git diff --check`와
  상대 link를 검사해야 함.
