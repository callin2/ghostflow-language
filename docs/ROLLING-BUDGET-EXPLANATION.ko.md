<!-- translation-source: docs/ROLLING-BUDGET-EXPLANATION.md -->
[English source](ROLLING-BUDGET-EXPLANATION.md)

# 영속 rolling 예산 설명

`AccountingRuntime.explainRolling({ nowMs, windowMs, limitMs, reserveMs })`은
검증된 소스에 바인딩된 영속 `on_time` account를 읽는다. canonical 소스의
단일 rolling window, 한도와 제안 예약량을 사용하며 불일치는 거부한다.
복사한 불변 바인딩은 공개 메타데이터 변경 시도에도 정책을 유지한다.
결과에는 canonical 소스 SHA, artifact SHA, account/target, 명시적 host
resource ID, 조회 시각, 사용 interval 합집합 시간, 미결 예약 시간, 한도,
제안 예약량, `blocked`, 거부 시 `blockReason: 'rolling-budget'`,
`nextReleaseMs`, `ledgerRevision`이 포함된다.

Rust ledger는 실제 `reserveRolling` 입장 판단과 같은 applied interval
합집합 및 미결 예약량을 계산한다. [0,20s], [10s,30s] interval과 60s window,
30s 한도, 5s 제안의 경우 40s에 사용량은 30s이고 차단된다. 가장 빠른 허용
시각은 65s이다. 64.999s는 거부하고 65s는 예약할 수 있다. 조회는 ledger를
변경하거나 시작을 허가하지 않는다. 용량 부족이나 중복 identity 같은
다른 입장 실패는 이 예산 설명과 구분된다.

`nextReleaseMs`는 새 증거가 없다는 조건하의 값이다. 미결 예약은 식별된
settlement/cancellation까지 유지되며 시간 경과나 OFF animation으로 해제되지
않는다. 미결 예약과 제안량만으로 한도를 넘으면 시간에 따른 해제를 약속하지
않는다. 이미 허용되는 예산도 null을 반환한다. bounded 검색은 합집합 조회를
최대 64회 수행한다. 시각은 u64 최댓값에서 포화하며 wrap하지 않는다. 기록된
interval 종료보다 이른 조회는 미래 증거로 감소하는 전망을 확정할 수 없어
Unknown이다.

Unknown은 null이며 초기화되지 않은 상태, 손상, 승인되지 않은 영속 변경도
포함한다. 정확히 영속 승인된 revision만 설명 증거를 제공한다. revision은
살아 있는 owner 내부 번호이고 restore 후 0부터 시작한다. 복구는 영속 snapshot과
canonical 소스로 재현하며 재시작 전체에 걸친 revision counter가 아니다.
host는 검증된 applied 증거, 안정된 resource binding, 비교 가능한 신뢰 monotonic
시간을 제공한다. clock/binding revision을 만들어 내거나 물리 receipt 인증을
제공하지 않는다.

REF-04-066은 실제 WASM ledger 거부, 정확한 해제 경계, 영속 승인 전 Unknown,
snapshot 복구와 control activation을 검증한다. 같은 snapshot에서 복구한 별도
context ledger는 실제 완료된 OFF output 관찰을 만든다. 그것이 rolling 거부를
발생시키거나 해당 ledger를 초기화하지 않는다. accounting API에는 animation
입력이 없다. 이는 reference accounting 투영이며 frontend renderer 검증,
컴파일된 `on_time` 시작/차단 자동 통합, API 배포, 저장 매체 인증 또는 Device
검증이 아니다. 추가된 WASM export를 사용하려면 WASM module을 다시 빌드해야
한다. GFB와 ledger snapshot 형식은 바뀌지 않는다.
