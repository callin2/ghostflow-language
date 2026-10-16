<!-- translation-source: docs/TEMPORARY-SETTINGS-HOST.md -->
[English original](TEMPORARY-SETTINGS-HOST.md)

# 임시 설정 reference host

`TemporarySettingsHost`는 Reference §5.2에서 채택한 overlay 수명주기를 구현한다. 새 GhostFlow 키워드는 추가하지 않는다. host는 actor 권한, Program/run identity, 단일 overlay 계층, lifetime, 복귀 provenance와 admission을 맡는다. 표현식, control state, timer, typed Result emission과 scan transaction은 `ControlRuntime`을 통해 공통 Rust core에서 실행한다.

activation은 정확히 컴파일된 literate artifact, `runId`, actor별 config ID `grants`, 제한된 history capacity와 기존 context profile을 받는다. source byte, bytecode와 manifest를 다시 컴파일해 비교한 뒤 activation한다. 조합 artifact에는 import closure를 함께 제공해야 한다. actor 권한, run identity, trusted clock observation과 승인된 checkpoint storage는 상위 host가 제공한다. actor/origin label은 인증이 아니다. 이 adapter는 Device run 발급, clock 수집, storage 저장 또는 물리 output 조작을 하지 않는다.

## 요청과 관측

`step(packet, event)`는 기존 control packet과 선택적인 식별된 host event를 받는다. 모든 event는 `kind`, 정확한 `programFingerprint`, `sourceSha256`, `runId`, `eventId`, `baseRevision`, `actor`, `reason`을 명시한다. `temporary`와 `ordinary` event는 `configId`와 typed `result`를 담은 비어 있지 않은 중복 없는 `changes`를 갖는다. `cancel`은 `cancelOverlayIds`에 원래 overlay ID를 명시한다. host가 적용 position을 할당하며 raw settings fact로 이를 우회할 수 없다.

임시 event에는 그룹 전체에 하나의 명시적 lifetime이 필요하다. `{ kind: 'Run' }` 또는 `{ kind: 'Until', dateTimeMs }`이며 후자는 밀리초 단위 절대 DateTime이다. 모든 target은 operator 편집 가능하고 actor에게 허용되어야 한다. 모든 값과 기록한 ordinary 복귀 값은 현재 Program의 타입, 범위, grid와 list capacity를 만족해야 한다. lifetime 누락, 중첩, 다른 Program/source/run, 오래된 revision, 중복 event, 알 수 없는 target과 권한 없는 요청은 core step 전에 거절한다. 새 임시 요청 전에 cancellation을 확정해야 한다. 임시 그룹 일부를 ordinary 변경하려면 전체 그룹 cancellation과 새 ordinary 변경을 한 event에 제출한다.

임시 event 직전 ordinary 값은 아래 계층에 남는다. 새 ordinary event는 해당 overlay를 제거하고 새 ordinary Result를 원자적으로 적용한다. 오래된 expiry가 이를 덮어쓸 수 없다. ordinary payload가 잘못되면 core의 그룹 전체 `fault(SettingsInvalid)`와 settings revision 의미를 보존한다. cancellation/expiry에는 실제 Result와 복귀 적용, ordinary event에 의한 대체, fault emission 중 어느 결과인지 기록하며 fault를 성공한 복귀로 표시하지 않는다.

## Lifetime, 복귀와 재시작

`Run`은 `endRun(packet)` 또는 다른 run 복원 후 첫 판단 전에 복귀한다. `endRun`은 마지막 settings 복귀 transaction을 평가하고 해당 host run을 닫으며 이후 step은 거절한다. `Until`은 정확히 같은 Program의 승인된 재시작에서 expiry 전까지 유지된다. trusted wall-time uncertainty 구간으로 expiry의 어느 쪽인지 확정할 수 있어야 한다. 시간이 Unknown이거나 구간이 expiry를 걸치면 lifetime validity를 unavailable로 보고하고 control 평가를 차단한다. 명시적 cancellation으로 시간 유효성을 추측하지 않고 복구할 수 있다. 복귀/control transaction 실패는 settings, overlay, 확정 outcome과 checkpoint를 보존하며 유효한 재시도는 미승인 identity를 사용한다.

`checkpoint()`는 정확한 Program/source, ordinary Result, overlay, core checkpoint, 완료 revision/position과 제한된 history를 digest로 결속한다. `instantiate` 복원에는 `restoreApproved: true`와 새로 제공한 `runId`가 필요하다. digest는 손상을 검출하지만 storage 인증은 아니다. 전체 overlay provenance, 권한 snapshot, 생성 event, expiry, rollback target/value와 core effective state를 검증한다. 새로운 core에 settings와 context terminal identity를 복원하지만 VM control state나 timer memory는 복원하지 않는다. settings revision은 유지하고 적용 position은 새 run에 속한다. 복원과 lifetime 판단은 첫 control 판단 전에 완료한다. Program Q에 P의 overlay를 자동 이관하지 않으며 Q에는 새로 식별하고 승인·검증한 요청이 필요하다.

## TimeSlots 복귀 경계

context settings origin tag `2`인 `temporaryReturn`은 host가 검증한 수명주기 복귀에 사용한다. 다른 origin label처럼 권한 부여가 아니다. operator 편집 가능한 target을 요구하며 타입, 범위, grid, capacity와 중복 검사를 유지한다. 복귀는 해당 stream에서 이미 할당한 row key를 다시 사용해 overlay 아래 ordinary identity를 보존할 수 있다. 아직 할당하지 않은 key는 사용할 수 없다. ordinary `operatorEdit`와 `producerObservation`은 계속 retired key를 거절한다. reference host는 기록한 복귀 key만 허용하고 복합 ordinary 변경에서 현재 row 또는 아래 ordinary row에 속하지 않은 key를 거절한다. 새 origin은 GFSF5/6의 추가 확장이며 이전 runtime은 새 tag를 거절하므로 이 요청을 소비하면 안 된다.

REF-05-018 테스트는 실제 Run/Until owner, P에서 Q로 변경 시 재검증, 그룹 cancellation, 보수적인 unavailable 처리, ordinary fault와 digest가 맞아도 잘못된 provenance의 거절을 실행한다. native Rust와 framed WASM에서 복귀 실패/재시도를 포함한 전체 core outcome, settings와 checkpoint byte를 비교한다. 이는 제공된 근거로 실행하는 reference-host 의미이며 production API orchestration, Device deployment, 물리 cutoff 또는 #89 전체 완료 증거가 아니다.

