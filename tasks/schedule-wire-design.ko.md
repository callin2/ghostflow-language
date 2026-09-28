<!-- translation-source: tasks/schedule-wire-design.md -->

[영문 원본](schedule-wire-design.md)

# Schedule wire와 트랜잭션 prelude 제안

상태: **root 검토용 초안**. GFB5 구조 slice는 완료됐다. Core 160,
native 12, encoder 8과 영향받은 44, browser 3, cross-language native 4,
catalog 5가 통과했다. 정본 lowering, schedule 실행, provider,
자원 집계, replay는 미완료다. 아래 식별자 binding과 자원 구성은 최종 승인되지 않았다.
Multiple-crossing 동작은 Reference §3.5로 확정됐다.
새로 통과한 모든 occurrence를 missed로 기록하고 아무것도 실행하지 않는다.

Root는 단계적 구조 구현을 위해 §2의 실행 배치를 승인했다.
첫 변경은 내부 encoder와 portable loader/verifier만 추가한다.
정본 source lowering과 schedule 실행은 미완료다. Format-5 module에는
schedule이 최소 하나 필요하다. Window-only 컴파일은 format 4를 유지한다.
실행 경로 구현 전까지 모든 activation 경로는 schedule module을
`schedule activation requires runtime bindings`로 거부해야 한다.
거짓 `.due` 값으로 대신해서는 안 된다.

근거: `build/schedule-core-green.log`, `build/gfb5-encoder-affected.log`,
`build/gfb5-browser-green.log`, `build/gfb5-native-green.log`,
`build/gfb5-catalog.log`. `docs/GFB5-SCHEDULE-PRELUDE.md`가 승인된 wire slice를 기록한다.

기준: [Reference §3](../docs/reference/03-time-and-schedules.md),
[pulse 설계](schedule-pulse-design.md), 기존 [GFB4 계약](window-gfb4-design.md).

## 1. 첫 실행 slice

Solar, `pulse`, 작성된 Bool `when`, `trusted_only`, 명시적 양의
`skip_after(Duration)`, `baseline`, `fallback = skip`이다.
Rust는 계획된 occurrence fact를 소비하며 clock 검증, crossing, 술어 평가,
처분, commit을 소유한다. Provider는 IANA 변환과 Solar 계산을 맡는다.
Native Solar helper의 UTC/Seoul 부분집합이 언어의 IANA 지원을 제한할 수 없다.
어떤 provider도 `.due`를 공급하지 않는다.

`window`, `run`, held clock, fixed-time fallback, Daily/IANA-DST 계획,
영속 occurrence ledger 이관은 별도의 필수 작업으로 남는다.
Wire는 제한된 완전한 crossing 집합을 표현해야 한다. Schedule 하나에 새로
통과한 occurrence가 여러 개면 모두 missed로 기록하고 아무것도 실행하지 않는다.

## 2. 제안하는 GFB5 바이트 배치

모든 정수는 little endian이다. 문자열과 식 blob은 기존 GFB 길이 prefix와
상한을 재사용한다. GFB5는 GFB4 module/input/state 구역과 clock/root header를
유지한다. Schedule-only module에서는 물리 root 0개를 허용한다.
Stateful prelude 항목은 최소 하나 필요하다.

각 strategy는 GFB4의 window 목록을 `u16 preludeCount`로 대체한다.
그 뒤 의존 순서의 tag 항목, 기존 transition과 intent가 이어진다.

| 항목 tag | 본문 |
| --- | --- |
| `0` | 정확한 기존 GFB4 window descriptor |
| `1` | 아래 Solar pulse descriptor |

제안하는 Solar 본문, 바이트 순서:

```
u32 site
string name
string timezone
f64 latitude
f64 longitude
u8 event                 // 0 rise, 1 set
i64 offsetMs             // whole milliseconds, -24h..+24h
u8 basis                 // 0 pulse
u8 clockPolicy           // 0 trusted_only
u8 recovery              // 0 baseline
u8 fallback              // 0 skip
u64 gapMs                // 1..9007199254740991
blob when                // exactly one Bool result
```

