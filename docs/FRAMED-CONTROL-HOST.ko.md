<!-- translation-source: docs/FRAMED-CONTROL-HOST.md -->
[English original](FRAMED-CONTROL-HOST.md)

# Framed ControlRuntime 도입 (D6)

주요 설계, 2026-09-11. 선정 작업: callin2/farm_studio_frontend#69,
TASK-76.6, GF-INT-COMMON-SCAN-DRIVERS. 범위는 언어 호스트와 Web 소비자 구현으로
나뉘는 모듈 간 도입 작업 하나다. language PR19 / 1b04529와 web PR71 / a6999ad를
기반으로 한다. 장치나 물리 I/O는 포함하지 않는다.

## 언어 호스트 진입점

`ControlRuntime.instantiateFramed(wasmBytes, artifact, options = {})`를 추가한다.
현재 진입점과 동일한 매니페스트 검증, 바이트코드 다이제스트 검증, 기능 바인딩 및
기존 Rust signal conditioner를 사용한다. 매니페스트 v1과 v4를 수용한다. v2는
`acceptSettings`로 허용한다. v3은 별도 opt-in 없이 수용한다. 현재 호스트 검증은
기능별 바이트코드 계약에 따라 v7, v8, v10도 수용한다. `acceptSolar` 옵션은 없다.
레거시 `instantiate`와 `instantiateSimulation`의 공개 결과 모양은 유지한다. 이제
모든 진입점이 같은 원자적 conditioner 트랜잭션 경계를 사용한다. conditioner 복사나
두 번째 평가기가 아니라 공유 생성자/helper를 사용한다.

새 진입점만 `FramedGhostFlowRuntime`을 소유한다. 각 `step`에서 호스트는 선언된
입력 전체, 샘플 및 일정 플래그를 검증하고 캡처한다. 그 다음 기존 conditioner가
sensor/signal 값+품질 입력을 만든다. Conditioner 실행 전에 원시 DI 값을 한 번 캡처한다.
DI 누락은 절대 false를 기본값으로 쓰지 않는다. 일정 플래그 누락은 기존 호스트 계약에
따라 제공된 발생 없음이라는 의미를 유지하며 민간 시간 일정을 진행시키지 않는다.

`__gf_now_ms`만 제외하고 선언/생성 입력의 완전한 목록 하나를 만든다. 타이머가 없는
프로그램도 포함해 명시적 논리 시간을 넣어 `runtime.scan`을 정확히 한 번 호출한다.
Framed 경로에서는 레거시 setter나 tick을 호출하거나 구형 산출물로 대체하지 않는다.
ABI export가 누락되면 컴파일 진단을 내고 기존 reload/retry 경로를 허용한다.

호스트는 인스턴스별 비공개 프레임 순서를 소유하며 초기값은 0이다. 성공 스캔 뒤에만
증가시킨다. 호스트 서비스 변경 전에 안전 정수 한도를 확인하며 오류 시 마지막 승인
시각과 결과를 보존한다. Framed 진입점에서만 기존 `{vm, sensors, signals}`에
`frame: {scanId, logicalTimeMs}`를 더해 반환한다. `vm`은 변경되지 않은 정본
TickRecord로 유지된다. 기존 tick 이름 공간은 frame ID와 별개다.
`lastFrameOutcome`은 framed 런타임의 새 일반 데이터 커밋 결과를 반환하는 읽기 전용
getter다 (첫 스캔 전과 레거시 모드에서는 null). 폐기 후에는 거부한다. 실행 모드와
프레임 카운터는 비공개로 유지한다.

`signals`에는 conditioner 판독값이 들어간다. VM 소유 `debounce`, `hold_last` 상태는
`vm.stateAfter`에 있다. hold 관측에는 검증된 소스 추적 메타데이터와 `vm`을
`observeSourceTrace`에 전달한다. `heldEvents`는 Rust가 계산한 Held 페이로드, 원래
샘플 식별자, 경과 시간, 마스킹된 고장을 투영한다. 어댑터와 observer는 hold 표현식을
실행하거나 TTL을 늘리지 않는다.

