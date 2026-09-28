<!-- translation-source: docs/CONTEXT-EXECUTION-ABI.md -->
[English original](CONTEXT-EXECUTION-ABI.md)

# 컨텍스트 실행 ABI

GFB10 (`control-v9`)은 이식 가능한 Rust VM에서 Periodic, Cron, WorkCalendar
Daily, Tide Run, 설정 기반 DailySlots, natural/accounting Result를 실행한다.
공개 소스는 완전한 `.ghost.md` 문서 하나로 유지된다. 아래 바이너리 및 내부
lowering 형식은 전송 계약이지 대체 제품 소스가 아니다.

## 소유권 및 커밋 경계

호스트는 시계 스냅샷, 공급자 관측, 달력 스냅샷, 해석된 민간 날짜 발생 행과
명시적 설정 이벤트를 제공한다. Rust는 바인딩을 검증하고 발생 식별자, due/missed/
active, natural Result, 설정 승인, 종료 상태 및 Run 기간을 결정한다. 호스트가
제공한 투영은 금지된다. Natural 입력은 보호된 `__gf_natural_SITE_ok/value/fault`를,
accounting 입력은 `__gf_accounting_SITE_ok/value/fault`를 사용한다.

컨텍스트 틱은 컨텍스트 엔진을 복제하고 공급자 검증, 설정 변경, 보호된 Result,
일정 조건 및 전이를 단계적으로 처리한다. VM 틱이 성공한 경우에만 단계적 컨텍스트와
추적을 커밋한다. 거부된 패킷이나 VM 오류는 설정 이벤트나 발생 식별자를 소비하지
않는다. 별도 Rust ledger에 이미 영속 커밋된 accounting 관측은 후속 스캔이 실패해도
커밋 상태를 유지한다. accounting ABI는 해당 ledger에서 Result 값을 구성한다.
GFSF4에는 accounting 투영을 담을 수 없다.

공급자 바인딩은 논리 공급자, 종류, 네임스페이스, 관측소, 바인딩 개정, 위치,
시간대, 분류 기준 및 불확실성 임계값을 고정한다. 한 틱에서 같은 공급자를 보는
모든 뷰는 동일한 개정, 커버리지, 만료, 불확실성 및 고장을 공유해야 한다. 분류
라벨과 발생 행은 별도 페이로드다. 발생 쪽 관측에서 라벨이 비어 있으면 해당
페이로드가 생략되지만 natural 관측에서 라벨이 비어 있으면 빈 집합을 인증한다.
두 뷰가 모두 라벨을 제공하면 집합이 같아야 한다. 봉투의 공급자 개정은 전체
스냅샷을 식별한다. 각 Tide 행의 공급자 개정은 이벤트 예측을 식별하며 다를 수 있다.
행 컨텍스트 개정은 이를 해석한 컨텍스트를 식별한다. 승인된 Run은 완료 때까지 원래
계획 시각과 행 개정을 유지한다. 커버리지는 `[start,end)`이고 `now >= expiry`이면
만료다. 불확실성은 admission 구간 연산이 아니라 인증 임계값이다. 관측 누락은
꾸며낸 증거가 아니라 형식화된 Unknown을 만든다.

## 실행 설명자

GFB10은 GFB 시간 헤더와 태그가 붙은 전략 서두를 유지한다. 기존 태그 0–4는 기존
레이아웃을 유지한다. 태그 5–9는 `u32 site, string name, u64 gapMs`로 시작하고
Bool 표현식 blob `when, cancel`로 끝난다.

| 태그 | 공통 접두부와 표현식 사이의 본문 |
| --- | --- |
| 5 Periodic (주기) | `string epochId, u64 anchorMs, string setting, u8 operatorEditable, u64 initialMs/minMs/maxMs/stepMs` |
| 6 Cron (크론) | `string timezone, u8 dstMissing/dstRepeated, u8 count 뒤에 u8 필드 값이 오는 목록 5개` |
| 7 Calendar Daily (달력 일일) | `string timezone, u64 atMs, string calendar, u8 offday/dstMissing/dstRepeated` |
| 8 Tide Run (조석 실행) | `string timezone/provider, u8 high, i64 offsetMs, u64 runMs/withinMs` |
| 9 Config DailySlots (설정 일일 슬롯) | `string timezone/setting, u8 operatorEditable, u64 gridMs, u16 capacity, u16 initialCount, u16 minutes, u8 dstMissing/dstRepeated` |
| 10 Natural Result | `u32 site, string name, u8 kind, string provider/classification, u16 ok/value/fault 입력 인덱스` |
| 11 Accounting Result | `u32 site, string name/account/event/timezone, u16 ok/value/fault 입력 인덱스` |

Natural 투영 형식은 Bool/Bool/Number이고 accounting은 Bool/Int/Number다. Fault
Number에는 유한 enum 코드가 들어간다. Opcode 58의 필드 0/1/2는 due/missed/active를
읽는다. 연산자 편집이 비활성화되어도 설정은 소스 식별자를 보존한다. 접근 권한이
생략되었다고 해서 편집이 허용되지는 않는다.