좌표는 유한하고 기존 소스 영역 안에 있어야 한다. 정책 byte는 기본값이 아니라
명시적 값이다. 다른 언어 정책은 이 slice에서 구현되지 않았으며,
영구적으로 잘못된 언어 형태라는 뜻은 아니다.

Window와 schedule slot은 각 kind를 decoding할 때 지정하는 별도의 조밀한 index다.
Opcode 57은 기존 window namespace를 유지한다. 제안하는 opcode 58은
`[58, u16 scheduleSlot, u8 field]`다. 필드 `0`은 Bool `.due`를 반환한다.
다른 필드는 거부한다. 각 strategy 내 site와 이름은 이종 prelude의 두 kind
전체에서 고유하다. 기존 window profile처럼 서로 다른 strategy는
동일한 소스 선언을 참조할 수 있다.

Verifier는 현재 descriptor보다 앞선 항목만 공개한다. Window source는
앞선 schedule을 읽을 수 있고 schedule 술어는 앞선 window를 읽을 수 있다.
컴파일러는 결합 graph를 위상 정렬하고 위치 정보가 있는 cycle 진단을 낸다.
Window evidence marker/root 검증은 변경하지 않는다.
Transition과 intent는 준비된 모든 prelude 항목을 읽을 수 있다.
일반 상태 읽기는 모두 작성된 이전 상태를 본다. 준비된 `next` 조회는 없다.

Strategy마다 `scalar state count + prelude count <= 128`을 유지하고
input/stack/expression/module 상한은 변경하지 않는다.
이는 기존 stateful 항목 예산을 확장하며 무관한 schedule quota를 새로 도입하지 않는다.
Format 5에는 decoder, encoder, package, host, fixture, golden의 조정된 갱신이 필요하다.
Format 1–4는 컴파일러가 아직 생성하는 곳에서 현재 profile로 남는다.
수용 뒤 대체된 Solar external-due 실행 경로는 제거한다.

## 3. 승인이 필요한 식별자 binding

실행 선언 식별자와 검증된 산출물 식별자는 별개다.

- `site`: 산출물 내부 source node/projection 식별자이며 영속 key가 아니다.
- `name`: GFB에 담긴 의미상 local 선언 이름.
- 기존의 정확한 source SHA와 외부 `documentId`/`revisionId`: 검증된
  activation 산출물 metadata이며 실행 GFB byte의 필드가 아니다.

Occurrence key는 activation에 연결된 안정된 선언 namespace,
local 선언, source local date, event kind를 결합한다. Provider revision과
보정된 계획 타임스탬프는 새 occurrence를 만들지 않는다.
정확한 source revision은 설명용 provenance이며 안정된 occurrence key가 아니다.
Source SHA, bytecode SHA, Runtime의 비암호학적 u64 fingerprint는 서로 다르다.
추가 암호학적 해시나 꾸며낸 source ID는 도입하지 않는다.

Activation은 `tools/compile-source.mjs`의 기존 `sourceDocument`와
`traceMetadata`에서 binding을 얻는다. Toolchain 정본 map 검사와
검증된 artifact/package 경계가 이를 검증한다. Reference §1과
`tests/toolchain.test.mjs`의 comment-only revision 테스트가 요구하듯,
주석/설명문만 바뀌면 source 식별자는 바뀌되 GFB와 node 식별자는 유지해야 한다.
Provider fact는 binding을 설정하거나 덮어쓸 수 없다.
Raw GFB 로딩은 bytecode 구조만 증명하며 source 식별자를 인증하지 않는다.
Native 서명 package의 서명/digest/metadata 검증은 native 정본 소스
재컴파일을 뜻하지 않는다. 이 제안에는 native 소스 컴파일러가 없다.

