<!-- translation-source: tasks/window-gfb4-design.md -->

[영문 원본](window-gfb4-design.md)

# GFB4 window 통합 계약

구현 계획이며 완성된 언어/runtime 지원 주장이 아니다.
관련 문서: [window 근거 설계](window-evidence-design.md).

## 호스트 활성화 인터페이스

두 저수준 WASM adapter는 같은 명시적 profile로 `activateTemporal(profile)`을
공개한다. Profile은 `{timeEpoch, rootDensity: [{sourceTag, maxObservations,
intervalMs}], budget: {maxRetainedSamples, maxBytes}}`다.
ControlRuntime은 이를 `options.temporal`로 받고 비동기 작업 전에 capture하며
매 scan에 고정 epoch를 공급한다. 새 time epoch에는 새 session이 필요하다.
Sensor 주기나 source window duration에서 profile을 추론하지 않는다.

제한된 activation packet은 little-endian `GFTA`, u16 version1,
u16 root 수, u64 epoch, u32 sample 예산, u32 byte 예산,
그 뒤 u32 tag, u32 최대 관측 수, u64 interval 밀리초로 된 root다.
정확한 크기는24+16N이다. N은1..31이다
(기존 입력128개 상한에서 clock2개를 빼고 root당 입력4개).
Epoch/interval은 정확한 JS-safe 정수다. Interval, density, 예산은 양수다.
Tag는 양수이고 고유하며 오름차순이다. Rust decoder는 모든 필드를 독립 검사한다.
거부된 activation은 configuring 상태를 보존한다.

Host manifest 검증은 window descriptor 영역, slot, source binding,
format 조합을 검사한다. 정본 source/nominal descriptor 동등성은
toolchain과 서명 package verifier의 책임이다.
Bytecode digest 일치만으로 호출자 제공 manifest를 인증하지는 않는다.

## 검증된 module 배치

Window를 담은 module은 기존 GFB1 magic과 format version4를 쓴다.
Window 없는 module은 기존 format 선택을 유지한다.
기존 module(1 MiB), expression/query(4,096바이트), stack(128), input(128),
strategy(32), scalar state 예산은 변경하지 않는다.
각 strategy의 scalar state 수 + window 수는128을 넘을 수 없다.

기존 scalar state 표 뒤에 다음을 encoding한다.

- `u16 nowInput`, `u16 timeEpochInput`: 각각 `__gf_now_ms`,
  `__gf_time_epoch`라는 Number 입력에 연결한다.
- `u16 rootCount`, 그 뒤 각 root: `u32 tag`, 문자열 이름,
  present(Bool), epoch/id/timestamp(Number)의 `u16` 입력 index4개.
- Root는 서로 다른 이름, 엄격한 증가 순서의 양의 tag,
  두 clock 입력과도 분리된 서로 다른 입력 binding을 갖는다.

각 strategy는 기존 이름/priority/query를 유지하고 `u16 windowCount`와
다음 descriptor를 transition/intent 전에 추가한다.

1. `u32 site`, 문자열 이름(strategy별 고유한 0이 아닌 site와 고유 이름).
2. `u8 operation`:0 average,1 minimum,2 maximum,3 rate.
3. `u8 payloadType`: 기존 Number/Int 기계 타입. Average/rate는 Number다.
   Average는 Int source 값을 Number로 명시 변환한다.
4. `u64 overMs`, `u64 maxAgeMs`: 모두1..2^53-1 포함.
5. `u16 rootRefCount`와 엄격한 증가 순서의 고유 `u16` root 표 index.
6. 기존 길이 prefix 식 blob6개, 순서대로 ok(Bool), payload(payloadType),
   fault, origin, quality, sourceTag(마지막4개는 모두 Number).

GFB4 module에는 strategy 전체에서 root/window가 각각 최소 하나 있다.
Source blob은 next state를 읽을 수 없다. 앞선 window slot은 참조할 수 있다.
Transition/intent는 자체 strategy의 모든 slot을 읽을 수 있다.
Format4는 기존 format3 식 연산을 포함한다.

Opcode57은 `[57, u16 slot, u8 field]`다.0 ok(Bool),1 value(payloadType),
2 fault,3 origin,4 admissionRevision,5 newestTimestamp,6 count,
7 quality(Number). 성공 aggregate 품질은 물리 measured 품질1이 아니라3이다.
Unavailable 품질은0이다. Format1–3과 device query는 이 opcode를 거부한다.