### 시간 창

두 어댑터를 통한 시간 재생은 다음에 규정되어 있다.
[TEMPORAL-REPLAY.md](TEMPORAL-REPLAY.md).

GFB4 창 모듈에서 `instantiate`와 `instantiateFramed` 모두 `options.temporal`을
요구한다. 실행 epoch, 물리 root 밀도 계약, 대상 시간 메모리 예산을 명시적으로 제공한다.

```js
const options = {
  temporal: {
    timeEpoch: 5,
    rootDensity: [{ sourceTag: 1, maxObservations: 3, intervalMs: 1000 }],
    budget: { maxRetainedSamples: 12, maxBytes: 33554432 },
  },
};
const runtime = await ControlRuntime.instantiateFramed(wasmBytes, artifact, options);
```

이 값은 예시이며 장치 기본값이 아니다. 소스 태그는 컴파일된 물리 root와 일치해야
한다. 밀도는 수집 상한이다. `sampleMs`로 밀도를 입증할 수 없다. Root 태그는 오름차순이며
고유해야 한다. 예산 정수는 u32에 들어가야 하고 epoch/구간은 정확한 안전 정수여야 한다.
창이 없는 모듈은 이 옵션을 거부한다. 호스트는 비동기 초기화 전에 값을 캡처하며
호출자가 이후 변경해도 세션은 바뀌지 않는다. 다른 시간 epoch에는 새 런타임 인스턴스가
필요하다. 호스트는 매 스캔마다 캡처된 `__gf_time_epoch`를 제공한다.

Rust 코어가 창을 계산한다. 소유된 증거는 `vm.windowTrace`에 있으며 계산된 품질, 직접
연결된 물리/집계 식별 정보, 선택적 상위 고장을 포함한다. 중첩 집계 기여자는 입력의
소유 증명 트리를 유지한다. observer는 이를 다른 평균으로 평탄화하지 않는다. 관측
시간은 가장 최근 기여 측정 시각을 유지하고 평가 시간은 별도다. 이는 `signals`의
conditioner 항목이 아니다. 거부된 스캔은 창 기록과 conditioner를 함께 롤백하므로
재시도에서 같은 샘플 식별자를 쓸 수 있다. `observeSourceTrace(verifiedMetadata, vm)`는
작성 선언과 연결된 `windowEvents`로 투영한다. 사용할 수 없는 집계는 자체 NotReady
site를 보고하고 상위 고장은 별도로 남는다. 소스 맵은 창 소스, 식별 입력, 시계,
하위 창 의존성을 기록한다. 소스 맵 복원은 이 연결을 정본 lowering과 대조한다.

저수준 어댑터는 동일 프로필을 받는 `activateTemporal(profile)`을 노출한다. 둘 다
제한된 GFTA 활성화 패킷과 독립 Rust 검증을 사용한다. 예산에는 시간 저장소와 제한된
추적 보존이 포함된다. JSON 버퍼, 호스트 conditioner, 호출자가 보존한 사본은 예산 밖이다.
매니페스트 검증은 구조 도메인과 바이트코드 다이제스트를 검사한다. 정본 소스/명목
설명자 일치는 도구체인/패키지 검증이 필요하다.

일반 스냅샷/형식/시간 검증은 conditioner 변경보다 먼저 이뤄진다. 이후의 Reference
4.15 원자적 틱 계약은 이 설계의 초기 롤백 불가 제한을 대체한다. Conditioner 실행
전에 호스트는 모든 센서/signal conditioner에 Rust 소유 트랜잭션을 시작한다.
Conditioning, 생성 입력 준비, 확인된 네이티브 거부가 발생하면 전부 롤백하고 승인된
논리 시간과 프레임 ID를 유지해 호출자가 재시도할 수 있다.