**미결:** activation에 연결된 안정된 선언 namespace의 정확한 정의와
document/import instance 규칙. 서로 다른 설치 문서가 같은 이름을 쓰면
control/name 쌍만으로는 부족하다. 검증된 installation/source 식별자 경계를
재사용한다. 불투명하고 검사되지 않은 provider 식별자가 대신 GFB에 들어가서는 안 된다.
Revision 간 영속 ledger 이관은 별도 계약으로 남는다.

## 4. 타입이 지정된 scan별 fact와 ABI 제안

Native 진입점:

```
Runtime::tick_with_schedule(&ScheduleFacts)
ScanDriver::scan_with_schedule(ScanFrameV1, &ScheduleFacts)
```

불변 fact 객체는 clock snapshot 하나와 site 순으로 정렬된 site group을 담는다.
선택된 schedule마다 group이 정확히 하나 있다. Clock은 boot/time epoch,
단조 밀리초, 선택적 wall 밀리초, 신뢰 여부, 선택적 uncertainty,
선택적 clock source revision을 담는다. Uncertainty가 없으면 없는 채로 유지한다.

각 group에는 설치된 provider capability에 연결된 provider ID/revision과
zone/context revision이 있다. 타입이 지정된 Unknown 사유 또는 명시적
covered wall 구간과 완전하게 정렬된 source-date 목록을 담는다.
각 날짜 행에는 event wall instant 또는 타입이 지정된 unavailable 사유가 있다.
Rust는 컴파일된 offset을 더하고 DateTime 상한을 검증한다.
Offset이 자정을 넘어도 날짜 행은 source date를 유지한다.
계획된 local-time 맥락을 provider 근거에 함께 담을 수 있으나,
안정된 source-date key를 대체하지는 않는다.

제안하는 packet framing은 `GFSC`, `u16 version=1`, 그 뒤 clock과
`u16 groupCount`다. Scalar 영역은 현재 정본 epoch-day,
epoch-millisecond, safe-integer 영역을 사용한다.
Presence/status tag로 선택 필드를 구분하며 wall time sentinel은 없다.
길이 prefix가 있는 문자열과 행은 명시적 fact 예산으로 제한해야 한다.
정확한 row/status encoding은 provider coverage 계약 검토를 따른다.
이 초안이 조용히 확정하지 않는다.

Coverage는 요청된 구간과 offset의 모든 적격 source date를 포함해야 한다.
구조 검증은 연속 행, 상한, 중복 key 부재를 증명할 수 있으나 외부
IANA/천문 provider가 사실을 말했는지는 증명할 수 없다.
그것은 검증된 driver capability 경계다. 현재/이전 날짜 열거만으로는
임의의 작성된 gap에 대해 완전한 coverage가 되지 않는다.

기존 nonschedule 호출을 보존하는 export 제안:

```
gf_tick_schedule(handle, factsPtr, factsLen) -> 1|0
gf_frame_scan_schedule(handle, scanId, logicalTimeMs,
                       inputPtr, inputLen, factsPtr, factsLen) -> 1|0
```

Clock 단조 시각은 framed 논리 시각 및 생성 VM now binding과 같아야 한다.
Schedule이 필요한 module은 fact 없는 일반 tick/scan을 거부한다.
Cached-fact fallback은 없다. 두 ABI는 Rust packet decoder 하나를 공유한다.
결합된 framed 입력과 fact envelope는 기존 64 KiB 전송 상한 안에 들어야 한다.
Native 직접 호출도 같은 활성화된 자원 구성을 강제해야 한다.
Packet decoder를 우회한다는 이유로 무제한 Vec를 사용해서는 안 된다.

## 5. 트랜잭션, replay, 자원 proof

준비된 clock gate 하나는 연속 수용된 wall/단조 값으로 gap을 검사한다.
신뢰된 wall 상한 기록은 별개다. 작성된 gap보다 큰 양의 delta는
admission을 거부하지만 같으면 거부하지 않는다. Boot/trust recovery baseline은
catch-up하지 않는다. Unknown/recovery, provider fault, 종결 처분은
구분하여 기록한다. Timer/window가 고정 session 연속성에 의존하는 동안
epoch 교체에는 명시적인 새 session이 필요하다.

