# 6. 조합, 재생과 교체

[전체 목차](../LANGUAGE-REFERENCE.md) · [이전: 설정과 관찰](05-settings-and-observation.md) · [다음: 의미 규칙·색인](07-semantic-rules-and-index.md)

GhostFlow의 재사용 단위는 코드 조각이 아니라 의미와 계약을 가진 behavior다. behavior는
제어식, 상태, 논리 포트, 설정과 의존성, 제약, 설명 provenance를 함께 보존한다. 조합은
이 단위를 복사해 붙이는 작업이 아니라, 정확한 정의 revision을 instance로 만들고 typed
관계를 검증하는 작업이다.

## 6.1 하나의 의미 모델과 여러 그래프

소스, control, intent, port, 장치, observation과 event는 stable identity로 연결된다. 같은
대상은 편집 문서, HMI, timeline, simulation과 trace에 나타날 수 있지만 view마다 새 의미
객체가 되지 않는다.

모든 관계를 하나의 보편적 DAG로 취급하지는 않는다. 그래프마다 edge와 cycle 의미가 다르다.

| 그래프 | edge의 의미 | cycle 규칙 |
|---|---|---|
| import graph | 정의가 다른 정의 revision에 의존 | executable import cycle 거부 |
| 한 tick의 계산 graph | 값이 같은 판단의 다른 값을 읽음 | 조합 순환 거부 |
| 상태 feedback | 이전 tick의 확정 state를 읽음 | 명시적 state 경계로 허용 |
| explanation graph | 평가 근거가 결과를 뒷받침 | DAG이며 cycle 거부 |
| installation graph | 논리 port가 physical capability에 bind | 별도 소유권·호환성 규칙 적용 |
| timeline | occurrence가 시간 순서로 이어짐 | branch와 선후 관계를 명시 |

**왜:** 화면상의 선 하나만 보고 실행 순서, 물리 연결과 설명 관계를 같은 규칙으로 처리하면
숨은 scheduler나 잘못된 안전 주장이 생긴다.

## 6.2 definition, instance와 논리 port

definition revision은 immutable canonical `.ghost.md`와 그 정확한 imported source closure를
가리킨다. instance는 그 definition을 한 조합 안에서 사용하는 별도 실행 단위다. 같은
definition을 두 번 사용해도 instance ID, state, timer, settings, binding과 provenance는
분리한다.

표시 이름, 파일 위치와 선언 순서는 identity가 아니다. 같은 instance ID와 같은 input/time
기록을 유지한 채 선언 순서를 바꾸어도 결과와 identity-keyed trace가 같아야 한다.

behavior의 port는 물리 핀 번호가 아니라 typed logical role이다.

```text
instance irrigation-east의 port pump
  → installation binding
  → MainPump 또는 board.RO3
```

logical port는 direction, semantic type, 필수 또는 선택 의존성, ownership 요구를 보존한다.
physical endpoint는 별도 profile과 binding revision이 소유한다. `Bool` input이라고 해서 항상
물리 DI를 소비하지는 않는다. 명시적인 software input도 같은 논리 타입을 공급할 수 있다.

기존 binding을 먼저 보존하고 새 port에 남은 capability를 제안한다. 타입이나 direction이
맞아도 극성, 부하, fail-safe와 실제 배선을 증명하지는 않는다. 그런 증거가 없으면
`unknown`이며 compatible 또는 physically verified로 승격하지 않는다.

물리 endpoint는 MCU의 직접 GPIO에 한정하지 않는다. I/O 확장기의 채널이나 통신형
릴레이의 채널도 같은 논리 출력 계약을 만족하면 binding 대상이 될 수 있다.
버스 주소·채널 선택·전송 절차는 Driver와 설치 연결이 소유한다. 언어의 한 tick에서
여러 출력 의도를 확정해도 실제 채널들이 동시에 전환된다는 보장은 생기지 않는다.

## 6.3 parameters, settings, dependencies와 bindings

네 관계는 값을 연결한다는 점이 비슷하지만 생명주기가 다르다.

