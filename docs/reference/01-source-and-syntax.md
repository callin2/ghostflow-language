# 1. 소스와 문법

[전체 목차](../LANGUAGE-REFERENCE.md) · [다음: 타입·표현식·상태](02-types-expressions-state.md)

GhostFlow 프로그램의 정본은 설명과 실행 규칙을 함께 담은 하나의 `.ghost.md` 문서다.
언어의 대표 표면은 `control Name { ... }`, 중괄호, 세미콜론, 수식, 명시적인 다음
상태와 출력 연결을 사용하는 **control 문법**이다. 이 장은 문서에서 실행 소스를
고르는 규칙, 어휘, 이름 범위와 선언 골격을 정의한다.

이 장의 `ghost` 조각은 문법과 의미를 설명하는 예시다.

근거: [선택 문법](../LANGUAGE-SURFACE.md), [공통 언어 계약](../LANGUAGE.md),
[literate 소스](../LITERATE.md), [의도 앵커](../INTENT-ANCHOR-MAP.md),
[소스 보존](../SOURCE-MAP.md), [설계 노트](../DESIGN-NOTES.md).
[전체 언어 reference](../LANGUAGE-REFERENCE.md)는 이 장과 나머지 상세 장의 색인이다.

## 1.1 왜 문서 하나가 소스인가

제어 규칙만 남기면 조건을 둔 이유와 현장 전제가 떨어져 나간다. 반대로 설명만
남기면 어떤 규칙이 실행되는지 기계적으로 확인할 수 없다. GhostFlow는 설명,
주석, 의도, 실행 코드를 한 판본으로 보존하여 검토의 출발점을 하나로 만든다.

- 제품 입력은 완전한 `.ghost.md` 문서 하나다.
- 일반 `.ghost` 파일은 실행 입력이나 대체 입력이 아니다.
- 편집기, 폼, 그래프는 이 문서의 다른 보기일 수 있지만 독립된 제어 원본을 만들지 않는다.
- 문서 판본과 실행 구조의 정체성은 구분한다. 설명만 바뀌어도 문서 판본은 바뀌지만,
  실행 토큰 구조가 같으면 계산의 의미는 같다.

### 실행 블록 추출

CommonMark 문서에서 **최상위 fenced code block**의 info string이 정확히 `ghost`인
블록만 문서 순서대로 추출한다. backtick fence와 tilde fence를 쓸 수 있다.
각 블록 본문 끝에는 개행을 두고 블록 사이에는 빈 줄 하나를 둔다. 제목과 설명을
코드 주석으로 합성하지 않는다.

다음은 `.ghost.md` 전체의 표시 예다.

````markdown
# 펌프 요청

정지가 시작보다 우선한다.

```ghost
control PumpRequest {
  input start, stop: Bool;
```

두 입력의 판단을 출력에 연결한다.

```ghost
  output pump: Bool;
  pump <- start && !stop;
}
```
````

두 `ghost` 블록은 하나의 `control`을 이룬다. 블록마다 별도 실행이나 상태 확정이
생기지 않는다. 중괄호나 문장을 자동으로 보충하지도 않는다. 블록 경계는 선언이나
문장의 끝에 두며 토큰, 문자열, 주석 또는 표현식 한가운데를 나누지 않는다.

다음 항목은 실행 코드가 아니다.

- 일반 문단, 표, 링크, 이미지와 front matter
- indented code block 및 `text` 등 다른 info string의 fence
- 목록이나 인용문 안의 중첩 `ghost` fence
- 더 긴 표시용 fence 안에 문자로 적힌 `ghost` fence
- `ghost-python`, 속성이 붙은 `ghost` 등 정확히 일치하지 않는 태그

닫히지 않은 실행 fence, 실행 코드가 없는 문서, 실행처럼 보이지만 제외되는 중첩
블록은 진단 대상이다. Markdown 구조를 정규식으로 흉내 내어 중첩 블록을 실행해서는 안 된다.

## 1.2 원문, 위치와 의도 연결

