<!-- translation-source: docs/BYTECODE.md -->
[English original](BYTECODE.md)

# GFB 바이트코드

## 임시 lifecycle framing

로컬 GFB21 후보는 변경 없는 내부 GFB byte와 검증된 restart descriptor를 감싼다.
[Scan frame WASM](SCAN-FRAME-WASM.ko.md#재시작-수명-주기-확장)을 참고한다.
GFB19는 계속 live Range start를 뜻하고 GFB20은 keyed TimeSlots Range를 뜻한다.
공개된 `ghostflow-runtime-99ca1a3`의 lifecycle GFB19 wrapper는 현행 Range 번호와
충돌하므로 통합 loader가 변환이나 fallback 없이 거부한다. 역사적 byte와 consumer
pin은 고정된 채로 보존한다. 검토한 source를 별도 owner 후보로 재컴파일해야 하며
21은 번호 할당 조정 전까지 임시다. 새 format이나 release를 공개하는 변경은 아니다.

GFB18은 채택된 달력 경계 profile `GhostFlow/control-v18`을 추가한다.
prelude tag 17은 calendar로 판정하는 불변 UTC Daily Range이며 tag 18은
protected Bool/Bool/fault-code 입력을 쓰는 typed calendar Result다.
정확한 layout과 그대로 유지되는 GFSF5 fact는
[컨텍스트 실행 ABI](CONTEXT-EXECUTION-ABI.ko.md#gfb18-달력-경계)에 설명한다.
Range는 자정을 넘는 work interval을 거부하며 자정에 끝나고 다음 날짜에 시작하는
명시적인 별도 range를 허용한다. 일반 Range 및 이전 binary layout의 기존 의미는
유지한다. 새 tag에는 GFB18 header가 필요하며 이전 loader는 이를 거부한다.
이 식별자는 Device release나 물리 실행의 인증이 아니다.

## Bounded 자연 정책 (GFB13)

확장 Solar/Tide 정책만 GFB13과 `GhostFlow/control-v12`를 선택하며 기존 profile bytes는 그대로다. Solar tag 1은 기존 layout을 유지하고 `when` expression 뒤에 `holdMs:u64` (0은 없음), `fallbackAtMs:u64` (86400000은 skip)을 추가한다. Context record는 cancellation expression 뒤에 `holdMs:u64`를 추가한다. Manifest 정책은 clock `{kind: 'hold_trusted', durationMs, terminal: 'skip'}`, fallback `{kind: 'fixed_time', atMs, terminal: 'skip'}` 객체다.

확장 Solar facts는 GFSF6을 사용한다. Solar v1 row layout을 유지하고 provider/context string 뒤에 optional `fallbackWallMs`, `unavailableReason:u8` (255는 없음, 0–5는 natural-context reason code)을 추가한다. 기존 v1 packet과 WASM 함수 이름은 그대로다. 이전 pinned runtime은 activation 전에 GFB13을 거부한다. 서명 portable-package의 config-only GFB11 profile은 좁은 범위를 유지한다. 이 형식은 물리 Device 증거가 아니다.

모든 정수는 리틀엔디안이다. 문자열은 `u16 length` 뒤에 UTF-8 바이트가 온다.
값은 제한된 후위 스택을 사용하고 조건식은 정방향 분기를 사용한다. 공개 컴파일은
정확한 표준 `.ghost.md` 문서 전체를 입력으로 받는다. `tools/gfb1.mjs`의 S-expression
표현은 내부 컴파일러 IR이다.

## 모듈 봉투 및 형식 결정

- magic: `GFB1` (봉투 magic은 변경되지 않음)
- 형식 버전: `u16`
- 모듈 이름: string
- 모듈 버전: `u32`
- 입력: `u16 count`, 이어서 `(name, type)` 레코드
- 상태: `u16 count`, 이어서 `(name, type, default value)` 레코드
- 전략: `u16 count`, 이어서 전략 레코드
- 안전 제약: `u16 count`, 이어서 제약 레코드
- 형식 4 시간 헤더: 상태 뒤에 `nowInput`, `timeEpochInput`, 루트 테이블
- 형식 4 시간 전략 테이블: 각 query 뒤, 전이/의도 앞에 window 설명자가 온다

| 형식 | 컴파일러 선택 조건 | 값 형식 |
|---|---|---|
| 1 | Int가 없는 직선식 | `1=Bool`, `2=Number` |
| 2 | Int 선언 또는 연산이 있는 직선식 | `3=Int`도 사용 |
| 3 | 분기, 동적 Int/Number 변환 또는 시간 값 가드 | Bool, Number, Int |
| 4 | 물리 루트와 시간 입력을 사용하는 시간 창 모듈 | 형식 3 형식과 제한된 창 설명자 |
| 5 | Solar 일정 서두 | 형식 4 형식과 태그가 붙은 일정 설명자 |
| 6 | 연속 `true_for` 서두 | 시간 형식과 true-for 설명자 |
| 7 | PID objective | Bool, Number, Int 및 objective 레코드 |
| 8 | Daily 일정 서두 | 시간 형식 및 Daily 설명자 |
| 9 | DailySlots 일정 서두 | 시간 형식 및 DailySlots 설명자 |
| 12 | 불변 UTC Range | GFB11 context 배치와 UTC Range 태그 13 |
| 11 | 형식 설정 스트림 및 컨텍스트 실행 | 컨텍스트 서두와 선택 PID objective; 기존 형식 10 컨텍스트 프로필을 대체 |

이는 컴파일러 출력 프로필이지 모든 호스트가 모든 프로필을 지원한다는 약속은 아니다.
레코드 배치와 활성화는 기능별 ABI 문서를 참고한다.

2026-09-22 형식 결정은 참조 §2.6 평가를 위해 형식 3을 도입한다.
형식 1과 2는 직선 프로그램용 현재 소형 프로필로 유지된다.
대체된 즉시 평가 표현식 opcode `11`, `12`, `18`은 **모든** 프로필에서 거부한다.
해당 연산을 포함한 소스는 다시 컴파일해야 한다. 로더는 즉시 실행으로 변환하거나
대체 경로를 사용하지 않는다. 지원하지 않는 형식 번호는 활성화 전에 실패한다.
기존 직선 golden 벡터의 바이트와 해시는 그대로 유지된다.

형식 2에는 Int 선언 또는 명령이 필요하다. Int 즉시 값 바이트는 opcode로 세지 않는다.
형식 3은 Bool/Number만 사용하는 분기도 허용한다. 정수 명령과 기능 query 형식 태그는
형식 2와 같은 의미다.

각 전략에는 이름, 부호 있는 우선순위, query blob, 전이와 의도가 들어간다. blob에는
`u32` 바이트 길이 접두부가 있다. 전이는 `u16` 인덱스로 상태를 지정하고 의도에는
이름과 결과 형식이 있다. 기본값은 Bool의 `u8`, 유한 `f64` Number, 부호 있는 `i32`
Int로 인코딩한다.

## 표현식 opcode

| Opcode | 피연산자 | 의미 |
|---:|---|---|
| 1 | `u8` | Bool 상수, 0 또는 1 |
| 2 | `f64` | 유한 Number 상수 |
| 3 | `u16` | 입력 인덱스 |
| 4 | `u16` | 이전 상태 인덱스 |
| 5 | `u16` | 다음 상태 인덱스; 의도에서만 |
| 10 | — | 불리언 NOT |
| 13 | — | 동일 형식 값의 동등 비교 |
| 14–17 | — | 수치 LT, LTE, GT, GTE |
| 19–22 | — | Number ADD, SUB, MUL, DIV |
| 23 | `i32` | Int 상수; 형식 2와 3 |
| 24 | — | 검사된 Int 부호 반전 |
| 25–29 | — | 검사된 Int ADD, SUB, MUL, DIV, REM |
| 30 | `u16 displacement` | Bool을 pop하고 false이면 점프; 형식 3 |
| 31 | `u16 displacement` | 무조건 점프; 형식 3 |
| 32–47 | — | Number 상수 `opcode - 32` (0부터 15); 형식 3 |
| 48 | — | Int를 정확한 Number로 변환; 형식 3과 4 |
| 49–53 | — | Number→Int: exact, floor, ceil, trunc, nearest-even; 형식 3과 4 |
| 54 | — | Duration 밀리초 검사, Number → Number; 형식 3과 4 |
| 55 | — | DateTime UTC epoch 밀리초 검사, Number → Number; 형식 3과 4 |
| 56 | `u32 site` | Trace Result 소비; `[payload:T, choice:Number, origin:Number] → [payload:T]`; 형식 3과 4 |
| 57 | `u16 slot, u8 field` | 시간 창 투영: `0=ok`, `1=value`, `2=fault`, `3=origin`, `4=admissionRevision`, `5=newestTimestamp`, `6=count`, `7=quality`; 창이 있는 시간 형식 |
| 58 | `u16 slot, u8 field` | 일정 투영: `0=due`, `1=missed`, `2=active` (`active`는 컨텍스트 프로필만); 일정이 있는 형식 5, 6, 8, 9, 11 |
| 59 | `u16 slot, u8 field` | 연속 `true_for` 투영: `0=ok`, `1=value`, `2=fault`, `3=origin`, `4=start`, `5=end`, `6=covered`; 형식 6 |

컴파일러는 분기식에서 compact Number 상수를 사용하여 유한 enum 제어 프로그램이 동일한
4096바이트 표현식 예산에 들도록 한다. 이 상수도 Number 형식이며 Int의 opcode 23 및
형식 태그 3과 무관하다. 음의 0은 일반 `NUMBER_CONST f64` 인코딩과 부호를 유지한다.
다른 Number 값도 일반 인코딩을 유지한다. 형식 1과 2는 compact opcode를 거부하고
현재 직선 바이트를 보존한다.

동적 변환은 형식 피연산자 하나를 소비하고 형식 결과 하나를 만든다. Number→Int 연산은
명시한 정책에 따라 반올림한 뒤 `-2147483648..2147483647` 바깥 값을
`integer-conversion-out-of-range`로 거부한다. `int_exact`에서는 유한 분수 값이
범위 검사 전에 `integer-conversion-fractional`을 발생시킨다. 여기에는 `2147483648.5`도
포함된다. 비유한 입력은 기존 Number 입력 경계에서 계속 유효하지 않다. 변환 고장은
틱 전체를 거부한다. 선택되지 않은 분기의 변환은 실행되지 않는다. 상수 변환은 컴파일
시 진단과 리터럴 lowering을 유지하며 해당 직선 프로그램은 여전히 형식 1 또는 2를 선택할 수 있다.

`CHECK_DURATION`은 유한 정수
`0..9007199254740991`일 때만 Number를 보존한다. 그 외에는 `duration-out-of-range`로
틱을 거부한다. 소스 컴파일러는 단항 음수를 포함해 동적 Duration 산술 연산 직후마다
가드를 출력한다. 유효하지 않은 중간 결과는 후속 산술로 감출 수 없다. 상수 Duration
오류는 컴파일 진단으로 남는다. 선택되지 않은 분기는 가드를 실행하지 않는다. 이
opcode는 기계 Number 표현을 보존하며 매니페스트의 명목 Duration 형식을 없애지 않는다.

`CHECK_DATETIME`도 유한 정수 UTC epoch 밀리초
`0..253402300799999`만 보존한다. 위반하면 `datetime-out-of-range`로 틱을 거부한다.
DateTime 이동은 일반 Number 산술 직후 이 가드를 적용하므로 유효하지 않은 중간 시각을
나중의 역방향 이동으로 감출 수 없다. 이 명령은 Date나 TimeOfDay 연산을 정의하지 않는다.

산술은 왼쪽 피연산자 다음 오른쪽 피연산자를 소비한다. Number를 0으로 나누거나
결과가 유한하지 않으면 틱을 거부한다. Int 산술은 오버플로와 0 제수를 거부한다.
나눗셈은 0 방향으로 자르고 나머지는 피제수 부호를 따른다. `MIN div -1`은 오버플로,
`MIN % -1`은 정확히 0이다.

## 형식 4 시간 창 레코드

형식 4는 기존 `GFB1` 봉투와 `u16` 형식 버전 `4`를 사용한다. 시간 창이 하나 이상
있는 모듈에만 선택된다. 창이 없는 모듈은 기존 형식 선택을 유지한다. 형식 4에는
형식 3의 모든 표현식 연산이 포함된다.

스칼라 상태 테이블 뒤에 `u16 nowInput`, `u16 timeEpochInput`, 그리고 `u16 rootCount`가
온다. 이 인덱스는 예약 Number 입력 `__gf_now_ms`, `__gf_time_epoch`를 바인딩한다.
각 root는 엄격히 증가하는 양수 `u32 tag`, 이름, present (`Bool`), epoch, id, timestamp
(`Number`) 입력 인덱스 네 개를 저장한다. 시계와 root 입력 바인딩은 서로 달라야 한다.

각 전략은 전이/의도 앞에 `u16 windowCount`를 저장한다. 창 레코드에는 `u32 site`, 이름,
연산 (`0=average`, `1=min`, `2=max`, `3=rate`), 페이로드 형식, `u64 overMs`,
`u64 maxAgeMs`, `u16 rootRefCount`, 정렬된 `u16` root 인덱스가 포함된다. 길이
접두부가 붙은 소스 표현식 여섯 개는 다음 순서다. `ok` (Bool), `payload` (페이로드 형식),
그리고 `fault`, `origin`, `quality`, `sourceTag` (Number). Duration은 `1..2^53-1` 범위다.
average와 rate는 Number 페이로드를 사용하고 min과 max는 Number 또는 Int를
사용할 수 있다. 스칼라 상태 수와 창 수의 합은 전략마다 최대 128이다.

Opcode 57은 창 슬롯과 필드를 읽는다. 필드 0과 1은 각각 Bool 및 페이로드 형식이며
필드 2–7은 Number 형식이다. 성공 집계의 품질은 `3`, 사용 불가 품질은 `0`이다.
형식 1–3과 장치 query는 opcode 57을 거부한다. 검증기는 활성화 전에 잘못된
root/window site, 중복 이름, 표준형이 아닌 root 순서, 잘못된 기간 및 소스 표현식
형식 불일치를 거부한다. 소스 표현식은 이전 창 슬롯만 읽을 수 있고 전이와 의도는
해당 전략의 모든 슬롯을 읽을 수 있다.

여섯 번째 소스 표현식은 품질에 따라 해석되는 증거 참조다. 품질 `1`은 물리 root tag를
선택하고 품질 `3`은 이전 창 site를 선택한다. 두 값은 서로 다른 식별 이름 공간이다.
quality 표현식의 field-7 opcode-57 읽기는 이전 창 증거 의존성을 선언한다. 해당 물리
root는 소비자의 root 참조에 포함되어야 한다. 제어 조건에서만 사용하는 다른 창 읽기는
증거를 선언하지 않는다. 품질 `3` 상수만으로 임의의 상위 창을 승인할 수 없다. 인코더와
네이티브 로더는 모두 활성화 전에 바인딩을 검증한다. 추가 opcode나 wire 필드는 없다.

중첩 창 매니페스트 설명자에는 비어 있지 않은 `{name, site, slot}` 배열
`upstreamWindows`가 포함되고 이전 슬롯 순으로 정렬된다. 물리 전용 설명자는 이를
생략한다. `sources` 배열에는 모든 전이적 물리 root가 들어간다. 정본 패키지 재생은
이 필드들을 고정한다. 네이티브 패키지 검증기도 디코딩된 이전 창 의존성과 대조한다.

`GhostFlow/control-v4` 매니페스트는 생성된 `__gf_now_ms`, `__gf_time_epoch` 입력과
창 signal 설명자를 바인딩한다. 밀도 사실, 대상 메모리 예산, 실행 epoch는 활성화
입력이다. 로드할 때 임의로 만들어 내거나 작성 매니페스트 설정으로 인코딩하지 않는다.

분기 변위는 변위 즉시 값의 끝부터 바이트 수를 센다. 양수여야 하며 명령 경계나
표현식 끝에 도달해야 한다. 역방향 간선, 루프, 표현식 바깥 대상, 도달 불가 명령
바이트는 유효하지 않다. 선택되지 않은 경로를 포함해 양쪽 경로를 검증한다. 모든
합류점에서 스택 높이와 형식이 같아야 한다. 모든 경로는 선언된 결과 형식의 값 하나로
끝나야 하며 스택 용량은 128개 값이다.

`if condition then yes else no`는 다음과 같이 lowering된다.

```text
condition
JUMP_IF_FALSE(length(yes) + 3)
yes
JUMP(length(no))
no
```

`left && right`는 `if left then right else false`로 lowering된다.
`left || right`는 `if left then true else right`로 lowering된다. 네이티브와 WASM의
Rust에서 조건과 선택된 분기는 왼쪽에서 오른쪽 순으로 실행된다. 선택되지 않은 분기는
런타임 오류를 낼 수 없다. 컴파일 시 형식/이름 오류는 여전히 실패한다.

입력 인덱스 0에서 `if guard then true else false`의 정확한 바이트는 다음과 같다.

```text
03 00 00  1e 05 00  01 01  1f 02 00  01 00
INPUT(0)  JFALSE(5) TRUE   JUMP(2)   FALSE
```

## Query opcode

Query는 별도 명령 이름 공간을 사용한다.

- `1 HAS kind-string name-string type-u8`
- `2 ALL u16-child-count`
- `3 ANY u16-child-count`
- `4 NOT`
- `5 BOOL_CONST u8` (0 or 1)

효과가 없는 기능 조건자는 계속 후위 평가를 사용한다. 표현식 opcode 폐기는 query의
ALL/ANY를 변경하지 않는다. 검증기는 모든 query 피연산자, 기능 형식, 스택 한도 및
불리언 결과 하나를 확인한다.

## 안전 레코드 및 호스트 매니페스트

제약 레코드는 `kind:u8`, `arity:u16`, 그리고 그 수만큼의 서로 다른 불리언 의도
이름으로 구성된다. 종류는 `1=requires` (이름 두 개), `2=mutex` (이름 2–32개),
`3=requires-any` (대상 뒤에 대안 1–31개)다. 매 라운드 후보 스냅샷 하나를 읽고
고정점에 도달할 때까지 false 전용 차단을 모두 함께 적용한다.

모듈 한도는 전체 1 MiB, 이름당 UTF-8 128바이트, 입력/상태/의도/제약 각각 128개,
전략 32개, blob당 4096바이트다. 형식 4에서는 전략별 스칼라 상태 수와 창 수의 합도
128 이하여야 한다. 런타임 오류는 상태, 의도 또는 저널을 커밋하기 전에 틱을 거부한다.
알 수 없는 표현식/query opcode 및 제약 종류는 활성화 전에 거부한다.

매니페스트 스키마와 바이트코드 형식은 별도 계약이다. `GhostFlow/control-v4`
매니페스트는 Int를 지원하는 GFB 형식 2 또는 3을 바인딩할 수 있고 창 매니페스트는
GFB 형식 4와 짝을 이룬다. 분기만으로 Int 매니페스트 스키마가 필요한 것은 아니다.
`.gfb.manifest.json`은 명목 형식과 생성 입력을 보존하고 `.gfb.map.json`은 소스 맵을
보존한다. 매니페스트의 `bytecodeSha256`은 정확한 바이트코드를 묶지만 인증하지는
않는다. 생성 입력이 없으면 런타임 오류다. [IMPLEMENTATION.md](IMPLEMENTATION.md)를 참고한다.

## 적합성 산출물

`tests/fixtures/gfb1-golden-v1.ghost.md`와
`tests/fixtures/gfb2-int-golden-v1.ghost.md`는 대응 추적 `.gfb` 및 다이제스트 메타데이터
`.json` 파일의 권위 있는 리터레이트 소스다. Node와 브라우저 컴파일은 직선 벡터를
보존한다. 네이티브와 WASM 로더는 잘못된 버전, 잘못된 바이트코드, 폐기된 즉시 명령을
거부한다. `tests/gfb2-int.test.mjs`는 형식 3 분기 바이트도 고정하고 두 호스트에서
선택/미선택 런타임 오류를 실행한다. Core Rust 테스트는 중첩 분기 실행, 분기 합류,
잘못된 인덱스와 스택 경계를 다룬다.

## Result 소비 진단

`TRACE_RESULT` (56)은 양수 u32 site를 요구한다. 컴파일러 내부 형식은
`(trace-result site payload choice origin)`다. 평가는 이벤트를 기록하기 전에 payload,
choice, origin 순으로 계산하며 payload 값과 형식은 바뀌지 않는다. Choice는
`0..65535`의 정확한 Number 정수다. 0은 Ok이고 fault는 오류 enum 순번에 1을 더해 쓴다.
Origin은 `0..4294967295`의 정확한 Number 정수이며 기본값은 0이다. 메타데이터가
유효하지 않으면 `result-trace-out-of-range`로 틱을 거부한다. 소스 메타데이터는 site와
origin 식별자를 정확한 소스 개정 및 오류 enum에 바인딩한다. VM은 이름을 추론하지 않는다.

커밋된 각 TickRecord JSON에는 `{site, choice, origin}` 이벤트로 된 전용 `resultTrace`
배열이 있다. 반복 site를 포함해 이벤트는 실행 순서를 따른다. 실행되지 않은 표식은
이벤트를 만들지 않는다. 진단은 요청 또는 안전 액추에이터 의도에 들어가지 않는다.
나중에 오류가 나면 후보 상태와 의도에 더해 해당 틱의 진단 버퍼 전체를 버린다.
되감기는 선택된 저널 레코드를 보존하고 ghost replay는 기록 입력에서 진단을 다시 만든다.
별도의 변경 가능한 진단 체크포인트 상태나 새 네이티브/WASM C ABI는 없다.

로더는 모든 전이, 의도와 형식 4 창 소스 표현식의 표식 명령 수를 센다. 정방향 전용
제어 흐름에서는 표현식마다 각 명령을 최대 한 번 실행하므로 모듈 표현식 바이트가 한
틱의 전체 이벤트 수를 제한한다. 복사된 표현식은 각각 별도 계산한다. 모듈 1 MiB 한도와
표식당 5바이트를 기준으로 하면 헤더와 다른 레코드가 상한을 더 낮추기 전 최대치는
`floor(1,048,576 / 5) = 209715`개 표식이다. 이벤트당 12바이트이므로 수집기 오버헤드
이전 최대 2516580바이트다. 보존 진단에는 기존의 제한된 저널 용량도 적용된다.

[이식형 GFB 패키지](PORTABLE-PACKAGE.md)는 정확한 바이트코드를 보존하고 소스,
매니페스트, 소스 맵, 컴파일러/런타임 식별자 및 설치 바인딩에 연결한다. 패키징은
바이트코드를 다시 쓰지 않는다.

## 컴파일러 단계 경계

위치를 보존하는 Surface AST는 검증된 소스 lowering을 거친 뒤 메모리 내 형식 Core IR이
된다. 이 IR에는 해석된 입력/상태 참조, 의미 표현식 형식 및 연산자, 요청 의도, Bool
제약과 시간/설정/품질/objective 동작의 명시적 확장 설명자가 있다. 위에서 언급한
S-expression 형식은 이 단계의 내부 lowering 입력이다. GFB emitter만 Core IR을 숫자
opcode로 매핑하고 형식을 선택해 바이트를 기록한다. 이 분리는 GFB wire 버전이나
런타임 계약을 바꾸지 않는다.

## 불변 UTC Range (형식 12)

GFB12는 UTC Range prelude를 하나 이상 요구하며 그 밖에는 GFB11 context 배치와 선택적 objective trailer를 사용한다. 태그 `13`은 `site:u32`, 이름 string, `gapMs:u64`, timezone string (`UTC`만), `durationMs:u64`, `startCount:u16`, 정렬된 고유 `startMs:u64` 값, `when`과 `cancel_when` expression blob을 인코딩한다. 시작은 `[0,86400000)` 안에 1–96개이며 duration은 `[1,86400000]`이다. 하루 순환 간격은 duration 이상이어야 한다. native decoder가 경계와 non-overlap을 독립적으로 검증한다. 기존 형식의 bytes는 바뀌지 않으며 이전 consumer는 activation 전에 형식 12를 거부한다. header를 낮춰도 태그 13은 GFB11 prelude가 되지 않는다.

manifest는 `GhostFlow/control-v10`과 기존 context facts ABI를 사용한다. 각 Range site는 빈 occurrence rows와 calendar/provider 없음이 필요하며 runtime은 신뢰된 wall time으로 UTC 계획을 생성한다. occurrence identity는 site, UTC source day, 정렬된 안정 slot key를 사용한다. Range engine checkpoint는 GFES2와 GFRG1 consumed-key ledger를 사용하며 기존 engine은 GFES1을 유지한다. 새 boot는 중복 방지 정보를 유지하지만 활성 timer를 재개하지 않는다. capacity 소진과 잘못된 checkpoint는 명시적이고 원자적으로 실패한다. 서명된 portable-package 설정 profile은 GFB11을 유지하며 GFB12를 허용하지 않는다.
