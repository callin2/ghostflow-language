<!-- translation-source: tasks/civil-schedule-reference-integration.md -->

[영문 원본](civil-schedule-reference-integration.md)

# Civil schedule Reference 통합

기준: [Reference §3.5–3.8](../docs/reference/03-time-and-schedules.md).
이 문서는 구현 기록이며 언어 계약을 대체하지 않는다.

## 구현된 구조 slice

`REF-03-024` (`Daily`)와 `REF-03-032` (`DailySlots<15min>`)는 이제 명시적
pulse 정책을 파싱하고 타입 검사한다. Checker는 안정된 선언 site,
timezone, 정확한 trigger, DST 선택, Bool 술어, 공통 정책을 보존한다.
Daily는 00:00과 23:59:59.999를 포함한 정확한 TimeOfDay 밀리초를 보존한다.
DailySlots는 정렬된 중복 없는 분 단위 slot과 15분 grid를 보존한다.

이 slice가 구조적으로 지원하는 정책은 `pulse`, `trusted_only`,
`skip_after(positive constant Duration)`, `baseline`, `skip`이다.
누락/중복 필드, 잘못된 타입/영역, Bool이 아닌 술어, 잘못된 zone/slot에는
진단을 낸다. Provider가 fold나 gap을 이미 해결했다고 가장하지 않고
DST enum 값을 보존한다.

Descriptor는 checker 출력일 뿐이다. 수용된 bytecode, package,
activation ABI를 정의하지 않는다. 명시적 정책 schedule에는 옛 host
`dueInput`을 주지 않는다. 공개 컴파일은 의도적으로 다음에서 멈춘다.

```text
Daily 정책 실행에는 검증된 occurrence provider와 native admission binding이 필요하다
DailySlots 정책 실행에는 검증된 occurrence provider와 native admission binding이 필요하다
```

따라서 **REF-03-024와 REF-03-032는 executable 수용 실패로 남는다**.
원래의 수용 기대값은 변경하지 않는다. 정책 없는 옛 DailySlots 경로는
아직 수용된 구현으로 대체되지 않았다. 이 slice는 그 경로의 Reference 준수를
인증하지 않는다. 정본 대체 경로가 실행되고 검증되면 옛 경로를 제거하고
활성 호출자를 이관한다.

근거: `tests/daily-slots-policy.test.mjs`는 두 Reference fixture를 직접 사용한다.
최초 테스트는 옛 미지원 문법에서 실패했다. 구현 뒤 새 구조/진단 테스트와
기존 중복/control 검사가 통과한다(52건; `build/daily-policy-green.log`).
공개 Reference 컴파일은 여전히 명시적 runtime binding 누락 진단에서 실패한다.

## 남은 통합 순서

1. 범위가 제한된 완전한 civil occurrence fact, 안정된 local-date/time/fold
   식별자, IANA/context revision, clock coverage를 정의한다.
   Provider는 fact를 공급하고 `.due`를 계산해서는 안 된다.
2. Portable admission descriptor를 Solar 밖으로 확장한다. 임의 술어 평가,
   수용된 scan의 clock 상한 기록, recovery baseline, gap 종결 처리,
   occurrence별 결과, multiple-crossing skip을 보존한다.
   기존 GFB5 schedule descriptor는 구체적으로 `SolarPulseDescriptor`다.
   그 tag를 다른 trigger에 재사용하면 잘못된 wire 계약이 된다.
3. 검증된 bytecode, WASM/native activation binding, 의존 순서의 prelude
   실행을 추가한다. Let/signal/schedule에 대한 술어 의존성,
   transaction rollback, 제한된 자원 집계, replay/restore를 포함한다.
4. 공개 literate 소스 -> 산출물 -> native/WASM 실행을 한 번의 daily crossing,
   거짓 술어, 정확한 gap 경계, 복구, rollback, 여러 crossing, DST gap/fold,
   하류 실패 rollback에 대해 증명한다. 그 뒤 명시적 생성 거부와
   대체된 host `.due` 경로를 제거한다.
5. 공통 정책을 Window/Run, 취소, held clock으로 확장하고 각 전체 실행 의미를
   구현한다. 이 유효한 Reference 형태는 pulse 구조 slice로 완료되지 않는다.

## 그 밖의 요청된 Reference 사례: 관측된 최초 실패

다음 진단은 이 slice 이전에 실제 catalog fixture에 `compileSource`를 적용하여
관측했다. 최초 차단 요인을 설명하며 전체 범위를 뜻하지 않는다.

| 사례 | 관측된 실패 | 추가로 필요한 계약 |
|---|---|---|
| REF-03-036 | Periodic schedule kind 거부 | 명시적 anchor, live interval phase/revision, occurrence provider와 admission |
| REF-03-038 | Cron schedule kind 거부 | cron5 parser/영역 검사, civil occurrence provider와 admission |
| REF-03-042/045 | Solar `basis` option 거부 | 기존 GFB5 구조/native admission 선행 구현으로 공개 공통 정책 lowering; provider/runtime binding은 여전히 필요 |
| REF-03-057 | `TimeSlots<15min,8>` config 거부 | 유한 집합 타입, live setting 검증/원자성, schedule grid binding과 편집 시 baseline/식별자 |
| REF-03-059 | `calendar` 선언 거부 | 타입이 지정된 WorkCalendar provider, day 규칙, revision/품질 관측 |
| REF-03-060 | `provider` 선언 거부 | 안정된 사건 식별자를 갖춘 Tide fact, 취소, Run/within admission |
| REF-03-062 | `provider` 선언 거부 | 자연 provider 선언과 품질을 인식하는 `tide_is`/`moon_is` Result 의미 |