## Compiler 내부 형태

이는 내부 encoding 형태이며 추가 작성 언어 문법이 아니다.

```text
(temporal-context __gf_now_ms __gf_time_epoch)
(temporal-root TAG NAME PRESENT_INPUT EPOCH_INPUT ID_INPUT TIMESTAMP_INPUT)
(strategy NAME PRIORITY
  (device QUERY)
  (window SITE NAME OPERATION PAYLOAD_TYPE OVER_MS MAX_AGE_MS
    (roots TAG ...)
    (source OK PAYLOAD FAULT ORIGIN QUALITY SOURCE_TAG))
  (next ...)
  (intent ...))
(window-read SLOT FIELD)
```

OPERATION은 `average`, `min`, `max`, `rate`; PAYLOAD_TYPE은 `number`, `int`;
FIELD는 `ok`, `value`, `fault`, `origin`, `revision`, `timestamp`,
`count`, `quality`다. Window는 transition/intent보다 앞선다.
Root 선언/참조는 이미 tag 오름차순이다. 비정본 순서는 거부한다.

## 실행과 activation 계약

### Source manifest와 provenance

기존 manifest envelope를 사용한다. Window 선언은 다음을 갖춘 `signals` 항목이다.
`kind: "window"`, `name`, `site`,0부터 시작하는 `slot`,
`operation`(`average|min|max|rate`), `payloadType`, `errorType: "SensorFault"`,
`quality: "measured"`, `overMs`, `maxAgeMs`, `clockInput: "__gf_now_ms"`,
`timeEpochInput: "__gf_time_epoch"`, `sources: [{name, tag}, ...]`.
Source는 source 식이 사용하는 정렬된 물리 root다.
Rate payload 표기는 `Rate<Q>`이며 Q는 Reference whitelist에 속한다.
다른 payload는 기존 정본 type 이름을 쓴다.
Manifest에 density나 대상 예산을 작성하지 않는다.
Window module은 `GhostFlow/control-v4`를 사용한다.
Host/package 계약은 GFB format4 조합을 명시적으로 허용해야 한다.

Lowering된 aggregate Result는 별도의 derived-evidence descriptor를 담는다.
기존 물리 `sample` 구조에 물리 sample ID를 위조하지 않는다.
생성 temporal 입력과 prelude source 식은 기존 compiler input/state,
expression/stack 한계에 집계한다. Source 컴파일 성공만으로
activation, host 검증, package 수용을 증명하지 않는다.

### Runtime 트랜잭션

로딩은 density/budget/time epoch를 지어내지 않고 요구량을 검증한다.
Temporal module에는 그 fact를 갖춘 명시적 activation이 필요하다.
일반 activation과 hot swap은 거부한다. Hot-swap 이관은 미완료다.

Prelude 평가는 이전 작성 상태를 사용한다. Source ok를 먼저 평가한다.
성공하면 중복 관측이어도 payload를 즉시 평가하여 선택 식의 fault를 보존한다.
Source 실패에서는 fault/origin 분기를 평가하고 payload는 평가하지 않는다.
선택 source가 fault여도 물리 root density/연속성 관측은 계속 처리한다.

Activation은 density fact, sample/byte 예산, time epoch 하나를 공급한다.
기존 runtime 단조 clock 계약은 유지한다. Time epoch 변경에는
명시적 새 실행 session이 필요하다. Clock 영역 교체 뒤 작성 상태를 조용히
초기화하거나 temporal 이력을 재사용하지 않는다.

Window commit/rollback, 독립 TickRecord provenance, 제한된 checkpoint 이력,
rewind/replay를 함께 통합해야 한다. 두 window bank, J+1 보존 checkpoint,
record contributor, replay scratch 메모리를 집계한다.
Allocation-free window engine이 전역 allocation 보장을 뜻하지는 않는다.

Nested aggregate source에는 derived 식별자, contributor 소유권,
보수적인 누적 lookback 용량 proof가 필요하다.
물리 root wire/decoder만으로 그 지원을 확립하지 않는다.
필수 작업으로 유지하며 Reference 기대값을 바꿔 영구 제외하지 않는다.

## 수용된 Runtime API 설계

- `Runtime::activate_with_temporal(&TemporalActivation)`은
  `root_density: Vec<RootDensity>`, `budget: TargetBudget`, `time_epoch: u64`를 받는다.
  Density fact는 선택 strategy의 물리 root 합집합과 정확히 일치한다.
