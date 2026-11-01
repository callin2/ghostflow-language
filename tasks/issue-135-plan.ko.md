<!-- translation-source: tasks/issue-135-plan.md -->
[영문 원문](issue-135-plan.md)

# Issue 135: 첫 실행 가능한 schedule slice

추적: https://github.com/callin2/ghostflow-language/issues/135

날짜가 기록된 이 구현 세션은 `REF-03-024` (`Daily`)만 대상으로 합니다.

- 변경하지 않은 정본 문서형(literate) fixture는 실행 가능한 control 산출물로
  컴파일되어 기존 Rust VM 경로로 실행되어야 합니다.
- Host adapter는 제한되고 완전한 occurrence fact 집합을 공급할 수 있습니다.
- 술어 평가, clock/admission 상태, projection, 트랜잭션 확정(commit), intent는
  계속 Rust가 책임집니다.

## 테스트 우선

1. Descriptor 산출물 gate에서 정확한 fixture의 현재 실패를 기록합니다.
2. Boot baseline과 Daily crossing 하나를 갖춘 집중 executable-reference
   oracle을 추가합니다. Fixture 소스와 기대 언어 계약은 변경하지 않습니다.
3. 기존 schedule 런타임 harness가 지원하는 최소한의 native/WASM parity 검사를
   추가합니다.

## 구현 경계

- `schedule_clock`과 제한된 schedule admission/런타임 기구를 재사용합니다.
- Architecture 검토에서 별도의 GFB8/tag-3 Daily descriptor와 control-v7
  manifest를 승인했습니다.
  - GFB7은 PID 전용으로 남습니다.
  - GFSF v2는 명시적인 trigger kind와 civil fold를 전달합니다.
  - 현재 Solar 소비자는 GFSF v1을 유지합니다.
- IANA occurrence 생성과 context revision은 provider/adapter 경계에 둡니다.
  JavaScript 식, 상태, admission, intent VM을 추가하지 않습니다.
- Unknown 사유, boot/recovery baseline, gap 종결 처리, rollback, occurrence
  identity, DST 정책 필드, 정확한 source identity를 보존합니다.
- 이 slice에서는 DailySlots, Periodic, Cron, TimeSlots, WorkCalendar, Tide
  동작을 바꾸지 않습니다.

## 파일 소유권

- Issue-135 작업자는 이 계획, 집중 schedule/compiler/runtime 파일,
  `REF-03-024` 집중 테스트를 소유합니다.
- 이 작업자는 `tasks/plan.md`나 temporal 작업자의 사례를 편집하지 않습니다.
- 공유 `tests/reference/cases/02-time-control.json` fixture는 정당한
  executable 입력 맥락이 필요한 경우가 아니면 읽기 전용입니다. 그 소스와
  기대값은 변경하지 않습니다.

## 수용 기준

- 변경 전 집중 테스트는 알려진 descriptor-only 사유로 RED입니다.
- 변경하지 않은 `REF-03-024` 소스가 실행 가능한 산출물을 생성합니다.
- `ghostsim`이 Rust를 통해 baseline과 수용된 Daily crossing 하나를
  실행합니다.
- 대상 테스트가 통과하고, 변경은 push, merge, USB, 하드웨어 작업 없이 로컬에
  commit합니다.

## Native/compiler checkpoint (2026-09-24)

- **Commit:** `9916c41`은 상수 Daily pulse slice와 별도의 native/WASM
  activation/tick 진입점을 구현합니다. 변경하지 않은 REF-03-024 소스를
  보존합니다.
- **기록된 RED:**
  - REF-03-024 descriptor-only 실행 실패
  - fold identity 누락
  - 사용할 수 없는 맥락을 BootBaseline으로 잘못 보고
  - Unknown 관측에서 provider/context revision 손실
- **GREEN:** native schedule 테스트 24, admission 테스트 9, fold 테스트 2;
  compiler, source identity, Solar 회귀, 저수준 Daily WASM 테스트 18.
- **아직 주장하지 않음:** host ControlRuntime과 ghostsim 통합은 별도로
  배정되었습니다. 이 checkpoint는 그 통합이 완료되었다고 주장하지 않습니다.
- **상세:** ABI 상세와 provider 책임은
  `docs/reports/2026-09-24-issue-135-daily-abi.md`에 있습니다.
