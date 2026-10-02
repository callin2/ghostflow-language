<!-- translation-source: docs/SOLAR-CONFIG-EXECUTION.md -->
# 공유 live 설정을 사용하는 Solar 실행

[English original](SOLAR-CONFIG-EXECUTION.md)

Solar와 일반 제어 식은 하나의 프로그램에서 같은 현재 typed config Result를
읽을 수 있다. 운영자의 허용 스위치와 일출 pulse는 완전한
[SolarLiveConfig 예제](../examples/solar-live-config.ghost.md)를 참조한다.
[영어 읽기 projection](../examples/solar-live-config.ghost.en.md)이 있어도 컴파일
입력은 한국어 정본이다. 좌표, 시간대, rise/set과 offset은 불변 프로그램 데이터다.
이 값을 바꾸려면 config 편집이 아니라 새 프로그램을 컴파일한다.

## 현재 Result와 복구

compiler는 Solar `when` 식에서 읽은 config ID를 기록한다. Rust는 보호 input의
읽기를 검사해 이 의존 집합을 독립 검증한다. 의존하는 현재 config가 하나라도
fault이면 admission은 `Unknown(SettingsFault)`다. 작성한 `fault` 분기가 true를
반환해도 같다. 과거 성공 값이나 초기 기본값으로 현재 fault를 몰래 대체하지 않는다.
무관한 config fault는 해당 Solar schedule을 억제하지 않는다. 일반 식은 여전히
자신이 명시한 Result 분기를 따른다.

승인 관측은 Solar와 일반 평가 전에 stage된다. 그 position의 모든 consumer는
같은 Result를 본다. fault 뒤의 성공 관측은 놓친 시작을 catch-up하지 않고 복구
기준선을 세운다. 다음 허용 crossing은 한 번 발생할 수 있다. 잘못된 packet,
거부된 event 또는 VM 평가 실패는 event와 Solar occurrence 어느 것도 commit하지
않으므로 같은 frame을 재시도할 수 있다. config 관측은 source identity나 일반
elapsed/state 의미를 바꾸지 않는다.

**이유:** 설정 오류를 false로 바꾸면 원인을 잃고, 마지막 성공 값으로 바꾸면
현재 관측이 더 이상 허용하지 않는 작업을 시작할 수 있다. 공유 staged vector는
schedule과 주변 제어가 실제로 적용된 설정에 대해 같은 판단을 하게 한다.

## 사실, 실행과 재시작

host는 typed Solar 사실, 시계 증거와 인증한 설정 관측을 공급한다. 기존 참조
provider로 천문 사실을 계산하지만 `due`를 계산하거나 Rust admission을 우회하지
않는다. 사실은 컴파일한 시간대, 좌표, 사건과 offset의 정확한 binding을 담는다.
binding이 달라지면 평가를 거부한다. 없거나 유효하지 않은 자연 증거에는 사건을
추측하지 않고 명시 clock/fallback 정책을 적용한다.

기존 Rust SolarPulseEngine은 설정·VM과 같은 staged context transaction에 참여한다.
GFB16(`GhostFlow/control-v15`)은 Solar context descriptor를 담고 GFCA1은 context를
활성화하며 GFSF6은 Solar 사실을 추가한다. 기존 비Solar context profile은 GFSF5를
유지한다. 이미 배포한 calendar profile을 보존하기 위한 명시 호환 결정이다.
이전 loader는 새 GFB header를 거부한다. #28/#29의 기존 standalone Solar consumer는
구체적인 기존 실행 profile을 유지한다. 거부된 공유 config 프로그램의 fallback이
아니다. format 번호는 package, source-language, Device 버전과 별개다.

GFCX3는 wrapper version을 유지하고 GFES subtype 3으로 Solar engine snapshot을
담는다. restore에는 정확한 Program과 binding이 필요하다. fault를 포함한 현재
config Result와 소비한 source-day identity는 복원 후에도 유지된다. 새 clock은 새
기준선을 세운다. checkpoint는 일반 VM image나 설정 fallback도, 놓친 시작을 다시
실행할 권한도 아니다. host는 durable storage를 맡으며 출력 의도를 게시하기 전에
admission을 보존해야 한다.

## 가상 예제 재현

1. lockfile dependency와 Rust `wasm32-unknown-unknown` target을 설치한다.
2. 일반 정본 source compiler로 `examples/solar-live-config.ghost.md`를 컴파일한다.
   영어 읽기 projection을 두 번째 프로그램으로 편집하지 않는다.
3. context 지원 WASM host 또는 native context runner에 컴파일 artifact와 일치하는
   activation, 유한한 기록 Solar 사실을 공급한다. clock 증거도 명시 공급한다.
   실제 clock이나 장치는 자동 설치되지 않는다.
4. 승인된 Bool config 관측, fault 관측, 이후 성공 관측을 공급한다. 일반 Result와
   schedule trace를 비교한다. 복구는 과거 일출을 재실행하지 않고 기준선을 세워야 한다.
5. `cargo build --locked -p ghostflow-core --release --example context_tape`와
   `cargo build --locked -p ghostflow-wasm --target wasm32-unknown-unknown --release`로 build한다.
   `node --test tests/solar-config-compiler.test.mjs tests/solar-config-runtime.test.mjs`를
   실행한다. 독자 예제는 컴파일 검사를 받고 더 풍부한 집중 test fixture는 같은
   artifact와 event 순서를 native Rust, WASM, 가상 simulator로 확인한다. packet과 commit 경계는
   [context ABI](CONTEXT-EXECUTION-ABI.md)를 참조한다.

실행 경계는 명시적이다. 공유 config stream과 literal DailySlots 혼합은 여전히
거부한다. #153의 Solar Window/Run 중첩·취소 설계는 별개다. 이 host 실행 변경은
signed portable packaging, Device 채택, 농부 interface 전달이나 물리 설치를
제공하지 않는다. Reference §3.5와 §5가 언어 의미를 정의하고,
[기존 standalone Solar 안내](SOLAR-SCHEDULE.ko.md)는 자체 profile을 설명한다.

관련 issue: [#145](https://github.com/callin2/ghostflow-language/issues/145).