| 관계 | 역할 | 변경 효과 |
|---|---|---|
| import parameter | definition을 특정 값으로 전문화 | 새 composition/source revision과 보통 새 artifact |
| operator setting | 같은 Program의 운전값 변경 | 같은 Program/run, 새 settings revision/effective position |
| dependency | 필요한 외부 behavior·capability 선택 | pinned closure와 호환성 재검증 |
| binding | logical port와 설치 endpoint 연결 | 새 installation/binding revision |

하나의 무타입 `with` map으로 이 차이를 지우지 않는다. 특히 operator setting으로 dependency나
물리 배선을 바꿀 수 없고, import parameter 변경을 live setting처럼 처리하지 않는다.

### 호환 장치 교체와 재컴파일 독립성

GhostFlow Program은 논리 port 계약을 대상으로 하며, 설치별 장치 모델·통신 주소·핀을
실행 규칙의 정체성으로 사용하지 않는다. Driver는 장치별 통신과 값 해석을 담당하고,
binding은 논리 port에 값을 공급하거나 출력을 적용할 실제 endpoint를 연결한다.

**같은 논리 장치 계약을 만족하는 물리 장치 또는 Driver 교체는 제어 소스 수정이나
Program 재컴파일을 요구하지 않는다.** 이 경우 canonical `.ghost.md`, source revision과
컴파일된 Program을 유지하고 설치 profile/binding의 해당 판본을 변경한다.
Driver 자체의 배포 판본은 실행 환경에서 관리한다.

호환성은 이름이나 기본 타입이 같다는 사실만으로 성립하지 않는다. 기존 프로그램이 요구하는
direction, 의미·단위·범위, 샘플 시각·품질·오류 계약과 capability를 만족해야 한다.
센서의 `sample`, `valid`, `filter`, `stale_after`, `recover_after` 같은 소스 규칙은
교체 장치에 맞추어 자동으로 바뀌지 않는다. 계약을 만족하지 못하면 호환 교체로 승인하지 않는다.

