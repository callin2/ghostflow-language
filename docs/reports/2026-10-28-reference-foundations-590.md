# 남은 Reference 계약의 기초 검증 — #590

목적은 작성한 GhostFlow 의도가 컴파일·실행·설정 변경·장치 관측 경계를 지나도 예측 가능한 의미를 유지하도록 하는 것이다. TODO 숫자를 줄이는 것만으로 완료를 판단하지 않는다. 실제 실행 경로와 명세의 Given/When/Then 전체가 연결된 경우만 완료 근거로 등록한다.

기준 소스는 `d096ed2986e048381668edbe4d139f8b29eaea5d`이며 Percent 수정 PR #592를 포함한다. 시작 시 실행 근거가 연결되지 않은 지정 사례는 37개였다. 이번 변경은 12개 사례에 완전한 소프트웨어 경계 근거를 추가하며 25개는 남긴다. 이는 전체 컴파일러의 보편적 정확성 증명이나 물리 장치 확인이 아니다.

## 수정한 실행 오류

`config`와 `continuous_true`를 함께 선언하면 컴파일러는 정상 GFB11과 `mode: continuous-true` 타이머 설명을 생성하지만, context 실행기의 manifest 검증이 `mode`를 알 수 없는 필드로 거부했다. 기존 scalar/context 검증이 같은 `validateTimers`를 사용하도록 수정했다. 잘못된 mode, elapsed/continuous 필드 혼합, clock 정보는 계속 거부한다. [#47 기록](https://github.com/callin2/ghostflow-language/issues/47#issuecomment-6445405766).

## 역사적 계약과 현재 계약

REF-05-013의 과거 기대값은 범위를 벗어난 설정 묶음을 거부하고 마지막 정상값과 revision을 유지하는 것이었다. 현재 Reference §5.2는 식별·권한 검증을 통과한 묶음의 payload가 잘못되면 모든 대상에 `fault(SettingsInvalid)`를 한 번 함께 전달한다. 대상 밖 설정은 유지하며, 유효한 새 event로 함께 복구한다.

과거 JSON은 바꾸지 않았다. `tests/reference/revisions/settings-result-v1.json`에 이전 case digest, 새 판본, [정정 근거](https://github.com/callin2/ghostflow-language/issues/274#issuecomment-6445458117)를 기록했다. 현재 검증은 이 명시적 판본을 사용한다. 과거 및 현재 case 전체 digest, 알 수 없는 ID, 중복, 분류 변경과 판본 변경을 검사한다. 이 정정은 기존 실행 의미에 검증 기대값을 맞춘 것이다.

## 완전한 근거를 추가한 12개 사례

정확한 테스트 이름과 대상은 `contracts/feature-status/catalog.json`에서 관리한다. 모든 새 파일은 `tools/verify-language.mjs`에 명시적으로 등록한다.

| 사례 | 실행 경계와 확인한 의미 |
|---|---|
| REF-00-002 | 실제 WASM ON 판단에 외부 ACK/readback 보고를 연결해도 없는 회전 feedback을 생성하지 않는다. |
| REF-00-009 | 서로 다른 입력 표현이 5분을 허용하고 90초를 동일하게 `SettingsInvalid`로 처리한다. native/WASM 결과를 비교한다. |
| REF-03-037 | Periodic interval과 알 수 없는 설정 대상을 묶은 event는 전체 거부되며 run·revision·phase를 유지한다. 유효 재시도는 과거 occurrence를 만들지 않는다. 범위를 벗어난 식별 가능 payload의 fault emission과 구분한다. |
| REF-03-047 | Tide correction/withdrawal과 stable ID, Solar LocationUnknown/skip, sea-level 계산, 이미 시작한 Run의 지속을 실제 provider·native/WASM 경로에서 확인한다. |
| REF-04-043 | 적용 실패와 false feedback을 요청값·안전값과 분리해 출처·품질·시각을 보존한다. |
| REF-04-054 | 권한 없는 설정이 섞인 묶음은 전체 거부한다. 유효한 짧은 운전 제한은 이미 경과한 시간과 다음 판단에서 비교한다. |
| REF-05-013 | 현재 Result 계약으로 모든 대상의 오류·revision·재전송 거부·정상 복구가 원자적으로 처리된다. |
| REF-05-014 | live 변경은 같은 source·Program·run에서 정확한 effective position을 기록하며 timer와 state를 초기화하지 않는다. |
| REF-05-025 | ON intent만 있으면 적용 및 물리 확인 자료의 부재가 그대로 남는다. |
| REF-06-006 | 같은 논리 계약의 GPIO·확장 칩·통신형 출력 endpoint를 설치 검증기가 받아들인다. 주소와 driver는 설치 정보에 남으며 source/artifact를 바꾸지 않는다. |
| REF-06-021 | module identity 또는 state 타입이 달라지는 교체는 이전을 거부한다. 허용된 상태 이전·새 상태 초기화·새 입력 요구도 확인한다. |
| REF-08-010 | 한 scan의 두 출력 판단에 서로 다른 bus 적용·feedback 시각을 연결해도 시각과 요청 ID가 합쳐지지 않는다. |

장치 보고를 사용한 검사는 보고 자료의 검증·연결·보존을 시험한다. 외부 보고는 계속 `not-authenticated`이며 실제 부하가 움직였다는 증거로 승격하지 않는다.

## 남은 25개 사례와 정확한 다음 작업

아래 번호마다 원래 이슈가 있으며 이를 유지한다. 현재 불확실성이 독립적인 소프트웨어 작업을 막는 조건이 되지는 않는다.

| 사례 | 남은 조건 / 담당 경계 |
|---|---|
| REF-01-003 | 편집기·폼·그래프 편집이 같은 canonical 문서 판본으로 저장되는 제품 경로. Frontend/API. |
| REF-03-018 | 작업 단위의 누적 ON 연산. state age·continuous·rolling/day 계수는 검증했지만 누적 작업 계수는 별도 언어/core 계약이다. |
| REF-03-021 | safe 단계와 confirmed flow/quality의 실제 accounting 실행 연결. 언어/core 및 Device receipt. |
| REF-03-026 | Window basis의 반열린 구간·첫 true 실행. Pulse와 늦은 Run만 검증했다. 언어/core. |
| REF-03-030 | Window basis에서 관측 간격 초과 후 terminal 및 재활성화 방지. open-within과 Pulse의 현재 동작만 검증했다. 언어/core. |
| REF-03-040 | 자연 일정의 원래 localDate 요일 필터. 이미 시작한 Tide Run의 자정 통과는 검증했다. 언어/core. |
| REF-04-039 | profile 후보 전체 검증·교체 경계와 현재 Stale을 장치 부재로 바꾸지 않는 strategy 수명주기. Host. |
| REF-04-051 | 70/40 요청, 정책 판본, 20% clamp를 한 설명에서 추적하는 전체 arbitration 계약. Core/host 관측. |
| REF-04-053 | VerifiedStop 정책에서 전송 성공·feedback timeout을 구분하는 실제 stop lifecycle. Device/driver. |
| REF-04-055 | 실제 command lifecycle을 applied interval receipt에 연결하고 confirmed-flow 품질을 계수에 반영하는 경로. interval union 및 native/WASM rolling/day 합은 검증했다. |
| REF-04-065 | Option 의미, 전체 bounded state 계획, 분석 Unknown/timeout, controller 처리 후 resource 실패의 통합 rollback. 현재 profile에서 가능한 quantity/Result 거부 및 scalar/PID 실패·재시도는 검증했다. |
| REF-05-017 | 실제 장치 재시작·저장된 일반 설정 복구·새 run 발급. 별도 Node process와 새 core 복구는 검증했지만 Device 저장·발급은 미검증이다. |
| REF-05-026 | received/started/cancelled 등 명령 lifecycle의 실제 생성 주체와 기록 연결. generic event history 보존만으로 완료하지 않는다. |
| REF-05-027 | 알람 raise/clear 생성 주체와 active snapshot의 결합. generic event history만으로 완료하지 않는다. |
| REF-05-028 | descriptor·설정 event·snapshot·explanation·driver 결과 전반의 source/settings/binding/run identity 연결. Tooling/host. |
| REF-06-002 | 동일 definition 두 instance의 timer·settings·binding revision 격리. 현재 composition은 timer/config 선언을 거부한다. |
| REF-06-005 | 타입·방향만 알려진 endpoint의 전기적 호환 unknown 판정. 현 integration 검증은 완전한 선언 형태 검증이며 극성·부하·배선의 독립 증거 판정과 구분한다. |
| REF-06-007 | import 파라미터·settings·dependency·binding 변경을 구분하는 실제 수명주기 계획. Compiler/host. |
| REF-06-008 | 샘플 시각·품질·오류·capability까지 맞는 driver 교체를 source/Program 고정 상태로 설치. Host/Device. |
| REF-06-009 | 타입은 같아도 sample 주기가 stale 요구를 못 맞추면 교체를 거부하는 계약. Host/Device. |
| REF-06-016 | occurrence에서 instance source/settings/binding 판본까지 이어지는 설명. 현재 source trace만으로 binding revision을 증명하지 않는다. |
| REF-06-020 | 교체 거부의 기존 run identity 유지까지 포함한 host 경로. core의 후보 포트 거부·기존 Program/state/journal/input 재시도는 검증했다. |
| REF-06-022 | 성공 교체의 source/artifact/run 경계 확정. core의 입력 cache 제거·새 snapshot 요구는 검증했다. |
| REF-07-007 | 실제 CSE 변환이 여러 원본 node를 합칠 때 모든 provenance 보존. 현재 설명 DAG 공유만으로 실행 CSE 검증이라고 하지 않는다. |
| REF-08-011 | source/settings/binding/driver/state/ledger/provider/renderer 변경의 통합 revision 분류. Tooling/host. |

## 실행 및 검토 근거

새 원자성·설정·시간·출력·case 판본 검사와 기존 renderer 검사 통합 실행은 29개 통과했다. 새 검사는 27개이며 기존 renderer 검사 2개가 함께 포함됐다. case/catalog/requirement 집중 검사는 15개 통과했다. 독립 검토에서 현재 case 전체 digest 고정 부족을 발견해 보강했다. 타이머 수정과 각 작업 파일도 독립 검토를 거쳤다.

최종 전체 실행의 판정·source·산출물 SHA는 `build/verification.json`과 `build/build-identity.json`으로 확인한다. 이 파일들은 생성되는 실행 증거이며 source 문서로 복제하지 않는다. 부모 #590의 전체 컴파일러 의미 보존 증명은 계속 열려 있다.
