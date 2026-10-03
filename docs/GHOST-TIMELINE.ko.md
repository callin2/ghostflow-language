<!-- translation-source: docs/GHOST-TIMELINE.md -->
[English source](GHOST-TIMELINE.md)

# 제한된 live timeline과 ghost rewind

`runtimes/node/ghost-timeline.mjs`의 `createGhostTimeline`은 Reference §6.8과
REF-06-018의 비간섭 경계를 구현한다. 실제 Rust 판단, occurrence, accounting
owner를 사용하는 데스크톱 reference host다. 하드웨어를 조작하거나 Driver
receipt의 진위를 보장하지 않는다.

선택된 profile은 독립적인 canonical `.ghost.md` GFB10 control이다. Periodic
schedule, 기존 settings, 같은 source의 applied/durable `on_time` account를
사용한다. sensor, 외부 context, controller, objective, after-event adapter는
제외한다. accounting budget constraint와 event-count binding은 owner 생성이나
저장 전에 거절한다. 이 profile은 applied 사용량을 관찰하지만 accounting을 판단
강제에 연결하지 않는다. `prepareWhatIfReplay`의 plain-control profile을 확장하지 않는다.
Range와 다른 schedule profile, source 교체, installation 권한, publishing
identity, 물리적 재시작, 환경 예측은 별도 작업이다.

caller는 source filename, WASM bytes, 명시적인 timeline·instance·run·source
revision·binding revision identity, context activation, account 이름, 안정적
resource ID, 제한된 accounting config, 실제 `FileLedger`, Bool output 이름,
동기 live sink를 제공한다. factory 내부에서 컴파일한다. 판단과 accounting
owner의 source 및 artifact hash는 같아야 한다. output에서 resource로 연결하는
caller mapping은 명시적인 reference binding이며 installation identity 발급자가 아니다.

저장 파일이 없으면 `initializeEmpty: true`로 빈 ledger 초기화를 명시적으로
허용한 경우만 진행한다. 기존 파일 bytes는 실제 accounting owner를 복원한다.
판단 timeline, 실행 중 timer, run identity는 복원하지 않는다. FileLedger의
데스크톱 durability와 single-writer 제한은 그대로 적용된다.

`append(frame)`은 완전한 `nowMs`, `inputs`, `contextFacts`를 받는다. live framed
core를 실행해 전체 outcome/context checkpoint를 기록하고 선택된 safe Bool intent를
연결된 live sink로 전달한다. sink 실패 시 이미 승인된 판단 기록은 유지하고
해당 owner의 추가 live dispatch를 막는다. tick을 취소하거나 applied 증거를
만들지 않는다. sink는 동기여야 한다. 물리적 적용과 확인은 별도 관찰이다.

`recordApplied(segment)`는 caller가 검증한 명시적인 Driver interval을 source-bound
AccountingRuntime에 전달하고 실제 snapshot을 저장·승인한다. request, safe intent,
UI 시간으로 interval을 만들지 않는다. `persistPending()`은 보류된 저장을 다시
시도하며 승인되지 않은 읽기는 accounting owner의 Unknown 의미를 유지한다.
`usedRolling(nowMs, windowMs)`은 연결된 resource를 조회한다. `observe()`는 복사된
timeline receipt, 현재 context checkpoint, 실제 메모리 accounting bytes/revision,
마지막 승인 bytes, 저장 receipt를 반환한다. AccountingRuntime의 새 `snapshot()`은
저장하거나 승인하지 않고 bytes와 revision만 캡처한다.

`branch({branchId, runId, at})`은 실제 timeline의 승인된 prefix를 캡처한다.
branch의 두 identity는 origin과 달라야 한다. 별도 framed core가 불변 prefix를
재실행하고 모든 baseline receipt를 검증한다. branch에는 live sink, storage,
accounting handle, live runtime handle을 전달하지 않는다. `step(frame, {provenance})`는
완전한 명시적 frame을 요구한다. `recorded`는 해당 offset에서 캡처된 실제 future와
일치해야 한다. 다르거나 새로운 frame은 `synthetic`으로 표시해야 한다.
누락된 input을 예측하거나 기본값으로 채우지 않는다.

`rewind()`는 branch core만 다시 만들고 원래 prefix를 검증한 뒤 branch future
frame을 지운다. 전체 prefix 재구성은 durable context checkpoint에 실행 중 timer가
있다고 가정하지 않고 timer와 conditioning 의미를 보존한다. step 또는 rewind가
실패하면 기존 승인 branch를 유지한다. 반환된 복사본이나 이후 caller 변경은
기록에 영향을 주지 않는다. owner는 동시 작업을 거절하며 사용 후 dispose해야 한다.
timeline 또는 branch별 frame 수는 최대 256개이고 canonical input 기록은 1 MiB까지다.

`tests/ghost-timeline-noninterference.test.mjs`는 먼저 실제 live sink dispatch,
실제 Periodic occurrence, 저장 승인된 applied 사용량을 증명한다. ghost에서 다른
intent를 계산해도 실행과 반복 rewind는 원본 전체 timeline, context checkpoint와
occurrence identity, 실제 accounting snapshot/revision, 저장 receipt, 파일 bytes,
sink 이력을 유지한다. 이후 원본 live 실행은 중복 admission 없이 이어지고 다음
새 occurrence를 승인한다. native `context-settings-periodic-v1` tape의 전체 receipt는
framed WASM과 일치한다. 별도 profile을 추가하므로 기존 settings tape 제한을
유지한다. 이는 software reference host와 portable core의 결과이며 물리적 작동
검증은 아니다.
