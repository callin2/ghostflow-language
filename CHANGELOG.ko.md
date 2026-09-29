<!-- translation-source: CHANGELOG.md -->
[영어 원문](CHANGELOG.md)

# 변경 기록

## 미출시

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
