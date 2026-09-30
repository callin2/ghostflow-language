<!-- translation-source: CHANGELOG.md -->
[영어 원문](CHANGELOG.md)

# 변경 기록

## 미출시

### 2026-10-01 — bounded 자연 사건 fallback ([#29](https://github.com/callin2/ghostflow-language/issues/29))

Reference §3.4는 Solar/Tide의 `clock = hold_trusted(5min, terminal: skip)`와 Solar의 `fallback = fixed_time(time`06:00`, terminal: skip)`을 허용한다. 이전에는 trusted-only clock과 skip fallback만 받았다. hold는 엄격한 duration 경계에서 만료되며 anchor/uncertainty 부재는 fail closed한다. fallback은 회복과 checkpoint에서도 같은 source-date Solar identity를 소비한다. facts provider가 IANA civil time을 변환하며 모호하거나 존재하지 않는 시간은 skip한다. 확장 정책은 GFB13/control-v12와 Solar GFSF6을 선택한다. 기존 bytes는 그대로이며 이전 pinned runtime은 GFB13을 거부한다. 서명 portable-package GFB11 profile은 좁게 유지한다. 회귀 검증: `natural-fallback-compiler.test.mjs`, `natural-fallback-runtime.test.mjs`, core `solar_tape`. 실행 결과는 별도로 보고하며 물리 Device 검증을 주장하지 않는다.

### 2026-10-01 — pause 중 Solar 관측 ([#402](https://github.com/callin2/ghostflow-language/issues/402))

명시적 paused observation은 작성된 program 실행이나 scan 생성 없이 Solar terminal
identity를 유지한다. 예를 들어 pause 중 관측한 occurrence는 resume/reboot 뒤에도
소비된 상태다. 이전에는 native observation을 생략하면 resume 때 해당 occurrence가
실행될 수 있었다. Program-logical time은 멈출 수 있으며 실제 wall/trust는 그대로
공급한다. 잘못된 관측은 원자적으로 거부한다. `schedule_module`과 pin을 고정한 Device
adapter regression이 경계를 검증한다. Syntax, GFB/WASM ABI, 일반 lifecycle interface는
추가하지 않는다.

### 2026-10-01 — 영속적인 framed Solar admission ([#400](https://github.com/callin2/ghostflow-language/issues/400))

Rust owner API는 이제 GFB5 Solar scan을 frame으로 실행하고 정확한 program의
유한 terminal occurrence identity를 내보내고 복원한다. 이전에는 Device consumer가
재시작 후 native Solar 중복 억제를 보존할 수 없었다. 예를 들어 첫 scan 전에
`solar_checkpoint()`를 복원하면 소비한 occurrence를 유지하고 새 boot에서는 clock
baseline을 새로 설정한다. 잘못되거나 일치하지 않거나 capacity를 넘는 checkpoint는
원자적으로 거부한다. Host는 ON을 게시하기 전에 admission을 저장해야 한다.
`schedule_module` test가 복원, framed rollback, retry를 검증한다. Source syntax,
GFB, WASM ABI는 그대로다. 물리 구동을 주장하지 않으며 남은 civil checkpoint API를
제공하지 않는다.

### 2026-10-01 — 유한한 estimate-basis 근거 API ([#398](https://github.com/callin2/ghostflow-language/issues/398))

portable core는 불변 reference와 유한 capacity 아래 명시적인 requested 또는
acknowledged-write history를 승인한다. native/WASM은 정확한 실행 출처, 원본 receipt
시간, 선언된 coverage, 알려진/알 수 없는 uncertainty를 보존한다. 잘못된 입력은 원자적으로
거부한다. gap, context 변경, 실패/불확실 write는 원인과 함께 연속성을 무효화한다.
근거 API만 추가하며 source syntax, Result/Quality 상태, 수치 모델, temporal 권한은 없다.
기존 sensor 산술과 measured-only admission은 그대로다. 실행 가능한 추정 선언과 보정 기간
예제는 parent #385에 남는다.

### 2026-09-30 — 불변 UTC Range 실행 ([#152](https://github.com/callin2/ghostflow-language/issues/152))

UTC Daily와 비어 있지 않은 정적 DailySlots `range(duration)` control이 GFB12로 실행된다. admission은 반열린 계획 interval의 남은 시간만 사용하며 cancellation은 occurrence를 소비한다. 활성 종료는 wall 보정과 clock trust 상실 중에도 monotonic time을 사용한다. checkpoint 복원은 중복 방지를 유지하지만 활성 timer는 재개하지 않는다. 다른 허용된 Range 변형은 descriptor로 유지한다. compiler, native/WASM/ghostsim parity와 실패 경계 test가 이 제한된 범위를 검증하며 물리 장치 검증을 주장하지 않는다. 이전 bytecode consumer는 새 형식을 명시적으로 거부한다.

### 2026-09-30 — 무시되던 input 초기값 거부 ([#151](https://github.com/callin2/ghostflow-language/issues/151))

