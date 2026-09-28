<!-- translation-source: docs/GFB5-SCHEDULE-PRELUDE.md -->
[English original](GFB5-SCHEDULE-PRELUDE.md)

# GFB5 일정 서두

이 내부 바이트코드 프로필에는 인코더와 이식 가능한 Rust 구조 검증기가 있다. 정본
소스 lowering과 일정 실행은 아직 연결되지 않았다. 구조적으로 유효한 모듈은 로드되지만
활성화, 시간 계획 및 hot swap은 `schedule activation requires runtime bindings`로 거부한다.

## 배치

Magic은 `GFB1`로 유지되고 리틀엔디안 형식 버전은 `5`다. 모듈, 입력, 상태, 시간
시계/root 섹션은 기존 배치를 유지한다. 일정만 있는 모듈에는 물리 root가 0개일 수
있다. 창에는 유효한 root 참조가 필요하다. 형식 5 모듈에는 일정이 하나 이상 있어야
한다. 창만 있는 모듈에는 인코더가 계속 형식 4를 출력한다.

각 전략에는 `u16` 서두 개수 뒤에 태그 항목들이 온다. 태그 `0`에는 기존 GFB4 창
본문이 들어간다. 태그 `1`에는 다음 Solar 본문이 들어간다.

| 필드 | 인코딩 및 도메인 |
| --- | --- |
| site | 양수 `u32` |
| name | 기존 GFB 문자열 |
| timezone | 비어 있지 않고 올바른 UTF-8 문자열, 최대 128바이트 |
| latitude, longitude | 유한 `f64`; −90..90 및 −180..180 |
| event | `u8`: 0 rise(일출), 1 set(일몰) |
| offsetMs | `i64`: −86400000..86400000 |
| basis | `u8`: 0 pulse |
| clockPolicy | `u8`: 0 trusted_only |
| recovery | `u8`: 0 baseline |
| fallback | `u8`: 0 skip |
| gapMs | `u64`: 1..9007199254740991 |
| when | 기존 표현식 blob, Bool 결과, 최대 4096바이트 |

모든 정수는 리틀엔디안이다. 정책 태그는 명시적이다. 다른 언어 정책에는 추가 구현이
필요하며 이 프로필은 언어가 지원하는 정책을 재정의하지 않는다. 시간대 제공 여부는
공급자 바인딩의 책임이며 구조 디코딩으로 입증되지 않는다.

창 슬롯과 일정 슬롯은 발견 순서에 따라 별도로 번호를 매긴다. Opcode 57은 창 읽기를
유지한다. Opcode 58은 `[58, u16 scheduleSlot, u8 field]`이며 field 0의 형식은 Bool
(`due`)이다. 각 서두 표현식은 앞선 항목만 참조할 수 있다. 전이와 의도는 모든 항목을
참조할 수 있다. 각 전략 안에서 두 종류를 통틀어 site와 이름이 고유해야 한다.
스칼라 상태와 서두 항목 수의 합은 전략마다 128 이하여야 한다.

## 식별 및 경계

바이트코드에는 의미상 로컬 선언 식별자가 들어간다. 문서 해시와 외부 문서/개정
식별자는 검증된 산출물 메타데이터에 남는다. 주석만 바뀌는 소스 변경은 실행 바이트를
바꾸면 안 된다.

The internal encoder forms are:

```text
(solar-pulse SITE NAME TIMEZONE LAT LON EVENT OFFSET_MS
  pulse trusted_only GAP_MS baseline skip WHEN)
(schedule-read SLOT due)
```

이 형식은 추가 제품 소스 형식이 아니다. 제품 소스는 계속 완전한 `.ghost.md` 문서 하나다.

집중 증거는 다음 테스트에 있다.
`tests/gfb5-schedule.test.mjs`,
`tests/gfb5-browser.test.mjs`, `tests/gfb5-native.test.mjs`, 및
`crates/ghostflow-core/tests/schedule_module.rs`. 이들은 wire 필드, 의존성 순서,
잘못된 입력, 경계 및 활성화 거부를 검증한다. 예약 admission, 공급자 정확성, 일정
실행, 영속 식별자, 리소스 회계 또는 재생을 입증하지는 않는다.