모든 정수는 리틀엔디안이다. 문자열은 u16 바이트 길이와 UTF-8을 사용하고 표현식
blob은 u32 바이트 길이를 사용한다. 공급자 식별 문자열은 비어 있지 않아야 하며
최대 128바이트다. 정확한 수치 전송 값은 최대 9007199254740991이다. Program 지문은
64비트를 모두 보존한다.

## 활성화 및 사실

`gf_activate_context(handle, ptr, len)`은 GFCA1을 소비한다.

```text
"GFCA", u16 1, u64 bootEpoch, u32 terminalCapacity,
u16 bindingCount, binding[]
binding := u8 kind, string provider/namespace/station/bindingRevision/
           location/timezone/criteria, u64 maxUncertaintyMs
```

종류는 Tide 0, Moon 1, Calendar 2다. 종료 용량은 1–4096이고 활성화 바인딩은
128개로 제한된다. 사용되지 않거나 중복되거나 일치하지 않는 바인딩은 활성화를
거부한다. 설정 용량과 패킷 행 용량은 종료 원장 용량과 별개다.

`gf_tick_context(handle, ptr, len)`은 GFSF4를 소비한다.

```text
"GFSF", u16 4,
u64 monotonicMs/bootEpoch, optional wallMs/uncertaintyMs,
u8 trusted, string reason/sourceRevision,
u16 naturalCount, observation[], u16 scheduleCount, schedule[],
u8 settingsPresent, [settings]

observation := binding, string providerRevision,
               u64 coverageStartMs/coverageEndMs/expiresAtMs/uncertaintyMs,
               u8 fault, u8 classificationCount, string classifications[]
schedule := u32 site, u64 coverageStartMs/coverageEndMs,
            u8 providerPresent, [observation], u8 calendarPresent, [calendar],
            u16 rowCount, row[]
row := u32 sourceDay, u64 slotKey, u16 minuteOfDay, u8 fold,
       string eventId, u8 eventKind, optional instantMs, u8 withdrawn,
       string providerRevision/contextRevision
calendar := string id/revision/timezone, u32 fromDate/toDateExclusive,
            u64 expiresAtMs, u8 weeklyWorkMask/holidayWork,
            u16 holidayCount, u32 holidays[],
            u16 exceptionCount, (u32 date, u8 work) exceptions[]
settings := u64 programFingerprint, string eventId,
            u64 baseRevision/position, u16 changeCount, change[]
change := u32 site, u8 kind,
          (u64 durationMs | u16 slotCount, (u64 key, u16 minuteOfDay) slots[])
```

선택적 시간은 `u8 present, u64 value`를 포함하며 부재 시 값은 0이다. 이벤트 종류는
civil 0, high 1, low 2다. 공급자 fault 255는 부재를 뜻한다. 코드는 유한 natural
fault enum의 0–5에 대응한다. 설정 kind 0은 Duration, 1은 TimeSlots다. 슬롯 키가
0이면 할당을 요청한다. 0이 아닌 키는 이미 해당 설정에 속해야 한다. 완전한 키 지정
값이 이전 값을 대체한다. 이벤트 위치는 다음 성공 스캔 번호이며 base revision은
현재 설정 개정과 같아야 한다. 설정과 스캔은 원자적으로 커밋한다.

활성화/사실 패킷은 65536바이트, 섹션 개수는 128개, 발생 행은 4096개로 제한된다.
디코더는 후행 바이트와 잘못된 태그를 거부한다. 네이티브 진입점도 페이로드 경계와
설명자 호환성을 검증한다.

## 영속 컨텍스트

`gf_context_checkpoint`는 바이트와 유효 설정 JSON을 캡처하며,
`gf_context_checkpoint_ptr/len` 및 `gf_context_state_ptr/len`으로 노출한다.
`gf_restore_context_checkpoint(handle, ptr, len)`은 활성화된 실행의 첫 스캔 전에만
허용된다. 영구 저장과 확인 책임은 호스트에 있다.

GFCX1에는 magic/version, 정확한 Program 지문, 표준 바인딩 바이트, 설정 개정,
승인 이벤트 식별자, site 키 기반 엔진 스냅샷과 CRC32가 들어간다. 봉투는 4 MiB,
각 엔진 스냅샷은 1 MiB로 제한된다. 식별 불일치, 손상, 복원 설정 오류 또는 용량
초과가 있으면 전체 복원을 거부한다. CRC32는 우발적 손상을 감지하지만 인증 수단은 아니다.

유효 Periodic 단계/구간, 키 지정 슬롯/할당기와 종료 발생 식별자는 재시작 후에도
유지된다. 시계 관측과 활성 Run은 유지되지 않는다. 복원한 실행은 새 기준점을 만들며
과거 발생을 재생할 수 없다. 이는 컨텍스트 체크포인트이지 accounting ledger나 일반
VM 상태 이미지가 아니다.

## 증거

`context_runtime_tests`는 보호 입력, 공급자 일관성, VM 실패 롤백, 설정 재시도 및
식별자 제한 영속 복원을 실행한다. `context_abi` 테스트는 패킷 거부를 다룬다.
종류별 경계 테스트는 `context_schedule`, `natural_context`, `work_calendar` 및
`cron_schedule`에 있다. 종단 간 Reference 픽스처는 정본 컴파일과 호스트 일정
구현이 아닌 동일 WASM 런타임을 실행한다.
