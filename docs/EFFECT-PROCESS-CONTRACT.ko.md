<!-- translation-source: docs/EFFECT-PROCESS-CONTRACT.md -->
[English original](EFFECT-PROCESS-CONTRACT.md)

# Effect와 Process 계약

상태: [#116](https://github.com/callin2/ghostflow-language/issues/116)의 향후 도입용
개념 계약과 실행 가능한 테스트 내부 모델이다. 승인된 다섯 종류 GhostFlow
소스 union은 없다. 이 문서는 컴파일러, host effect 엔진, workflow scheduler,
전송 schema나 ABI를 구현하지 않는다. 문법이 필요하면 별도 제안이 필요하며
분류 방출과 typed request/result binding은 별도 버전의 소비자 도입 대상이다.

## 권위와 소유권

[Reference 2.8](reference/02-types-expressions-state.md)은 원자적 논리 결정을,
[4.7](reference/04-sensors-constraints-control.md)은 requested/safe/applied/confirmed
출력 증거 구분을, [5.3](reference/05-settings-and-observation.md)은 descriptor,
snapshot, event와 실행 결과 구분을 정의한다.
[interaction stream 계약](INTERACTION-STREAM-CONTRACT.ko.md)(#74)은 제안된
command 관찰 생명주기를 정의한다. [host 순서 계약](HOST-EVENT-ORDERING-CONTRACT.ko.md)
(#115)은 닫힌 ingress batch, commit과 이후 effect 결과를 정렬한다.
[Driver ABI 초안](DRIVER-ABI-V1-DRAFT.ko.md)(#117)은 가능한 물리 경계를 설명하며
여전히 초안이다. 여기의 구현이나 선행 조건이 아니다.

Process의 도메인 단계, 상태, timer, 취소 predicate와 제약은 작성된 GhostFlow
규칙으로 남으며 같은 Rust core가 여러 tick에 걸쳐 평가한다. host는 ingress,
binding, 외부 dispatch와 증거 export를 소유하며 그 단계를 실행하는 두 번째
JSON 프로그램을 소유하지 않는다. 생명주기 관찰은 선언된 도메인 증거를
보고하며 작성된 프로그램을 대체하는 별도 host 상태 기계를 구동할 수 없다.
이 계약을 명시하는 데 command/alarm descriptor 구현이나 frontend 기능은
필요하지 않다.

## 분류와 식별자

아래 이름은 개념 분류이며 소스 keyword나 기록 enum이 아니다. 모든 식별자는
정확한 source/module/artifact·binding 리비전, run과 자체 occurrence/attempt
위치를 포함한다. 결과는 원래 식별자를 보존하며 표시 이름·원시 값으로
서로 연결하지 않는다.

| 종류 | 의미와 요청 식별자 | 결과와 관찰 경계 |
| --- | --- | --- |
| DesiredState | commit scan/revision에서 선언된 논리 endpoint의 요청 목표; 반복된 같은 목표는 지속 의도 | requested/safe snapshot, 각 write attempt 결과와 별도 feedback; scan마다 새 일회성 command가 되지 않음 |
| Command | 명시적 request ID와 정본 typed-request digest를 가진 한 도메인 동작 | #74에 binding된 received/start/terminal 증거; Driver ACK만으로 도메인 완료나 물리 확인이 되지 않음 |
| Process | 작성된 상태/timer 결정으로 여러 tick에 걸친 하나의 요청; 같은 요청이 상관 식별의 root | started/progress/current-state 관찰과 terminal 도메인 증거; 진행은 새 요청이나 새 lifecycle 상태가 아님 |
| Message | 명시적 send 요청/digest, channel/binding과 별도 send-attempt 식별자 | queue/service 수락, delivery·실패 증거의 명시 범위 유지; 수락은 전달·읽기 증거가 아님 |
| Render | 정확한 source/schema/run/완료 scan 또는 event 위치와 projection 리비전의 읽기 전용 투영 | rendered/unavailable/stale 표시 결과; 제어 권한, command 완료, feedback이나 commit을 만들지 않음 |

명시적 binding이 종류별 증거와 #74 lifecycle mapping을 선택한다.
DesiredState write나 Render 결과에 보편적 lifecycle graph를 강제하지 않는다.
Message 완료는 선언된 범위만 의미한다. queue 수락 계약을 전달 완료 계약으로
표시하지 않는다. true Bool scan이 반복되어도 Command, Process나 Message를
암묵적으로 dispatch하지 않는다. 기본 edge detector, retry, 도메인 permission이나
전달 보장을 추론하지 않는다.

## 요청 수락, 중복과 한계

Command/Process와 명시적으로 식별된 Message 요청은 결과 전에 request ID,
typed-request digest, 분류와 정확한 문맥을 보존한다. 같은 ID/digest/context는
보존된 현재 상태나 명시적 duplicate 결과를 반환하며 다시 시작·전송하지
않는다. 같은 run 재연결이나 새 collection stream은 dedup을 지우지 않는다.
기존 식별자 아래 payload, 종류나 binding을 바꾸면 충돌하는 새 admission으로
거절하며 원래 요청의 lifecycle·digest를 바꾸지 않는다. 이 충돌은 이미 시작·
종결된 원래 요청의 후속 `rejected` event가 아니다.

dedup 항목, 활성 Process, 취소 요청, 결과 이력, payload와 effect attempt는
유한 profile 예산을 가진다. 외부 effect의 결과 증거를 포함해 start/dispatch
전에 용량을 예약한다. 부족하면 선언된 사유로 새 admission을 거절하며
활성·terminal dedup 식별자를 조용히 제거해 같은 동작을 두 번 시작하게
하지 않는다. admission 뒤 증거가 손실되면 명시적 gap/fault와 host의 fail-closed
정책을 유지하며 성공한 chain을 지어내지 않는다.

## Process 생명주기와 취소

#74로 mapping된 lifecycle 관찰은 정확히 다음을 사용한다.

```text
received -> rejected
received -> started -> completed | cancelled | failed
```

`received`는 결과보다 앞선다. 시작·완료에는 binding이 선언한 정확한 도메인
증거가 필요하다. 시작 전 실패는 `rejected`이며 `started`를 만들지 않는다.
거절·실패에는 선언된 사유 code와 비어 있지 않은 설명이 필수다.
`received`, `started`, `completed`는 사유를 금지하며 `cancelled`에는 선언된
사유가 가능하다. terminal에는 후속 상태가 없다. 현재 상태는 마지막 유효
기록의 투영이며 또 다른 occurrence가 아니다.

취소 요청은 자체 request/digest와 대상 식별자를 갖는다. 수신만으로 취소,
즉시 물리 OFF나 rollback이 증명되지 않는다. 내부 취소 대기 사실은 `started`와
함께 남을 수 있으며 새 exported lifecycle enum을 만들지 않는다. 도메인
정책이 시작 전 취소를 받아들이면 사유와 함께 `rejected`가 된다. 시작 후
`cancelled`에는 선언된 도메인 취소 증거가 필요하다. 거절·무효한 취소는
진행을 지우거나 terminal을 만들지 않는다.

완료·취소·실패 수신은 #115 직렬화 지점을 통과한다. 정확한 request/context의
유효 증거만 자격이 있다. 완전한 이력에서 그 순서의 첫 유효 terminal이
승리하며 후속 terminal 주장은 이를 다시 쓸 수 없다. 소스/도메인 규칙이
증거 자격과 취소 수락 여부를 결정한다. 이 순서 규칙은 완료·실패보다 취소를
우선하는 보편적 정책을 만들지 않는다.
같은 입력 snapshot의 stop/completion 신호 경쟁에는 작성된 규칙이나 명시적
binding 중재가 필요하다. 수신 순서가 도메인 결과를 선택하지 않으며 증거
자격이 확립된 뒤에 적용된다. binding이 없으면 결과를 추측하지 않고
admission을 거절한다. 이력 gap이 있으면 관찰 상태를
불완전으로 유지하며 빠진 시작/terminal event를 만들거나 완전성을 가정해
chain을 거절하지 않는다.

## Effect 실패와 재시작

dispatch는 성공 논리 commit 뒤에 온다. 외부 실패는 해당 commit과
requested/safe 의도 및 부분/불확실 effect 결과를 보존한다. 상관 결과는
명시적 typed binding을 통해 향후 허용 결정에만 영향을 준다. host/Device
중단 정책이 권위를 유지하며 자동 계속 실행·retry·restart는 없다.
Driver register/write 수락과 sensor 확인은 별도 증거다. 선언된 증거가 실제로
확립하지 않는 한 취소 완료는 물리 정지를 주장하지 않는다.

실제 재시작은 새 run 식별자를 사용한다. 과거 terminal은 종결 이력으로
유지하며 중단된 started Process는 실제 terminal 증거 없이는 불완전/unknown이다.
restart만으로 `failed`나 `cancelled`가 되지 않는다. 이전 현재 상태에서 effect,
Message send나 Process를 자동 복원하지 않는다. 명시적 follow-up에는 새 전체
request 식별자와 새 run의 admission 규칙이 필요하다. 늦은 과거 run/source/
binding feedback은 현재 실행에 stale이며 원래 식별자로 이력에 보존할 수
있다. 현재 commit, 진행이나 terminal 결과를 만들어서는 안 된다.

## Conformance 증거와 도입

`tests/effect-process-contract.test.mjs`는 가상의 제한 reference 모델이며
producer, scheduler나 Rust Process 실행의 대체물이 아니다. 식별자, 증거와
내부 취소 객체는 테스트 표기이며 승인된 serialization이 아니다.
명시적 fixture 증거는 작성된 도메인 결과를 대신한다.

| 사례 | 필수 oracle |
| --- | --- |
| 종류 경계 | 반복 DesiredState는 의도 유지; Command/Process/Message는 명시 요청 필수; Message 수락·Render 성공은 전달·물리 동작을 증명하지 않음 |
| 중복/충돌/한계 | 정확한 식별자당 한 start/send; 충돌은 원래 상태 보존; 용량 부족은 dedup 제거 없이 admission 거절 |
| 시작 전/후 취소 | 시작 전 거절은 사유 필수; 시작 후 대기는 도메인 증거 없이 terminal이 되지 않음 |
| Terminal 경쟁·실패 | 직렬화된 유효 완료/취소/실패에서 하나의 불변 terminal; 잘못된 증거·사유로 전이 생성 금지 |
| 재시작·stale 증거 | 복원·terminal 추론 금지; 명시적 새 식별자 필요; 이전 문맥으로 새 run 변경 금지 |

도입은 typed binding, 증거 범위, 직렬화 수신 순서, 제한 보존과 각 host의
실패/재시작 정책을 명시하고 실제 producer로 oracle을 검증해야 한다.
이 테스트는 계약 동작만 확립하며 배포, 전달, Driver나 물리 conformance를
확립하지 않는다.
