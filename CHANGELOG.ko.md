<!-- translation-source: CHANGELOG.md -->
[영어 원문](CHANGELOG.md)

# 변경 기록

## 미출시

### 2026-10-06 — 실행 가능한 의도 출처 진단 ([#537](https://github.com/callin2/ghostflow-language/issues/537))

Reference 1.2 의도 링크 계약의 버그 수정입니다. 스키마 요청에서 링크 없는
`state hot: Bool = false;`는 짧은 메시지만 반환했지만, 이제 원본 선언 위치와
Markdown anchor 및 인접 코드 link를 설명하고 소스/문서/리비전 ID를 보존합니다.
수정 힌트는 작성자 검토를 위한 명시적인 미확인 AI 가정(`relation=assumes`)이며,
확인된 의도를 만들어 내거나 소스를 자동 수정하지 않습니다. Node와 브라우저
회귀 검사에서 state/timer/operator config 수정이 실행 바이트 변경 없이 컴파일됩니다.
기존 출처 거부 및 스키마 식별 검사, 문법, GFB/ABI, 런타임, 릴리스 정책은 유지됩니다.
### 2026-10-06 — Boolean 요청 출력 설명 ([#283](https://github.com/callin2/ghostflow-language/issues/283))

Reference 5.3의 제한된 실제 평가 경로 관찰을 추가한다. 선택적 Rust VM
instruction witness와 artifact에 결속된 compiler sidecar가 한 완료 scan의
지원되는 요청 Bool 표현식을 설명한다. false gate와 0 divisor를 사용한
`pump <- gate && (1.0 / divisor > 0.0)`에서 첫 항의 false가 OFF의 근거이며
생략된 둘째 항에는 실제 값이나 support가 없다. 공유 DAG의 support는
parent/output occurrence별로 구분한다. 기존 GFB bytes와 실행 의미는 유지한다.
실패 scan은 새 완료 proof를 만들지 못하며 source/module/run/scan/time join은
stale을 구별한다. `tests/explanation-path.test.mjs`가 실제 native/WASM parity와
거부 경계를 검증한다. timer/schedule/composition/safety/Result/transition proof는
명시적 미지원이며 issue88 전체 완료나 하드웨어 검증을 주장하지 않는다.


### 2026-10-05 — 품질 기반 canonical input ([#531](https://github.com/callin2/ghostflow-language/issues/531))

외부 `input` 선언은 기존 sensor의 Result, conditioning과 optional capability
규칙을 계승한다(Reference 1/4). `input request: Bool;`은
`request |> recover(true)`처럼 명시적으로 처리한다. healthy false는 false다.
기존 `sensor` 선언은 새 revision migration 진단으로 거부한다. 저장 소스/이력은
보존하고 이전 plain input의 fault 정책을 검토한다. Bool/Number/quantity wire
정보, GFB 형식과 WASM ABI는 그대로다. Int와 기존 Duration/Date/TimeOfDay/DateTime scalar 범위에도
반올림 없이 같은 타입별 품질 계약을 적용한다. 잘못된 숫자 관측값은 Invalid가
되고 정확한 payload는 identity filter를 유지한다. canonical input 회귀 검사는
plain/framed WASM의 품질, conditioning과 bytecode 일치를 다룬다. optional Int
capability는 기존 Int tag를 유지해 설치된 입력이 품질과 무관하게 present
전략을 선택한다. Host는 Bool의 숫자 범위를 거부하며 source replay는 서명된
전체 quality descriptor가 canonical input conditioning과 일치하는지 검사한다.
별도로 서명한 metadata 대체로 이 계약을 바꿀 수 없다. native package는
취득 metadata의 타입별 범위와 생성된 sample identity를 별도로 검사한다.
canonical source를 다시 컴파일하는 검사는 아니다.

At 전용 예약 프로필도 typed quality input을 허용한다. 기존 sensor 분류 금지는
이미 지원하던 외부 예약 조건의 canonical 대체 입력까지 거부했으므로 제거했다.
명시적인 `allow |> recover(false)`는 사용할 수 없는 조건의 실행을 차단한다.
At clock/recovery 규칙, GFB14와 context ABI는 유지한다. At 계약, native/WASM
실행 parity 및 fault 회귀 검증으로 이 수정을 확인한다.
Bool의 `valid` 범위는 host/native admission과 동일하게 컴파일 단계에서 거부한다.
이전에는 boolean 범위가 어느 host에서도 실행할 수 없는 manifest를 만들 수 있었다.

현재 curriculum, tutorial, book과 test fixture는 새 source revision에서
Result를 명시적으로 처리한다. 원본 바이트와 과거 replay identity는 보존한다.
producer quality는 물리 버튼 고장 진단과 구분하며 공통 재시작 정책이나
START 버튼을 강제하지 않는다. 공개 선언 진단은 input으로 표기하고 기존
내부 sensor 분류는 유지한다.

참조 소프트웨어 producer는 값이 실제로 공급됐을 때만 새 타입별 관측을 제출한다.
clock-only frame은 Good 관측을 만들지 않는다. 초기 상태는 NotReady이고 기존
freshness 규칙에 따라 Stale이 될 수 있다. 정상 false와 0은 Good이다.
Simulator, console과 live adapter는 같은 canonical source를 유지한다.
Ghost Timeline은 명시적 품질 sample을 기록·재생하면서 live sink와 ledger를
바꾸지 않는다(Reference 4.2/6.8). 소스에 결합된 resource mode 검증은 canonical
Bool input을 인식한다. 서명된 composition package의 sensor-instance 정보는
전체 canonical source replay 후에만 승인한다. 과거 GFB10 프로필은 지원하지
않는 해당 필드를 bytecode 로드 전에 거부한다. GFB와 ABI는 바꾸지 않는다.
software producer, timeline, package 변조와 resource binding 회귀 검사가
이를 다룬다.