- `Runtime::temporal_memory_bytes()`는 집계 temporal 저장량을 보고한다.
  `max_retained_samples`는 논리 window 용량 합을 제한한다.
  Byte 한계는 checkpoint/trace contributor 목록의 중복 저장도 센다.
- Activation 상태 변경 전에 모든 engine, root/projection buffer,
  J+1 checkpoint를 할당한다. J 보존 기록과 후보/임시 기록1개의 독립 trace 근거를
  제한한다. Window arena/history/trace 배열은 포함한다.
  Allocator 관리 정보, 기존 scalar map, JSON 문자열, 호출자 clone은
  temporal-only 한계에 포함하지 않는다.
- `Runtime::replay_with_temporal(module, caps, count, &activation,
  max_peak_temporal_bytes)`는 보존 live runtime과 scratch 실행을 함께 집계한다.
  가장 오래된 보존 입력 직전 checkpoint로 scratch를 시작한다.
  반환 기록은 deep clone하지 않고 move한다.
  일반 `replay`에도 temporal 실행을 위한 이 명시적 예산이 필요하다.
- Rust TickRecord는 window trace 항목과 contributor를 소유한다.
  Temporal JSON은 `windowTrace`를 포함한다. Non-temporal JSON에는 빈 필드를 추가하지 않는다.
  Framed adapter의 소유 trace 복사도 adapter peak 검증에 포함해야 한다.
  조용히 호출자 clone으로 취급하지 않는다.
- 이관 미완료 동안 일반 temporal hot swap은 계속 거부한다.
  반복 activation은 temporal 이력을 조용히 초기화할 수 없다.
  이는 구현 공백이며 최종 Reference 요구 축소가 아니다.

각 `windowTrace` 항목은 `site`, 기계 `payloadType`(`number|int`),
`operation`, `value`(Number 또는 null), `quality`(3 또는0), `count`,
`admissionRevision`, `timeEpoch`, `nowMs`, `first`, `last`, `contributors`,
`upstreamFault`를 담는다. 항목은 slot 순서다. Contributor는
`{sourceTag, epoch, id, timestampMs, value}`다.
First/last는 contributor 또는 null이다.
Upstream fault는 null 또는 `{origin, faultCode}`다.
FaultCode는 Rust enum discriminant가 아니라 언어 순번
(Disconnected=0, Stale=1, Invalid=2, NotReady=3)이다.
Runtime dispose 뒤에도 기록은 독립적으로 읽을 수 있다.

## 통합 수용

- 구현됨: 정본 source compiler와 nominal Rate 비교;
  변경하지 않은 모든 Reference window 수용 사례와 독립 runtime oracle.
- 구현됨: 공유 core activation, rollback, trace, journal rollover, rewind, replay.
- 구현됨: legacy/framed WASM과 가상 native CLI가 명시적 density/budget/epoch를 전달.
- 구현됨: host manifest 검증이 window signal과 생성 time epoch를 인식.
  Host는 aggregate 계산이나 admission 선택을 하지 않음.
- 구현됨: source 관측이 Rust window trace를 정확한 source node/contributor에 매핑.
  정본 restore가 생성 window descriptor와 의존성을 검증.
- JS 서명 package 검증은 source/manifest/bytecode window binding을 검증한다.
  거부 테스트는 semantic guard에 도달하도록 변조 payload를 다시 서명한다.
  Native 서명 package 통합과 framed native CLI profile은 미결이다.
- 영속 이관, nested aggregate 근거, estimated-quality 근거는 별도 수용 작업이다.
  어느 것도 GFB4 loader 테스트로 인증되지 않는다.

Source-trace 통합은 관측/의존성을 모두 다룬다. 정본 windowSites 표는
파싱된 signal site와 descriptor를 연결한다.
의존성은 source 식, root 식별자, 두 clock, 하류 window 읽기를 포함한다.
Restore는 window 항목과 소비자 의존성을 fresh lowering과 비교한다.
관측은 signed-i32 값, 식별자 고유성과 순서, open-left 보존 상한,
가용 결과 근거/freshness를 검사한다. JavaScript에서 aggregate를 재계산하지 않는다.
집중 테스트 근거와 현재 통합 한계는 `window-evidence-design.md`를 참조한다.
