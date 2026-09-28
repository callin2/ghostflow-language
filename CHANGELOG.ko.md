<!-- translation-source: CHANGELOG.md -->
[영어 원문](CHANGELOG.md)

# 변경 기록

## 미출시

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