instance의 scalar output에서 다른 instance input으로의 내부 연결은 기존
타입별 `ok` 생성자를 재사용해 실제 계산값을 받는 쪽의 Result 계약으로
lift한다(Reference 6.2/6.4). 취득 관측이나 sample lineage는 생성하지 않는다.
받는 소스는 Result를 명시적으로 처리해야 한다. 계산 포트의 conditioning은
거부하며 이전 상태 feedback과 cycle 제한은 유지한다. 예를 들어
`connect B.previous <- A.previous;`는 물리 producer를 요구하지 않고 기존
확정 상태 경계를 유지한다. 기존 `map(fn)`과 `and_then(fn)`은 새로운 runtime
HOF 없이 순수 함수와 Result 반환 함수를 연결한다. native/WASM 상태 지연,
선언 순서와 Result 전파 회귀 검사가 이를 다룬다.

Reference 4.2의 준비 조건을 복원하는 버그 수정: `recover_after = 3 samples`는
고장 후뿐 아니라 초기 시작, reset과 source epoch 변경에서도 서로 다른 새
정상 관측 세 개를 요구한다. 이전에는 초기 시작/reset에서 이 조건을 건너뛰었다.
필터도 준비됐다면 세 번째 관측부터 사용할 수 있다. 중복 전달과 읽기는 수를
늘리지 않는다. fault, stale reception과 source reset은 새 준비 순서를 시작한다.
기본 one-sample 동작은 유지한다. Rust와 실제 plain/framed WASM 회귀 검사는
사용 불가 품질, 정상 false/0 및 명시적 ROP fault 전파를 보존한다.
시간 기반 annotation, ABI 또는 application 재시작 규칙은 추가하지 않는다.

기존 소스의 `map + debounce(stable_for: 2min) + Result case` 조합으로 시간
기준 준비도 검증했다. 새 문법은 없다. 첫 conditioned Good 관측부터 기간을
재며 deadline 이후의 새 Good 관측에서만 준비를 완료한다. clock-only scan과
중복 전달은 완료 조건을 만족하지 않는다. fault, stale과 epoch 변경은 준비를
다시 시작한다. `recover_after = N samples`는 N번째 관측부터 사용한다는 뜻이다.
처음 N개를 버리려면 기존 1..31 범위에서 N+1을 지정해야 한다.
plain/framed/native 회귀 검사가 이 조합을 다룬다.

bound resource mode binding은 canonical Bool input을 생성된 value rail에
연결하고 permission을 읽기 전에 짝인 OK rail을 검증한다. 사용할 수 없는
mode 관측은 기존 필수 Bool permission의 누락/타입 오류처럼 원자적으로
거부한다. false/OFF나 새 trip 정책으로 바꾸지 않는다. 같은 scan의 수정된
재시도 및 기존 소스에 명시된 admission, safe vector와 재무장 동작을
native/plain/framed 회귀 검사로 다룬다. GFRB/GFRS/GFB17 버전과 형식은 유지한다.

### 2026-10-03 — 보존 범위의 관찰 event gap 보고 ([#282](https://github.com/callin2/ghostflow-language/issues/282))

명시적 event와 completed snapshot을 분리해서 보존하는 소스에 결합된 참조 Host journal을 추가한다. sequence10의 소비자는 보존 범위가14부터 시작하면 누락 범위11–13과 원래 event14를 받으며 snapshot에서 만든 가상 event는 받지 않는다. 전체 발행을 원자적으로 검증하고 거부된 batch는 같은 scan에서 재시도할 수 있으며 cursor는 정확한 source/Program/schema/run identity에 결합한다. REF-05-022는 실제 native/framed-WASM trace, 전체 Host 전달 및 새 replay를 검증한다. 이 참조 API는 source 문법, Interaction snapshot v0, 물리 증거 또는 실행 환경의 최종 event 전송을 바꾸지 않는다.

### 2026-10-03 — source에 결합된 instance trace projection ([#291](https://github.com/callin2/ghostflow-language/issues/291))

REF-06-003 instance 표시와 trace projection을 위한 production 참조 어댑터를 추가한다. 이 어댑터는 activation 전에 supplied artifact를 다시 컴파일하여 정확한 root source, imported closure의 text/revision/digest, bytecode, manifest, source map 및 trace metadata를 검증한다. Presentation label은 실제 컴파일된 instance ID를 정확히 대상으로 해야 하며 별도 metadata로 남는다. 이 label은 instance를 rename하거나 source revision을 작성하지 않는다. Projection은 이제 `observeSourceTrace()` 결과를 사용하고, 방출된 source-map owner와 authored symbol에서 identity-keyed entry를 반환하며 private VM slot suffix를 public meaning으로 만들지 않는다. 잘못된 label, caller mutation 시도, 잘못된 source/manifest/closure provenance 및 다른 trace module identity는 projection 전에 거부된다. Source grammar, evaluator 또는 Reference semantics 변경은 없다.

### 2026-10-03 — Program에 결합된 임시 설정 ([#279](https://github.com/callin2/ghostflow-language/issues/279))

그룹 단위 Run/Until 운영 설정을 위한 참조 Host를 추가합니다. 임시 값은 직전 일반 값을 기록하고, 평가 전에 만료 또는 취소하며, 수명이나 복귀 유효성을 확인할 수 없으면 결정을 막습니다. 같은 Program에 대한 명시적 승인으로만 새 Run에 복원합니다. 잘못된 일반 값 대체는 전체 SettingsInvalid 경로를 따릅니다. 형식 있는 context 설정 origin(tag 2, temporaryReturn)은 검증된 복귀에서 이미 할당한 TimeSlots 행 식별자를 보존하며 일반 편집의 삭제 및 할당 검사는 유지합니다. 행위자 권한과 체크포인트 승인은 신뢰하는 Host 입력입니다. REF-05-018은 native/WASM의 전체 결과와 체크포인트 바이트를 비교합니다.

### 2026-10-03 — 서명된 재사용 source closure 보존 ([#309](https://github.com/callin2/ghostflow-language/issues/309))