각 schedule 술어를 prelude 순서로 이전 상태와 이미 준비된 projection에 대해
한 번 평가한다. Window, clock 상태, occurrence 소비, schedule 관측,
scalar 상태는 실패 가능한 모든 식이 성공한 뒤 함께 commit한다.
이후 fault는 모든 후보를 폐기한다. 재시도는 같은 crossing을 본다.
JavaScript admission 상태 기계나 독립적으로 commit하는 provider cache가
그 트랜잭션을 대신할 수 없다.

TickRecord는 replay에 필요한 fact와 각 schedule 판단을 소유한다.
Checkpoint는 수용된 clock 상태와 occurrence 소비 상태를 포함한다.
Ghost replay는 새 provider 조회가 아니라 기록된 fact와 검증된 설치 definition을
사용한다. Framed replay는 원래 scan ID와 수용된 논리 시각을 보존한다.

**자원 검토는 여전히 필요하다:** schedule activation을 위해 ABI 전송 최대값으로
제한되는 명시적 양의 fact-byte 예산을 도입하고 encoding으로 행 용량을 도출한다.
이는 저장 용량이며 운전 주기가 아니다. GFTA v2가 이 필드와 window sample 용량
0인 schedule-only profile을 담을 위치로 제안된다.
누락된 GFTA1 필드를 기본값으로 재해석하지 않는다.
구현 전에 root가 이 profile 변경을 승인해야 한다.

공유 구조 planner는 decoding된 group/row/string 용량, clock/admission bank,
`(journalCapacity+1)` 소유 fact/판단 기록과 checkpoint, 후보와 replay의
중첩까지 비용에 반영해야 한다. Encoding된 64 KiB나 기존 temporal arena만
반영해서는 부족하다. 모든 판단에 provider 문자열을 반복하지 않는다.
행/판단을 기록에서 한 번 소유하는 metadata에 연결한다.
실제 용량 검사는 기존 temporal plan 규칙을 따른다.
JSON buffer는 별도로 제한한다. 유한한 session 내 occurrence 소비 표현도
provider 보정 아래에서 proof가 필요하다. 무한히 커지는 HashSet을 추가하거나
journal 기록이 제거됐다는 이유만으로 소비된 key를 정리해서는 안 된다.

## 6. 구현 경계와 첫 결정적 검사

| 소유자 | 계약 승인 뒤 범위가 제한된 작업 |
| --- | --- |
| Root | 식별자/용량 결정; Reference와 산출물 binding |
| Astra | GFB5 verifier, 공유 Rust prelude/admission, transaction/resource/replay, ABI |
| Sol | Source graph/lowering/encoder, IANA fact provider, 얇은 host/wrapper |
| Luna | 독립적인 진단과 native/WASM 수용 vector |

첫 테스트는 window가 공급한 술어와 이전 상태 입력, 역방향 의존과 cycle,
정확한 gap과 gap+1, 뒤늦은 intent 실패 뒤 동일한 crossing 재시도,
보정된 provider 타임스탬프에서도 유지되는 occurrence 식별자,
provider 호출 없이 판단을 보존하는 journal rollover replay를 구분해야 한다.
하나의 schedule에서 새로 통과한 두 occurrence가 모두 missed로 기록되고
아무것도 admit되지 않음을 증명하는 여러 날짜 coverage 테스트를 추가한다.
일반 admission 동작을 유지하는 single-crossing 대조군과 짝짓는다.

독립적인 trusted-only clock 구성요소는 먼저 진행할 수 있다.
전체 pulse 경로 수용을 주장하기 전에 GFB descriptor 식별자,
완전한 fact encoding, 결합 저장 계획을 검토해야 한다.
