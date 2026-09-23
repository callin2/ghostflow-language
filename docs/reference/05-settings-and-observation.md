# 5. 설정과 관찰

[전체 목차](../LANGUAGE-REFERENCE.md) · [이전: 센서·제약·제어](04-sensors-constraints-control.md) · [다음: 합성과 재현](06-composition-and-replay.md)

GhostFlow 프로그램은 조절 가능한 값과 실행 중 생긴 값을 구분한다. `config`는 작성자가
의도적으로 공개한 조절점이고, `state`·타이머·입력·출력은 실행을 관찰하는 값이다. 이
구분이 있어야 운영자가 관수 시간을 바꾸는 일과 현재 타이머를 임의로 고치는 일을 혼동하지
않는다. 또한 화면은 소스를 다시 해석하지 않고도 같은 타입과 검증 규칙을 사용할 수 있다.

## 5.1 `config` 선언

다음은 확정된 소스 표기다.

```ghost
control OperatorSettings {
  config duration: Duration = 5min {
    min = 1min;
    max = 20min;
    step = 1min;
    access = operator;
    label = "관수 시간";
  }

  config duty: Percent = 50% {
    min = 0%;
    max = 100%;
    step = 10%;
    access = designer;
    label = "출력 비율";
  }

  config enabled: Bool = false {
    access = operator;
    label = "자동 관수 사용";
  }
}
```

`config name: Type = default { ... }`은 이름, 타입, 소스 기본값과 설정 메타데이터를
한 선언으로 묶는다.

| 항목 | 의미 | 규칙 |
|---|---|---|
| 타입 | 값의 의미와 표현 범위 | 실행식과 설정 입력에 같은 타입 규칙을 적용한다. |
| 기본값 | override가 없을 때 사용하는 작성자 값 | canonical `.ghost.md`의 일부다. |
| `min`, `max` | 닫힌 허용 범위 | 타입이 같고 `min <= max`여야 하며 양 끝값을 허용한다. |
| `step` | `min`을 기준으로 한 허용 격자 | 0보다 커야 하며 `(value - min)`이 step에 맞지 않으면 거부한다. Temperature의 차이는 TemperatureDelta다. |
| `access = operator` | 운전자가 바꿀 수 있는 설정 | 선언된 범위 안의 typed 설정 event만 허용한다. |
| `access = designer` | 소스 작성자가 정하는 값 | 운영 설정 event로 바꿀 수 없다. |
| `label` | 사람이 읽을 표시 이름 | 식별자가 아니며 의미나 권한을 바꾸지 않는다. |

`apply` 필드는 두지 않는다. `apply = stopped`와 `apply = live`는 모두 구문 오류다.
`operator` 설정의 적용 의미는 항상 5.2절의 atomic live event다. 적용 시점을 고르는
두 번째 설정 체계를 만들지 않기 위해 이 규칙을 선언 자체에 고정한다.

수치 설정의 기본값도 `min..max` 안에 있고 `min` 기준 step 격자에 맞아야 한다. `Bool`은
선택 가능한 두 값이 타입 자체에 있으므로 수치 범위와 증분을 두지 않는다. `false`, `0`,
`0%`는 값 없음이 아니라 유효한 명시 값이다. 알 수 없는 설정, 중복된 설정, 타입 불일치,
범위 초과, 증분 불일치, `designer` 설정에 대한 운영자 변경은 거부한다.

`Int` 설정의 기본값·`min`·`max`·`step`은 모두 signed 32-bit 정수다.
`step`은 양수이며 기본값과 `max` 모두 `min`에서 시작하는 정수 격자 위에 있어야 한다.
예를 들어 `min = -2; max = 4; step = 2;`는 `-2, 0, 2, 4`를 허용한다.
분수나 실수 오차 허용값을 정수 격자에 반올림하여 포함하지 않는다.

**왜:** 횟수와 같은 정수 설정은 허용된 값을 정확히 선택해야 한다.
큰 증분에서도 격자 밖의 정수가 오차 허용 때문에 통과하지 않으며,
닫힌 범위의 양 끝값을 실제로 선택할 수 있게 한다.

`Temperature`의 `min`·`max`·기본값은 절대 온도이고 `step`은 `TemperatureDelta`다.
예를 들어 `min = 10°C; max = 30°C; step = 0.5Δ°C;`로 선언한다.
그 밖의 물리량은 §2.9의 연산 표에서 정의한 차이 타입을 사용한다.
일반 산술을 제공하지 않는 명목 타입의 설정 격자는 해당 타입의 canonical 크기에서만
검사하며 그 내부 검사가 프로그램의 새 산술 연산을 허용하지는 않는다.