Portable composition package는 이제 정확히 pin된 transitive source closure를 보존한다. 이전에는 서명 과정에서 provenance가 빠지고 검증이 문서 없이 import를 lowering하려 했다. 검증은 서명된 closure를 다시 컴파일하여 전체 bytecode, manifest 및 source-map identity를 비교한 뒤 target admission을 허용한다. 다시 서명한 instance 변조도 거부한다. REF-06-025는 native/WASM instance 격리와 검증된 package의 effect-free replay를 확인한다. 기존 package format과 plain-control replay 정책은 바뀌지 않는다.

### 2026-10-03 — dependency 및 ownership 거부 맥락 보완 ([#301](https://github.com/callin2/ghostflow-language/issues/301))

Reference §6.6의 진단 상세를 복원한다. 누락되거나 revision이 다른 import는
import alias, 영향받는 instance/port, 기대 revision/digest 및 실제 누락 또는
제공된 identity를 명시한다. 중복 supplier는 두 writer를 유지하고 영향받는
definition/instance/port, supplier 하나라는 기대, 실제 개수, pinned 근거와
교정 선택을 추가한다. 예를 들어 `pump`의 두 writer는 activation 전에
`Relay/east/pump`와 `Relay/west/pump`를 모두 명시하여 거부한다. 이전에는
이유와 writer 이름만 있었고 해당 contract 맥락이 빠져 있었다. 기존 error
class/category, 작성 위치, 첫 실패 순서 및 후보 거부는 유지한다. 진단 문구가
더 상세해지지만 source 문법, artifact 또는 ABI는 바뀌지 않는다. REF-06-015
거부 테스트와 수정된 source의 전체 native/framed-WASM 실행/replay로 검증한다.


### 2026-10-03 — 혼합 UTC Range와 비공개 config snapshot 복구 ([#503](https://github.com/callin2/ghostflow-language/pull/503))

Reference §§3.5–3.6과 §5의 설정 관측 동작을 복구하는 버그 수정이다.
GFB20에서 config로 선택한 `DailySlots` Range와 일반 UTC `Daily` Range를
함께 로드한다. 이전에는 일반 schedule 때문에 activation이 실패했다.
완료 scan snapshot은 공개 설정과 함께 선언한 비공개
`config internal: Bool = true;`를 수락한다. 모든 compiled config의 정확한
runtime 식별자, source 기본값과 emission provenance 검사는 유지하며 공개
descriptor만 투영한다. 기존 native/framed-WASM 동등성 및 설정 provenance
테스트가 혼합 activation·실행과 비공개 행 변조를 검증한다. format/ABI 변경이나
Device·하드웨어 검증을 주장하지 않는다.

### 2026-10-02 — 경쟁하는 두 output writer 식별 ([#300](https://github.com/callin2/ghostflow-language/issues/300))

조합 duplicate-supplier 진단은 두 원본 writer endpoint를 모두 명명하거나 root
output expression과 instance connection을 구분한다. 예를 들어
`connect pump <- east.pump`와 `connect pump <- west.pump`는 여전히 activation
전에 거부되며 이제 `east.pump`와 `west.pump`를 함께 식별한다. 이전에는 공유 sink만
명명했다. 기존 진단 종류, 정본 두 번째 writer 위치와 거부 동작을 유지한다.
last-writer 정책, arbitration이나 artifact/ABI 변경을 도입하지 않는다. Reference
§6.5의 정확한 테스트는 writer·선언 순서 양쪽, expression과의 혼합 충돌 및 별도
channel의 native/framed-WASM 전체 결과 일치를 검증한다.

### 2026-10-02 — transitive import cycle의 닫는 edge에서 진단 ([#298](https://github.com/callin2/ghostflow-language/issues/298))

컴파일러는 닫는 import edge의 revision/digest를 검사하기 전에 원본 위치에서
executable import cycle을 보고한다. 이전에는 순환 digest 불일치가 구조적 cycle을
가렸다. 예를 들어 pinned `root -> A -> B -> A`는 B가 A를 import하는 위치에서
cycle로 거부된다. 순환이 없는 import는 여전히 모든 정확한 immutable revision과
UTF-8 source digest를 요구한다. resolver, fallback이나 artifact format은 바뀌지
않는다. 두 dependency의 canonical 테스트는 저장된 전체 closure 재검증, 변조 거부,
원본 위치의 누락·floating·불일치 pin과 native/framed-WASM 전체 실행 결과를 확인한다.
이는 Reference §6.4의 구체적 cycle 거부를 복구하는 수정이며 package나 배포 정책을
채택하지 않는다.

### 2026-10-02 — 설정 관측을 source 기본값과 수락 emission에 연결 ([#273](https://github.com/callin2/ghostflow-language/issues/273))

설정 stream이 행별 수락 emission revision과 적용 position을 불변 source 식별자 및 전역
settings revision과 구분해 유지한다. 초기 5분 Duration은 다른 Bool 수정 후에도 override가
아니며 같은 값의 성공 emission도 이후 override다. 현재 fault는 과거 성공값·기본값의
유효값 fallback이나 성공 전용 override 없이 fault를 표시한다. 새 설정 Interaction schema는
source 기본값을 포함한 명시적 버전 0.4이고 snapshot은 전역·행 provenance를 연결한 0.2다.
legacy 0.3/0.1 설정 문서는 원래 검증과 digest를 유지하며 설정이 없는 문서는 변경하지 않는다.
context checkpoint 버전 4가 metadata를 저장하고 초기값·allocator·이력·최신 revision·atomic
position 불일치를 owner 변경 전에 거부한다. 실제 canonical native/framed-WASM 테스트가
전체 outcome·설정·checkpoint, 권한/VM rollback과 checksum을 복구한 의미적 변조를 검증한다.
실행 descriptor binding·publishing 식별자·Device 채택·하드웨어 검증은 주장하지 않는다.