소스의 규칙 자체를 바꾸면 소스 변경이다. `config`로 공개된 값만 바꾸면 운영 설정 변경이다.
Driver의 동적 설치 여부, 펌웨어 갱신과 물리 교체 절차는 실행 환경의 책임이다.
Program 재사용은 무정지 교체나 기존 run·센서 상태의 자동 연속성을 보장하지 않는다.
적용 절차는 [§4.10](04-sensors-constraints-control.md#410-mode와-live-settings),
샘플 연속성과 복구는 [§4.2](04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서)를 따른다.

**왜:** 프린터 Driver를 바꿔도 문서 프로그램을 재컴파일하지 않듯, 장치별 차이는
공통 계약 뒤에서 처리해야 한다. 그래야 제어 의도와 하드웨어의 교체 주기를 분리할 수 있다.

## 6.4 import와 연결의 문법

각 문서는 여전히 하나의 `control`을 정의한다. 문서 최상위의 import는 완전한
`.ghost.md` 정의를 고정하며, 그 control을 본문에서 instance로 사용한다.

```ghost
import Irrigation from "./irrigation.ghost.md"
  revision "rev-42"
  sha256 "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

control Farm {
  input east_start, west_start: Bool;
  output east_pump, west_pump: Bool;
  instance east: Irrigation;
  instance west: Irrigation;
  connect east.start <- east_start;
  connect west.start <- west_start;
  connect east_pump <- east.pump;
  connect west_pump <- west.pump;
}
```

위 digest는 자리 표시용이다. 실제 예제를 컴파일할 때는 참조 문서의 정확한 UTF-8
SHA-256과 immutable revision을 제공해야 한다. 경로는 import한 문서에 대한 상대 locator이며
identity가 아니다. resolver가 제공한 source closure 밖의 파일이나 네트워크를 실행 중 읽지 않는다.
브라우저와 장치에서도 동일한 완전한 원문 closure로 해석한다.

```text
import_decl    ::= 'import' Identifier 'from' String
                  'revision' String 'sha256' HexDigestString ';'
parameter_decl ::= 'parameter' Identifier ':' type '=' constant_expr ';'
instance_decl  ::= 'instance' Identifier ':' ImportAlias
                  [ '(' named_constant_args ')' ] ';'
connect_decl   ::= 'connect' sink_port '<-' source_port ';'
```

parameter는 definition의 control 안에 선언한다. 예를 들어
`parameter duration: Duration = 5min;`은 `instance east: Irrigation(duration = 10min);`으로
전문화한다. 인자는 이름으로 결속하며 누락 시 선언 기본값을 사용한다. 중복·알 수 없는
인자와 비상수·타입 불일치를 거부한다. parameter는 실행 중 변하지 않으며 operator 설정과
같은 이름을 가질 수 없다. 공개 top-level 함수와 타입은 `Irrigation.name`으로 참조한다.
다른 control의 내부 state·let·timer에는 접근할 수 없다.

`connect`의 source는 root input 또는 instance output이며 sink는 instance input 또는
root output이다. 타입은 정확히 일치해야 한다. 입력 하나의 공급자는 하나이며 필수 입력은
빠짐없이 연결한다. root output은 일반 `<- expr`와 `connect` 중 하나로만 정의한다.
sensor 포트는 일반 값 포트로 품질을 지우지 않는다. sensor 연결은 같은 payload 타입과
sample·quality 계약을 가진 root sensor에서 instance sensor로만 허용한다.
각 instance가 선언한 필터와 freshness 규칙은 계속 적용된다.

`bind`는 제어 소스 문법이 아니다. 설치 binding이 root 논리 포트를 실제 endpoint에
연결한다. GPIO·버스 주소와 credential을 이 프로그램에 넣지 않는다.

조합 규칙은 다음과 같다.

1. import는 catalog의 `latest`나 표시 이름이 아니라 exact immutable revision과 digest를 고정한다.
2. transitive import도 모두 고정한 closure를 이루며 누락, digest 불일치와 import cycle을 거부한다.
3. canonical source authority는 각 원본 `.ghost.md`에 남는다. 조합 graph나 생성 manifest는
   수정 가능한 두 번째 프로그램이 아니다.
4. instance-qualified 이름으로 충돌을 피하되 원본 definition과 source node provenance를
   지우지 않는다.
5. local site binding, credential, conversation, runtime history는 reusable definition에 넣지 않는다.

## 6.5 조합 실행의 불변 규칙

조합 후에도 단일 control의 tick 의미를 유지한다.

- 모든 상태 전이는 같은 input snapshot과 같은 이전 state snapshot을 읽는다.
- 한 state의 다음 값을 다른 state 전이식이나 `let`에서 같은 tick 값으로 읽지 않는다.
- output 식만 허용된 다음 상태를 참조한다.
- state와 논리 output 결과는 한 판단으로 함께 확정한다.
- 각 instance의 state와 timer는 다른 instance와 격리한다.
- 선언·탐색 순서를 scheduler나 우선순위로 사용하지 않는다.
- 같은 scan의 순간 dependency cycle은 실행 전에 거부한다. 이전 scan의 확정 state를 통한
  feedback은 별도의 명시적 시간 경계다.
- 다음 상태 참조 금지는 port 연결을 따라 전이적으로 검사한다. 다른 instance의
  다음 상태로 계산된 output을 같은 scan의 state 전이에 연결하는 것도 거부한다.
- 같은 논리 output channel의 authoritative direct definition은 하나뿐이다. 경쟁 writer는
  last-writer 규칙으로 해결하지 않고 거부한다.

공유 펌프처럼 중재가 필요한 자원은 명시적인 station/resource manager에 요청한다. 여러
behavior가 같은 physical 자원을 쓴다는 이유로 direct output writer를 여러 개 허용하지 않는다.
기존 station의 pump/valve 정책도 모든 자원의 보편적 arbiter로 일반화하지 않는다.

## 6.6 resource와 contract

조합 contract는 첫 범위에서 다음을 검사한다.

- port direction과 semantic type
- 필수 dependency의 존재와 exact revision
- import parameter의 타입과 bound
- exclusive output/resource ownership
- supplied installation contract와의 호환성

검사 결과는 declared assumption, 정적 검사 결과, 실행 중 강제한 constraint와 물리 검증을
구분한다. 잘못된 port나 빠진 dependency는 구체적으로 거부한다. 설치 적합성 증거가 없으면
`unknown`으로 둔다. 단순 channel 수가 맞거나 simulation이 통과했다는 이유로 안전 또는 물리
적합성을 선언하지 않는다.

diagnostic은 reason, 영향받은 definition/instance/port, 기대값과 실제값, 근거 revision과
고칠 수 있는 선택을 제공한다. 예를 들어 두 instance가 한 exclusive pump를 소유하려 하면
두 instance와 port를 모두 가리키며 activation 전에 거부한다.

## 6.7 조합된 설명과 provenance

조합 결과의 설명은 다음 경로를 잃지 않는다.

```text
completed occurrence
→ requested / safe output
→ instance-qualified explanation node와 constraint
→ imported definition의 source node/span과 intent anchor
→ exact source revision과 import closure
→ settings revision 및 binding revision
```

한 definition의 여러 instance trace를 이름이 같다는 이유로 합치지 않는다. source 위치가
다른 문서의 node를 하나의 합성 위치로 평탄화하지 않는다. low-water 입력이 pump 요청을
차단했다면 그 신호와 논리 결과를 말할 수 있지만, tank의 실제 물리 상태를 증명하지 않는다.
Driver 적용 실패나 feedback 부재도 requested/safe 단계와 분리해 표시한다.

## 6.8 replay, ghost와 branch

replay는 기록한 입력, fault, 논리 시간과 시작 checkpoint를 같은 언어 의미로 다시 계산한다.
Ghost는 같은 실행 core를 쓰는 별도 instance이며 physical effect sink를 갖지 않는다.

재생·분기 기록에는 timeline/branch ID, 기준 checkpoint, Program과 source closure, instance,
settings와 binding revision, `runId`, 논리 tick, 입력과 fault, old/candidate state,
requested/safe intent와 제약 개입이 필요하다. 중간 trace는 bounded 선택 정보다.

원본 timeline을 보존한 채 특정 occurrence에서 branch를 만든다. 비교는 같은 논리 tick에서
state, requested intent, safe intent와 fault를 맞춘다. wall clock은 입력 데이터이며 정렬
기준을 대신하지 않는다. 기록에 없는 센서값을 자동 생성하지 않는다. what-if에 필요한 값은
가상 입력임을 표시한 trace로 제공한다.

rewind는 실제 장치를 과거 상태로 움직이지 않는다. ghost branch는 실제 사용량 ledger,
예약 발생 기록이나 물리 설비 상태를 수정하지 않는다. 다른 출력이 환경에 미칠 장기 효과를
예측하려면 제어 replay와 별도의 환경 모델이 필요하다.

**왜:** 같은 입력에서 규칙 변경의 영향을 재현하면서 실제 장치와 원본 기록을 보존하기
위해서다.

## 6.9 Program hot replacement

Program 교체는 operator setting event와 다르다. 새 source revision 또는 import closure를 가진
후보를 검증하고, port·ownership·profile·resource와 state 호환성을 확인한 뒤 tick 경계에서
원자적으로 확정한다. 검증이 실패하면 이전 Program을 유지한다.

같은 module identity 정책 아래 같은 이름과 같은 타입으로 명시된 state만 이전할 수 있다.
새 state는 선언 기본값을 쓰고 제거된 state는 사라진다. 같은 이름의 타입 변경, 암묵적 rename,
서로 다른 instance의 state 합치기는 명시적 migration 없이 거부한다. 이전 입력 cache는 버리고
새 schema의 완전한 input snapshot을 다시 받는다. 제거된 output은 host의 해제 정책을 따른다.

교체된 Program은 새 artifact/source identity와 새 run 경계를 가진다. 이전 trace와 새 trace를
settings 변경처럼 한 run으로 이어 붙이지 않는다. 누적 사용량이나 예약 중복 방지처럼 물리
설비가 소유한 영속 기록은 일반 control state migration이나 ghost rewind로 초기화하지 않는다.

## 6.10 `syntax`, `quote`, splice의 문법

일반 값 재사용에는 순수 함수가 맞다. compile-time 구문 확장은 반복되는 도메인 구조 자체를
만들 때만 사용한다. 확장은 타입이 있는 expression AST로 한정한다.

```ghost
syntax hold(start: Expr<Bool>, stop: Expr<Bool>, held: Expr<Bool>): Expr<Bool> {
  quote { !$(stop) && ($(start) || $(held)) }
}

running' = @hold(start, stop, running);
```

`syntax`는 문서 최상위에서 선언한다. 인자와 결과는 `Expr<T>`이며 `T`는 완전한 값 타입이다.
본문은 `quote { expr }` 하나다. `$(parameter)`는 해당 AST를 splice하며
`@hold(...)`는 호출 위치에서 확장한다. splice 안에는 선언한 macro 인자 이름만 허용한다.
`Expr<T>`는 런타임 값 타입이 아니므로 input·state·config에 저장하거나 반환할 수 없다.
quote 밖의 splice, 알 수 없는 인자, 타입 불일치, 선언을 만드는 macro는 거부한다.

splice된 이름은 호출 위치에서 해석한다. quote에 직접 적은 이름은 정의 위치에서 해석한다.
macro 인자나 호출자의 동명 지역 이름이 정의 위치의 이름을 가로채지 않는다.
인자가 여러 번 splice되면 식도 여러 번 나타난다. 함수처럼 한 번 평가한다고 가정하지 않으며
각 위치에서 일반 lazy 평가 규칙을 따른다. timer·filter 같은 기억을 만드는 선언은
expression macro 안에 숨길 수 없다.

확장은 런타임 값을 읽지 않는다. 호출자 이름을 포획하지 않는 hygienic expansion이어야 하고,
확장 결과는 다시 타입, state 경계, cycle과 resource 검사를 통과한다. 재귀 확장, 외부 파일,
network, clock 읽기와 무제한 AST 생성을 허용하지 않는다. macro 호출 graph는 비순환이어야 한다.
컴파일 대상은 허용할 최대 확장 node 수를 명시하며 초과하면 자르지 않고 컴파일 오류를 낸다.
이 상한은 언어의 실행 결과를 바꾸는 설정이 아니라 대상 자원 한계다. 원본 macro 호출과 생성 node 사이의
source/intent provenance를 보존하여 explanation이 사람이 작성한 위치로 돌아갈 수 있어야 한다.
구문 확장 자체가 운전 중 수행하는 작업이나 새로운 물리적 효과가 되어서는 안 된다.

## 6.11 설계 이유와 근거

pinned import와 분리된 instance identity는 재사용과 재현을 함께 보장한다. logical port와 physical
binding을 분리하면 같은 behavior를 다른 설치에 사용할 수 있다. 실행 불변 규칙과 cycle 거부는
선언 순서가 결과를 바꾸지 않게 한다. replay와 effect 경계는 실제 설비를 움직이지 않고도 변경을
비교하게 한다. macro를 compile time에 제한하면 도메인 표기를 추가하면서 실행 비용과 provenance를
보존한다.

근거: [언어 모델](../LANGUAGE.md), [문법 대안과 macro 표기](../LANGUAGE-EXAMPLES.md),
[Programming in GhostFlow](../ProgrammingInGhostflow.md), [portable package](../PORTABLE-PACKAGE.md),
[#99](https://github.com/callin2/ghostflow-language/issues/99),
[#100](https://github.com/callin2/ghostflow-language/issues/100),
[#101](https://github.com/callin2/ghostflow-language/issues/101),
[#102](https://github.com/callin2/ghostflow-language/issues/102),
[#103](https://github.com/callin2/ghostflow-language/issues/103),
[#104](https://github.com/callin2/ghostflow-language/issues/104),
[#105](https://github.com/callin2/ghostflow-language/issues/105),
[#106](https://github.com/callin2/ghostflow-language/issues/106),
[#107](https://github.com/callin2/ghostflow-language/issues/107),
[#108](https://github.com/callin2/ghostflow-language/issues/108).