버그 수정, Reference §1.6: 기존에는 `input x: Bool = false;`를 파싱한 뒤 초기값을
조용히 버렸다. 이제 canonical literate 문서를 포함한 원본 소스의 `=` 위치에서
오류가 발생한다. `input x: Bool;`로 바꾸고 host에서 값을 공급한다. 암묵적인
기본값이나 fallback은 도입하지 않는다. State 초기화와 타입만 선언하는 output은
바뀌지 않는다. `tests/compiler.test.mjs`에서 초기값 거부, 소스 위치, state·output을
포함한 유효한 host 입력 선언을 검증한다. `tests/control-host.test.mjs`는 실제 WASM으로
입력 누락 거부와 명시적인 true·false 값을 검증한다. GFB/ABI 변경은 없다.

### 2026-09-30 — 네이티브 시나리오 Percent 입력 버그 수정

네이티브 시나리오 실행기는 이제 0..100 범위(양 끝 포함)의 유한한 `Percent` 입력을
받으며 초기 입력과 입력 변경 action 모두 숫자 값을 그대로 보존한다. 기존에는 공개
시뮬레이터가 입력을 검증해도 네이티브 전달 경로에서 잘못된 타입으로 거부했으며,
프로그래밍 예제 E32도 실패했다. 예를 들어 `input level: Percent;`에 host 값 `33.5`를
공급하면 `33.5`를 유지한다. 잘못된 값과 nominal 타입 불일치는 계속 거부한다.
기존 Percent 계약(Reference §2.1)을 복구하며 소스 이행이나 GFB/ABI 변경은 없다.
네이티브 `scenario_scan` 단위 테스트, `tests/ghostsim.test.mjs`,
`tests/ghostsim-input-validation.test.mjs`, `tests/programming-book-simulation.test.mjs`의
E32로 검증한다. [#151](https://github.com/callin2/ghostflow-language/issues/151)의 선행 수정이다.

### 2026-09-29 — 고정 sensor·함수 합성 ([#377](https://github.com/callin2/ghostflow-language/issues/377))

Reference §6.4의 sensor 연결과 import 순수 함수가 미지원 거부 대신 실행된다.
예: `connect high.air <- air;`는 root 원본 sample을 `high`의 변경하지 않은 sensor
conditioning에 공급한다. Payload·선택성·sample 간격은 일치해야 한다. 함수·지역 이름은
격리한다. 공개 root sensor는 `manifest.sensors`에 둔다. 이 프로그램을 활성화하는
consumer는 `manifest.sensorInstances` routing을 지원해야 한다. 기존 단독 프로그램과
GFB·WASM·frame 인터페이스는 바뀌지 않는다. `tests/composition-execution.test.mjs`는
filter·fault·recovery·stale·rollback·잘못된 연결·provenance·native/WASM conditioning
frame 일치를 검사한다.

### 2026-09-29 — 명시적 상대습도 비율 ([#371](https://github.com/callin2/ghostflow-language/issues/371))

Reference §2.9는 기존에 거부하던 `RelativeHumidity / RelativeHumidity -> Number`를
허용한다. 예를 들어 `60%RH / 100%RH`는 작성한 공기 VPD 계산에 사용할 `0.6`이다.
그 밖의 RH 산술, 서로 다른 물리량의 나눗셈, 암묵적 숫자 변환은 계속 금지한다.
상수·동적 0 나눗셈은 기존 진단·tick 거부를 따른다. 기존 나눗셈 bytecode를 사용하며
GFB/ABI 변경이나 소스 이행은 없다. `tests/relative-humidity-ratio.test.mjs`에서 상수,
nominal 경계 거부, native/WASM 결과를 검증한다.

### 2026-09-28 — framed 민간 시간 일정 버그 수정 ([#366](https://github.com/callin2/ghostflow-language/issues/366))

수정 전에는 framed 민간 시간 일정이 거부됐다. 이제 `Daily`와 `DailySlots`는 동일한
Rust 코어를 사용한다. 활성화는 `{bootEpoch, terminalCapacity}`를 받는다. Provider는
GFSF v2/v3 일정 사실을 스캔 시점에 별도로 제공한다. 일치하는 WASM export가 필요하다.
발생 승인과 원장은 Rust가 소유한다. 호스트는 전체 입력과 일정 사실 패킷을 검증하며 런타임 `due`,
`ok`, `fault` 값을 계산하지 않는다. 확인된 거부는 롤백되어 같은 프레임으로 재시도할
수 있고, 커밋 후 실패는 커밋 결과를 보존한다. Framed Solar는 계속 지원되지 않는다.

회귀 테스트는 `tests/framed-control-host.test.mjs`와
`crates/ghostflow-core/tests/schedule_module.rs`에 있다.
[Framed ControlRuntime 문서](docs/FRAMED-CONTROL-HOST.ko.md)를 참고한다.