### 2026-10-02 — what-if 재생 입력 누락 보고 ([#304](https://github.com/callin2/ghostflow-language/issues/304))

제한된 reference host가 event-sourced 기록 prefix checkpoint에서 plain control의 실제
source-bound ghost branch를 실행한다. 각 미래 프레임은 완전한 기록 입력과 센서 sample을
요구하며 누락되면 branch 실행 전에 보고한다. fault sample을 포함한 명시적 가상 입력은
synthetic provenance를 표시해야 한다. 새 일회용 runtime이 원본 기록과 이후 live 실행을
보존한다. canonical native/WASM 테스트는 전체 VM trace·상태·requested/safe 출력을 비교한다.
이 프로파일은 같은 Program과 가상 binding을 사용한다. 외부 메모리 checkpoint,
settings/schedule, Device 실행과 환경 모델은 범위 밖이다.

### 2026-10-02 — keyed TimeSlots Range의 atomic 중첩 검증 ([#267](https://github.com/callin2/ghostflow-language/issues/267))

Reference §§3.5–3.6은 하루를 나누는 정수 분 grid에서 `TimeSlots<G,N>`로 선택한
UTC `DailySlots<G>`와 양의 고정 Duration을 GFB20/control-v20으로 실행한다.
이전에는 이 keyed Range 형식을 거부했다. 08:00 `range(20min)`을
`[08:00, 08:15]`로 바꾸는 live 제안은 설정/scan transaction 전체를 거부하고,
맞닿는 `[08:00, 08:20]`은 성공한다. preflight는 이미 admit한 제거된 key도
보호한다. retime은 occurrence identity를 유지하고, key 제거는 admit한 작업을
유지하며, 추가/재추가는 새 key와 신뢰할 수 있는 추가 baseline을 사용한다.
변경된 key는 신뢰할 수 있는 wall time 없이는 atomic하게 거부한다. 빈 목록은
유효하고 승인된 fault는 새 plan을 만들지 않으며 과거 key를 보존한다. GFRG4는
keyed 설정, allocator, baseline과 consumed history를 저장하고 restore에서 검증하되
timer를 재개하지 않는다. 이전 consumer는 새 format을 거부하며 GFRG1/2/3은 별도로
유지한다. REF-03-078은 원래의 정적 slots/live Duration 중첩 사례를 포함하여 실제
native/WASM trace, 전체 checkpoint와 rollback을 비교한다. 비 UTC/DST, calendar,
live TimeSlots와 Duration의 조합, Run cancellation 정책은 이 profile 밖에 있다.

### 2026-10-02 — 영속 확인 없는 accounting admission 차단 ([#269](https://github.com/callin2/ghostflow-language/issues/269))

Reference §3.10 `on_unknown = block`을 복원하는 버그 수정이다. 현재 revision에 영속
확인이 없는 ledger는 reservation, revision 또는 persistence를 바꾸기 전에 rolling
reservation admission을 거부한다. 이전에는 `initializeEmpty`의 저장이 실패해 읽기가
Unknown이어도 5초 reservation을 생성할 수 있었다. 누락·손상 ledger는 계속 차단하며
pending 정확한 재시도도 명시적 `persistPending` 복구 전에는 차단한다. 복구 후 알려진
중복은 멱등성을 유지한다. REF-03-080은 같은 canonical count-fault-to-false program과
source에서 유도한 보호 policy의 실제 native/WASM ABI trace, 전체 ledger와 admission
결과를 비교한다. source-bound 참조 host admission이며 자동 VM/resource 또는 물리
binding은 아니다. source grammar와 직렬화 ABI format은 바뀌지 않는다.

### 2026-10-02 — live scalar Range 시작 설정이 활성 occurrence를 재시각화 ([#266](https://github.com/callin2/ghostflow-language/issues/266))

Reference §3.5는 이제 고정 Duration을 가진 제한된 실행 가능 UTC Daily Range profile에서 scalar `Daily.at` source로 `TimeOfDay` config를 받을 수 있다. 성공한 원자적 live settings event는 이미 admit한 occurrence를 original local date와 새 유효 시작 시각으로 다시 계산하며 같은 occurrence ID와 due ledger를 유지한다. 08:00 `range(10min)`이 08:04에 admit된 뒤 08:07에 08:08로 편집되면 즉시 일시 비활성화되고 08:08에 다시 active가 되어 08:18에 끝난다. 08:02로 편집하면 08:12에 끝난다. GFB19 encoding은 start config id를 담는다. calendar, 비 UTC, multi-slot, Periodic, live start+Duration 조합은 static metadata로 fallback하지 않고 거부한다. Checkpoint는 승인된 scalar start 설정과 소비한 history를 저장·검증하지만 active timer를 재개하지 않는다. REF-03-077은 native/WASM framed parity test로 검증한다.

### 2026-10-02 — live Range Duration 설정이 활성 occurrence를 재시각화 ([#265](https://github.com/callin2/ghostflow-language/issues/265))

Reference §3.5의 `range(duration)`은 이제 work calendar가 없는 실행 가능한 UTC Daily/DailySlots GFB12 Range에서 `Duration` config를 받을 수 있다. 성공한 원자적 live settings event는 frozen planned start에서 활성 occurrence를 다시 계산한다. 08:00 계획을 08:04에 10분으로 admit한 뒤 08:07에 12분으로 편집하면 같은 occurrence가 유지되고 08:12에 끝난다. 5분으로 편집하면 event 위치에서 종료한다. 새 due pulse나 occurrence ID를 만들지 않는다. 승인된 duration은 GFRGv2 checkpoint에 보존되어 복구 뒤 다음 occurrence도 live 값을 쓴다. 잘못된 typed 값은 기존 settings-fault 결정이 되며 승인된 duration을 바꾸지 않는다. REF-03-076은 native/WASM trace와 checkpoint parity를 검증한다. GFB12 encoding은 duration 0 sentinel 다음 기존 config id를 쓰며, 이전 GFB12 consumer는 이 새 encoding form을 거부한다.

