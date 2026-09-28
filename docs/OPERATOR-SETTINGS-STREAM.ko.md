<!-- translation-source: docs/OPERATOR-SETTINGS-STREAM.md -->
[영어 원문](OPERATOR-SETTINGS-STREAM.md)

# Typed configuration stream

규범 언어 규칙은 Reference §2 Result, §3 Periodic/DailySlots, §5 settings다.
config 선언은 초기 `ok(initial)` 관측을 가진 typed stream에 이름을 붙인다. config 읽기는
`Result<T, SettingsFault>`다. consumer는 기존 `case`, `map`, `and_then`, 명시적 `recover`
의미를 사용한다. producer는 network interface나 physical control일 수 있다. consumer
source는 transport를 명시하지 않는다. 이 계약은 RxJS나 새 일반 stream framework를
요구하지 않는다.

`SettingsInvalid`는 인식되고 승인된 emission이 payload 검증에 실패했다는 뜻이다.
`SettingsUnavailable`은 명시적 producer error 관측이다. 메시지가 없다는 사실만으로 error나
꾸며낸 반복 emission을 만들지 않는다. 둘 다 이후 성공 emission으로 복구할 수 있다.
암묵 last-good/default 정책은 없다.

aggregate는 비어 있지 않고 고유하며 승인된 config ID 집합을 식별한다. 모든 payload를 함께
검증한다. aggregate는 모두 `ok` 또는 지정된 모두에 `fault`를 emit한다. 무관한 stream은
불변이다. aggregate 안에서 명시 fault code가 충돌하면 packet을 거부한다. 균일한 명시 fault는
지정 group에 전달된다. 실제 payload 검증 실패는 그 group에 `SettingsInvalid`를 emit한다.
잘못된 packet, 미인식 target, stale Program/base revision, 거부된 권한은 admission 전에
거부한다. 그런 거부는 관측을 만들지 않는다. 승인 error emission은 settings 관측 revision을
전진시킨다.

평가 position의 모든 consumer는 같은 현재 Result를 사용한다. 의존 schedule은 error를
`Unknown(SettingsFault)`로 보존하고 현재 error 동안 새 occurrence를 admit하지 않는다.
복구는 성공 emission position에 선언 phase 정책을 적용하며 과거 catch-up하지 않는다.
admit된 Run은 config error로 취소되지 않는다. 일반 control expression은 자체 반응을
명시적으로 정한다. 따라서 `case` 안 duration 읽기는 elapsed time reset 없이 다음 평가에
진행 중 control을 바꿀 수 있다. 대신 program은 run별 duration을 원하면 성공 값을 state에
명시 capture할 수 있다.

## Binary 통합

GFB11/control-v10은 이전 GFB10 context profile을 대체한다. scalar config descriptor는
prelude tag12이며 schedule consumer보다 먼저 온다.

```text
u32 id, string name, string semanticType, u8 kind, u8 operatorEditable
scalar: typed initial, u8 hasBounds, [typed min, max, step]
slots:  u64 gridMs, u16 capacity, u16 count, u16 minuteOfDay[]
u16 okInput, valueInput, faultInput
```

kind는 Bool0, Int1, Number2, TimeSlots3다. scalar 값은 canonical Bool flag, signed i32,
finite f64 표현을 사용한다. `semanticType`은 wire에서 Duration/Percent/quantity/time 구분을
보존한다. TimeSlots는 모든 scalar projection index에 0xffff를 쓴다. scalar projection은
보호된 이름 `__gf_config_ID_ok/value/fault`를 가진다. host는 직접 설정할 수 없다.

Periodic tag5는 embedded config value/bound를 `u32 configId`로 대체한다. ID0은 대신 바로
뒤에 양의 `u64 literalIntervalMs`를 담는다. literal은 만들어 낸 editable config가 아니다.
config DailySlots tag9는 공통 prefix 뒤에 `string timezone, u32 configId, u8 dstMissing,
dstRepeated`를 담는다. 두 consumer는 별도 setting 복사본 대신 공유 config descriptor/
현재 관측을 참조한다.

모든 GFB11 artifact는 `u16 objectiveCount`(0 또는 1)로 끝난다. objective body는 name/output과
input index 네 개를 유지하고 `u16 targetOkInput`을 추가한 뒤 period/late/direction/PID 수치
여섯 개를 유지한다. target value/ok 쌍은 하나의 Temperature config descriptor를 참조해야 한다.
host code는 보호 input 어느 쪽도 쓰거나 manifest의 initial target을 대입할 수 없다.

GFSF5는 context clock/evidence section을 유지한다. settings envelope는 Program fingerprint,
event ID, base revision, effective position, change다. effective position 뒤 `u8 origin`이
operatorEdit0/producerObservation1을 구분한다. host가 이 classification을 인증한다.
packet 주장은 인증 credential이 아니다. consumer source는 Result만 본다. operator edit에는
editable access가 필요하다. 정당한 producer 관측은 readonly config fault를 보고하고 선언
initial payload로 복구할 수 있지만 readonly payload를 바꾸지는 못한다. 각 change는
`u32 configId, u8 rail`이다. Rail0은 `string semanticType, u8 kind, typed value`를 담는다.
TimeSlots 값은 `u16 count` 뒤 `(u64 key,u16 minute)`다. Rail1은 fault code0
(`SettingsInvalid`) 또는 1 (`SettingsUnavailable`)을 담는다. stream 검증 전에 구조 tag/finite
수치 표현을 검사한다. 표현은 유효하나 선언 type/range/grid/capacity가 틀리면 semantic error
rail을 만든다.