양수 네이티브 스캔은 결과 디코딩 전에 모든 conditioner, 논리 시간, 프레임 ID를
커밋한다. 이 경계 뒤의 실패는 승인된 상태를 되돌릴 수 없으며 호스트를 종료시킨다.
네이티브 커밋 상태를 알 수 없는 trap도 롤백을 꾸며내지 않고 호스트를 종료시킨다.
어댑터가 계속 읽을 수 있으면 커밋된 VM 결과를 제공한다. 전역 제약으로 false 출력이
발생해도 성공 스캔이지 호스트 고장이 아니다. Dispose는 소유 중인 모든 conditioner와
framed 핸들을 해제한다.

## Web 소비자

검토된 언어 호스트 커밋을 고정하고 기존 엄격한 소스/산출물 guard를 통해 실제 일치
WASM을 빌드한다. 언어 선행 조건이 독립 검토를 통과할 때까지 pin 갱신은 main이
담당한다. `compilePlaygroundSource`는 `instantiateFramed`를 사용하고 컴파일 성공마다
새 `runEpoch` (UUID)를 지정한다. 사용자의 preview 체크아웃은 수정하지 않는다.

`runPlaygroundScan`은 존재하는 불리언 DI 항목 정확히 8개를 받는다. 호스트 호출 전에
잘못된 길이, 구멍, 불리언이 아닌 값을 거부한다. 분리된 스냅샷을 사용한다. 추론된
false 입력 대체를 제거한다. UI 결과 게시 전에 호스트가 승인한 프레임 ID/시간을
검증한다. RO1..RO8은 해당 결과의 마지막 `vm.safe` 뱅크에서만 가져오며 각각 명시적
불리언이어야 한다. 요청 출력을 쓰거나 결과 없음 상태를 false로 처리하지 않는다.

ControlRuntime 안에서 정본 VM 출력을 변경하지 않는다. Web 관측은 추적에
`scanFrame: {runEpoch, scanId, logicalTimeMs}`를 붙일 수 있다. 이는 변경된 Rust
TickRecord가 아니라 로컬 선언에 호스트 메타데이터로 문서화한다. 기존 기록, 비교,
재생 데이터에 이를 전달한다. 의미 비교에서 run-epoch 식별자를 무시한다. 별도 실행은
의도적으로 서로 다른 epoch를 쓴다. 브라우저 검사에 유용하면 전송 data attribute로
현재 승인된 식별자를 노출한다. 별도 설명 문구나 새 레이아웃은 필요하지 않다.
Compile/reset은 epoch를 교체한다. 재컴파일 거부 시 마지막 정상 인스턴스/식별자를
유지한다. Pause와 one-step은 epoch를 바꾸거나 프레임 ID를 건너뛰지 않는다.

## 검증 및 완료

언어: 실제 빌드 WASM, 기존 모든 gate, 새 진입점의 완전/생성 입력 동등성(타이머,
센서/signal, 일정, 제약), 타이머 유무 프레임, 안전한 식별자 진행과 거부, 레거시
export 미호출, 확인된 거부의 롤백 및 동일 ID 재시도, 커밋 상태 불명/커밋 후 고장 고정과
커밋 결과 보존, 구형 산출물 및 dispose 처리.
Web: 단위/형식/빌드/소스 guard, 엄격한 재사용 금지 브라우저 서버, 기존 lesson/replay/
source-trace 및 속도 테스트, 승인 프레임/epoch 연속성, 제약, 컴파일/reset 실패,
호스트 호출 전 잘못된 DI 거부.

언어 선행 작업은 자체 exact-head gate를 통과하면 병합할 수 있다. Web이 산출물을
고정하고 실행하기 전까지 상위 D6는 Done이 될 수 없다. D9 네이티브 framed-tape 동등성과
D7/D8/D11 장치 통합은 별도 작업이다.