Live Range config는 runtime loader와 동일하게 컴파일 시 양수인 최소 Duration을
요구한다. 지원하지 않는 calendar binding과 중첩을 만드는 live 제안은 명시적으로
거부하며, 거부한 envelope는 settings revision과 전체 context checkpoint를
변경하지 않는다. clock trust가 unknown이거나 wall 보정으로 날짜가 바뀌어도
이미 admit한 frozen origin으로 재시간화를 수행한다.

### 2026-10-02 — 영속 이벤트 count의 불완전 상태 ([#268](https://github.com/callin2/ghostflow-language/issues/268))

WASM accounting adapter는 알려진 ledger의 최신 revision에 영속 저장 승인이
없으면 `LedgerIncomplete`을 반환한다. 이전에는 이벤트 저장이 실패한 뒤에도
초기화 당시의 `LedgerMissing`을 유지했다. 누락·손상 ledger는 각각의 fault를
유지하며, 저장 승인에 성공하면 정확한 count로 복구된다. REF-03-079는 실제
native/WASM control trace와 직렬화된 ledger를 비교한다. 내부 production 변환
경계 테스트는 수십억 이벤트를 할당하지 않고 `CountOverflow`를 검증한다.

### 2026-10-02 — 영속 rolling 예산 설명 ([#260](https://github.com/callin2/ghostflow-language/issues/260))

Reference §4.15에 실제 Rust ledger를 읽는 소스 바인딩 reference host 조회를
추가했다. 영속 revision, 예산 거부와 조건부 가장 빠른 해제 시각을 제공한다.
겹친 [0,20s]/[10s,30s] interval, 60s window, 30s 한도, 5s 제안은 OFF animation과
무관하게 64.999s에 거부하고 65s에 허용한다. REF-04-066은 복구/activation과
영속 승인 전 Unknown을 검증한다. 소스 한도를 복사하고 동결하여 caller의
메타데이터 변경이 검증된 소스 정책을 위반하던 버그를 수정했다. 이전에는 공개
한도를 99s로 바꾸면 허가되지 않은 예약을 허용했지만 이제 변경 시 예외를 던지고
불일치 예약을 거부한다. 수정 전후 probe와 불변 바인딩 회귀 검증이 복구된 계약을
확인한다. 추가 query export를 위해 WASM을
재빌드해야 하지만 GFB/snapshot 형식은 유지된다. 신뢰 증거, owner 내부 revision,
통합 한계는 [host 계약](docs/ROLLING-BUDGET-EXPLANATION.ko.md)을 참고한다.

### 2026-10-02 — 제한된 적응 제안 검증 버그 수정 ([#258](https://github.com/callin2/ghostflow-language/issues/258))

Reference §4.14 정책 경계가 컴파일 descriptor에서 빠졌고 reference host가 제안의
변화량 한도를 검증하지 않았다. 이제 컴파일 시 typed 경계를 검사하고 전달하며 새
`AdaptationSettingsHost`가 신뢰된 actor 권한과 모든 property를 검증한 후 기존
Rust atomic 설정 event 하나를 제출한다. 20%→30%로 시간당 10% 한도를 소비한 뒤
30%→25%를 포함하는 두 property 제안은 값과 revision을 바꾸지 않고 모두 거부한다.
REF-04-064가 실제 WASM 활성화와 snapshot, rolling 절대 변화량, 정확한 Int/Duration
격자, 제한된 식별자·이력 검증을 확인한다. GFB/WASM ABI는 그대로지만 경계가 필수이므로
기존 adaptation manifest를 다시 생성해야 한다. 이 reference profile은 설정
checkpoint 복구나 API/Device 통합을 제공하지 않는다.

### 2026-10-02 — Station 원자적 mode 진입 binding 버그 수정 ([#250](https://github.com/callin2/ghostflow-language/issues/250))

Reference §4.10은 같은 tick의 충돌 mode 진입을 모두 거부한다. 기존 WASM
어댑터는 `enter()`만 노출하여 Stopped에서 Manual 다음 Configure를 순차 호출하면
Manual이 선택될 수 있었다. 이제 `enterBatch([{requestId: 5n, ...claim,
mode: 'Manual'}, {requestId: 6n, ...claim, mode: 'Configure'}])`가 기존 Rust의
원자적 계약을 호출하여 변경이나 지연 진입 없이 둘 다 거부한다. 호스트는 여전히
관측한 Stop을 진입 및 새 작업보다 먼저 처리한다. 기존 단일 진입 export,
source profile 및 GFB/GFS 형식은 그대로이며 batch 호출자는 추가된
`gf_station_enter_batch` export가 필요하다. REF-04-052는 native/WASM 동등성,
Stop cleanup과 명시적 재시도, 잘못된 batch와 오래된 claim 검사를 포함한다.

### 2026-10-02 — 합성 EMA signal 실행 ([#237](https://github.com/callin2/ghostflow-language/issues/237))

Reference §4.3의 이름 있는 numeric EMA 단계를 공유 Rust VM의 유한 상태로
컴파일한다. 이전에는 `signal smooth = ema(moisture, alpha: 0.5);`를 거부하여
문서의 sensor median → EMA 합성을 실행할 수 없었다. EMA는 upstream Result와
원래 물리 sample identity를 소비한다. 중복 sample과 clock-only tick은 recurrence를
바꾸지 않으며 fault는 기억을 비우고 provenance를 보존한다. upstream의 준비·복구
조건과 freshness를 그대로 따른다. 단일 source EMA마다 scalar 슬롯 세 개와 source
identity 슬롯 두 개를 사용하며 source epoch 변경은 reseed한다. bytecode/ABI 형식
변경이나 암묵적인 recovery 정책을 추가하지 않는다. 지원되는 단계는 단일 물리
source를 가진 numeric SensorFault Result를 요구한다. REF-04-024 native VM/plain/framed
WASM trace와 atomic rollback·invalid contract 회귀 검증으로 복원된 동작을 확인한다.

