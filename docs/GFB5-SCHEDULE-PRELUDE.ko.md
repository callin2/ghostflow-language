<!-- translation-source: docs/GFB5-SCHEDULE-PRELUDE.md -->
[영문 원문](GFB5-SCHEDULE-PRELUDE.md)

# GFB5 예약 prelude

GFB5는 전략별 *prelude*에 예약 항목(현재는 Solar)을 추가하는 **내부** 바이트코드
프로필입니다. prelude란 전략의 전이와 의도가 참조할 수 있는 창(window) 항목과 예약 항목의
목록입니다. 현재 상태는 다음과 같습니다.

| 부분 | 상태 |
| --- | --- |
| 인코더 | 구현됨 |
| 이식 가능한 Rust 구조 검증기 | 구현됨 |
| 정본 소스 lowering | 연결되지 않음 |
| 예약 실행 | 연결되지 않음 |
| 로딩 | 구조적으로 유효한 모듈은 성공 |
| 활성화, 시간 계획, hot swap | `schedule activation requires runtime bindings`로 거부 |

## 배치

magic은 `GFB1`로 유지되며, 리틀엔디안 형식 버전은 `5`입니다.

- 모듈, 입력, 상태, 시간 시계/root 섹션은 기존 배치를 유지합니다.
- 예약만 있는 모듈은 물리 root가 0개일 수 있습니다. 창에는 여전히 유효한 root 참조가
  필요합니다.
- 형식 5 모듈에는 예약이 하나 이상 있어야 합니다. 창만 있는 모듈에 대해서는 인코더가 계속
  형식 4를 출력합니다.

각 전략에는 `u16` prelude 개수가 있고, 그 뒤에 그 수만큼의 태그 항목이 옵니다.

- 태그 `0`에는 기존 GFB4 창 본문이 들어갑니다.
- 태그 `1`에는 다음 Solar 본문이 들어갑니다.

| 필드 | 인코딩과 도메인 |
| --- | --- |
| site | `u32`, 양수 |
| name | 기존 GFB 문자열 |
| timezone | 비어 있지 않고 올바른 UTF-8 문자열, 최대 128바이트 |
| latitude, longitude | `f64`, 유한; −90..90 및 −180..180 |
| event | `u8`: 0 rise(일출), 1 set(일몰) |
| offsetMs | `i64`: −86400000..86400000 |
| basis | `u8`: 0 pulse |
| clockPolicy | `u8`: 0 trusted_only |
| recovery | `u8`: 0 baseline |
| fallback | `u8`: 0 skip |
| gapMs | `u64`: 1..9007199254740991 |
| when | 기존 식 blob, Bool 결과, 최대 4096바이트 |

모든 정수는 리틀엔디안입니다. 정책 태그는 명시적이며, 현재 각 정책 필드에는 정의된 값이 정확히
하나씩만 있습니다. 다른 언어 정책은 추가 구현이 필요합니다. 이 프로필은 언어가 어떤 정책을
지원하는지 재정의하지 않습니다. 시간대 사용 가능 여부는 provider 바인딩의 책임이며, 구조
디코딩으로 확인되지 않습니다.

**슬롯과 참조.**

- 창 슬롯과 예약 슬롯은 나타나는 순서대로 따로 번호를 매깁니다.
- opcode 57은 여전히 창을 읽습니다. opcode 58은 `[58, u16 scheduleSlot, u8 field]`이며,
  field 0은 Bool 타입(`due`)입니다.
- 각 prelude 식은 앞선 항목만 참조할 수 있습니다. 전이와 의도는 모든 항목을 참조할 수 있습니다.
- site와 이름은 각 전략 안에서 두 종류를 통틀어 고유해야 합니다.
- 스칼라 상태와 prelude 항목의 합은 전략마다 128을 넘어서는 안 됩니다.

## identity와 경계

바이트코드에는 의미상의 로컬 선언 identity가 들어갑니다. 문서 해시와 외부 document/revision
identity는 검증된 결과물 메타데이터에 남습니다. 주석만 바뀐 소스 변경은 실행 바이트를 바꿔서는
안 됩니다.

내부 인코더 형식은 다음과 같습니다.

```text
(solar-pulse SITE NAME TIMEZONE LAT LON EVENT OFFSET_MS
  pulse trusted_only GAP_MS baseline skip WHEN)
(schedule-read SLOT due)
```

이 형식은 추가적인 제품 소스 형식이 아닙니다. 제품 소스는 여전히 완전한 `.ghost.md` 문서
하나입니다.

집중 증거는 `tests/gfb5-schedule.test.mjs`, `tests/gfb5-browser.test.mjs`,
`tests/gfb5-native.test.mjs`, `crates/ghostflow-core/tests/schedule_module.rs`에 있습니다.

- **검증하는 것:** wire 필드, 의존성 순서, 잘못된 입력, 경계, 활성화 거부.
- **입증하지 않는 것:** 예약 admission(수용), provider 정확성, 예약 실행, 영속 identity, 자원
  accounting(사용량 집계), 재생.
