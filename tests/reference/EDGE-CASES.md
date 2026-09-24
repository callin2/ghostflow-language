# 엣지 케이스·경계값 점검

아래 `../../build/` 증거는 당시 호스트에서 생성한 로컬 파일이며 git에 포함되지 않는다.
링크가 없는 checkout에서는 실행 결과를 직접 확인할 수 없다. 현재 소스의 검증은
테스트를 다시 실행해 별도 기록해야 한다.

2026-09-22. Reference의 범위·오류·시간 경계를 기존 테스트와 대조하고 누락된 사례를
추가했다. 이번 변경은 테스트와 이 검증 기록뿐이며 컴파일러·런타임 의미를 바꾸지 않는다.

## 판정

**모든 엣지 케이스가 검증된 상태는 아니다.** Reference의 모든 번호 있는 절에 사례가
연결되어 있다는 카탈로그 검사는 분기·경계·입력 조합의 완전한 검증을 뜻하지 않는다.
기존 CLI 사례 203개와 비실행 계약 164개를 그대로 보존했다. 아래 실행 테스트는
별도 증거이며, 일부 의미가 겹친다는 이유로 164개 계약을 통과로 바꾸지 않았다.

## 이번에 확인·보완한 경계

| 영역과 Reference | 경계·예외 | 실행 증거 |
|---|---|---|
| 정수 [§2.2–2.3](../../docs/reference/02-types-expressions-state.md#23-정확한-정수-설계) | i32 양 끝과 바로 밖, 명시 변환 반올림, 산술 오류, GFB2의 실제 정수 사용 판별 | [Int compiler](../int-compiler.test.mjs), [GFB2 native/WASM](../gfb2-int.test.mjs) |
| Duration [§3.1](../../docs/reference/03-time-and-schedules.md#duration) | 각 단위의 0·최대 정수 리터럴·최대+1, 매우 긴 숫자, 최대+0·최대+1·0-1·분수 결과 | [source validation](../control-source-validation.test.mjs) |
| 설정 [§5.1](../../docs/reference/05-settings-and-observation.md#51-config-선언) | min=max, 양 끝 기본값과 범위 밖, min>max, 0·음수 step | [source validation](../control-source-validation.test.mjs) |
| 타이머 [§3.2–3.3](../../docs/reference/03-time-and-schedules.md#33-bool이-연속으로-참인-시간) | 0·임계값-1·임계값·임계값+1, 동일 시각, 늦은 첫 true, 임계값에서 false, 독립 타이머, 거부된 scan의 상태 보존 | [실제 WASM scan](../scan-frame-wasm.test.mjs) |
| 원문·산출물 [§1](../../docs/reference/01-source-and-syntax.md) | 타이머 descriptor·내부 state role·의존 read 변조와 누락 | [strict restoration](../toolchain.test.mjs) |
| 센서 [§4.2–4.3](../../docs/reference/04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서) | median 1·31의 N-1/N/N+1, valid 양 끝과 바로 밖, hysteresis 양 임계값에서 이전 true/false 유지, stale 직전·정각·직후, 중복 샘플·반복 read, recovery 1·31 | [실제 WASM signals](../signals-wasm.test.mjs), [threshold 타입 검사](../control-source-validation.test.mjs) |

정상 이웃값과 거부값을 함께 검사한다. 정상 소스도 컴파일되지 않는 상태에서 다른
문법 오류로 거부된 것을 경계 검사 성공으로 계산하지 않는다. 실제 시간·센서 상태
검사는 Rust WASM을 사용하며 mock 결과를 실행 의미의 증거로 쓰지 않는다.

## 새로 드러난 결함

1. **Duration 상수 산술 상한 누락.** `9007199254740991ms + 1ms`는
   [§3.1](../../docs/reference/03-time-and-schedules.md#duration)의 상한을 넘으므로 거부해야
   하지만 컴파일된다. 리터럴 자체의 상한 검사가 산술 결과까지 보장하지 않았다.
   `Duration arithmetic rejects 9007199254740991ms + 1ms`가 재현한다.
2. **센서 복구 중 공개 품질 불일치.** fault 뒤 정상 샘플이 다시 들어와도 복구 조건을
   모두 충족하기 전에는 [§4.2](../../docs/reference/04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서)의
   `NotReady`여야 한다. `recoverSamples=31`에서 실제 WASM은 `Invalid`를 계속 노출한다.
   update의 NotReady 결과와 read가 유지한 이전 fault가 다르다.
   `real WASM recovery(31) requires N fresh samples after fault`가 재현한다.
3. **i32 최솟값 나머지 연산 오류.** `-2147483648 % -1`의 나머지는 `0`이다.
   [§2.3](../../docs/reference/02-types-expressions-state.md#연산-의미)는 `MIN div -1`의
   overflow를 규정하며, 나머지는 피제수 부호 규칙을 따른다. 상수 타입 검사는 이 식을
   허용하지만 실제 native와 WASM은 모두 `integer-overflow`를 반환한다.
   `GF-TEST-gfb2-int-runtime-edges`가 같은 입력으로 양쪽 실행 경로를 검사한다.

이 세 테스트는 일반 실패로 유지한다. 기대값 변경, skip, TODO로 감추지 않는다.

## 남은 검증 범위

- 동적 Duration 산술과 동적 numeric conversion의 전체 실행 경계.
- 미지원 Reference 문법의 의미 실행: 새 예약 정책·달력/자연 사건, 물리량·Result 합성,
  resource/accounting·PID·adaptation, import·macro 등. 기존 하위 모듈 테스트의 통과만으로
  해당 언어 기능의 end-to-end 지원을 주장하지 않는다.
- live 설정의 원자성·재시작 보존과 비실행 계약의 실제 관찰 경계 연결.
- 이번에 보완한 타이머 시나리오 전체의 native/WASM 동등성, 실제 Device/Driver I/O.

## 실행 결과

테스트 block 18개를 추가하고 기존 table과 타이머 trace를 보강했다. block 하나가 여러
입력 벡터를 검사할 수 있으므로 이 수치는 경계 조합의 총개수가 아니다.

`npm test`를 전체 변경 후 한 번 실행했다. 종료 코드는 **1**이다.

| 구분 | 결과 |
|---|---:|
| Node test 전체 | 781 |
| 통과 | 570 |
| 실패 | 47 |
| 미실행 계약 TODO | 164 |
| skip | 0 |
| Reference CLI | 159 통과 / 44 실패 |
| 새 경계 테스트로 드러난 결함 | 3 |

Reference 실패 ID 44개는 직전 컴파일러 개선 결과와 같다. 그 외 실패는 위의 신규
결함 3개뿐이다. Reference catalog 검사, Cargo workspace 테스트, native/WASM 빌드는
통과했다. Node 단계가 실패했으므로 전체 host gate 통과나 후속 tutorial 완료를 주장하지
않는다. 이 결과는 하드웨어 실행 증거가 아니다.

실행 기록:

- [전체 로그](../../build/edge-boundaries-full.log)
- [host gate 보고서](../../build/edge-boundaries-verification.json)
- [Reference 결과](../../build/edge-boundaries-reference-results.json)

위 `build/` 파일은 로컬 생성 증거다. 다음 컴파일러·런타임 수정 때는 신규 결함 3개를
먼저 해결하고 같은 테스트로 확인한다.

## 테스트 작성 원칙에 따른 후속 리뷰

같은 날 앞선 경계 테스트를 작성자와 다른 에이전트가 분담 리뷰했다. 기준은 명세에
근거한 기대값, 관찰 가능한 결과, 사례별 실패 격리, 결정적 실행, 실제 구현 사용,
정상·오류·복구 경로다. 단순 테스트 개수 증가는 검증 범위 증가로 계산하지 않는다.

| 발견한 부족 | 보완 |
|---|---|
| 반복문 첫 assertion이 실패하면 뒤 입력을 검사하지 않음 | 독립 test/subtest로 분리하고 각 사례의 이름·실행 결과를 남김 |
| 정상 컴파일의 `doesNotThrow`만으로 값의 의미를 검증함 | Duration·설정의 실제 manifest 값과 범위·타입을 명세 기대값과 비교 |
| CLI 검사 모드 실패가 산출물 생성 모드를 가림 | 두 모드를 모두 실행·검사하고 실패를 함께 보고; build의 진단도 기대 패턴과 비교 |
| 타이머 forward dependency는 컴파일만 검사함 | timer/let 선언 순서를 바꾼 두 프로그램의 실제 WASM 경과값·출력을 고정된 기대 trace와 각각 비교 |
| 존재하지 않는 의존 이름을 넣은 거부만으로 정확한 원문 결속을 증명하기 어려움 | 존재하고 타입도 같은 다른 입력으로 교체한 사례를 추가; canonical dependency 불일치 진단 확인 |
| 오류 후 상태와 복구·독립 실행의 관찰이 부족함 | 정수 연산 오류의 상태 보존, 단락 평가, 센서 복구·인스턴스 격리를 실제 실행으로 보강 |

입력 시각과 벡터는 고정한다. wall-clock 대기, 네트워크, 비결정적 난수에 의존하지
않는다. 각 테스트가 runtime·임시 파일을 정리한다. 내부 byte tag를 검사하는 기존
format 계약 테스트와 외부 출력·상태를 검사하는 의미 테스트는 검증 목적이 다르다.

기존 실패의 기대값이나 Reference는 변경하지 않는다. 분리 때문에 동일 결함이 여러
실패 항목으로 보고될 수 있으므로 실패 테스트 수와 제품 결함 종류를 구분한다.

### 후속 실행 결과

전체 `npm test`를 변경 후 한 번 실행했다. 종료 코드는 **1**이다.

| 구분 | 결과 |
|---|---:|
| Node test 전체 | 850 |
| 통과 | 634 |
| 실패 | 52 |
| 미실행 계약 TODO | 164 |
| skip | 0 |
| Reference CLI | 159 통과 / 44 실패 |

Reference 203개 사례 모두 `--check`와 산출물 생성 모드를 실행했다(406회 호출).
실패한 Reference ID 44개는 이전 실행과 같다. Cargo workspace 테스트와 native/WASM
빌드는 통과했다. Node 이후의 후속 host gate는 완료되지 않았다.

총 test 수는 781에서 850으로 늘었다. 이 69개 증가는 기존 벡터 분리와 subtest 등록을
포함하므로 69개의 새로운 의미를 검증했다는 뜻이 아니다. 실제 보완 범위는 위 표와
각 테스트의 명명된 입력·기대값으로 추적한다.

Reference 외 실패 8개는 다음 **4종류의 결함**으로 분류한다.

| 결함 종류 | 실패 테스트 수 | 이번 리뷰 결과 |
|---|---:|---|
| Duration 상수 덧셈 상한 누락 | 1 | 기존 재현 유지 |
| i32 최솟값 `% -1` overflow | 1 | 기존 재현 유지; 양 backend 결과를 함께 검증 |
| 센서 복구 중 이전 fault 유지 | 3 | 기존 Invalid 뒤 복구와 중복 입력을 분리; Stale 뒤 복구에서도 같은 증상 확인 |
| 선택되지 않은 분기를 실행함 | 3 | **새 결함.** `if`, `&&`, `\|\|`가 선택되지 않은 `1 div 0`을 실행함. [§2.6](../../docs/reference/02-types-expressions-state.md#조건식)의 단락 평가 규칙 위반 |

단락 평가의 선택된 오류 분기는 별도 테스트 3개로 실행해 정상적으로 거부됨을 확인했다.
정수 연산 fault 뒤 state·intent·tick·journal 보존과 다음 정상 입력에서의 복구도 통과했다.
센서 인스턴스 격리는 **동일 WASM exports 안에 두 conditioner**를 만들어 검사했다.
서로 다른 WASM instance를 쓰는 것으로 같은 instance 안의 상태 공유 검사를 대체하지 않는다.

리뷰 중 확인한 low-level conditioner의 허용 범위는 언어 문법과 구분했다. 공개 compiler와
control manifest 경로는 median의 홀수 조건과 양의 stale duration을 검사한다. 하위 primitive의
더 넓은 값 허용만으로 위 언어 경로의 결함으로 계산하지 않았다.

증거: [전체 로그](../../build/test-principles-full.log),
[host gate 보고서](../../build/test-principles-verification.json),
[Reference 모드별 결과](../../build/test-principles-reference-results.json).
기존 Reference 기대값과 제품 소스는 변경하지 않았다.