`Date` 설정의 기본값과 `min`·`max`는 `Date`이고 `step`은 양의 `Int` 일수다.
예를 들어 `step = 1;`은 `min`부터 달력 날짜를 하루씩 선택하는 격자다.
`TimeOfDay`와 `DateTime` 설정의 기본값과 범위는 각각 같은 시간 타입이며,
`step`은 `1min`처럼 양의 `Duration`이다. 격자는 각각 자정 이후 밀리초와 UTC epoch
밀리초의 차이로 검사한다. 자정 순환이나 시간대 추론은 하지 않는다.
이 설정 검사는 프로그램에 `DateTime - DateTime`이나 `TimeOfDay + Duration` 같은
추가 산술을 허용하지 않는다.

**왜:** 날짜의 선택 간격은 달력 일수이고, 시간값의 선택 간격은 밀리초 해상도다.
날짜의 하루를 임의 시간대의 실제 운전 시간 24시간으로 바꾸지 않으며,
설정창과 런타임이 같은 허용 값 집합을 검사하게 한다.

예약 목록에는 ``config times: TimeSlots<15min, 8> = [time`06:00`];`` 형태를 사용한다.
이 타입은 grid와 최대 원소 수가 허용 범위다. `min`·`max`·`step`은 쓰지 않는다.
목록 검증과 `DailySlots` 연결은 [§3.6](03-time-and-schedules.md#36-선택된-dailyslots)을 따른다.

설정 descriptor는 stable setting ID, 소스 이름, 타입, 기본값, 접근 권한, 범위·증분,
label과 소스·의도 provenance를 제공한다. renderer는 이 정보로 Duration 입력, Bool 선택,
범위가 있는 수치 입력 같은 typed form을 만들 수 있다. slider, dial, 좌표, 색, 배치는
renderer가 정한다. `label`이나 widget 모양으로 설정 identity 또는 검증 규칙을 추론하지
않는다.

`Temperature` 설정 descriptor는 canonical `K` 값과 별도로 선택된 `displayUnit` (`°C` 또는
`K`)을 반드시 포함한다. 숫자만 바꾸는 live event는 기존 `displayUnit`을 보존한다. 단위를
바꾸려면 event가 새 unit을 명시해야 한다. 누락되거나 모호한 unit은 적용 전 오류이며,
canonical 값이나 값의 크기에서 표시 unit을 추론하거나 기본 unit을 정하지 않는다.

### 기본값과 유효값

기본값은 소스가 정한 값이고, 유효값은 특정 실행 위치에서 실제 식이 읽는 값이다.

```text
해당 setting의 받아들인 override가 있음 → override 값
없음                                  → 소스 기본값
```

관찰자는 `defaultValue`, `effectiveValue`, override 여부, settings revision과 적용 위치를
구분할 수 있어야 한다. 유효값은 프로그램 소스나 실행 상태의 복사본이 아니다.

## 5.2 소스 변경과 운영 설정 변경

두 변경은 서로 다른 의미를 갖는다.

| 변경 | 바뀌는 정체성 | 의미 |
|---|---|---|
| 소스 기본값·식·선언 편집 | document revision, source digest, 보통 program artifact | 검토할 새 canonical `.ghost.md` 후보 |
| 운영 설정 event | settings revision과 effective event position | 같은 소스·Program·run에서 유효값 변경 |

소스 편집은 원문 Markdown을 수정한다. prose, 주석, fence, 줄바꿈과 원본 byte를 보존한
새 문서 revision이어야 하며, 설정 overlay로 위장하지 않는다. 반대로 운영 설정은
소스 리터럴을 바꾸거나 재컴파일하지 않는다. 이 구분은 “5분을 10분으로 바꿔 줘”가
영구 기본값 수정인지 이번 운전 설정인지 검토 가능하게 한다.

### atomic live event

`operator` 설정 변경은 하나의 atomic live event다.

1. event가 대상으로 삼는 Program과 settings 기준 revision을 확인한다.
2. 한 동작에 든 모든 값을 타입·범위·증분·권한 규칙으로 함께 검증한다.
3. 하나라도 잘못되면 event 전체를 거부하고 어떤 설정도 바꾸지 않는다.
4. 받아들이면 처리된 event 위치부터 모든 값을 함께 유효하게 한다.
5. 같은 canonical source, compiled Program과 `runId`를 유지한다.
6. state와 timer를 초기화하지 않는다. 현재 제어식이 새 유효값을 읽어 결과를 정한다.

따라서 운전 중 `duration`을 10분에서 5분으로 줄이면, 이미 경과한 시간과 새 제한을
다음 판단에서 비교할 수 있다. “다음 회차”, 정지, reset, 재컴파일 또는 새 run을
암묵적으로 기다리지 않는다. 설정 event가 어떤 출력 결과를 강제하는 것도 아니다.
출력 변화는 작성된 제어식에서 나온다.

설정 선언에는 적용 시점 필드를 추가하지 않는다. 시작 때의 운전 길이를 유지하려면
프로그램이 시작 전이에서 설정값을 자기 state로 기억하고 그 값을 읽는다.
프로그램·펌웨어 교체에 필요한 정지 절차도 운영 설정 event에 적용하지 않는다.

### 생명주기와 임시 설정

임시 설정은 별도 소스가 아니라 수명이 정해진 운영 설정이다. 대상 Program, 설정 ID,
typed 값, actor, 권한, 이유, 생성 event, settings revision, 시작 위치, lifetime, expiry,
rollback provenance와 복귀 대상을 명시해야 한다. 다른 Program revision에는 이전 override를
자동으로 붙이지 않는다. 새 revision에 대해 다시 검증하고 명시적으로 승인해야 한다.

받아들인 일반 live 설정은 실제 장치 재시작 뒤에도 보존한다. 재시작은 새 `runId`를 만든다.
임시 변경은 일반 설정 위에 놓는 **한 층의 overlay**다. 소스 키워드를 추가하지 않고
설정 event의 다음 의미로 정의한다.

| 항목 | 확정 규칙 |
|---|---|
| 수명 | 요청자가 `Run` 또는 `Until(DateTime)` 중 하나를 명시한다. 수명 생략은 거부한다. |
| `Run` | 현재 run에서만 유효하다. run이 끝나면 overlay를 제거한다. |
| `Until` | 절대 만료 시각과 정확한 Program identity를 저장한다. 같은 Program의 재시작에서도 만료 전이면 유효하다. |
| 복귀값 | 임시 변경 직전의 검증된 일반 설정값이다. 소스 기본값으로 임의 대체하지 않는다. |
| 중첩 | 같은 setting에 활성 임시 변경이 있으면 다른 임시 변경을 거부한다. 먼저 명시적으로 취소한다. |
| 새 일반 설정 | 해당 setting의 overlay를 같은 event에서 제거하고 새 일반값을 적용한다. 이전 expiry가 새 값을 덮어쓰지 않는다. |
| 만료·취소 | 원래 overlay ID를 대상으로 하는 atomic settings event다. 완료된 settings revision과 적용 위치를 남긴다. |
| 복귀 실패 | 성공한 복귀로 기록하지 않는다. 설정 유효성을 unavailable로 보고하고 해당 설정을 요구하는 판단을 확정하지 않는다. 물리 출력 대응은 설치의 명시된 장애 계약을 따른다. |

`Until`의 만료 여부를 판단할 신뢰 가능한 시각이 없으면 새 임시 요청을 거부한다.
이미 적용한 값의 유효성을 더 이상 판단할 수 없으면 이를 계속 유효한 값으로 읽지 않는다.
재시작 시 복원·만료 판정은 첫 제어 판단 전에 끝낸다. 서로 다른 설정을 묶은 임시 event는
동일한 수명을 가지며 적용·복귀도 전부 또는 전무다. 일반 변경이 그 묶음 일부를 건드리려면
묶음 전체의 취소와 새 값을 하나의 event로 제출해야 한다.

**왜:** 임시값이 영구값이 되거나 늦게 도착한 만료가 새 운영자 결정을 되돌리는 일을 막는다.
만료 시각과 임시값의 선택은 운영자의 결정이며 언어가 임의의 운전 시간을 정하지 않는다.

### 재시작과 기억의 복원

새 run은 선언한 state 초기값과 새 타이머 기준점으로 시작한다. 정전 중 시간은
`elapsed`에 더하지 않는다. 일반 설정의 지속성과 state 복원은 별개다.
호스트가 checkpoint 복원을 제공할 때는 Program·instance·state schema·단조 시간 연속성을
검증하고, 사용할 checkpoint와 복원 허용 정책을 명시한 실행 요청을 받아야 한다.
연속성을 입증할 수 없는 timer·filter 기억은 복원하지 않는다. 복원 실패는 관찰 가능한
실패이며, 복원이 성공했다고 표시한 채 초기화하지 않는다.

재시작 원인이 필요하면 다음과 같은 일반 typed input 계약으로 공급한다. 전용
`on_restart` 문장은 두지 않는다.

```ghost
type RestartReason = PowerOn | Brownout | Watchdog | Software | Unknown;
input restart_reason: RestartReason;
```

이 선언은 control 본문의 단편이다. 생산자는 하드웨어가 확인한 원인만 공급하며 근거가
없으면 `Unknown`이다. `PowerOn`만으로 정전 복구라고 단정하지 않는다. 이 입력은 한 run
동안 고정된다. 자동 재개, 대기, 취소 후 원위치 이동은 작성자가 state 전이로 정한다.
첫 판단 전 물리 출력은 Driver의 설치 계약이 소유한다.

## 5.3 renderer 독립 관찰 모델

관찰 계약은 의미를 전달하며 화면을 지정하지 않는다.

| 개념 | 답하는 질문 | 시간 의미 |
|---|---|---|
| descriptor | 무엇을 읽거나 바꿀 수 있는가? | 정적 source/Program 의미 |
| snapshot | 완료된 한 판단에서 값이 무엇인가? | 한 completed scan |
| event | 무엇이 어떤 순서로 발생했는가? | run 안의 ordered occurrence |
| command result | 요청을 실행 경계가 어떻게 처리했는가? | command lifecycle |
| alarm | 어떤 조건이 발생했고 해제되었는가? | raise/clear event와 현재 상태 |
| explanation | 어떤 평가가 현재 결과를 뒷받침했는가? | 같은 completed scan |

이 계약에는 widget, layout, 좌표, 색상이나 특정 화면의 visibility 정책을 넣지 않는다.
여러 renderer는 같은 descriptor와 실행 정체성을 서로 다르게 보여줄 수 있지만 값, 권한,
검증, command availability를 바꾸지 않는다.

### descriptor와 snapshot

descriptor는 공개 의미 ID, 이름, kind, source type, 읽기·쓰기·실행 권한과 source/intent
provenance를 갖는다. 상태, 타이머, 정확한 counter, 설정, 입력, 출력, command, alarm 등은
각자 선언된 의미로 분류한다. 이름이 `count`이거나 값이 정수처럼 보인다는 이유로 counter를
추론하지 않는다.

설정 변경과 관찰은 서로 다른 capability다. `state`, timer 또는 output descriptor에 값이
보인다는 사실은 write 권한을 만들지 않는다. metadata producer나 renderer도 소스에 없는
`write`·`execute` 권한을 추가할 수 없다. command 권한이 내부 state 직접 변경 권한을 뜻하지
않으며, operator 설정 권한도 source 편집 권한을 뜻하지 않는다.

snapshot은 정확히 한 completed scan에 결속된다. 관찰값은 다음을 구분한다.

- `ready`: `false`와 `0`을 포함한 실제 값이 있다.
- `unavailable`: 그 완료 시점에 값이 없으며 이유가 있다.
- `error`: 해당 descriptor를 관찰하지 못했다.
- `stale`: payload가 자칭하는 상태가 아니라 consumer가 예상 identity와 대조해 얻는 결과다.

유효한 stateless control은 식별된 schema와 함께 빈 descriptor 목록을 가질 수 있고,
그 completed snapshot도 빈 observation 목록을 가진다. 이는 관찰 실패가 아니다. 화면을
채우기 위해 가짜 Bool state나 timer를 추가해서는 안 된다.

`timer age = elapsed(phase)`의 descriptor는 원본 enum `phase`를 직접 subject로 가리킨다.
내부 계산이나 표시를 위해 합성 Bool 시계를 공개 의미처럼 만들지 않는다. Bool
subject도 true에서 false, false에서 true 어느 변화든 마지막 확정 변경부터 경과 시간을 센다.

### event, command result와 alarm

snapshot만으로는 두 새로고침 사이에 발생하고 해제된 alarm을 알 수 없다. event는 run별
순서를 가지며 중복을 식별할 수 있어야 한다. 보존 범위를 넘어 record가 사라졌거나 연결이
끊기면 sequence gap 또는 missed range를 명시한다. 마지막 snapshot으로 중간 event를
재구성하지 않는다.

command result는 요청 수신, 거부, 시작, 완료, 취소와 실패를 서로 다른 결과로 보존한다.
`received → rejected | started → completed | cancelled | failed`는 이 구분을 설명하는 lifecycle
표기이며 확정된 source 문법이나 record enum·전이 schema가 아니다. command ID와 execution
identity가 같아야 하며, renderer나 callback이 별도의 상태기를 추론하지 않는다. bounded
history에서 record를 내보내기 전에 잃으면 gap을 보고한다. alarm은 현재 active 여부와
raise/clear event를 함께 사용하여 짧은 발생도 보존한다. command와 alarm의 최종 record
직렬화와 전송은 실행 환경의 관찰 계약이다. 별도의 `command`·`alarm` 소스 선언이나
severity 키워드는 이 언어에 두지 않는다. 제어 반응은 명시된 typed input과 state 식으로
작성한다. 어떤 입력을 명령 요청으로 연결하고 어떤 관찰을 알람으로 공개할지는 외부의
명시된 descriptor 계약으로 연결하며 이름이나 Bool 값만 보고 자동 추론하지 않는다.

### explanation DAG

설명은 하나의 output 결과에서 실제로 평가한 입력, 상태, timer, 이름 있는 중간값,
predicate와 제약으로 이어지는 방향성 비순환 그래프다. 공유 조건은 하나의 stable node로
유지한다. renderer가 필요하면 특정 output을 root로 tree처럼 펼칠 수 있다.

각 completed scan의 평가에는 적어도 `evaluated`, 실제 value/status와 `supportsResult`의
의미가 필요하다. short-circuit로 평가하지 않은 branch를 실제 근거처럼 표시하지 않는다.
AND가 false이면 평가된 false child, OR가 true이면 평가된 모든 true child가 결과 설명에
참여할 수 있다. 하나를 임의의 승자로 고르지 않는다. 이 그래프는 해당 평가 결과의 proof
path이며 “이 조건이 없었으면 결과가 달랐다”는 counterfactual 인과를 주장하지 않는다.

설명은 output ON과 OFF, requested intent와 제약 후 safe intent를 모두 다룬다. compiler의
private slot 이름을 공개 의미 ID로 사용하지 않는다. node는 source node/span, intent anchor와
canonical document revision으로 거슬러 갈 수 있어야 한다.

## 5.4 정체성과 물리적 사실의 경계

관찰과 설정 기록은 다음 정체성을 혼합하지 않는다.

```text
source document + immutable revision + source digest
Program/module + artifact digest
settings revision + effective event position
behavior instance와 installation/binding revision(조합한 경우)
runId + completed scanId + logical time
event/command/alarm sequence identity
```

`scanId`는 한 run 안의 순서일 뿐이다. reset이나 실제 재시작으로 새 run이 생기면 같은
`scanId = 0`도 다른 occurrence다. 설정 live event는 `runId`를 바꾸지 않는다. 서로 다른
source, Program, settings, binding 또는 run의 snapshot과 explanation을 이어 붙이면 stale
또는 mismatch로 처리한다.

GhostFlow가 관찰하는 것은 입력과 제어 판단이다. `pump = true`는 출력 의도이며 펌프의
전기적 인가, 회전 또는 유량을 증명하지 않는다. requested intent, safe intent, host/Driver의
적용 결과, 실제 feedback을 각각 보존한다. feedback이 없으면 unknown이다. 저수위 신호가
관수를 막았다는 설명을 “탱크가 실제로 비었다”는 주장으로 바꾸지 않는다.

## 5.5 설계 이유와 근거

typed 설정은 코드, 검증과 자동 생성 form이 같은 뜻을 사용하게 한다. atomic event는 여러
값의 일부만 적용되는 순간을 없앤다. snapshot과 event를 나누면 현재값과 지나간 발생을
모두 잃지 않는다. exact identity와 provenance는 같은 이름의 다른 실행을 잘못 연결하지
않게 한다. 물리적 사실의 경계를 유지하면 시뮬레이션과 UI가 장치 성공을 지어내지 않는다.

근거: [언어 모델](../LANGUAGE.md), [control 표면](../LANGUAGE-SURFACE.md),
[의도 anchor](../INTENT-ANCHOR-MAP.md), [Interaction v0](../../contracts/interaction-v0/README.md),
[#68](https://github.com/callin2/ghostflow-language/issues/68),
[#70](https://github.com/callin2/ghostflow-language/issues/70),
[#73](https://github.com/callin2/ghostflow-language/issues/73),
[#74](https://github.com/callin2/ghostflow-language/issues/74),
[#88](https://github.com/callin2/ghostflow-language/issues/88),
[#89](https://github.com/callin2/ghostflow-language/issues/89),
[#105](https://github.com/callin2/ghostflow-language/issues/105),
[#110](https://github.com/callin2/ghostflow-language/issues/110).