### 2026-10-01 — 근무 달력 경계의 실행 ([#225](https://github.com/callin2/ghostflow-language/issues/225))

Reference §3.8의 `calendar_is` Result 식과 불변 UTC Daily work/off-day range를
GFB18 및 `GhostFlow/control-v18`의 공유 Rust context engine으로 실행한다.
이전에는 채택된 이 표면의 실행 lowering이 없었다. host는 식별된 calendar snapshot을
공급하고 Rust는 missing, coverage 밖, expiry fault를 보존한다. Result를 명시적인
fault 처리 없이 부정하여 허가로 만들 수 없다. 자정을 넘는 work range는 거부한다.
`23:45`와 `range(15min)`, `00:00`와 `range(15min)`을 각각 별도 선언으로 나눈다.
정확히 자정에 끝나는 range는 유효하며 일반 UTC range의 기존 동작은 유지한다.
제한된 profile은 명시적인 UTC binding을 요구한다. shift 귀속, 비 UTC Range 정책,
Run overlap 규칙을 추가하지 않는다. 이전 loader는 GFB18을 거부한다.
정확한 REF-03-041 oracle은 `tests/reference-calendar-boundary.test.mjs`와
공유 core/native/WASM 검증으로 확인한다.

### 2026-10-02 — 현재 Periodic 패키지의 서명된 승인