원본 문서의 prose, `//` 주석, Unicode, 줄바꿈과 마지막 개행은 그대로 보존할
언어 자산이다. 문법·타입 진단은 합쳐진 임시 텍스트가 아니라 원본 `.ghost.md`의
파일, 행, 열을 가리킨다. 여러 fence에 걸쳐 닫는 중괄호가 빠졌다면 선언 시작과
문서 끝을 함께 가리킬 수 있어야 한다.

노드 정체성은 Markdown 행 번호로 만들지 않는다. 설명을 앞에 추가해 위치가
이동하더라도 실행 구조가 같다면 같은 계산을 계속 식별할 수 있어야 한다. 위치는
항상 특정 문서 판본에 묶인다. 원문과 실행 artifact의 digest는 서로 다른 판본을
섞지 않도록 한다. 이 보존은 원문의 진위를 스스로 증명한다는 뜻은 아니다.

### 의도 앵커

이 계약의 설계 기록은 [#31](https://github.com/callin2/ghostflow-language/issues/31)과
[#60](https://github.com/callin2/ghostflow-language/issues/60)에 연결된다.

앵커는 실행되지 않는 최상위 Markdown HTML 주석이며, 바로 뒤의 최상위 문단 또는
인용 블록 하나를 원문으로 가리킨다. 빈 줄 하나는 허용된다.

```markdown
<!-- ghostflow:anchor id=GF-INT-PUMP-001 kind=intent status=confirmed origin=user -->
> 급수 요청이 있고 정지가 없을 때 펌프를 요청한다.
```

필드 순서와 값은 고정된다.

- `id`: `[A-Za-z][A-Za-z0-9._:-]{0,127}`, 문서 안에서 유일하고 같은 의도에는 안정적이다.
- `kind`: `intent | premise | assumption`
- `status`: `confirmed | unconfirmed | superseded`
- `origin`: `user | operator | engineer | ai | imported`
- `assumption`은 `confirmed`일 수 없다. 확인되면 `intent` 또는 `premise`로 다시 분류한다.

heading, list, nested block, code fence, 다른 앵커 또는 문서 끝은 앵커 본문이 아니다.
여러 블록의 설명은 여러 앵커로 나눈다.

### 실행 노드 링크

실행 `ghost` fence 안의 다음 whole-line 주석은 바로 다음 추적 가능 문장 하나를 가리킨다.

```ghost
// ghostflow:link id=GF-INT-PUMP-001 relation=implements
pump <- request;
```

`relation`은 `implements | constrains | fallback | assumes` 중 하나다. `assumes`는
`unconfirmed assumption`만 가리키며, 다른 relation은 assumption을 가리키지 않는다.
`superseded` 앵커는 현재 노드에 연결할 수 없다. 여러 연속 link line은 같은 다음
문장을 가리킬 수 있다. 빈 줄, 일반 주석, 중첩 표현식, `control` header 또는 fence
끝을 만나면 고아 링크다.

연결 대상은 `input`, `output`, `state`, `config`, `let`, enum, function, `sensor`,
`signal`, `schedule`, `timer`, `require`, `mutex`, 다음 상태 정의, 출력 연결이다.
링크는 자연어를 해석하거나 암묵지를 발견하지 않는다. 작성된 분류와 관계를
보존하며, 미확인 관계를 증명이나 승인으로 바꾸지 않는다.

## 1.3 어휘

### 식별자와 대소문자

식별자는 `[A-Za-z_][A-Za-z0-9_]*`이며 대소문자를 구별한다. `start`와 `Start`는
다른 이름이다. `.`은 식별자 문자가 아니라 `starts.due`, `Alias.name`,
`instance.port` 같은 확정된 경로 구분자다. 입력과 이전 상태는 `start`, `running`처럼
직접 읽으며 이전 별칭 `input.start`, `state.running`, `next.running`은 거부한다.
`'`도 식별자 문자가 아니라 `running'`의 다음 상태 표기다.

다음 언어 단어는 사용자 이름으로 쓸 수 없다.

```text
control fn input output state config parameter let type sensor signal schedule timer
calendar provider resource event account require mutex if then else case in true false
div ok fault import syntax
```

`purefn`, `enum`, `next`, `ifthenelse`, `not`, `and`, `or`, `is`, `isnt`도 제거된
표기를 다른 뜻으로 재해석하지 않도록 예약하고 migration 진단으로 거부한다. `Bool`,
`Int`, `Number`, `Percent`, `Duration`, `Result`, `SensorFault`, `Expr`, `Date`,
`TimeOfDay`, `DateTime`, `TimeSlots`, `WorkCalendar`, `HolidayCalendar`,
`TidePredictions`, `LunarEphemeris`, `BoolActuator`, `Event`, `ClockFault`,
`CalendarFault`, `TemporalContextFault`, `AccountingFault`와 2장의 물리량 타입은 내장 타입 namespace다. `number`,
`int_exact`, `int_floor`, `int_ceil`, `int_trunc`, `int_nearest_even`, `elapsed`,
`median`, `hysteresis`, `date`, `time`, `datetime`, `cron5`, `sun`, `tide`, `day`,
`moon`, `continuous_true`, `instant`, `civil`, `on_time`, `count_events`, `local_day_is`,
`calendar_is`, `tide_is`, `moon_is`, `used`, `rolling`, `local_day`와 Result 변환
이름은 내장 callable namespace다. 사용자 선언은 이 이름들을 가릴 수 없다. 내부용 `__gf_`
접두사와 discard pattern `_`도 선언 이름으로 쓸 수 없다.

schedule과 account가 제공하는 `.due`, `.open`, `.active`, `.count`는 해당 내장 타입의
projection 이름이다. schedule의 `.missed`도 projection이다. 다른 타입에 같은 member를
추측하거나 사용자 projection으로 재정의하지 않는다. `.missed` 의미는
[§3.5](03-time-and-schedules.md#35-schedule의-공통-의미)를 참조한다.

`from`, `revision`, `sha256`, `instance`, `connect`, `quote`와 `timezone`, `selected`,
`basis`, `when`, `clock`, `gap`, `recovery`, `fallback`, `dst_missing`, `dst_repeated`,
`sample`, `valid`, `filter`, `stale_after`, `recover_after`, `samples`, `min`, `max`,
`step`, `access`, `label`은 해당 문법 위치에서만 특별한 **문맥 단어**다. 다른 위치의
식별자까지 전역 예약하지 않는다. `adapt`, `has`, `constraints`, `check`, `limit`의
문맥은 [4장](04-sensors-constraints-control.md)이 정한다.

### 공백, 문장 끝과 주석

공백과 들여쓰기는 토큰을 나누고 사람이 구조를 읽게 하지만 block을 만들지 않는다.
탭 또는 특정 칸 수를 대표 control 문법의 의미 규칙으로 삼지 않는다. 선언과 식
정의는 원칙적으로 `;`로 끝나며 줄바꿈이 이를 대신하지 않는다.

`input`, `output`, `state`, `config`, `let`, 다음 상태 정의, 출력 연결, `require`,
`mutex`, `signal`, `timer`, `type X = ...` 및 설정 block의 항목에는 `;`가 필요하다.
함수의 마지막 결과식, 함수의 닫는 `}`, `case` branch 뒤에는 세미콜론을 생략할 수 있다.

`//`부터 줄 끝까지가 코드 주석이다. `#` 주석과 `/* ... */` 주석은 대표 control
문법의 주석이 아니다. 문서 설명은 Markdown 본문에 쓴다.

### 기호와 구분자

| 표기 | 역할 |
|---|---|
| `{ }` | control, 함수, case, 설정 block 및 `in` 집합 |
| `( )` | 식 묶음, 함수 호출, 매개변수 |
| `[ ]` | schedule의 선택 시각 목록; 범용 list 문법은 아님 |
| `:` | 이름과 타입, 이름 있는 내장 인수 |
| `,` | 이름, 인수, 원소 구분 |
| `=` | 정의와 초기값 |
| `'` | 다음 상태 정의·참조 |
| `<-` | 출력 intent 연결 |
| `->` | 함수 결과 타입 |
| `=>` | `case` branch 또는 출력 제약 관계 |
| `?` | 선택적 sensor capability 선언 |
| `..` | sensor 유효 범위 |

`=>`는 일반 식에 넣는 논리 연산자가 아니다.

## 1.4 문법 표기법

이 reference의 문법 요약은 다음 메타 표기법을 쓴다.

- 작은따옴표 안의 글자는 그대로 쓰는 token이다.
- `name` 같은 기울임 없는 소문자 이름은 다른 문법 항목이다.
- `[ item ]`은 선택, `{ item }`은 0회 이상 반복을 뜻한다.
- `(a | b)`는 둘 중 하나다. 실제 GhostFlow의 `{}`, `[]`, `|` token은 작은따옴표로 적는다.

이는 전체 parser 문법을 대신하는 생성 규격이 아니라 이 장의 규칙을 모호하지 않게
설명하는 요약이다.

```text
document       ::= Markdown containing one or more top-level ghost fences
program        ::= { import_decl | top_level_function | top_level_type | syntax_decl }
                   control_decl
control_decl   ::= 'control' Identifier '{' { control_item } '}'
top_level_function ::= function_decl
top_level_type ::= enum_decl

control_item   ::= declaration | function_decl | next_definition
                 | output_connection | constraint | parameter_decl
                 | instance_decl | connect_decl
declaration    ::= input_decl | sensor_decl | output_decl | config_decl
                 | state_decl | let_decl | enum_decl | signal_decl
                 | schedule_decl | timer_decl
```

program의 실행 root에는 `control`이 정확히 하나다. document-scope import는 완전한
`.ghost.md` definition revision과 digest를 고정하며, imported 함수·타입은
`Alias.name`으로만 참조한다. control 안의 `instance`와 `connect`가 imported control을
조합한다. wildcard import, 암묵 export, 두 번째 root control은 없다. 정확한 import,
parameter, instance, connect와 typed expression macro 문법은
[6장](06-composition-and-replay.md#64-import와-연결의-문법)에서 정의한다.

선택 문법에서 확인되는 선언 형태는 다음과 같다. `expr`, `type`, `pattern`의 세부
규칙은 [다음 장](02-types-expressions-state.md)에서 다룬다.

```text
input_decl       ::= 'input' name_list ':' type ';'
sensor_decl      ::= 'sensor' Identifier [ '?' ] ':' type
                     ( ';' | '{' { sensor_setting ';' } '}' )
output_decl      ::= 'output' name_list ':' type ';'
config_decl      ::= 'config' Identifier ':' type '=' expr
                     ( ';' | '{' { config_setting ';' } '}' )
parameter_decl   ::= 'parameter' Identifier ':' type '=' constant_expr ';'
state_decl       ::= 'state' Identifier ':' type '=' constant_expr ';'
let_decl         ::= 'let' Identifier '=' expr ';'
enum_decl        ::= 'type' Identifier '=' Identifier { '|' Identifier } ';'
function_decl    ::= 'fn' Identifier '(' [ parameter_list ] ')' '->' type
                     '{' expr [ ';' ] '}'
next_definition  ::= Identifier "'" '=' expr ';'
output_connection ::= Identifier '<-' expr ';'
signal_decl      ::= 'signal' Identifier '=' expr ';'
timer_decl       ::= 'timer' Identifier '=' 'elapsed' '(' Identifier ')' ';'
constraint       ::= 'require' expr [ '=>' expr ] ';'
                   | 'mutex' name_list ';'
                   | 'mutex' '(' name_list ')' ';'
name_list        ::= Identifier { ',' Identifier }
parameter_list   ::= Identifier ':' type { ',' Identifier ':' type }
```

`schedule`은 일반 선언 골격과 달리 타입별 설정 block을 갖는다. 확정된 일일 슬롯
형태는 다음과 같다.

```ghost
schedule starts: DailySlots<15min> {
  timezone = "Asia/Seoul";
  selected = [06:00, 18:45];
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
  dst_missing = skip;
  dst_repeated = first;
}
```

`timezone`, `selected`, 시각과 목록은 이 schedule 위치의 문법이다. 일반 문자열,
일반 list 또는 임의 generic type 문법으로 확장해 읽지 않는다.

## 1.5 대표 선언 골격

```ghost
fn allowed(request: Bool, enabled: Bool) -> Bool {
  request && enabled
}

control Example {
  input start, stop: Bool;
  sensor moisture?: Percent;
  output pump: Bool;
  config threshold: Percent = 30%;
  type Phase = Idle | Running;
  state phase: Phase = Idle;
  let request = start && !stop;
  timer age = elapsed(phase);

  phase' = if request then Running else Idle;
  pump <- phase' == Running;
}
```

역할을 다른 keyword로 나누는 이유는 외부 입력, 운영 설정, 기억, 일시 계산과 출력
요청이 서로 다른 변경·관찰 의미를 갖기 때문이다. `let`은 기억을 만들지 않고,
`output` 선언은 값이나 안전 기본값을 만들지 않는다.

### 이름 범위와 해석

- 함수 매개변수는 해당 함수 안에서만 존재하며 한 parameter list 안에서 유일하다.
  순수 함수가 control 값을 포획하지 않으므로 control 값과 같은 spelling은 쓸 수 있지만,
  다른 함수·타입·enum case·내장 이름은 가리지 않는다.
- 함수는 필요한 control 값과 상태를 매개변수로 받아야 한다. 바깥 입력·상태를
  암묵적으로 포획하지 않는다.
- 문서의 control, 함수, 타입, enum case, import alias, syntax 이름과 control 값 이름은
  모호하지 않아야 한다. `input`, `output`, `state`, `config`, `parameter`, `let`,
  `sensor`, `signal`, `schedule`, `timer`, 함수와 instance는 하나의 값 namespace를
  공유하며 선언 종류가 달라도 같은 이름을 다시 쓸 수 없다. enum case도 문서 안에서
  유일하다. imported 내부 이름은 `Alias.name` 아래에 남는다.
- 하나의 output에는 정확히 하나의 직접 연결식 또는 `connect`만 둔다.
- `let`의 소스 순서는 의존 순서를 만들지 않는다. 비순환 의존 그래프로 해석하며
  서로를 필요로 하는 순환은 오류다.
- 지역 계산은 함수 이름이나 예약 namespace를 가리지 않는다.

충돌은 선언 순서나 종류별 shadowing으로 해결하지 않고 compile 진단한다.

## 1.6 대표 표기, 참고 별칭과 역사적 대안

새 문서는 다음 대표 표기만 사용한다. 오른쪽의 이전 표기는 문법 alias가 아니라
읽기와 migration 진단을 위한 역사 기록이며 실행 입력으로 거부한다.

| 대표 표기 | 거부하는 이전 표기 |
|---|---|
| `fn` | `purefn` |
| `type Mode = Off \| On;` | `enum Mode { Off, On }`, `enum Mode = Off \| On;` |
| `running' = expr;` | `next running = expr;` |
| 출력식의 `running'` | `next.running` |
| `start`, `running` | `input.start`, `state.running` |
| `if c then a else b` | `ifthenelse(c, a, b)` |

compiler는 오른쪽 표기를 자동 변환하거나 별도 profile로 실행하지 않는다. 변환 도구가
필요하면 원문을 새 canonical `.ghost.md` revision으로 명시적으로 고치고 다시 검토한다.

초기 A/B/C 비교안의 YAML 계층 표기, CoffeeScript 계열의 들여쓰기·`not/and/or`,
Cypher 계열의 `MATCH/WHERE/WITH/NEXT/EMIT`는 설계 역사다. 선택된 control 문법의
허용 alias가 아니다. 위 표에서 설명한 개별 참고 별칭이 있다는 이유로
초기 대안의 블록 구조와 연산자 전체를 함께 사용할 수 있다고 해석하지 않는다.

## 1.7 소스 규칙의 장별 경계

이 장은 canonical 문서 추출, 어휘, namespace와 root program 골격을 정한다. 기능별
세부 문법은 같은 reference의 다음 장이 소유한다.

- 값, Result, 표현식과 상태: [2장](02-types-expressions-state.md)
- 시간값과 schedule: [3장](03-time-and-schedules.md)
- `adapt`, `has`, capability와 constraints: [4장](04-sensors-constraints-control.md)
- immutable import, parameter, instance, connect와 typed expression macro:
  [6장](06-composition-and-replay.md)

각 문법은 해당 장의 명시적 선언 위치에서만 결합한다. 암묵 import, wildcard export,
호환 alias fallback, runtime macro 실행 또는 문서 밖 파일의 runtime 탐색은 없다.