TimeSlots key는 공유 config stream이 할당한다. Key0은 새 identity를 요청한다. 기존 key는
유지 항목을 retime한다. 없는 key는 항목을 제거한다. 그 config를 소비하는 모든 schedule은
identity를 공유한다. error는 과거 list를 현재 성공 값으로 노출하지 않는다.

combined context 호출은 emission, 보호 input, schedule 판단, VM state를 함께 stage한다.
거부된 combined 호출은 event를 소비하지 않으므로 재시도할 수 있다. 이 API는 commit 전에
emission이 effective라고 acknowledge하지 않는다. 다른 API가 제공해 독립 승인된 관측은
나중에 control 평가가 실패해도 되돌릴 수 없다.

public framed 경로는 같은 GFCA1/GFSF5 packet과 native ScanDriver로 `gf_frame_activate_context`/
`gf_frame_scan_context`를 사용한다. 완전한 input frame은 runtime 보호 Result projection/
파생 monotonic clock을 생략한다. logical time은 context clock과 일치해야 한다. 성공 평가만
native scan ID/time을 전진시키고 승인 결과를 게시한다. 거부 frame은 같은 scan ID에서
재시도할 수 있다. framed checkpoint/state 접근과 첫 scan 이전 restore는 GFCX2를 재사용한다.
두 번째 settings state를 만들거나 JavaScript에서 승인 결과를 합성하지 않는다.

GFCX2는 정확한 Program/binding identity 아래 현재 Result, revision, 승인 event identity,
key 할당 history를 저장한다. 복원 fault는 fault로 남는다. 과거 성공 payload는 stable-key/
phase 검증에만 존재하며 consumer fallback이 아니다. 복원 engine cache는 공유 config
history와 일치해야 한다. 이전 GFCX1 image는 명시 거부한다.

context state는 각 config의 ID, name, type, 현재 Result를 노출한다. error 결과는 이전
`value` 대신 fault를 담는다. emission은 source hash/run identity를 바꾸지 않는다.
기존 state/timer 의미는 불변이다. hardware acquisition, WebUI transport, device release
작업은 이 language/runtime 변경 밖이다.

## 실행 profile 경계

이 변경의 Periodic profile은 `preserve_anchor`, pulse/trusted-clock/baseline/skip 정책으로
명시적 `instant` anchor를 실행한다. Reference의 다른 anchor/phase 정책은 자체 구현
요구사항을 유지한다. 이 변경은 그 실행을 주장하지 않는다. config 기반 TimeSlots는 공유
stream consumer를 사용한다. stream과 이전 Solar/literal DailySlots 실행 profile 혼합은
source 컴파일에서 거부한다. native Temperature PID objective는 같은 보호 config Result
vector에서 target을 읽는다. fault는 작성 disable 정책을 따른다. 실제 operator setting을
상수로 바꿔 이 거부를 우회해서는 안 된다. Solar 통합은
[#145](https://github.com/callin2/ghostflow-language/issues/145)에서 추적한다.
실행 profile의 accounting reserve/limit 값은 정적 designer bound다. Reference의 ON 5분/
stop-delay 10초 예는 고정 bound에 `let`을 쓴다. live config Result는 initial 값으로 조용히
접지 않고 거부한다.
현재 `basis = range(...)` DailySlots profile도 고정 duration을 요구한다. live config Result는
컴파일 거부한다. literal/`let` range 중첩/맞닿는 경계 규칙은 실행 가능하게 유지한다.
Range를 공유 live Result consumer로 확장하는 것은 이 Periodic/일반 control stream 구현과
별개다.
Native/WASM/virtual-simulator 검증은 frontend 전달, physical acquisition, Device deployment,
임의 external producer adapter를 인증하지 않는다.

공유 vector는 기존 PID engine 전에 stage한다. target fault는 PID deadline 사이에서도 즉시
작성 `fault = disable` 정책을 따른다. 복구는 기존 deadline/`track_safe` 정책을 보존한다.
settings/PID 변경은 같은 성공 평가로 commit한다. 재시작은 config 관측을 복원하고 작성
PID `restart = reset(...)`을 사용한다. config checkpoint는 controller history를 복원하지 않는다.

signed portable package는 일반 elapsed timer를 포함한 scalar config GFB11 artifact를
`GhostFlow/context-scan-abi-v5`/`control-v10` 아래에서 허용한다. signature, digest, capability,
compiler 일관성 검사는 필수 유지한다. 이 package profile은 schedule, PID, TimeSlots,
signal-prelude packaging 지원을 추가하지 않는다.