기존 패키지 검증기는 GFB11에서 config 전용 서두만 허용하여 현재 컴파일러의
`config interval: Duration = 15min` 및 `schedule cycle: Periodic` 결과를
거부했습니다. 이제 서명된 GFB11/control-v10 패키지는 스칼라 config,
instant anchor, 생성 입력 및 schedule 설명자가 바이트코드와 일치하는
범위에서 이 Periodic 형식을 승인합니다. 다른 schedule 종류와 미지원
서두는 계속 거부합니다. 기존 소스·서명 검증과 config 범위 검사,
Device 승인은 그대로 필요합니다. 회귀 검사에서는 서명된 REF-03-036이
native target loader에 도달하며, 재서명한 설명자 바꿔치기는 그 전에
거부됩니다. [Device 이슈 #74](https://github.com/callin2/farm-device/issues/74)의
의도된 패키지 경로를 복구합니다.

### 2026-10-01 — 바인딩된 작성 상태 출처 버그 수정 ([#158](https://github.com/callin2/ghostflow-language/issues/158))

유한 바인딩 자원 프로필에서 의도 anchor와 연결한 작성 Bool 상태도 브라우저 API로
컴파일하고 완료된 scan의 관찰값을 생성합니다. 이전에는 실행 불가능한 descriptor에
의도 anchor를 붙이면 실행 trace 배열이 없어 literate 소스 위치 변환이 실패했습니다.
이제 descriptor는 명시적인 빈 출처 구조를 제공하고, 바인딩은 실제로 낮춘 프로그램의
실행 바인딩을 유지하며 descriptor의 의도 anchor와 링크만 추가합니다. 없는 필드에서
실행 메타데이터를 추정하지 않습니다. `tests/bound-resource-control.test.mjs`에서
정규 상태·anchor 위치와 실제 WASM의 `remembered` 관찰값이 `true`에서 `false`로
바뀌는 것을 검증합니다.

### 2026-10-01 — 브라우저 바인딩 자원 모듈 ([#158](https://github.com/callin2/ghostflow-language/issues/158))

공개 브라우저 컴파일러가 바인딩 자원 컴파일·검증·trace 관찰을 재수출합니다.
이식 가능한 런타임 경로는 `runtimes/wasm/bound-resource-control.mjs`이며,
현재 Node 경로는 동일한 구현과 writer 레지스트리를 재수출합니다. 유한 GFB17
정책과 Rust 실행 의미는 바뀌지 않습니다. 하나의 realm 안에서는 비동기 생성
대기부터 writer 자원을 예약합니다. Worker를 나누는 설치는 공유 호스트
레지스트리가 필요하며 이 API는 물리적 보장을 제공하지 않습니다.

검증된 자원 descriptor도 명시적인 문서·리비전 식별자로 상호작용 스키마를
생성할 수 있습니다. 바인딩 시 실행 바이트에 맞는 모듈 식별자를 다시 생성하고,
검증은 위조된 스키마 메타데이터를 거부합니다. 기존 정규 매핑·실행 동등성·불일치
검사를 유지하며 `tests/browser-toolchain.test.mjs`와
`tests/bound-resource-control.test.mjs`에서 브라우저 그래프·생성 대기 writer·폐기
후 재생성을 검증합니다.

### 2026-10-01 — 바인딩된 유한 자원 제약 실행 ([#158](https://github.com/callin2/ghostflow-language/issues/158))

Reference §4.8에서 소스 검사와 실행 가능한 자원 바인딩을 구분합니다.
이전 `constraints Shared for station { ... }`는 검사된 비실행 설명자만
생성했습니다. 이제 `compileBoundResourceControl(checked, binding)`은 Bool
GFB1 v1/v3 요청 제어를 보호하는 GFB17 프로필을 생성합니다. 바인딩은 정본
소스·설명자·설치 리비전·안정된 자원 ID·완전한 유한 모드/출력 매핑을
고정합니다. 각 그룹은 하나의 exclusive 활동 집합 또는 require-only 실행을
지원하며, 여러 exclusive 문장을 합쳐 해석하지 않고 거부합니다.
모든 출력은 명시적인 보호가 필요하며, 누락된 바인딩과 미지원
프로필은 안전하게 거부합니다. 출력이나 물리 안전 시퀀스를 암묵적으로 제공하지 않습니다.

이식 가능한 Rust 제약 실행부가 입장과 최종 논리 출력 투영을 소유합니다.
충돌하는 새 활동은 기존 소유자를 대체하거나 숨은 대기열에 진입하지 않습니다.
예측 가능한 시작 전 위반은 새 출력 동작 없이 입장을 거부합니다. 실행 중
위반에는 true 값도 포함하는 작성된 안전 벡터를 적용하며, 복구에는 중립
요청 뒤 새 요청이 필요합니다. 겹치는 필수 그룹은 AND로 결합하고 충돌하는
안전 값은 거부합니다. 기존 로컬 필수 조건도 유지합니다. 호스트 소유의
하나의 레지스트리가 지원하는 모든 작성자를 관리하며 중복 소유는 거부합니다.
명시적 활성화와 매 scan의 일치하는 바인딩 정체성이 일반 tick/scan 우회를
막습니다. 평가 실패 시 제약·VM·결정 증거를 함께 롤백합니다.

바인딩 없는 컴파일은 비실행으로 유지하며, 사용자는 정확한 바인딩과 보호된
API를 명시적으로 선택합니다. 회계·import·Station 권고 검사·고정 Station
임대는 기존 계약을 유지합니다. 이 유한 논리 프로필은 문맥·연속/PID 실행,
협력하는 다중 제어기 중재, 물리 Driver 채택이나 하드웨어 확인을 구현하지
않습니다. 완전한 한·영 예제는 `examples/bound-resource-execution.ghost.md`입니다.
회귀 증거는 실제 native/plain/framed WASM 및 참조 시뮬레이션, 바인딩 위조,
입장, 모든 출력을 OFF로 만들지 않는 위반 응답, 복구, 작성자·우회 거부를 포함합니다.

결정 trace로 현재 wasm32 framed replay 헤더가 프레임당 192바이트에서
200바이트로 증가합니다(세 프레임은 24바이트 추가). planner는 실제 컴파일러
레이아웃을 계산합니다. 기존 temporal 예산과 과거 보고서는 유지하므로,
호출자는 최대 replay 예산에 이 헤더 비용을 포함해야 합니다.

### 2026-10-01 — control-owned 제약 그룹 정리 ([#157](https://github.com/callin2/ghostflow-language/issues/157))

Reference §4.8에서 local 출력, 공유 자원, accounting 적용 범위를 구분합니다.
이제 control 하나에서 기존 Bool 출력 규칙을
`constraints Local { require at safe_output pump => valve; }`로 묶습니다.
이전에는 그룹 밖에서만 수용했습니다. 그룹은 기존 native/WASM 출력 projection,
fixed-point 차단과 회복 의미를 유지하며 소스에 연결된 규칙 관찰도 보존합니다.

기존 targeted 문법 `constraints Shared for resource { ... }`를 같은 control
안에서 검사합니다. 명시적인 `safe { alias = false; ... }` 값은 유한한 Bool
자원을 모두 포함하고 필수 predicate를 만족해야 합니다. false를 모든 자원에
안전한 값으로 추론하지 않습니다. 공유 계약은 #158의 binding·enforcement
전까지 명시적으로 실행 불가능한 descriptor만 만들며, 제약을 조용히 제거해
실행 bytecode를 만들 수 없습니다. import·instance·connect와 accounting limit의
기존 의미는 보존합니다. 독립 `ghostrules` profile은 실제 Station demo와 Station
WASM 소비자를 위해서만 유지하고 제한된 계약을 별도로 문서화합니다.
물리 output ABI나 안전 시퀀스는 추가하지 않습니다. 그룹 소스는 새 컴파일러로
재컴파일하며, 기존 그룹 밖 규칙은 계속 유효합니다.
참조 논리 mapping 검사는 정본 source/artifact 해시, 안정 resource identity와
유한한 Bool 입력·출력 port를 고정하고 누락·불일치·위장 binding을 거부한다.
실행 권한을 주지 않으며, 완전한 소프트웨어 전용 예제는
`examples/shared-constraint-contract.ghost.md`다.
검증은 완전한 `examples/constraint-envelope.ghost.md`, 문법 및 잘못된 safe 값,
실제 native/plain/framed-WASM 동등성, 누락 참조, 미지원 권고 단계와 binding
없는 실행 거부를 포함합니다.

### 2026-10-01 — accounting 전용 artifact profile ([#210](https://github.com/callin2/ghostflow-language/issues/210))

실행 가능한 accounting source는 `on_time` account만 있고 context를 생성하는
표현식이 없어도 `GhostFlow/control-v10`을 선택한다. 이전에는
`account used = on_time(pump, stage: applied, persistence: durable);`가
control-v1을 유지할 수 있어 기존 accounting metadata가 있어도 표준 source에
바인딩하는 WASM ledger가 거부했다. 문서화된 binding 계약을 복구하며 syntax,
GFB bytes, ledger ABI는 바꾸지 않는다. 다시 컴파일하면 profile이 수정된다.
Reference §3.4는 그대로다. REF-03-020은 일정·불규칙 partition의 실제 native/WASM
역사적 rolling 계산을 partial overlap과 snapshot replay까지 비교한다.
제어 admission, 실시간 cutoff, 물리 receipt 검증은 이 수정의 범위 밖이다.

### 2026-10-01 — 공유 Solar/config 실행 ([#145](https://github.com/callin2/ghostflow-language/issues/145))

이전에 compiler가 거부했던 Solar와 live typed configuration 합성을 이제 하나의
staged Rust context에서 실행한다. 예를 들어
`when = case enabled { ok(v) => v; fault(_) => false; };`는 일반 제어와 같은
현재 Result를 읽는다. `when`이 참조한 config fault는 작성한 fault 분기가 true를
반환해도 `Unknown(SettingsFault)`를 보존한다. 무관한 fault는 Solar를 억제하지
않는다. 복구는 catch-up 없이 기준선을 세우고 실패한 평가는 event/occurrence를
소비하지 않는다. 과거 성공 값이 occurrence를 허용하는 것을 막기 위한 변경이다.
[Reference §3.5](docs/reference/03-time-and-schedules.md#35-schedule의-공통-의미)와
[실행 안내](docs/SOLAR-CONFIG-EXECUTION.ko.md)를 참조한다.
GFB16/tag16은 control-v15와 불변 컴파일 binding을 검증하는 GFSF6 Solar 사실을
선택한다. GFCX3 wrapper는 유지하고 GFES subtype3 Solar state를 추가한다.
명시 호환 결정으로 구체적인 standalone Solar #28/#29 consumer와 calendar를
포함한 비Solar GFSF5 profile을 유지한다. 거부된 공유 source의 fallback은 아니다.
이전 loader는 GFB16을 거부한다. compiler와 native/WASM/ghostsim 회귀는 의존성
변조, 현재 fault/복구, rollback, durable 중복 억제를 다룬다. literal DailySlots
혼합과 #153 Window/Run 중첩은 범위 밖이다. Device 채택이나 물리 운전을 주장하지 않는다.

### 2026-10-01 — 공휴일 실행과 불변 달력 합성

Daily의 `on = day\`holiday\`; calendar = public_days;`는 typed HolidayCalendar의
membership을 shared Rust core에서 실행하며 근무/휴무 일정과 함께 사용할 수 있다.
공휴일 membership은 작업 예외와 독립적이다. Node reference adapter는
검토된 한국 2026–2027 사실과 명시 base/override 합성을 제공하고 새 ID, 내용 revision,
출처를 유지한다. 현장 주간/공휴일 작업 정책은 명시한다. 부재·만료·coverage 밖은
Unknown을 유지한다. 공유 binding은 같은 snapshot을 요구하며 revision 내용은
tick과 durable restore를 가로질러 불변이다. [Reference §3.8](docs/reference/03-time-and-schedules.md#38-dst-자정과-work-calendar)과
[provider 안내](docs/CALENDAR-PROVIDERS.ko.md)를 참조한다.
공휴일 실행은 GFB15/control-v14를 사용하고 GFSF5는 유지한다. GFCXv3은 제한된
달력 history를 저장하고 v1/v2 checkpoint를 거부한다. 이전 loader는 새 header를
거부한다. 요일 문법 [#155](https://github.com/callin2/ghostflow-language/issues/155)는
별도 작업이다. provider, compiler, native/WASM/ghostsim과 checkpoint 회귀는
host 실행을 검증하며 Device나 물리 운전을 증명하지 않는다.

### 2026-10-01 — one-shot At pulse ([#154](https://github.com/callin2/ghostflow-language/issues/154))

`schedule appointment: At { at = datetime\`2026-01-01T08:00:00Z\`; ... }`이
이제 shared Rust core, WASM host와 ghostsim에서 절대 시점의 단일 pulse로
컴파일되고 실행된다. 공통 policy 여섯 개는 필수다. 이 제한된 profile은
pulse/trusted-only/baseline/skip을 받고 다른 basis와 timezone/DST/cancellation
field는 거부한다. trusted crossing은 한 번 admit하며 false, gap과 지난
boot/recovery baseline은 terminal miss로 소비한다. 거부된 scan은 소비하지
않으며 같은 program의 checkpoint 복원은 reboot 뒤 dedup을 유지한다.
GFB14/control-v13으로 이전 loader는 fail closed한다. scan transport는 그대로다.
서명된 portable packaging은 아직 지원하지 않는다. [Reference §3.5](docs/reference/03-time-and-schedules.md#35-schedule의-공통-의미)를 참조한다.
compiler와 native/WASM/ghostsim 경계, 회복, rollback과 checkpoint 회귀 검사를
추가했다. 논리 admission은 물리 실행을 주장하지 않는다.

### 2026-10-01 — portable 적응 전략 메타데이터

Portable package는 컴파일러가 생성한 쌍으로 된 adaptation descriptor를 받습니다.
정본 소스 replay와 native decoded strategy/query binding은 재서명된 descriptor나
bytecode 변경을 거부합니다. 선택 Bool feedback은 native/WASM 실행에서 부재 시
baseline과 명시적인 존재 시 전략을 유지합니다. GFB, wire 형식, ABI와 서명 정책은
변하지 않습니다. [Portable package](docs/PORTABLE-PACKAGE.ko.md#적응-전략-descriptor)를 참조합니다.


### 2026-09-30 ? 검증된 중복 제약 대체 ([#31](https://github.com/callin2/ghostflow-language/issues/31))

컴파일은 독립적인 bounded effect 검증 후 인접한 동일 순서의 Bool 출력 제약을
병합할 수 있다. 예를 들어 연속된 두 `require pump => valve;` 선언은 하나의
실행 검사와 두 원본 출처를 유지한다. 변환된 source map과 결합된 관찰은 host v2
형식을 사용한다. 제거된 검사는 검증된 파생 대체 근거를 가지며 실행된 것으로
보고하지 않는다. 기존 lowering은 미증명 상태를 유지한다. 이 한정된 조각 밖의
프로그램은 원래 경로를 유지한다. GFB 명령, native/WASM ABI와 원본 문법은
바뀌지 않는다. 이전 host metadata consumer는 v2를 거부하며, 해당 package는
replay를 우회하지 않고 canonical source에서 다시 빌드해야 한다.
[대체 계약](docs/CHECKED-CONSTRAINT-REPLACEMENTS.md)과 compiler, proof 변조,
source recovery, native/WASM parity 회귀를 참조한다.

### 2026-10-01 — 명시적 native 개발 서명 정책

Native portable-package verifier는 발행자 인증에 대한 명시적 개발 우회를 제공한다.
기존 API는 강제 검증을 유지한다. 서명이 없거나 신뢰하지 않는 package도 동일한
integrity, compatibility, loader 검사를 통과해야 한다. 우회 결과는
`DevelopmentBypass`와 빈 accepted key 배열을 명시한다. Device profile을 활성화하거나
DSL/VM semantics를 바꾸지 않는다. Native package regression은 strict rejection,
개발 admission, 잘못된 signature metadata, 유지된 payload/source/bytecode/binding
rejection을 검증한다.

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
