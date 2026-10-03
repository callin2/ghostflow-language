<!-- translation-source: docs/WHAT-IF-REPLAY.md -->
[English source](WHAT-IF-REPLAY.md)

# 제한된 what-if 재생

`runtimes/wasm/what-if-replay.mjs`의 `prepareWhatIfReplay`는 실제 portable core로
Reference §6.8과 REF-06-019의 누락 입력 경계를 구현한다. 가상 actuator capability를
사용하고 물리 출력 sink가 없는 Node reference host API다.

호스트는 canonical compilation, WASM 바이트, 명시적인 timeline·instance·run·불변
source revision·가상 binding revision 식별자와 기록된 `prefix`/`future` 프레임을 제공한다.
프레임은 `nowMs`, 모든 외부 `inputs`, 기록된 식별자·timestamp·값·quality의 센서
`samples`를 담는다. 어댑터는 artifact source map을 검증하고 불변 source closure를
다시 컴파일해 정확한 bytecode와 manifest를 확인한다. settings·schedule·context·controller·
objective·after-event 어댑터가 없는 plain control 프로파일이며 settings revision은 0이다.
센서 conditioning은 기존 reference host, 표현식·상태·requested/safe 출력은 Rust가 실행한다.

기준 checkpoint는 명시적인 `GhostFlow/replay-prefix-checkpoint-v1`이다. canonical 초기
상태와 완전한 제한된 기록 prefix, 그 digest, 실제 실행 결과 digest, 정확한 Program/source-
closure digest와 원본 식별자를 포함한다. branch는 새 runtime에서 prefix를 복원하고 결과
digest를 확인한다. 이는 event-sourced checkpoint이며 외부 VM 메모리를 가져오지 않는다.
같은 sample 재생으로 conditioner 이력을 보존한다. 총 256프레임, 입력 기록 1 MiB까지 받으며
logical time은 엄격하게 증가한다. 비동기 준비 중단 전에 입력을 복사하므로 이후 호출자 변경이
기록 증거로 승격되지 않는다.

`branch({ branchId, runId, synthetic })`는 원본과 다른 식별자를 요구한다. 미래 프레임 실행
전에 각 프레임의 모든 필수 입력과 센서 sample을 확인한다. 누락되면 `status: 'missing-input'`,
누락 이름과 logical time을 반환하며 branch 프레임을 실행하지 않는다. 이전 sample·기본값·환경
예측으로 빈자리를 채우지 않는다.

명시적인 가상 값은 `offset`, `kind` (`inputs` 또는 `samples`), `name`, `value`,
`provenance: 'synthetic'`를 포함한다. 누락 값을 제공하거나 기록 값을 교체하며 기존 입력·센서
계약을 만족해야 한다. 중복 대상·알 수 없는 이름·잘못된 값은 거부한다. 완료 receipt는 모든
입력을 `recorded` 또는 `synthetic`으로 표시하고 가상 sample을 기록된 물리 증거로 승격하지
않는다. candidate에는 실제 프레임·VM 상태·requested/safe 출력·센서 fault가 있다. 원래 미래
기록 전체가 있으면 같은 logical time의 실제 원본 결과를 포함하고 없으면 `original`은 null이다.
원본 결과를 지어내지 않는다.

각 요청은 일회용 runtime과 비공개 복사본을 사용한다. 반환 receipt로 기준 상태를 바꿀 수 없다.
거부되거나 완료된 branch는 원본 기록·식별자·별도로 실행 중인 live instance를 보존한다. API는
live runtime·ledger·설치 schedule·물리 callback을 받지 않는다. 같은 Program을 비교하며 source
교체, 외부 checkpoint, 운영 binding/run 식별자 발급, Device lifecycle, durable branch 저장과
환경 모델은 별도 작업이다.

`tests/what-if-replay.test.mjs`는 누락 기록·synthetic 성공/fault sample·logical tick 비교·원본
불변성·이후 live 실행·호출자 변경·artifact 변조를 검증한다. native와 WASM은 같은 bytecode와
reference conditioning 센서 필드를 실행해 전체 VM trace를 비교한다. portable 실행 동등성의
증거이며 native 운영 센서 driver나 하드웨어 검증을 주장하지 않는다.
