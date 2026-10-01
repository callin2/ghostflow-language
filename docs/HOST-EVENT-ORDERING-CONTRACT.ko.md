<!-- translation-source: docs/HOST-EVENT-ORDERING-CONTRACT.md -->
[English original](HOST-EVENT-ORDERING-CONTRACT.md)

# Host 이벤트 순서 계약

상태: [#115](https://github.com/callin2/ghostflow-language/issues/115)의 계약과 실행 가능한 conformance **모델**.
아래 ingress queue와 경계 규칙은 향후 host 도입이 필요하다. 이 변경은
제품 이벤트 엔진, 소스 문법, descriptor binding, firmware 정책, 전송 schema나
ABI를 추가하지 않는다. command/alarm descriptor 구현이나 특정 frontend에
의존하지 않는다.

## 권위와 현재 구현

[Reference 2.8](reference/02-types-expressions-state.md)은 tick의 불변 입력
snapshot과 원자적 논리 상태/출력 commit을 정의한다.
[Reference 4.7](reference/04-sensors-constraints-control.md)은 requested, safe,
applied, confirmed 증거를 구분한다. [Reference 5.3](reference/05-settings-and-observation.md)과
[interaction stream 설계](INTERACTION-STREAM-CONTRACT.ko.md)는 완료 snapshot,
순서 있는 이벤트와 command 결과를 구별한다. 이 문서는 host 수신과 scan
경계의 순서를 정하며 해당 생명주기를 다시 정의하지 않는다.

현재 `runtimes/wasm/framed-runtime.mjs`는 동기 dispatch 전에 완전한 typed
frame을 캡처한다. `crates/ghostflow-core/src/scan.rs`는 scan 식별자와 시간을
검증하며 실패한 scan은 성공 scan 식별자/시간을 전진시키지 않는다.
`crates/ghostflow-core/src/lib.rs`는 성공 논리 결과 commit 전에 후보 상태와
의도를 계산한다. `runtimes/wasm/control-runtime.mjs`는 준비/precommit rollback과
postcommit adapter 실패를 구분한다. 이 인터페이스는 공통 외부 수신 queue,
batch latch나 이벤트 동률 규칙을 구현하지 **않는다**. 기존 테스트는
core/adapter 증거이며 새 ingress 계약이 이미 배포되었다는 증거가 아니다.

[물리 순서](LLM-TOOLCHAIN-ARCHITECTURE.md#physical-driver-and-device-boundary)는
Device 출력 실패 시 논리 commit을 되돌리지 않고 중단함을 문서화한다.
여기서는 Device firmware 리비전을 검사하지 않았다. 이 계약은 해당 정책을
대체하거나 물리 동작이 검증되었다고 주장하지 않는다.

## Run 안의 수신 순서와 batch 경계

하나의 host 직렬화 지점은 받아들인 수신마다 연속적이며 재사용하지 않는
run 내부 `receiptSequence`를 부여한다. host가 책임을 받아들이는 시점에,
관찰자 호출 전에 부여한다. wall/monotonic timestamp가 같아도 별도 수신이며
sequence가 동률을 해소한다. producer 이벤트 시간, sequence와 source epoch는
각자의 증거를 유지한다. 더 이른 producer timestamp가 늦게 도착해도 이미
닫은 batch로 옮기지 않는다. 독립 producer 사이에는 host 수신 외의 전역
인과 순서를 추론하지 않는다.

scan 경계에서 host는 이전 latch 뒤에 받아들인 가장 큰 연속 prefix를
원자적으로 latch한다. 적절한 경우 빈 prefix도 가능하다. 별도 attempt/boundary
식별자, 정확한 source/module/binding/run 식별자, 수신 범위와 scan/time 후보를
기록한 뒤 불변 batch를 닫는다. 수신 하나가 두 batch에 걸칠 수 없다.
latch 뒤, 평가·논리 commit·effect dispatch·관찰 hook 도중의 도착은 나중
batch에 속한다. 재진입 callback도 같은 직렬화 지점을 사용하며 현재 batch를
변경하거나 같은 instance의 평가를 겹쳐 시작할 수 없다.

이는 수신 순서이며 보편적 reducer가 아니다. 선언된 입력/event binding마다
검증, 중복 처리, protocol 순서와 snapshot projection을 정의한다. 이름이나
Bool 값에서 last-value-wins, command 우선순위, alarm 의미나 물리 ACK를
추론하지 않는다. 소스의 ordered event protocol은 해당 binding 안에서 권위를
유지하며 충돌·누락 증거는 명시적으로 진단한다. 저장·payload 한계는 유한하고
host profile이 선택한다. overflow는 수신을 받아들이기 전에 admission을
거절하며 이미 받은 수신을 버리거나 재번호화하지 않는다. 수신 후 손실에는
명시적 gap/fault 증거가 필요하다.

## 필수 순서

| 순서 | 경계 | 필수 결과 |
| --- | --- | --- |
| 1 | 수신 수락 | 식별자를 직렬화하고 원본 증거 보존; 열린 queue에 대해 평가하지 않음 |
| 2 | batch latch·닫기 | 연속 수신 prefix와 완전한 typed frame, 시계·이전 상태 문맥을 동결 |
| 3 | 검증·평가 | 단일 snapshot에서 core 소유의 next state, requested 의도와 제약 후 safe 의도 계산 |
| 4 | 논리 결과 | 성공은 논리 상태/결과를 함께 commit; 실패는 완료 snapshot·새 effect 없이 실패 attempt 기록 |
| 5 | commit 증거 캡처 | hook이나 물리 dispatch 전에 완료/출력 의도를 실제 commit scan에 연결 |
| 6 | 외부 effect dispatch | 기존 Driver/profile 정책으로 commit된 safe 의도 전달; 부분 물리 적용 가능성 유지 |
| 7 | effect 결과 수신 | 실제 성공/실패/불확실성을 별도 상관 수신으로 기록; 향후 허용 경계에서만 admission |
| 8 | 다음 허용 결정 | 명시적 typed binding이 새 수신을 사용 가능; 원래 결정의 소급 변경 금지 |

1·7단계는 직렬화 경계 사이에 비동기로 일어날 수 있다. commit 증거 캡처는
hook보다 앞서지만 네트워크 export가 물리 dispatch보다 먼저 끝날 필요는 없다.
export 오류는 commit을 되돌리거나 관찰하지 않은 effect를 만들어서는 안 된다.
batch 소속·event sequence는 완료 scan 식별자와 interaction stream이 별도로
부여하는 occurrence sequence와 구별한다.

## 실패, 상관 식별과 안전

평가/검증 실패는 이전 commit 논리 상태를 보존하며 실패 후보에서 새 effect를
발행하지 않는다. 실패 batch, 수신 소속, attempt 식별자와 사유를 실패 증거로
유지한다. 수신 소속은 command 성공 처리나 완료 scan이 아니다. host는 실패
batch를 명시적으로 종결하거나 재시도 정책에 따라 같은 불변 batch를
재시도한다. 비멱등 요청을 조용히 재실행하거나 재시도에 새 도착을 합치지
않는다. 이후 수신은 queue에 남는다. 현재 core가 같은 scan ID/time 재시도를
지원한다는 사실만으로 요청 재시도가 허용되지는 않는다.

effect 결과는 원래 commit scan, run, 정확한 source/module/binding과
effect/attempt 식별자를 가리킨다. 여러 effect와 재시도는 별도 식별자가
필요하며 재시도로 두 번째 원래 commit을 만들어서는 안 된다. Driver 수락
기록은 명시된 register/write 수락만 증명하며 relay 이동이나 물리 확인을
증명하지 않는다. 적용 실패/불확실성은 원래 논리 상태를 rollback하거나
safe/requested 의도를 과거의 false 값으로 바꾸지 않는다. 부분 적용과 각 결과
사유를 보존하며 feedback이 없으면 unknown이다.

늦게 도착한 수신이 queue를 채워 effect 결과를 받아들이지 못하면 원래 commit과
별도의 결과/admission 실패 증거를 보존하며, 수락된 receipt sequence를 만들어
내지 않는다. 모델은 이 기록 경로 오류에서 중단한다. 실제 채택은 fail-closed
정책을 정해야 하며 결과를 조용히 잃어서는 안 된다.

기존 host 실패 정책이 중단이면 결과를 기록하고 중단한다. 자동 재시작이나
다음 scan은 없다. 계속 실행이 명시적으로 허용되면 원래 latch 뒤에 받아들인
effect 결과는 선언된 typed binding을 통해 향후 결정에만 영향을 줄 수 있다.
자동으로 alarm, command 완료나 임의 소스 입력이 되지 않는다. 이 순서 계약은
독립 emergency stop/watchdog을 일반 batch 뒤로 미루거나 기존 out-of-band
안전 경로를 변경하지 않는다.

## 경계 사례와 증거

`tests/host-event-ordering-contract.test.mjs`는 테스트 내부 reference 모델이며
host adapter가 아니다. 단순 request reducer와 effect-failure 입력 binding은
명시적인 가상 fixture이며 보편적 제품 정책이나 소스 문법이 아니다.
수신/boundary 객체도 모델 표기이며 승인된 기록 형식이 아니다.

| Vector | Conformance 의무 |
| --- | --- |
| 정상 | 수신/latch/평가/commit/dispatch/결과 순서; effect에서 commit 상태·불변 origin 식별 관찰 |
| 동률·과거 producer 시간 | 같은 수신 시간은 sequence 보존; 늦은 소스 timestamp로 소속 재정렬 금지 |
| 평가·dispatch 중 도착 | 닫힌 batch 유지; 정확히 다음 허용 batch에 새 수신 포함 |
| 평가 fault | 이전 상태 보존, 완료 결과/effect 없음; 명시적 실패 batch 처분, 성공 scan counter 유지 |
| 계속 실행 허용 시 effect 실패 | origin commit 유지; 결과는 origin에 연결된 이후 ingress; 다음 결정은 명시적 fixture binding만 사용 |
| 중단 정책 시 effect 실패 | 결과 보존, 이후 평가 거절; 자동 계속 실행 없음 |
| 한계·재진입 | sequence 부여 전 overflow 거절; 불변 캡처와 단일 instance 평가 보장; commit 후 결과 admission 실패는 origin/결과 증거를 보존하고 모델 중단 |

집중 모델 테스트는 이 계약 oracle만 확립한다. 도입에는 각 host의 latch,
제한 저장, typed projection, 실패/재시도 정책과 기록 구현 및 실제 adapter를
통한 같은 사례 검증이 필요하다. core 소유권, 현재 ABI와 물리 증거는 유지한다.
