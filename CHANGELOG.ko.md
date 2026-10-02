<!-- translation-source: CHANGELOG.md -->
[영어 원문](CHANGELOG.md)

# 변경 기록

## 미출시

### 2026-10-02 — 재시작 수명 주기 입력

Control은 정확한 reserved `RestartReason`과 `restart_event` 입력을 선택할 수 있다.
Compiler는 기본 control profile을 보존하면서 순서가 있는 enum metadata를 추가 GFB19
envelope에 기록하고 검증한다. Framed native/WASM 호스트는 활성화 전에 하드웨어가
확인한 원인과 부팅 pending bit를 초기화해야 한다. Core가 두 값을 주입하고 호출자의
덮어쓰기를 거부한다. 이벤트는 거부된 scan 뒤에도 true를 유지하고 처음 성공적으로
commit된 뒤 지운다. 이는 이벤트 기반 복구만 지원하며 VM과 timer 상태는 복원하지 않는다.
일반 enum input과 `on_restart` 문법은 계속 지원하지 않는다.

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
