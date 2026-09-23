# GhostFlow Coding FAQ

“이런 동작은 어떻게 코딩하나요?”에 답하는 사례집이다.
질문마다 코드, 동작, 그렇게 작성하는 이유를 설명한다.
언어 규칙의 기준은 [Language Reference](LANGUAGE-REFERENCE.md)다.
각 요구에 필요한 언어·런타임·Driver·설치·UI의 책임은
[Reference 8장](reference/08-language-runtime-and-device-boundaries.md#83-faq-전체-책임표)에 정리한다.

## 질문 목록

1. [프로그램 파일은 어떻게 작성하나요?](#q01)
2. [버튼을 누르는 동안만 출력을 켜려면?](#q02)
3. [시작 버튼을 놓아도 운전을 유지하고, 정지 버튼으로 끄려면?](#q03)
4. [한 번 시작하면 5분 운전하고 자동으로 멈추려면?](#q04)
5. [요청이 2초 동안 유지된 뒤 켜려면?](#q05)
6. [요청이 사라져도 3초 뒤에 끄려면?](#q06)
7. [매일 오전 6시와 오후 6시 45분에 관수하려면?](#q07)
8. [1번 구역 다음에 2번 구역을 순서대로 관수하려면?](#q08)
9. [수분이 낮을 때 켜고, 경계에서 켜졌다 꺼졌다 하지 않게 하려면?](#q09)
10. [탱크가 하한보다 낮아지면 채우고 상한에서 멈추려면?](#q10)
11. [센서가 세 번 감지하면 완료 신호를 내보내려면?](#q11)
12. [‘5분’을 화면에서 변경할 수 있는 입력창으로 만들려면?](#q12)
13. [고장이 사라져도 알람을 유지하고 리셋으로 해제하려면?](#q13)
14. [두 출력을 동시에 켜지 못하게 하려면?](#q14)
15. [일출 30분 뒤에 시작하려면?](#q15)
16. [같은 계산을 여러 곳에서 재사용하려면?](#q16)
17. [인터록은 어떻게 구현하나요?](#q17)
18. [자기유지 기능이 있나요?](#q18)
19. [사용자가 중간에 취소한 경우 특정 장치를 움직이게 할 수 있나요?](#q19)
20. [일출 시각에 맞춰 예약하려면?](#q20)
21. [요일을 기준으로 동작을 예약할 수 있나요?](#q21)
22. [특정 장치의 누적 동작 시간을 기준으로 제어할 수 있나요?](#q22)
23. [자동·수동 운전과 상관없이 하루 동작 횟수에 따라 세척 운전을 할 수 있나요?](#q23)
24. [펌웨어 업데이트 없이 나중에 작동 시간만 바꿀 수 있나요?](#q24)
25. [설정 입력창의 라벨과 UI 컴포넌트를 바꿀 수 있나요?](#q25)
26. [설정값의 변경 가능 범위를 제한할 수 있나요?](#q26)
27. [요일별로 다른 설정을 할 수 있나요?](#q27)
28. [공휴일에만 제어 로직을 다르게 할 수 있나요?](#q28)
29. [서머타임도 제어에 적용할 수 있나요?](#q29)
30. [만조·간조를 기준으로 제어할 수 있나요?](#q30)
31. [사리·조금이나 달의 위상을 기준으로 제어할 수 있나요?](#q31)
32. [정전 후 다시 켜졌을 때의 동작을 코딩할 수 있나요?](#q32)
33. [온도 센서를 바꿔도 제어 코드를 수정하지 않아도 되나요?](#q33)
34. [센서 설정과 GhostFlow 소스는 분리되나요? 변경 주기도 다른가요?](#q34)
35. [프린터 Driver만 바꾸듯 센서를 교체해도 제어 프로그램을 재컴파일하지 않아도 되나요?](#q35)
36. [장치 교체와 재컴파일 분리 원칙은 language spec에도 있어야 하나요?](#q36)
37. [버튼을 다른 GPIO 핀에 연결해도 입력 매핑만 바꾸면 되나요?](#q37)
38. [출력 GPIO 매핑만 바꿔 다른 릴레이를 연결할 수 있나요?](#q38)
39. [Waveshare 같은 확장 보드로 출력 수를 늘릴 수 있나요?](#q39)
40. [RS485 I/O 확장 보드의 입력과 출력도 매핑할 수 있나요?](#q40)
41. [컴파일러 CLI로 문서를 검사하거나 컴파일하려면?](#q41)

## 예제를 읽는 방법

- 각 `control` 예제는 독립된 프로그램이다. 서로 다른 예제를 한 control에 그대로 합치지 않는다.
- 코드는 `.ghost.md` 문서의 최상위 `ghost` 블록에 넣는다. 첫 질문에 완전한 문서 모양을 보인다.
- **단편**은 해당 선언이나 식을 기존 control 안에 넣는 예다.
- **설계 표기**는 Reference에서도 그와 같이 구분한 표기다.
- 입력 이름의 의미는 각 질문에서 정한다. 물리 접점의 극성이나 통신 방식이 변수 이름에서 자동 결정되지는 않는다.
- 출력은 논리적 의도다. 열린 밸브를 확인해야 한다면 출력값과 별개인 피드백 입력으로 표현한다.
- 각 답변의 **문법 근거**에서 사용한 표기의 Reference 장·절을 바로 찾아갈 수 있다.
  공통 `control`, `input`, `output` 선언은 [Reference §1.4 문법 표기법](reference/01-source-and-syntax.md#14-문법-표기법)을 따른다.

<a id="q01"></a>
## 1. 프로그램 파일은 어떻게 작성하나요?

설명과 코드를 함께 담은 `.ghost.md` 문서를 작성한다.

````markdown
# 버튼으로 램프 켜기

버튼을 누르고 있는 동안 램프를 켠다.

```ghost
control ButtonLamp {
  input button: Bool;
  output lamp: Bool;

  lamp <- button;
}
```
````

Markdown 설명은 사람이 읽고, `ghost` 블록은 제어 규칙을 담는다.
설명 중간에 여러 블록을 두어도 문서 순서대로 하나의 프로그램을 구성한다.
블록을 나누는 것만으로 실행 단계나 대기 시간이 생기지 않는다.

**왜 이렇게 쓰나요?** 동작과 그 동작을 선택한 이유를 같은 문서에 보존하기 위해서다.

**문법 근거**

- `.ghost.md`, 최상위 `ghost` 블록: [Reference §1.1 — 실행 블록 추출](reference/01-source-and-syntax.md#실행-블록-추출)
- `control`, 입력·출력 선언: [Reference §1.4 문법 표기법](reference/01-source-and-syntax.md#14-문법-표기법)
- `<-` 출력 연결: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)

<a id="q02"></a>
## 2. 버튼을 누르는 동안만 출력을 켜려면?

기억이 필요하지 않으므로 입력을 출력에 연결한다.
여기서 `button = true`는 눌림, `stop = true`는 정지 요청이다.

```ghost
control HoldToRun {
  input button, stop: Bool;
  output pump: Bool;

  pump <- button && !stop;
}
```

버튼을 놓거나 정지 요청이 들어오면 그 판단에서 출력 의도가 꺼진다.
버튼과 정지가 함께 참이어도 `!stop` 때문에 출력은 거짓이다.

**왜 state가 없나요?** 이전에 눌렀는지 기억할 필요 없이 현재 입력만으로 결정하기 때문이다.

**문법 근거**

- `Bool`, `true`/`false`: [Reference §2.1 값 종류](reference/02-types-expressions-state.md#21-값-종류)
- `&&`, `!`: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)
- `<-`: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)

<a id="q03"></a>
## 3. 시작 버튼을 놓아도 운전을 유지하고, 정지 버튼으로 끄려면?

운전 여부를 `state`로 기억한다. 아래 예는 정지 해제만으로 재시작하지 않고,
시작 버튼을 놓았다가 다시 눌러야 시작한다.

```ghost
control StartStop {
  input start, stop: Bool;
  output pump: Bool;
  state armed: Bool = false;
  state running: Bool = false;

  let start_event = armed && start;

  armed' = !stop && !start;
  running' = !stop && (start_event || running);
  pump <- running';
}
```

- `running`은 이전 운전 상태다. 시작 후 버튼을 놓아도 유지한다.
- `armed`는 정지가 없을 때 시작 버튼의 해제를 관측했는지 기억한다.
- 초기부터 버튼을 누르고 있으면 시작하지 않는다. 해제 후 새 누름을 받는다.
- 정지는 자기유지와 시작 요청보다 우선한다.

**왜 `running'`을 출력에 쓰나요?** 이번 판단에서 정지했다면 출력에도 그 결과를 바로 반영하기 위해서다.

**문법 근거**

- `state`, 이전 상태와 `running'`: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `let`: [Reference §2.7 순수 함수와 계산 조합](reference/02-types-expressions-state.md#27-순수-함수와-계산-조합)
- `!`, `&&`, `||`: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)

관련 예제: [START/STOP](../examples/curriculum/pc-02-start-stop.ghost.md).

<a id="q04"></a>
## 4. 한 번 시작하면 5분 운전하고 자동으로 멈추려면?

운전 상태와 그 상태의 경과 시간을 함께 사용한다.
`stop` 또는 `low_water`가 참이면 종료한다. 운전 중 새 시작 요청은 무시한다.

```ghost
control FiveMinuteRun {
  input start, stop, low_water: Bool;
  output pump, valve: Bool;
  config duration: Duration = 5min;
  state armed: Bool = false;
  state running: Bool = false;
  timer age = elapsed(running);

  let permit = !stop && !low_water;
  let start_event = armed && start;

  armed' = permit && !start;
  running' = if !permit then false
    else if running then age < duration
    else start_event;

  valve <- running';
  pump <- running';
  require pump => valve;
}
```

`running`이 참으로 바뀔 때 `age`가 0으로 시작한다. `age >= duration`인 첫 tick에서 종료한다.
버튼을 계속 누르고 있어도 자동으로 새 5분을 시작하지 않는다.
시간 만료 뒤 재시작하려면 새 누름이 필요하다. 정지·저수위 뒤에는 허가가 복구되고 버튼 해제를 관측해야 한다.

**왜 `sleep(5min)`이 아닌가요?** 기다리는 동안에도 정지와 저수위를 매 tick 판단해야 하기 때문이다.

**문법 근거**

- `config duration: Duration`, `5min`: [Reference §5.1 config 선언](reference/05-settings-and-observation.md#51-config-선언), [§3.1 — Duration](reference/03-time-and-schedules.md#duration)
- `timer age = elapsed(running)`: [Reference §3.2 상태 변경 뒤의 경과 시간](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간)
- `if ... then ... else`: [Reference §2.6 — 조건식](reference/02-types-expressions-state.md#조건식)
- `require pump => valve`: [Reference §4.7 출력 의도와 제약](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)

<a id="q05"></a>
## 5. 요청이 2초 동안 유지된 뒤 켜려면?

요청을 받은 상태와 실제로 켜진 상태를 구분한다.

```ghost
control OnDelay {
  input request, stop: Bool;
  output enabled: Bool;
  config delay: Duration = 2s;
  type Phase = Idle | Waiting | Active;
  state phase: Phase = Idle;
  timer age = elapsed(phase);

  phase' = case phase {
    Idle => if request && !stop then Waiting else Idle;
    Waiting => if stop || !request then Idle
      else if age >= delay then Active else Waiting;
    Active => if request && !stop then Active else Idle;
  };

  enabled <- phase' == Active;
}
```

대기 중 요청이 사라지면 취소한다. 다시 요청하면 새 2초를 잰다.
정확한 전이 시점은 조건을 관측한 tick이며, 긴 tick 하나가 여러 단계를 한꺼번에 통과하지 않는다.

**왜 단계가 필요한가요?** “요청을 기다림”, “2초를 기다림”, “켜짐”의 의미를 명시하기 위해서다.

**문법 근거**

- `type Phase`, `case`: [Reference §2.4 enum과 빠짐없는 분기](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- `state phase`, `phase'`: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `elapsed(phase)`, `2s`: [Reference §3.2 상태 변경 뒤의 경과 시간](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간), [§3.1 — Duration](reference/03-time-and-schedules.md#duration)

관련 예제: [독립적인 타이머 패턴](../examples/curriculum/pc-06-timer-patterns.ghost.md).

<a id="q06"></a>
## 6. 요청이 사라져도 3초 뒤에 끄려면?

요청 해제 뒤의 유지 단계를 둔다. 유지 중 요청이 돌아오면 계속 켠다.

```ghost
control OffDelay {
  input request, stop: Bool;
  output enabled: Bool;
  config delay: Duration = 3s;
  type Phase = Idle | Active | Holding;
  state phase: Phase = Idle;
  timer age = elapsed(phase);

  phase' = case phase {
    Idle => if request && !stop then Active else Idle;
    Active => if stop then Idle
      else if !request then Holding else Active;
    Holding => if stop then Idle
      else if request then Active
      else if age >= delay then Idle else Holding;
  };

  enabled <- phase' in {Active, Holding};
}
```

`Holding`에 들어간 뒤 3초를 센다. 정지는 지연을 기다리지 않고 출력을 끈다.
`elapsed(phase)`는 현재 단계의 경과 시간이며 여러 ON 구간을 더한 누적 시간이 아니다.

**왜 ON-delay와 같은 타이머를 공유하지 않나요?** 서로 다른 조건의 시작 시점을 따로 기억해야 하기 때문이다.

**문법 근거**

- `type`, `case`, `in {Active, Holding}`: [Reference §2.4 enum과 빠짐없는 분기](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- `elapsed(phase)`: [Reference §3.2 상태 변경 뒤의 경과 시간](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간)
- 단계 경과와 누적의 구분: [Reference §3.4 누적 시간과 rolling budget](reference/03-time-and-schedules.md#34-누적-시간과-rolling-budget)

<a id="q07"></a>
## 7. 매일 오전 6시와 오후 6시 45분에 관수하려면?

예약의 `.due`를 시작 조건으로 사용한다.

```ghost
control DailyWatering {
  input stop: Bool;
  output pump: Bool;
  schedule starts: DailySlots<15min> {
    timezone = "Asia/Seoul";
    selected = [06:00, 18:45];
    dst_missing = skip;
    dst_repeated = first;
    basis = pulse;
    when = true;
    clock = trusted_only;
    gap = skip_after(60s);
    recovery = baseline;
    fallback = skip;
  }
  config duration: Duration = 5min;
  state running: Bool = false;
  timer age = elapsed(running);

  running' = !stop && (if running then age < duration else starts.due);
  pump <- running';
}
```

`DailySlots<15min>`은 15분마다 실행하라는 뜻이 아니다. 15분 격자에서 선택한 시각에 발생한다.
이 예는 운전 중 들어온 예약을 저장하지 않는다. 정지 중 지나간 예약도 뒤늦게 실행하지 않는다.

**왜 예약과 타이머를 나누나요?** 시작은 달력 시각, 운전 길이는 단조 경과 시간으로 판단하기 때문이다.

**문법 근거**

- `schedule`, `DailySlots<15min>`, `timezone`, `selected`, `.due`: [Reference §3.6 선택된 DailySlots](reference/03-time-and-schedules.md#36-선택된-dailyslots)
- 예약 발생과 운전의 구분: [Reference §3.5 Schedule의 공통 의미](reference/03-time-and-schedules.md#35-schedule의-공통-의미)
- `elapsed(running)`: [Reference §3.2 상태 변경 뒤의 경과 시간](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간)

<a id="q08"></a>
## 8. 1번 구역 다음에 2번 구역을 순서대로 관수하려면?

순서를 enum으로 적고 각 단계에서 허용할 출력을 연결한다.
아래는 정상 운전 순서의 예다. 각 구역은 밸브 개방 요청 후 2초 대기, 5분 급수,
펌프 정지 요청 후 2초 정리 순서로 진행한다.

```ghost
control TwoZones {
  input start: Bool;
  output pump, valve1, valve2: Bool;
  type Phase = Idle | Open1 | Water1 | Stop1 | Open2 | Water2 | Stop2;
  state phase: Phase = Idle;
  state armed: Bool = false;
  timer age = elapsed(phase);
  config watering_time: Duration = 5min;
  config settle_time: Duration = 2s;

  let start_event = armed && start;
  armed' = phase == Idle && !start;

  phase' = case phase {
    Idle => if start_event then Open1 else Idle;
    Open1 => if age >= settle_time then Water1 else Open1;
    Water1 => if age >= watering_time then Stop1 else Water1;
    Stop1 => if age >= settle_time then Open2 else Stop1;
    Open2 => if age >= settle_time then Water2 else Open2;
    Water2 => if age >= watering_time then Stop2 else Water2;
    Stop2 => if age >= settle_time then Idle else Stop2;
  };

  valve1 <- phase' in {Open1, Water1, Stop1};
  valve2 <- phase' in {Open2, Water2, Stop2};
  pump <- phase' in {Water1, Water2};
  require pump => (valve1 || valve2);
  require !(valve1 && valve2);
}
```

운전 중 요청은 대기열에 쌓이지 않는다. 종료 후 버튼 해제와 새 누름이 있어야 다시 시작한다.
이 코드의 2초 대기는 실제 밸브 열림 확인이 아니다.
열림·닫힘 피드백과 중단 경로가 필요한 경우에는
[피드백을 사용하는 순차 제어 예제](../examples/curriculum/pc-09-sequential-water-supply.ghost.md)를 따른다.

**왜 반복문으로 쓰지 않나요?** 각 단계에서도 새로운 입력을 판단하면서 현재 단계를 기억해야 하기 때문이다.

**문법 근거**

- `type Phase`, `case`, `in { ... }`: [Reference §2.4 enum과 빠짐없는 분기](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- `phase'`와 동시 상태 전이: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `elapsed(phase)`: [Reference §3.2 상태 변경 뒤의 경과 시간](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간)
- `require`, `=>`, 출력 상호 배제: [Reference §4.7 출력 의도와 제약](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)

<a id="q09"></a>
## 9. 수분이 낮을 때 켜고, 경계에서 켜졌다 꺼졌다 하지 않게 하려면?

켜는 기준과 끄는 기준을 다르게 둔다. 센서 fault도 명시적으로 처리한다.

```ghost
control MoistureControl {
  input stop: Bool;
  sensor moisture: Percent {
    sample = 1s;
    valid = 0% .. 100%;
    filter = median(5);
    stale_after = 3s;
    recover_after = 3 samples;
  }
  signal dry = hysteresis(moisture,
    on_below: 30%, off_above: 35%, initial: false);
  output pump: Bool;

  let requested = case dry {
    ok(value) => value;
    fault(_) => false;
  };
  pump <- requested && !stop;
}
```

정상 수분값이 30% 미만이면 켜고, 35% 초과이면 끈다. 두 경계값과 그 사이는 이전 판단을 유지한다.
필터 준비나 복구 조건을 충족하지 못했을 때도 fault 경로를 따라 끈다.
예제의 측정 간격과 한계값은 이 프로그램의 선택이며 모든 센서의 기본값이 아니다.
정상 측정으로 복구되면 새 수분 판단으로 자동 운전한다. 수동 재시작이 필요하다면 별도 상태를 둔다.

**왜 `moisture < 30%` 한 줄로 끝내지 않나요?** 품질과 경계 진동을 함께 다루기 위해서다.

**문법 근거**

- `sensor`, `sample`, `valid`, `filter`, `stale_after`, `recover_after`: [Reference §4.2 샘플 계약과 sensor 처리 순서](reference/04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서)
- `median`, `signal`, `hysteresis`, 이름 붙인 인수: [Reference §4.3 filter와 signal 연산](reference/04-sensors-constraints-control.md#43-filter와-signal-연산)
- `case`, `ok(value)`, `fault(_)`: [Reference §4.1 sensor와 Result 품질](reference/04-sensors-constraints-control.md#41-sensor와-result-품질)

<a id="q10"></a>
## 10. 탱크가 하한보다 낮아지면 채우고 상한에서 멈추려면?

채우는 중인지 기억한다. `low_level_reached`는 물이 하한에 도달했다는 뜻이고,
`high_level_reached`는 상한에 도달했다는 뜻이다.

```ghost
control TankLevel {
  input low_level_reached, high_level_reached: Bool;
  output fill_pump: Bool;
  type Phase = Idle | Filling | SensorConflict;
  state phase: Phase = Idle;
  let conflict = high_level_reached && !low_level_reached;

  phase' = case phase {
    Idle => if conflict then SensorConflict
      else if !low_level_reached then Filling else Idle;
    Filling => if conflict then SensorConflict
      else if high_level_reached then Idle else Filling;
    SensorConflict => if conflict then SensorConflict else Idle;
  };

  fill_pump <- phase' == Filling;
}
```

하한을 다시 넘었다고 즉시 멈추지 않는다. 채우는 중이면 상한까지 간다.
상한만 참이고 하한이 거짓인 모순에서는 끈다. 모순 해제 뒤 한 번 Idle을 거쳐 다시 판단한다.

**왜 입력 하나만 반전해서 쓰지 않나요?** 시작 기준과 종료 기준이 다르므로 이전 운전 상태가 필요하기 때문이다.

**문법 근거**

- `type Phase`, `case`: [Reference §2.4 enum과 빠짐없는 분기](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- `state`, `phase'`, `<-`: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `if`, `!`, `&&`: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)

원본 사례: [탱크 히스테리시스](../examples/curriculum/pc-07-tank-hysteresis.ghost.md).

<a id="q11"></a>
## 11. 센서가 세 번 감지하면 완료 신호를 내보내려면?

참인 tick 수가 아니라 거짓에서 참으로 바뀐 사건을 센다.
아래는 Reference의 정확 정수 타입 `Int`를 사용한 예다.

```ghost
control CountThree {
  input detected, reset: Bool;
  output done: Bool;
  state previous: Bool = false;
  state count: Int = 0;
  let event = detected && !previous;

  previous' = detected;
  count' = if reset then 0
    else if event && count < 3 then count + 1
    else count;
  done <- count' >= 3;
}
```

감지 신호를 계속 참으로 유지해도 한 번만 센다. 이 예는 3에서 멈추는 카운터다.
reset과 감지가 같은 tick이면 reset이 우선한다. 초기 입력이 참이면 첫 감지로 센다.
카운터를 화면에 공개할 때는 이름에서 추측하게 하지 않고 의도 연결에 counter 의미를 명시한다.

**왜 Number가 아닌 Int인가요?** 개수에는 근사값이나 암묵적 반올림을 허용하지 않기 때문이다.

**문법 근거**

- `Int`, 정수 연산·비교: [Reference §2.3 정확한 정수 설계](reference/02-types-expressions-state.md#23-정확한-정수-설계)
- `previous`, `count`의 상태 기억과 `count'`: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- 카운터의 공개 의미: [Reference §5.3 — descriptor와 snapshot](reference/05-settings-and-observation.md#descriptor와-snapshot)

<a id="q12"></a>
## 12. ‘5분’을 화면에서 변경할 수 있는 입력창으로 만들려면?

운영 설정으로 선언하고 타입·범위·증분·권한·표시 이름을 적는다.
다음 **단편**으로 [4번 예제](#q04)의 `duration` 선언을 바꾼다.

```ghost
config duration: Duration = 5min {
  min = 1min;
  max = 20min;
  step = 1min;
  access = operator;
  label = "관수 시간";
}
```

제어식은 계속 `age < duration`을 사용한다.
화면은 설정 설명을 받아 시간 입력창을 만들며 1분부터 20분까지 1분 간격의 값을 허용한다.
텍스트 입력, 선택 목록, 슬라이더 중 어떤 모양을 쓸지는 화면이 정한다.

운영 설정 변경은 같은 프로그램·같은 실행에서 유효값을 바꾸는 atomic live event다.
여러 값을 한 번에 바꾸면 전부 검증하고 함께 적용한다. 하나라도 잘못되면 아무 값도 바꾸지 않는다.
진행 중인 타이머를 0으로 초기화하지 않는다.
이미 6분 경과한 운전의 제한을 10분에서 5분으로 줄이면, 새 값이 반영된 판단에서
`age < duration`이 거짓이 되어 종료한다.

**왜 그냥 `5min` 리터럴을 화면에서 찾으면 안 되나요?** 모든 상수가 운영자의 조절점은 아니기 때문이다.

**문법 근거**

- `config`, `min`, `max`, `step`, `access`, `label`: [Reference §5.1 config 선언](reference/05-settings-and-observation.md#51-config-선언)
- 기본값과 유효값: [Reference §5.1 — 기본값과 유효값](reference/05-settings-and-observation.md#기본값과-유효값)
- 실행 중 원자적 변경: [Reference §5.2 — atomic live event](reference/05-settings-and-observation.md#atomic-live-event)

<a id="q13"></a>
## 13. 고장이 사라져도 알람을 유지하고 리셋으로 해제하려면?

fault의 현재값과 fault를 기억하는 상태를 나눈다.
아래는 알람 기억만 다루는 예다. `fault = true`이면 원인이 남아 있다는 뜻이다.

```ghost
control AlarmMemory {
  input fault, reset: Bool;
  output alarm: Bool;
  state latched: Bool = false;
  state reset_armed: Bool = false;
  let reset_event = reset_armed && reset;

  reset_armed' = !fault && !reset;
  latched' = fault || (latched && !reset_event);
  alarm <- latched';
}
```

고장 원인이 사라져도 `latched`는 남는다. 원인이 사라진 뒤 reset의 해제와 새 누름을 받아야 지운다.
fault와 reset이 동시에 참이면 fault가 이긴다. reset은 장비의 재시작 명령이 아니다.

**왜 `alarm <- fault`와 다른가요?** 현재 원인과 과거에 발생한 고장의 기억은 다른 정보이기 때문이다.
장비 정리·위치 피드백·여러 고장 원인까지 포함한 사례는
[고장 및 리셋 예제](../examples/curriculum/pc-10-fault-alarm-reset.ghost.md)를 참조한다.

**문법 근거**

- `state latched`, `reset_armed`, 다음 상태 `'`: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `let`, 순수한 사건 조건: [Reference §2.7 순수 함수와 계산 조합](reference/02-types-expressions-state.md#27-순수-함수와-계산-조합)
- `fault || (latched && !reset_event)`: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)

<a id="q14"></a>
## 14. 두 출력을 동시에 켜지 못하게 하려면?

요청을 각각 표현한 뒤 상호 배제 제약을 둔다.

```ghost
control ExclusiveDirections {
  input forward_request, reverse_request: Bool;
  output forward, reverse: Bool;

  forward <- forward_request;
  reverse <- reverse_request;
  require !(forward && reverse);
}
```

두 요청이 동시에 참이면 제약을 거친 두 출력은 모두 거짓이다. 작성 순서로 승자를 고르지 않는다.
이 제약만으로 방향 전환 대기시간까지 생기지는 않는다. 대기가 필요하면
[방향 전환 상태와 타이머 사례](../examples/curriculum/pc-04-direction-interlock.ghost.md)를 사용한다.

**왜 한쪽 출력식에서 다른 쪽을 몰래 막지 않나요?** 두 요청과 충돌 규칙을 각각 읽고 설명할 수 있게 하기 위해서다.

**문법 근거**

- `require !(forward && reverse)`와 상호 배제: [Reference §4.7 출력 의도와 제약](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)
- 제약문의 문법 골격: [Reference §1.4 문법 표기법](reference/01-source-and-syntax.md#14-문법-표기법)

<a id="q15"></a>
## 15. 일출 30분 뒤에 시작하려면?

Solar 예약을 선언하고 `.due`를 시작 조건으로 쓴다.
다음은 [7번 예제](#q07)의 `starts` 선언을 대체하는 **단편**이다.

```ghost
schedule starts: Solar {
  timezone = "Asia/Seoul";
  latitude = 37.5665;
  longitude = 126.9780;
  at = sun`rise + 30min`;
  fallback = skip;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
}
```

예제 좌표를 대상 장소의 좌표로 바꾼다. `starts.due` 이후의 운전 시간은 기존 `duration`과 타이머가 정한다.
일출을 결정할 수 없으면 이 예는 새 운전을 건너뛴다. 이유를 정상적인 “아직 시작 시각 아님”으로 바꾸지는 않는다.
이미 시작한 운전을 취소하는 규칙은 `fallback = skip`에서 자동으로 나오지 않는다.

**왜 위치·시간대·fallback을 적나요?** 자연 사건은 설치 맥락에 따라 달라지고, 정보를 모를 때의 판단도 명시해야 하기 때문이다.

**문법 근거**

- `schedule ...: Solar`, 위치·시간대, ``sun`rise + 30min` ``: [Reference §3.9 — 선택된 Solar 표기](reference/03-time-and-schedules.md#선택된-solar-표기)
- `fallback = skip`: [Reference §3.9 — 자연 기준의 fallback과 회복](reference/03-time-and-schedules.md#자연-기준의-fallback과-회복)
- `.due`의 의미: [Reference §3.5 Schedule의 공통 의미](reference/03-time-and-schedules.md#35-schedule의-공통-의미)

<a id="q16"></a>
## 16. 같은 계산을 여러 곳에서 재사용하려면?

순수 함수로 꺼내고 필요한 값을 인자로 전달한다.

```ghost
fn permitted(request: Bool, stop: Bool, enabled: Bool) -> Bool {
  request && !stop && enabled
}

control TwoRequests {
  input request1, request2, stop, enabled: Bool;
  output zone1, zone2: Bool;

  zone1 <- permitted(request1, stop, enabled);
  zone2 <- permitted(request2, stop, enabled);
}
```

함수는 호출 사이의 상태를 기억하지 않는다. 타이머나 자기유지 기억을 가진 동작을
복제하는 문제는 순수한 계산 재사용과 구분한다.
그런 동작의 독립 상태·포트·설정·연결은 [동작 합성](reference/06-composition-and-replay.md)의 의미를 따른다.

**왜 바깥 상태를 함수가 몰래 읽지 않나요?** 같은 인자에서 같은 결과를 얻고 호출의 의존성을 드러내기 위해서다.

**문법 근거**

- `fn`, 매개변수, `-> Bool`, 함수 호출: [Reference §2.7 순수 함수와 계산 조합](reference/02-types-expressions-state.md#27-순수-함수와-계산-조합)
- 함수 선언의 문법 골격: [Reference §1.4 문법 표기법](reference/01-source-and-syntax.md#14-문법-표기법)
- 기억을 가진 동작의 독립성: [Reference §6.2 definition, instance와 논리 port](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)

<a id="q17"></a>
## 17. 인터록은 어떻게 구현하나요?

인터록은 조건이 맞지 않는 동작이나 서로 충돌하는 동작을 막는 규칙이다.
동작 허가 조건은 상태 전이식에 넣고, 출력끼리 지켜야 할 관계는 `require`로 표현한다.

### 조건이 충족될 때만 운전하기

“밸브 열림이 확인되고 저수위가 아닐 때만 펌프를 운전한다”는 다음처럼 적는다.
`valve_open`은 실제 열림을 확인한 입력, `low_water`는 저수위 감지,
`stop`은 정지 요청이다. `valve_open`을 밸브 개방 출력값으로 대신하지 않는다.

```ghost
control PumpInterlock {
  input start, stop, valve_open, low_water: Bool;
  output pump: Bool;
  state armed: Bool = false;
  state running: Bool = false;

  let permit = !stop && valve_open && !low_water;
  let start_event = armed && start;

  armed' = permit && !start;
  running' = permit && (running || start_event);
  pump <- running';
}
```

운전 중에도 매 tick `permit`을 판단한다. 밸브 열림 확인이 사라지거나 저수위·정지가
발생하면 `running'`과 펌프 의도를 함께 끈다. 조건 복구만으로 다시 시작하지 않는다.
허가가 복구된 뒤 시작 버튼을 놓았다가 새로 눌러야 한다.
이는 이 예제가 선택한 재시작 정책이다.

### 두 출력의 동시 동작 막기

정·역회전처럼 두 출력을 동시에 허용하지 않으려면 출력 제약을 둔다.

```ghost
control DirectionInterlock {
  input forward_request, reverse_request: Bool;
  output forward, reverse: Bool;

  forward <- forward_request;
  reverse <- reverse_request;
  require !(forward && reverse);
}
```

두 요청이 동시에 참이면 제약을 거친 두 출력은 모두 거짓이다. 먼저 적힌 쪽이 이기는 규칙이 아니다.
같은 상호 배제 관계를 `mutex(forward, reverse);`로도 표현한다.
방향을 바꾸기 전 대기시간은 별도 상태와 타이머로 적는다.

`require pump => valve;`는 “펌프 출력 의도에는 밸브 출력 의도가 필요하다”는 관계다.
밸브가 실제로 열렸다는 확인은 첫 예제처럼 별도 입력으로 판단한다.
또한 출력 제약은 상태를 자동으로 초기화하지 않는다. 조건 해제 뒤 새 시작을 요구하려면
첫 예제처럼 상태 전이와 재시작 조건까지 명시한다.
비상정지는 이 소프트웨어 논리로 대체하지 않는다.

**왜 두 방식으로 나누나요?** 운전 상태를 어떻게 바꿀지와 어떤 출력 조합을 허용할지는
각각 명시해야 하는 제어 규칙이기 때문이다.

**문법 근거**

- `let permit`, 이름 붙인 순수 계산: [Reference §2.7 순수 함수와 계산 조합](reference/02-types-expressions-state.md#27-순수-함수와-계산-조합)
- `state`, `running'`, `<-`: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `!`, `&&`, `||`: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)
- `require`, `mutex`, `=>`, requested/safe 출력 구분: [Reference §4.7 출력 의도와 제약](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)
- `require`와 `mutex`의 선언 형태: [Reference §1.4 문법 표기법](reference/01-source-and-syntax.md#14-문법-표기법)

<a id="q18"></a>
## 18. 자기유지 기능이 있나요?

있다. `state`로 이전 운전 상태를 기억하고, 다음 상태 식에서 그 값을 다시 사용한다.
시작 버튼을 놓아도 켜진 상태를 유지하는 기본 자기유지는 다음과 같다.

```ghost
control SelfHolding {
  input start, stop: Bool;
  output pump: Bool;
  state running: Bool = false;

  running' = !stop && (start || running);
  pump <- running';
}
```

- `start`가 참이면 `running'`이 참이 된다.
- 다음 tick에 `start`가 거짓이어도 이전 `running`이 참이므로 운전을 유지한다.
- `stop`이 참이면 `running'`은 거짓이다. 시작과 정지가 동시에 들어와도 정지가 우선한다.
- `pump`는 이번 판단의 `running'`을 따라간다.

이 기본 식은 정지를 해제할 때 `start`가 계속 참이면 다시 켜진다.
“시작 버튼을 놓았다가 다시 눌러야 한다”는 동작이 필요하면
[3번의 재시작 허가 상태](#q03)를 함께 둔다.

**왜 이전 상태를 식에 넣나요?** 자기유지의 기억을 `running`으로 명시하면
시작·유지·해제 조건을 한 식에서 읽을 수 있기 때문이다.

**문법 근거**

- `state running: Bool = false`, 이전 상태 `running`, 다음 상태 `running'`: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `!stop && (start || running)`: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)
- `pump <- running'`: [Reference §1.4 출력 연결 문법](reference/01-source-and-syntax.md#14-문법-표기법), [§2.8 출력에서 다음 상태 읽기](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)

<a id="q19"></a>
## 19. 사용자가 중간에 취소한 경우 특정 장치를 움직이게 할 수 있나요?

가능하다. 취소 입력을 받으면 후속 동작 단계로 전환하고 그 단계의 출력을 연결한다.
다음 예는 원래 작업 정지 요청 → 정지 확인 → 복귀 장치 작동 → 원위치 확인 순서다.
`stopped`와 `home`은 실제 정지와 원위치를 확인하는 입력이다.

```ghost
control CancelAndReturn {
  input start, cancel, stopped, home: Bool;
  output work, return_device: Bool;
  type Phase = Idle | Working | Stopping | Returning;
  state phase: Phase = Idle;
  state armed: Bool = false;

  let start_event = armed && start;
  armed' = phase == Idle && !start && !cancel;
  phase' = case phase {
    Idle => if !cancel && start_event then Working else Idle;
    Working => if cancel then Stopping else Working;
    Stopping => if !stopped then Stopping else if home then Idle else Returning;
    Returning => if home then Idle else Returning;
  };
  work <- phase' == Working;
  return_device <- phase' == Returning;
  require !(work && return_device);
}
```

`Stopping`에서는 새 복귀 명령을 보내지 않고 원래 작업이 멈췄다는 피드백을 기다린다.
`Returning`에서만 복귀 장치를 명령한다. 취소를 놓아도 복귀는 원위치 확인까지 유지한다.
정지 또는 원위치 확인이 오지 않으면 해당 단계에 머문다. 이 예에는 시간 초과 정책이 없다.
취소 후 자동 재시작하지 않으며, 대기 상태에서 시작·취소를 놓은 뒤 새 시작 요청이 필요하다.
이 예는 일반 작업 취소다. 비상정지 때 추가 움직임을 허가하는 규칙으로 사용하지 않는다.

**왜 정지 확인 뒤에 복귀하나요?** 원래 작업과 복귀 명령이 동시에 장치를 움직이지 않게 하고,
취소가 논리 상태와 물리 상태를 혼동하지 않게 하기 위해서다.

**문법 근거**

- phase 전이와 상태 snapshot의 의미: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- requested, applied, confirmed를 나누는 장치 피드백: [Reference §4.7 requested, safe, applied, confirmed](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)
- `type Phase`, `case`: [Reference §2.4 enum과 빠짐없는 분기](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- `let`, `if`, Bool 연산과 비교: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)

<a id="q20"></a>
## 20. 일출 시각에 맞춰 예약하려면?

`Solar` 예약의 `.due`를 시작 조건으로 사용한다. 아래는 일출 자체에 맞추는 단편이다.

```ghost
schedule starts: Solar {
  timezone = "Asia/Seoul";
  latitude = 37.5665;
  longitude = 126.9780;
  at = sun`rise`;
  fallback = skip;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
}
```

대상 장소의 좌표와 시간대로 바꾼다. `starts.due`가 참인 시점에 새 occurrence를
admit하고, 운전 시간은 기존 `duration`과 control state가 정한다. 일출을 계산할 수 없으면
새 운전을 건너뛴다. `fallback = skip`은 이미 admit한 운전을 취소하지 않는다.

**왜 `.due`를 쓰나요?** 자연 사건의 발생과 운전의 상태 전이를 분리해, 일정 판단과
장치 제어의 경계를 보존하기 위해서다.

**문법 근거**

- `schedule ...: Solar`, ``sun`rise` ``, 위치·시간대와 `fallback`: [Reference §3.9 선택된 Solar 표기](reference/03-time-and-schedules.md#선택된-solar-표기)
- `.due`와 occurrence admission: [Reference §3.5 Schedule의 공통 의미](reference/03-time-and-schedules.md#35-schedule의-공통-의미)
- `fallback = skip`과 회복: [Reference §3.9 자연 기준의 fallback과 회복](reference/03-time-and-schedules.md#자연-기준의-fallback과-회복)

<a id="q21"></a>
## 21. 요일을 기준으로 동작을 예약할 수 있나요?

요일 조건은 일정의 `on` 필드로 표현한다. 예를 들어 월요일부터 금요일까지
오전 6시에 시작하려면 시각 조건과 다음 요일 조건을 조합한다.
아래는 schedule 본문에 넣는 문법 단편이다.

```ghost
on = day`mon..fri`;
```

요일 필터는 계산된 scheduled start의 local date에 적용한다. 공휴일과 현장 근무일은
평일과 다른 규칙이므로 ``day`mon..fri` ``가 공휴일 달력을 뜻한다고 해석하지 않는다.
DST와 자정 경계 정책도 일정 계약에 따라 적용한다.

**왜 요일과 시각을 나누나요?** 같은 시각 예약에도 평일·공휴일·현장 근무일처럼 서로 다른 날짜 조건을 조합할 수 있어야 하기 때문이다.

**문법 근거**

- `on`과 요일·공휴일·근무일의 구분: [Reference §3.8 DST, 자정과 work calendar](reference/03-time-and-schedules.md#38-dst-자정과-work-calendar)
- `DailySlots`와 `.due`의 선택된 일정 의미: [Reference §3.6 선택된 DailySlots](reference/03-time-and-schedules.md#36-선택된-dailyslots)
- 시간대와 local date 경계: [Reference §3.1 시간값과 시계 영역](reference/03-time-and-schedules.md#31-시간값과-시계-영역)


<a id="q22"></a>
## 22. 특정 장치의 누적 동작 시간을 기준으로 제어할 수 있나요?

누적 동작 시간을 `Duration` 값으로 받아 조건에 사용할 수 있다.
먼저 **어느 기간에, 무엇을 동작으로 인정하여 합산하는지** 정한다.

| 원하는 기준 | 합산 범위 |
|---|---|
| 이번 작업에서 총 10분 동작 | 작업 시작부터 ON 구간 합계 |
| 최근 1시간 중 20분 동작 | 계속 이동하는 1시간 창 |
| 오늘 총 1시간 동작 | 지정 시간대의 오늘 날짜 |
| 정비 후 총 100시간 동작 | 명시적인 정비 초기화 이후 |

아래는 누적값을 소비하는 제어 예다. `used`는 같은 장치의 확인된 ON 구간을
선택한 범위에서 합산한 입력이다. `usage_valid`는 그 집계가 유효하다는 입력이다.
이 코드는 누적값을 생성하는 선언까지 포함하지 않는다.

```ghost
control UsageLimit {
  input request, usage_valid: Bool;
  input used: Duration;
  output device: Bool;
  config limit: Duration = 1h;

  device <- request && usage_valid && used < limit;
}
```

합계가 한도에 도달하면 추가 운전 요청을 내지 않는다. 물리 정지까지의 지연을 포함한
엄격한 사용량 한도는 Reference §3.10의 예약·정산 규칙도 필요하다.
`elapsed(running)`은 마지막 상태 변경 이후의 시간이다. 여러 번 켰다 끈 시간을 합산하지 않는다.

자동·수동 운전을 모두 포함하려면 명령별 타이머 대신 같은 설비의 공통 동작 기록을 합산한다.
출력 요청, 제약 통과 출력, 적용된 명령, 실제 피드백 중 어느 것을 셀지 구분한다.
피드백이 없으면 명령 적용 시간을 실제 동작 시간이라고 부르지 않는다.

누적 기록은 `account`로 선언하고 `used(account, rolling(60s))`로 최근 60초를 조회한다.
`on_time` 선언에는 대상, requested/safe/applied/confirmed 중 증거 기준과 지속성을 명시한다.
작업별·정비 이후 누적값의 초기화와 보존 정책을 이 표기에서 자동으로 추론하지 않는다.

**왜 별도 누적 의미가 필요한가요?** 연속 운전 시간만 검사하면 짧게 여러 번 켠 사용량을 놓치기 때문이다.

**문법 근거**

- `Duration`, `1h`: [Reference §3.1 시간값과 시계 영역 — Duration](reference/03-time-and-schedules.md#duration)
- `&&`, `<`: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)
- `elapsed`와 누적의 차이: [Reference §3.2 상태 변경 뒤의 경과 시간](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간)
- 누적 대상·범위와 `account`·`on_time`·`used`: [Reference §3.4 누적 시간과 rolling budget](reference/03-time-and-schedules.md#34-누적-시간과-rolling-budget)
- 자동·수동 통합 집계와 일일 한도: [Reference §3.10 시간 기반 사용량 제약](reference/03-time-and-schedules.md#310-시간-기반-사용량-제약)
- `config limit`: [Reference §5.1 config 선언](reference/05-settings-and-observation.md#51-config-선언)

<a id="q23"></a>
## 23. 자동·수동 운전과 상관없이 하루 동작 횟수에 따라 세척 운전을 할 수 있나요?

횟수 조건과 세척 순서를 조합하여 표현할 수 있다.
자동 시작 명령과 수동 시작 명령을 각각 세는 대신, **같은 장치의 동작을 한 곳에서 센다.**
장치가 계속 동작하는 중에 자동에서 수동으로 전환해도 새 동작으로 세지 않는다.

예를 들어 “서울 시간으로 오늘 일반 운전을 10번 시작하면, 현재 운전 종료 후 한 번 세척”이라는
정책을 선택할 수 있다. 여기서는 동작 확인 신호의 OFF→ON을 1회로 정한다.
완료한 운전만 세고 싶다면 시작 대신 완료 사건을 집계한다.

다음은 일일 집계값을 읽는 **단편**이다. `Int`는 Reference의 정확 정수 타입이다.
`today_starts`는 자동·수동 일반 운전을 합친 오늘 횟수이며, `count_valid`는 집계 유효성이다.

```ghost
input today_starts: Int;
input count_valid: Bool;
let wash_due = count_valid && today_starts >= 10;
```

`today_starts`는 내장 이름이 아니다. 이 단편은 일일 카운터 자체를 선언하지 않는다.
일일 집계 자체는 §3.10의 `account`·`count_events`로 선언한다. 입력 사건의 ID,
증거 기준과 날짜 경계를 명시하며 같은 사건의 재전송은 한 번만 센다.
`on_time`은 시간 합계이고 `count_events`는 횟수이므로 서로 바꾸어 쓰지 않는다.

위 예의 세척 순서는 다음과 같다. 아래는 실행 문법이 아닌 동작 설명이다.

```text
오늘 일반 운전 10회 도달 → 세척 필요를 기억
현재 일반 운전 종료 확인 → 세척 단계 시작
세척 완료 확인          → 요청 해제, 해당 날짜의 세척 완료를 기억
```

- 세척 때문에 같은 장치가 켜진 동작은 이 예의 일반 운전 횟수에서 제외한다.
- 세척 중 새 일반 운전은 시작하지 않는다. 자동·수동 요청 모두 같은 조건을 적용한다.
- 세척 요청을 한 tick의 펄스로만 두면 장치가 바쁠 때 잃을 수 있으므로 상태로 기억한다.
- 날짜가 바뀌어도 이미 기억한 세척 요청과 진행 중인 세척은 취소하지 않는 정책이다.
- 하루 한 번 세척할지, 매 10회마다 세척할지는 다른 정책이다. 이 예는 하루 한 번이다.

실제 일일 집계 계약에는 시간대, 날짜 경계, 재시작 후 복원, 시계 보정 및 집계 불명 상태를
정해야 한다. 일반 `state count = 0` 선언만으로 날짜별 영속 집계가 생기지는 않는다.
세척 자체의 단계와 출력은 [8번 순차 제어](#q08)처럼 enum 상태로 작성한다.

**왜 운전 모드 밖에서 세나요?** 세척 필요성은 누가 명령했는지가 아니라 장치가 얼마나 사용되었는지에 달려 있기 때문이다.

**문법 근거**

- `Int`와 정확한 횟수: [Reference §2.3 정확한 정수 설계](reference/02-types-expressions-state.md#23-정확한-정수-설계)
- `let`, `&&`, `>=`: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)
- 세척 단계의 enum과 `case`: [Reference §2.4 enum과 빠짐없는 분기](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- 이전 입력·횟수·세척 요청 기억: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- 명령과 물리 동작의 구분: [Reference §4.7 requested, safe, applied, confirmed](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)
- 일일 설비 집계의 관련 원칙 — 시간 집계 규칙이며 횟수 문법은 아님: [Reference §3.10 시간 기반 사용량 제약](reference/03-time-and-schedules.md#310-시간-기반-사용량-제약)

<a id="q24"></a>
## 24. 펌웨어 업데이트 없이 나중에 작동 시간만 바꿀 수 있나요?

가능하다. **얼마 동안 작동할지**를 운영자가 바꿀 수 있는 `Duration` 설정으로 선언한다.
다음 **단편**은 [4번 시간제 운전](#q04)의 `duration` 선언을 대체한다.

```ghost
config duration: Duration = 5min {
  min = 1min;
  max = 20min;
  step = 1min;
  access = operator;
  label = "작동 시간";
}
```

화면에서 5분을 10분으로 바꾸면 설정의 유효값이 바뀐다.
소스 수정, 프로그램 재컴파일, 펌웨어 업데이트, 재시작은 필요하지 않다.
타입과 범위는 이 선언이 정하고 화면은 그 설명을 이용해 입력창을 만든다.
일반 운영 설정의 받아들인 값은 장치를 재시작해도 보존한다.

변경은 같은 실행 안에서 적용하며 이미 지난 시간을 초기화하지 않는다.
`age < duration`으로 제어할 때 3분 경과 후 5분을 10분으로 늘리면 총 10분을 기준으로 판단한다.
이미 6분 경과한 상태에서 5분으로 줄이면 새 값이 반영된 판단에서 종료한다.
“현재 작업은 그대로, 다음 작업부터 새 시간 사용”은 작업 시작 때 설정을 별도 상태에 기억하는
명시적 제어 규칙이 필요하다. `config`의 기본 변경 의미는 아니다.

**몇 시에 시작할지**는 운전 길이와 다른 설정이다.
`DailySlots`의 고정 `selected` 목록 대신 `TimeSlots` config를 연결한다.
다음은 설정 선언 단편이다. 15분 격자에 최대 8개 시각을 받는다.

```ghost
config watering_slots: TimeSlots<15min, 8> = [time`06:00`, time`18:45`] {
  access = operator;
  label = "관수 시작 시각";
}
```

같은 control의 `DailySlots<15min>` 안에 `selected = watering_slots;`를 적는다.
시각 변경도 재컴파일 없는 live event다. 새로 추가한 과거 시각은 실행하지 않으며,
이미 시작한 운전은 슬롯 삭제만으로 취소하지 않는다.

**왜 조절할 값을 미리 표시하나요?** 운영자가 바꿔도 되는 범위와 프로그램 규칙 자체를 바꾸는 경계를 언어가 명확히 정하기 위해서다.

**문법 근거**

- `config`, `Duration`, `min`, `max`, `step`, `access`, `label`: [Reference §5.1 config 선언](reference/05-settings-and-observation.md#51-config-선언)
- 소스 기본값과 운영 유효값: [Reference §5.1 기본값과 유효값](reference/05-settings-and-observation.md#기본값과-유효값)
- 재컴파일·재시작 없는 변경: [Reference §5.2 atomic live event](reference/05-settings-and-observation.md#atomic-live-event)
- 일반 설정의 재시작 후 보존: [Reference §5.2 생명주기와 임시 설정](reference/05-settings-and-observation.md#생명주기와-임시-설정)
- `elapsed`와 기존 경과 시간: [Reference §3.2 상태 변경 뒤의 경과 시간](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간)
- 예약 시각 `selected`: [Reference §3.6 선택된 DailySlots](reference/03-time-and-schedules.md#36-선택된-dailyslots)


<a id="q25"></a>
## 25. 설정 입력창의 라벨과 UI 컴포넌트를 바꿀 수 있나요?

라벨은 언어의 `label`로 지정한다. UI 컴포넌트는 화면을 만드는 renderer에서 선택한다.
다음 **단편**은 [24번](#q24)의 설정 이름을 “세척 시간”으로 표시한다.

```ghost
config duration: Duration = 5min {
  min = 1min;
  max = 20min;
  step = 1min;
  access = operator;
  label = "세척 시간";
}
```

이 선언을 사용하는 화면은 다음 중 적절한 입력 방식을 선택할 수 있다.

| 화면의 입력 방식 | 지켜야 하는 설정 의미 |
|---|---|
| 시간 입력창 | Duration 값으로 읽고 1–20분 범위와 1분 단위를 검사 |
| 선택 목록 | 1분부터 20분까지 허용값을 선택 |
| 슬라이더 | 같은 범위와 증분을 적용 |

컴포넌트를 바꿔도 값의 타입·범위·증분·변경 권한은 그대로 적용한다.
`label`은 사람이 읽는 이름이며 설정 ID나 권한을 바꾸지 않는다.

GhostFlow에서 `widget = slider`처럼 특정 컴포넌트를 지정하는 문법은 두지 않는다.
그 선택은 renderer의 책임이다. 여기서 화면이 선택할 수 있다는 말은
운영자가 컴포넌트 종류를 직접 바꾸는 메뉴까지 언어가 제공한다는 뜻은 아니다.

**왜 화면 모양은 언어 밖에서 정하나요?** 같은 “세척 시간” 설정을 휴대폰과 장치 화면에서
각각 적합한 방식으로 편집하면서도 제어 의미와 검증 규칙은 같게 유지하기 위해서다.

**문법 근거**

- `config`, `label`, `min`, `max`, `step`, `access`: [Reference §5.1 config 선언](reference/05-settings-and-observation.md#51-config-선언)
- UI 모양과 언어 의미의 분리: [Reference §5.3 renderer 독립 관찰 모델](reference/05-settings-and-observation.md#53-renderer-독립-관찰-모델)
- 설정 ID·타입·권한을 전달하는 설명: [Reference §5.3 descriptor와 snapshot](reference/05-settings-and-observation.md#descriptor와-snapshot)


<a id="q26"></a>
## 26. 설정값의 변경 가능 범위를 제한할 수 있나요?

가능하다. `min`과 `max`로 양 끝을 포함하는 허용 범위를 정하고, `step`으로 변경 단위를 정한다.
다음 **단편**은 작동 시간을 1분부터 20분까지, 1분 단위로만 바꾸게 한다.

```ghost
config duration: Duration = 5min {
  min = 1min;
  max = 20min;
  step = 1min;
  access = operator;
  label = "작동 시간";
}
```

| 입력값 | 결과 |
|---|---|
| 1분, 5분, 20분 | 허용 |
| 30초, 21분 | 범위 밖이므로 거부 |
| 1분 30초 | 범위 안이지만 1분 단위에 맞지 않아 거부 |

`step`은 `min`에서 시작하는 격자다. 예를 들어 최소 1분, 증분 2분이면
1분·3분·5분처럼 허용한다. 기본값도 범위와 격자를 만족해야 한다.
단위와 타입이 다른 값도 거부하며, 값을 자동으로 반올림하거나 경계값으로 바꾸지 않는다.

검증 규칙은 슬라이더의 표시 범위에만 있는 것이 아니다. 다른 입력창이나 설정 요청에서도
같은 규칙을 지킨다. 여러 설정을 한 번에 변경할 때 하나라도 잘못되면 전부 적용하지 않는다.
운영자의 변경 자체를 허용하지 않으려면 `access = designer`로 선언한다.

**왜 범위를 언어에 적나요?** 어느 화면이나 요청 경로를 사용하더라도 작성자가 허용한 값만 제어에 사용하도록 하기 위해서다.

**문법 근거**

- `min`, `max`, `step`, 기본값 검증과 `access`: [Reference §5.1 config 선언](reference/05-settings-and-observation.md#51-config-선언)
- 여러 설정의 전체 승인 또는 전체 거부: [Reference §5.2 atomic live event](reference/05-settings-and-observation.md#atomic-live-event)

<a id="q27"></a>
## 27. 요일별로 다른 설정을 할 수 있나요?

가능하다. 요일별 값을 각각 `config`로 선언하고 조건식으로 사용할 값을 선택한다.
예를 들어 평일에는 5분, 주말에는 10분 운전하도록 설정할 수 있다.
두 설정은 각각 라벨과 변경 범위를 가질 수 있다.

다음은 **설정 선택 단편**이다. `is_weekday`는 지정한 현장 시간대에서 월요일부터 금요일이면
참인 입력이다. `calendar_valid`는 그 날짜 판단이 유효하다는 입력이다.
두 입력은 자동으로 생기는 내장 변수가 아니다. 생산자가 현장 날짜와 유효성을 공급한다.
예약 자체를 요일별로 제한할 때는 Reference §3.8의 `on = day` 필터를 쓴다.

```ghost
input is_weekday, calendar_valid: Bool;
config weekday_duration: Duration = 5min {
  min = 1min;
  max = 20min;
  step = 1min;
  access = operator;
  label = "평일 작동 시간";
}
config weekend_duration: Duration = 10min {
  min = 1min;
  max = 20min;
  step = 1min;
  access = operator;
  label = "주말 작동 시간";
}
let duration = if is_weekday then weekday_duration else weekend_duration;
let can_start = calendar_valid;
```

시작 조건에 `can_start`를 함께 검사하고, 운전 시간 비교에 `duration`을 사용한다.
날짜를 알 수 없다는 이유로 주말 설정을 선택하여 새 운전을 시작하지 않는다.
이 단편만으로 장치가 작동하지 않으며 시작·정지·출력은 운전 규칙에 연결해야 한다.

월요일부터 일요일까지 각각 다르게 하려면 같은 방식으로 7개의 설정을 두고,
요일을 나타내는 enum 입력과 빠짐없는 `case` 분기로 선택할 수 있다.
공휴일과 현장 근무일은 요일과 별개의 조건이다.

운전 중에도 위 `duration` 식을 계속 읽으면 요일이나 설정값이 바뀔 때 새 값으로 판단한다.
“시작한 요일의 시간으로 이번 운전을 끝낸다”가 목적이면 시작 시 선택한 값을 상태에 기억한다.
자정을 넘긴 작업의 정책을 요일별 설정이 자동으로 정하지는 않는다.

**왜 설정과 선택 조건을 나누나요?** 운영자는 요일별 시간만 바꾸고, 어떤 요일에 어떤 값을 쓰는지는 작성된 제어 규칙으로 유지하기 위해서다.

**문법 근거**

- 요일별 `config`, 라벨·범위·권한: [Reference §5.1 config 선언](reference/05-settings-and-observation.md#51-config-선언)
- `let`과 `if ... then ... else`: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)
- 7개 요일의 enum과 `case`: [Reference §2.4 enum과 빠짐없는 분기](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- 시작 시 값 기억: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- 요일·공휴일·근무일과 날짜 경계: [Reference §3.8 DST, 자정과 work calendar](reference/03-time-and-schedules.md#38-dst-자정과-work-calendar)
- 실행 중 설정 변경: [Reference §5.2 atomic live event](reference/05-settings-and-observation.md#atomic-live-event)

<a id="q28"></a>
## 28. 공휴일에만 제어 로직을 다르게 할 수 있나요?

가능하다. 공휴일 여부를 조건으로 서로 다른 제어식을 선택한다.
시간이나 설정값만 다르게 하는 것뿐 아니라 작동 조건이나 순서를 다르게 작성할 수 있다.

다음 예는 일반 날짜에는 사람이 있거나 온도가 높으면 환기하고,
공휴일에는 온도가 높을 때만 환기한다.
`is_holiday`는 현장 시간대와 선택한 공휴일 달력으로 판단한 입력이다.
`calendar_valid`는 해당 날짜의 공휴일 판단이 유효하다는 입력이다.
두 이름은 내장 변수가 아니며, 공휴일 조회를 이 코드가 수행하는 것은 아니다.

```ghost
control HolidayVentilation {
  input is_holiday, calendar_valid: Bool;
  input occupied, hot, stop: Bool;
  output fan: Bool;

  let normal_request = occupied || hot;
  let holiday_request = hot;
  let request = if is_holiday then holiday_request else normal_request;
  fan <- calendar_valid && !stop && request;
}
```

이 예에서 `stop`은 두 분기에 공통으로 적용한다.
달력 판단이 유효하지 않으면 환기 출력을 끄는 정책을 명시했다.
고온 보호처럼 별도 필수 동작이 있는 설비라면 달력을 모를 때의 규칙도 그 요구에 맞게 작성해야 한다.
알 수 없는 날짜를 임의로 일반 날짜나 공휴일로 처리하지 않는다.

공휴일은 토요일·일요일과 같은 뜻이 아니다. 적용할 지역, 대체공휴일 포함 여부와
달력의 유효 기간을 정해야 한다. 현장이 쉬는 날을 뜻한다면 공휴일 대신 현장 근무 달력을 사용한다.
예약에 공휴일 필터를 붙일 때는 ``on = day`holiday`;``와 `calendar = holidays;`를 쓴다.
`calendar holidays: HolidayCalendar;`로 논리 달력 공급자를 선언한다.
이 선언이 위 예제의 `is_holiday` Bool 입력을 자동으로 만드는 것은 아니다.

위 예는 매 판단에서 현재 날짜의 분기를 선택한다. 진행 중인 순차 작업을 날짜 변경과 함께
다른 순서로 바꾸려는 예는 아니다. 시작한 작업의 순서를 유지하려면 시작 시 선택한 분기를
상태에 기억하고, 새 작업부터 새로운 날짜의 규칙을 선택한다.

**왜 공휴일 판단과 제어식을 나누나요?** 지역별 달력은 달라도 공휴일에 어떤 동작을 할지는
프로그램에서 명시적으로 읽고 설명할 수 있어야 하기 때문이다.

**문법 근거**

- `let`, `if ... then ... else`, `||`, `&&`, `!`: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)
- `input`, `output`, `<-`: [Reference §1.4 문법 표기법](reference/01-source-and-syntax.md#14-문법-표기법)
- 공휴일·현장 근무일과 달력 유효 범위: [Reference §3.8 DST, 자정과 work calendar](reference/03-time-and-schedules.md#38-dst-자정과-work-calendar)
- 작업 시작 시 분기 기억: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)

<a id="q29"></a>
## 29. 서머타임도 제어에 적용할 수 있나요?

가능하다. **지역 시각으로 정하는 예약**에는 IANA 시간대를 지정하고,
서머타임 전환으로 시각이 사라지거나 반복될 때의 정책을 명시한다.
**얼마 동안 운전할지**는 단조 경과 시간으로 판단하므로 서머타임 때문에 길어지거나 짧아지지 않는다.

다음은 시간대를 지정하는 예약 선언 **단편**이다.

```ghost
schedule starts: DailySlots<15min> {
  timezone = "America/New_York";
  selected = [06:00];
  dst_missing = skip;
  dst_repeated = first;
  basis = pulse;
  when = true;
  clock = trusted_only;
  gap = skip_after(60s);
  recovery = baseline;
  fallback = skip;
}
```

이 예약의 기준은 뉴욕의 지역 시각 오전 6시다. 고정된 UTC 오프셋을 직접 더하는 방식과 다르다.
위 선언은 없는 시각을 건너뛰고 반복된 시각은 첫 번째를 선택하는 예다.
Reference §3.8에 정의된 전환 정책은 다음과 같다.

| 전환 상황 | 정책 | 의미 |
|---|---|---|
| 시계가 앞으로 이동하여 예약 시각이 존재하지 않음 | `skip` | 해당 예약을 건너뜀 |
| 같은 상황 | `next_valid` | 다음 유효한 시각으로 처리 |
| 시계가 뒤로 이동하여 예약 시각이 두 번 나타남 | `first` | 첫 번째만 선택 |
| 같은 상황 | `second` | 두 번째만 선택 |
| 같은 상황 | `both` | 두 시각을 각각 별개의 예약 발생으로 선택 |
| 같은 상황 | `skip` | 해당 예약을 건너뜀 |

정책은 `dst_missing = skip;`와 `dst_repeated = first;`처럼 일정 안에 명시한다.
실제 선택은 현장의 운전 의도에 맞춰 정한다.
`both`를 선택한 경우 두 발생은 서로 다른 식별자를 가진다.
실제로 각각 운전을 시작할지는 운전 중 요청 처리 등 제어 규칙에 달려 있다.
단순 시계 보정으로 같은 예약이 다시 관측된 것을 새로운 예약으로 세지는 않는다.

예약으로 시작한 뒤의 운전 길이는 [7번](#q07)처럼 작성한다.
`timer age = elapsed(running)`과 `age < duration`을 사용하면
운전 도중 지역 시계가 바뀌어도 같은 단조 경과 시간을 비교한다.
날짜나 DST 구간이 바뀌었다는 이유만으로 이미 시작한 운전을 취소하지 않는다.

**왜 두 종류의 시간을 나누나요?** “현지 시각 오전 6시”는 생활 시간표를 뜻하고,
“펌프를 5분 동안 켠다”는 실제 지속 시간을 뜻하기 때문이다.

**문법 근거**

- 시간대와 달력 시각·단조 시간의 구분: [Reference §3.1 시간값과 시계 영역](reference/03-time-and-schedules.md#31-시간값과-시계-영역)
- `DailySlots`, `timezone`, `selected`: [Reference §3.6 선택된 DailySlots](reference/03-time-and-schedules.md#36-선택된-dailyslots)
- 사라진 시각·반복 시각의 정책: [Reference §3.8 DST, 자정과 work calendar](reference/03-time-and-schedules.md#38-dst-자정과-work-calendar)
- 예약 발생 식별과 중복 억제: [Reference §3.5 occurrence identity와 중복 억제](reference/03-time-and-schedules.md#occurrence-identity와-중복-억제)
- `elapsed(running)`: [Reference §3.2 상태 변경 뒤의 경과 시간](reference/03-time-and-schedules.md#32-상태-변경-뒤의-경과-시간)

<a id="q30"></a>
## 30. 만조·간조를 기준으로 제어할 수 있나요?

가능하다. 예측된 만조·간조 시각을 예약 발생 기준으로 삼고,
그 전후의 시간 차이와 운전 길이를 따로 정한다.
다음 두 요구는 서로 다른 기준 시각과 운전 길이를 가진다.

```text
만조 30분 전 → 운전 시작 → 10분 운전
간조 20분 후 → 운전 시작 → 5분 운전
```

첫 번째 예는 `Tide` 일정에서 다음과 같이 쓴다. 선언한 예측 공급자와 공통 정책은 생략한 단편이다.

```ghost
at = tide`high - 30min`;
basis = run(10min, on_time);
```

예약은 예측 시각으로 시작 여부를 판단하고, 시작한 뒤의 운전 길이는 단조 시간으로 잰다.
조석 기준 장소의 관측소 또는 예측 모델, 예측 판본, 적용 기간과 만료 시각을 명시해야 한다.
달의 위상만으로 현장의 만조·간조 시각을 추정하거나 하루 발생 횟수를 고정하지 않는다.

- **만조·간조:** 특정 예측 시각이다. “30분 전”, “20분 후” 같은 기준점을 만들 수 있다.
- **사리·조금:** 조차의 분류 상태나 기간이다. 예약 허용 조건으로 쓰며 “사리 30분 전”처럼 취급하지 않는다.
- **실제 수위:** 예측 시각과 별개의 센서 조건이다. 실제 수위 확인이 필요한 제어에는 따로 연결한다.

예측이 없거나 오래된 경우에는 명시한 fallback을 따른다. 최소 정책인 `skip`은 새 운전을 건너뛴다.
예측이 수정되어도 같은 조석 사건을 중복 실행하지 않는다.
이미 시작한 운전을 예측 수정이나 철회만으로 자동 취소하지 않으며,
자료가 회복됐다고 지나간 예약을 뒤늦게 실행하지 않는다.
이 규칙은 인터넷 연결 자체보다 사용할 예측 자료와 시각의 유효성을 기준으로 한다.

**왜 예측 시각과 운전 길이를 나누나요?** 조석 예측이 갱신되어도 이미 시작한 작업의
지속 시간을 임의로 바꾸지 않고, 어느 조석 사건 때문에 시작했는지 구분하기 위해서다.

**문법 근거**

- 만조·간조 occurrence, offset, 사리·조금과 예측 수정: [Reference §3.9 달과 조석](reference/03-time-and-schedules.md#달과-조석)
- 예측 불명·만료와 fallback: [Reference §3.9 자연 기준의 fallback과 회복](reference/03-time-and-schedules.md#자연-기준의-fallback과-회복)
- 예약 시작과 `Run` 지속 시간: [Reference §3.5 Pulse, Window, Run](reference/03-time-and-schedules.md#pulse-window-run)
- 달력 시각과 단조 경과 시간: [Reference §3.1 시간값과 시계 영역](reference/03-time-and-schedules.md#31-시간값과-시계-영역)

<a id="q31"></a>
## 31. 사리·조금이나 달의 위상을 기준으로 제어할 수 있나요?

가능하다. 사리·조금은 **조차의 분류 상태 또는 기간**으로,
달의 위상은 그와 별개의 조건으로 다룬다. 조건을 만족할 때 예약을 허용하거나
다른 제어 규칙을 선택할 수 있다. 예약 조건에는 `tide_is` 또는 `moon_is`를 쓴다.

| 원하는 동작의 예 | 조건의 역할 |
|---|---|
| 조금 기간에만 오전 6시 운전 | 조금 여부로 시각 예약의 시작 허용 |
| 사리 기간에는 운전 시간을 짧게 선택 | 사리 여부로 사용할 설정값 선택 |
| 정해 둔 달 위상 조건을 만족할 때만 예약 허용 | 달 위상 판정으로 시작 허용 |

Reference의 다음 단편은 선언한 `TidePredictions` 공급자를 예약의 허용 조건에 연결한다.

```ghost
when = tide_is(harbor_tides, tide`neap`);
```

조건을 입력으로 받은 뒤 제어식에 연결하는 **단편**은 다음처럼 작성할 수 있다.
`is_neap`은 현장 조석 자료의 조금 판정, `tide_valid`는 그 판정의 유효성,
`schedule_due`는 별도 예약의 이번 시작 사건을 뜻한다. 이들은 내장 변수가 아니며
조석을 계산하거나 자료를 조회하는 선언도 아니다.

```ghost
input is_neap, tide_valid, schedule_due: Bool;
let start_allowed = tide_valid && is_neap && schedule_due;
```

운전 상태가 대기 중일 때 `start_allowed`를 시작 조건으로 사용한다.
운전 출력에 이 한 번의 예약 사건을 직접 연결하면 지속 운전이 되지 않는다.
시작한 뒤의 운전 시간은 [7번](#q07)처럼 상태와 타이머로 유지한다.
시작 허용 조건으로만 사용했다면 조금 기간이 끝났다는 이유로 진행 중인 작업을 자동 취소하지 않는다.

사리·조금은 특정 시각이 아니므로 “사리 30분 전” 같은 시간 오프셋을 붙이지 않는다.
“만조 30분 전”처럼 정확한 시작점을 원하면 [30번의 만조·간조 사건](#q30)을 사용한다.
달 위상만으로 현장의 사리·조금 판정이나 만조 시각을 대신하지 않는다.
사리·조금의 분류 기준과 달 위상 조건의 판정 범위는 사용 자료의 계약에서 명확히 해야 한다.
자료가 없거나 만료되었으면 정상 조건으로 간주하지 않고 명시한 fallback을 따른다.
위 단편은 유효하지 않을 때 새 운전을 허용하지 않는 예다.

**왜 사건과 상태 조건을 구분하나요?** “언제 시작하는가”와 “어떤 기간에 시작을 허용하는가”를
분리해야 같은 기간 동안 매 판단마다 새 운전을 요청하는 혼동을 피할 수 있기 때문이다.

**문법 근거**

- 사리·조금의 분류 의미와 달 위상의 구분: [Reference §3.9 달과 조석](reference/03-time-and-schedules.md#달과-조석)
- 확정된 typed 표기와 외부 자료 경계: [Reference §3.11 확정된 시간 문법과 경계](reference/03-time-and-schedules.md#311-확정된-시간-문법과-경계)
- 자료 불명·만료와 fallback: [Reference §3.9 자연 기준의 fallback과 회복](reference/03-time-and-schedules.md#자연-기준의-fallback과-회복)
- 예약 발생과 시작 허용 조건: [Reference §3.5 Schedule의 공통 의미](reference/03-time-and-schedules.md#35-schedule의-공통-의미)
- `input`, `Bool`: [Reference §1.4 문법 표기법](reference/01-source-and-syntax.md#14-문법-표기법)
- `let`, `&&`: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)

<a id="q32"></a>
## 32. 정전 후 다시 켜졌을 때의 동작을 코딩할 수 있나요?

가능하다. 시작 상태와 이후 전이 조건을 명시하여 재시작 후의 동작을 작성한다.
예를 들어 정지 상태로 기다리기, 준비 확인 후 운전하기, 원위치 복귀 단계를 먼저 수행하기 등을
상태와 입력 조건으로 표현할 수 있다. 내장 `on_power_restore` 같은 문법을 가정하지 않는다.

다음 예는 **이전 운전 상태를 복원하지 않고 선언 초기값으로 시작하는 정책**이다.
전원이 돌아온 뒤 준비 확인을 받고, 시작 버튼을 놓았다가 새로 눌러야 운전한다.
`ready`는 센서와 장치가 새 운전을 시작할 준비가 되었음을 확인하는 입력이다.

```ghost
control RestartAndWait {
  input ready, start, stop: Bool;
  output pump: Bool;
  state armed: Bool = false;
  state running: Bool = false;

  let start_event = armed && start;
  armed' = ready && !stop && !start;
  running' = ready && !stop && (running || start_event);
  pump <- running';
}
```

- 시작 시 `running`과 `armed`는 거짓이다. 시작 버튼이 눌린 채 부팅되어도 자동 운전하지 않는다.
- `ready`가 참이고 정지·시작 버튼이 모두 해제된 판단을 거친 뒤 새 시작 요청을 받는다.
- 운전 중 `ready`가 거짓이 되거나 `stop`이 참이면 운전을 해제한다. 다시 준비되어도 새 시작 요청이 필요하다.

복귀나 점검 같은 여러 단계가 필요하면 초기 enum 상태를 준비 단계로 두고,
[19번](#q19)처럼 장치 피드백에 따라 다음 단계로 이동한다.
이 규칙은 GhostFlow가 판단을 시작한 이후의 출력 의도다.
전원 투입부터 첫 판단 전까지의 실제 핀·릴레이 상태는 Driver의 부팅 정책이 정한다.

**정전 전 작업을 이어 하는 것은 별도 정책이다.** 일반 운영 설정은 재시작 뒤에도 보존하지만,
그 사실만으로 운전 단계나 타이머까지 자동 복원되는 것은 아니다.
이어 하려면 어떤 상태와 시간을 보존할지, 정전 시간을 운전 시간에 포함할지,
현재 장치 위치와 센서가 복원된 상태에 맞는지 등을 명시해야 한다.
위 예는 그런 checkpoint 복원을 수행하지 않는다.

센서는 재부팅 뒤 기본적으로 `NotReady`부터 다시 준비한다.
오래된 정상값을 준비 확인으로 간주하지 않는다.
또한 초기 상태만으로 정전 복귀와 일반 재시작의 원인을 구별할 수는 없다.
정전 복귀에만 다른 동작을 원한다면 재시작 원인을 별도 입력으로 제공하는 계약이 필요하다.

**왜 재시작 정책을 명시하나요?** 설정값 보존, 작업 상태 복원, 물리 장치의 현재 상태는
서로 다른 사실이므로 전원이 돌아왔다는 이유만으로 이전 운전을 재개해서는 의도를 설명할 수 없기 때문이다.

**문법 근거**

- `state` 초기값, 이전 상태와 다음 상태, 출력 의도: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)
- `let`, `&&`, `||`, `!`: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)
- 준비·복귀 단계의 enum과 `case`: [Reference §2.4 enum과 빠짐없는 분기](reference/02-types-expressions-state.md#24-enum과-빠짐없는-분기)
- 센서 재부팅과 명시적 복원: [Reference §4.2 샘플 계약과 sensor 처리 순서](reference/04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서)
- 설정 보존, 새 실행과 부팅 출력의 경계: [Reference §5.2 생명주기와 임시 설정](reference/05-settings-and-observation.md#생명주기와-임시-설정)

<a id="q33"></a>
## 33. 온도 센서를 바꿔도 제어 코드를 수정하지 않아도 되나요?

**같은 논리 입력 계약을 유지한다면 제어 코드를 그대로 사용할 수 있다.**
프로그램은 센서 모델명이나 핀 번호 대신 “온실 온도” 같은 논리 역할을 읽는다.
어느 실제 센서가 그 값을 공급하는지는 설치 binding으로 연결한다.

다음은 섭씨로 정규화된 온도 값을 읽는 예다.
`temperature`의 `Number` 값이 섭씨라는 것은 이 예의 입력 계약이다.
`Number` 자체가 온도 단위를 검사해 주는 것은 아니며, 전용 물리량 표기는 Reference §2.9의 설계 범위다.

```ghost
control TemperatureMonitor {
  sensor temperature: Number;
  output high_temperature, sensor_fault: Bool;

  high_temperature <- case temperature {
    ok(value) => value >= 30.0;
    fault(_) => false;
  };
  sensor_fault <- case temperature {
    ok(_) => false;
    fault(_) => true;
  };
}
```

센서 A에서 센서 B로 교체해도 같은 위치의 온도를 같은 계약으로 공급하면 위 판단식은 그대로다.
센서 오류는 정상 온도 0으로 바꾸지 않고 별도의 오류 출력으로 구분했다.

| 교체로 달라지는 부분 | 처리할 위치 |
|---|---|
| 연결 주소·핀·물리 장치 | 설치 binding |
| 통신 방식·원시값 해석·단위 변환 | Driver 및 입력 공급 경계 |
| 논리 온도 값에 대한 30도 비교 | 입력 계약이 같으면 제어식 유지 |
| 측정 대상·단위·범위·샘플 주기·품질 보장이 달라짐 | 계약 호환성 확인 후 필요한 선언·규칙 변경 |

예를 들어 새 센서가 훨씬 느리면 기존 `stale_after` 조건을 만족하지 못할 수 있다.
둘 다 수치를 낸다는 이유만으로 호환된다고 판단하지 않는다.
교체 센서의 새 샘플과 품질을 확인해야 하며, 이전 센서의 마지막 정상값을 새 센서의 측정으로 취급하지 않는다.

제어 소스 유지가 자동 장치 인식이나 Driver 무변경까지 보장하는 것은 아니다.
새 센서의 통신을 처리할 수 있어야 하며, 실제 연결과 새 binding을 검증해야 한다.
교체 중 입력이 끊기면 기존 프로그램에 작성된 sensor fault 처리 규칙을 따른다.

**왜 논리 역할과 실제 센서를 나누나요?** “온도가 높으면 알린다”는 제어 의도를
특정 제조사·통신 방식·배선에 묶지 않고 재사용하기 위해서다.

**문법 근거**

- `sensor`, `ok(value)`, `fault(_)`: [Reference §4.1 sensor와 Result 품질](reference/04-sensors-constraints-control.md#41-sensor와-result-품질)
- 단위·샘플·품질·복구 계약: [Reference §4.2 샘플 계약과 sensor 처리 순서](reference/04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서)
- `Number`와 전용 물리량의 구분: [Reference §2.1 값 종류](reference/02-types-expressions-state.md#21-값-종류), [§2.9 물리량과 단위](reference/02-types-expressions-state.md#29-물리량과-단위)
- `>=` 비교: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)
- 논리 입력과 설치 연결의 분리: [Reference §6.3 parameters, settings, dependencies와 bindings](reference/06-composition-and-replay.md#63-parameters-settings-dependencies와-bindings)

<a id="q34"></a>
## 34. 센서 설정과 GhostFlow 소스는 분리되나요? 변경 주기도 다른가요?

**물리 센서 연결 정보는 제어 소스와 분리되며 별도의 변경 이력을 가진다.**
다만 “센서 설정” 전체가 외부에 있는 것은 아니다.
센서 값을 제어에서 어떻게 받아들일지 정하는 선언과 규칙은 GhostFlow 소스에 속한다.
여기서 제어 소스의 정본은 하나의 `.ghost.md` 문서다.

| 구분 | 포함하는 내용 | 변경 시 달라지는 것 |
|---|---|---|
| GhostFlow 소스 | 논리 센서 선언·타입, `sample`, `valid`, `filter`, `stale_after`, `recover_after`, 오류 처리와 제어식 | source revision, 실행 규칙 변경 시 새 Program 후보 |
| 설치 profile·binding | 논리 센서와 실제 장치·포트·주소의 연결, 제공 capability | installation/profile/binding revision과 호환성 검증 |
| 운영 설정 | 소스가 `config`로 공개한 값의 override | 같은 Program/run에서 settings revision |

예를 들어 [33번](#q33)의 논리 선언은 소스에 남는다.

```ghost
sensor temperature: Number;
```

센서 A를 B로 바꾸는 것은 다음 연결을 바꾸는 일이다. 아래는 파일 형식이나 실행 문법이 아닌 설명이다.

```text
논리 센서 temperature → 설치 binding → 실제 센서 A
논리 센서 temperature → 새 binding   → 실제 센서 B
```

B가 같은 입력 계약을 만족하면 제어 소스는 그대로 둘 수 있다.
반면 “3초 동안 새 측정이 없으면 오류”를 “10초”로 고치는 것처럼
소스의 `stale_after` 선언을 바꾸면 제어 계약 자체가 바뀌므로 소스 변경이다.
그 필드가 센서와 관련 있다는 이유로 자동으로 live 운영 설정이 되지는 않는다.

운영자가 공개된 작동 시간을 5분에서 10분으로 바꾸는 것은 또 다른 변경이다.
소스와 Program은 유지하고 설정값만 같은 실행에 적용한다.
이 운영 설정 변경 경로로 물리 binding이나 센서 의존성을 바꾸지는 않는다.

따라서 **변경 주기와 판본은 분리하지만, 반드시 두 파일이라는 저장 형식을 정한 것은 아니다.**
설치 정보의 파일·DB 등 저장 형태는 언어의 `.ghost.md` 소스 계약과 별개다.
소스와 binding이 따로 변경되어도 함께 사용할 때는 입력 계약의 호환성을 확인해야 한다.
물리 연결 변경을 일반 설정값 변경처럼 운전 중 즉시 적용할 수 있다고 해석하지 않는다.
구조 변경의 적용 절차와 revision 경계는 설치 계약에서 정한다.

**왜 생명주기를 나누나요?** 센서를 교체하는 일, 제어 규칙을 바꾸는 일,
운전 시간을 조절하는 일이 서로 다른 검증과 변경 이력을 필요로 하기 때문이다.

**문법 근거**

- 정본 `.ghost.md` 문서: [Reference §1.1 왜 문서 하나가 소스인가](reference/01-source-and-syntax.md#11-왜-문서-하나가-소스인가)
- `sensor` 선언: [Reference §4.1 sensor와 Result 품질](reference/04-sensors-constraints-control.md#41-sensor와-result-품질)
- 소스에 선언하는 샘플·필터·유효성 규칙: [Reference §4.2 샘플 계약과 sensor 처리 순서](reference/04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서)
- 논리 역할과 물리 endpoint: [Reference §6.2 definition, instance와 논리 port](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)
- 각 변경의 별도 생명주기: [Reference §6.3 parameters, settings, dependencies와 bindings](reference/06-composition-and-replay.md#63-parameters-settings-dependencies와-bindings)
- 소스 변경과 live 설정 변경: [Reference §5.2 소스 변경과 운영 설정 변경](reference/05-settings-and-observation.md#52-소스-변경과-운영-설정-변경)
- 구조 변경과 설정 변경의 적용 경계: [Reference §4.10 mode와 live settings](reference/04-sensors-constraints-control.md#410-mode와-live-settings)

<a id="q35"></a>
## 35. 프린터 Driver만 바꾸듯 센서를 교체해도 제어 프로그램을 재컴파일하지 않아도 되나요?

맞다. **새 센서가 기존 논리 입력 계약을 만족하면 GhostFlow 제어 프로그램을 재컴파일하지 않는다.**
Word가 프린터마다 다시 컴파일되는 대신 공통 인쇄 인터페이스를 사용하는 것과 같은 분리다.
센서별 통신과 데이터 해석은 Driver가 맡고, 설치 binding이 사용할 센서를 연결한다.

| 비유 | GhostFlow에서의 역할 |
|---|---|
| Word 문서와 인쇄 요청 | `.ghost.md`의 제어 규칙과 논리 입력·출력 |
| 공통 인쇄 인터페이스 | 타입·단위·품질 등을 정한 논리 장치 계약 |
| 프린터 선택 | 설치 binding에서 실제 장치 선택 |
| 프린터 Driver | 장치별 통신·원시값 해석을 담당하는 Driver |

예를 들어 아래 **단편**은 온도를 공급하는 제조사나 통신 방식을 지정하지 않는다.

```ghost
sensor temperature: Number;
```

설치 계약이 이 값을 섭씨 온도로 정의했다면 새 Driver도 같은 의미의 값과 품질 정보를 공급한다.
`Number`라는 타입만 같다고 단위나 샘플 주기까지 호환되는 것은 아니다.
같은 계약을 만족하는 교체라면 기존 소스와 컴파일된 Program을 유지하고 설치 연결만 갱신한다.

Driver를 추가하거나 바꾸는 방법은 실행 환경의 책임이다.
이 분리가 MCU에서도 Driver를 동적으로 설치할 수 있다는 뜻은 아니다.
장치 지원을 위해 펌웨어 변경이 필요한지와 GhostFlow 제어 프로그램의 재컴파일이 필요한지는
서로 다른 판단이다.

**왜 이렇게 분리하나요?** 장치별 차이를 Driver에서 처리하면 제어 의도를 특정 하드웨어에
묶지 않고 같은 프로그램을 다른 설치에서도 사용할 수 있기 때문이다.

**문법 근거**

- `sensor`와 정상값·오류 계약: [Reference §4.1 sensor와 Result 품질](reference/04-sensors-constraints-control.md#41-sensor와-result-품질)
- Driver가 제공하는 샘플·품질 정보: [Reference §4.2 샘플 계약과 sensor 처리 순서](reference/04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서)
- 논리 port와 물리 endpoint의 분리: [Reference §6.2 definition, instance와 논리 port](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)
- 소스와 별도로 변경하는 binding: [Reference §6.3 parameters, settings, dependencies와 bindings](reference/06-composition-and-replay.md#63-parameters-settings-dependencies와-bindings)
- 호환 교체 시 소스·Program 유지: [Reference §6.3 호환 장치 교체와 재컴파일 독립성](reference/06-composition-and-replay.md#호환-장치-교체와-재컴파일-독립성)

<a id="q36"></a>
## 36. 장치 교체와 재컴파일 분리 원칙은 language spec에도 있어야 하나요?

그렇다. 사용 예제뿐 아니라 언어와 장치 경계의 규칙으로 명시해야 한다.
규칙은 **“같은 논리 장치 계약을 만족하는 장치 또는 Driver 교체는 제어 소스 수정이나
Program 재컴파일을 요구하지 않는다”**이다.

언어 계약의 [§12.1](LANGUAGE.md#121-호환-장치-교체는-제어-프로그램-교체가-아니다)과
Reference §6.3에 이 원칙을 둔다. FAQ는 [35번](#q35)의 비유와 예제로 설명한다.
새 문법을 추가하는 것이 아니라 논리 port, Driver와 binding의 책임 및 변경 경계를 정의한다.

**왜:** 이 원칙이 FAQ에만 있으면 장치 교체마다 프로그램을 재생성해도 되는지 판단할 기준이 없기 때문이다.

**문법 근거**

- 논리 장치 계약과 물리 연결: [Reference §6.2 definition, instance와 논리 port](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)
- 재컴파일 독립성과 호환 조건: [Reference §6.3 호환 장치 교체와 재컴파일 독립성](reference/06-composition-and-replay.md#호환-장치-교체와-재컴파일-독립성)

<a id="q37"></a>
## 37. 버튼을 다른 GPIO 핀에 연결해도 입력 매핑만 바꾸면 되나요?

그렇다. **새 핀이 같은 버튼 입력 계약을 제공하면 설치 binding만 바꾸고
제어 소스와 컴파일된 Program은 그대로 사용한다.**
프로그램은 GPIO 번호 대신 `start`라는 논리 입력을 읽는다.

```ghost
control ButtonRequest {
  input start: Bool;
  output request: Bool;
  request <- start;
}
```

위 예의 `start`는 버튼을 누르면 참, 놓으면 거짓이라는 계약이다.
다음은 변경 전후의 연결 설명이며 binding 파일의 문법은 아니다.

```text
변경 전: GPIO A → 버튼 입력 Driver → 논리 입력 start
변경 후: GPIO B → 버튼 입력 Driver → 논리 입력 start
```

버튼 배선을 B로 옮기고 `start`에 연결된 실제 입력을 B로 변경한다.
새 핀은 해당 보드에서 버튼 입력으로 사용할 수 있어야 한다.
눌렀을 때의 전기 신호가 LOW인지 HIGH인지, 필요한 풀업·풀다운 등의 물리 설정은
설치·Driver 경계에서 처리하여 프로그램에는 같은 참·거짓 의미를 제공한다.
논리 입력 이름이나 제어식을 GPIO 번호에 맞추어 바꾸지 않는다.

이 변경은 작동 시간을 바꾸는 live 운영 설정과 다르다.
새 installation/binding revision으로 관리하고 설치 계약의 적용 절차를 따른다.
프로그램을 재컴파일하지 않는다는 말이 운전 중 무중단 배선 교체까지 허용한다는 뜻은 아니다.

**왜 GPIO 번호를 소스에 넣지 않나요?** 버튼의 역할은 그대로인데 배선 위치만 바뀌었다면
제어 의도와 프로그램 판본까지 바꿀 이유가 없기 때문이다.

**문법 근거**

- `input start: Bool`, `output`, `<-`: [Reference §1.4 문법 표기법](reference/01-source-and-syntax.md#14-문법-표기법)
- 논리 port와 실제 핀의 분리: [Reference §6.2 definition, instance와 논리 port](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)
- 호환 입력 교체 시 소스·Program 유지: [Reference §6.3 호환 장치 교체와 재컴파일 독립성](reference/06-composition-and-replay.md#호환-장치-교체와-재컴파일-독립성)
- 물리 binding 변경과 live 설정 변경의 구분: [Reference §4.10 mode와 live settings](reference/04-sensors-constraints-control.md#410-mode와-live-settings)

<a id="q38"></a>
## 38. 출력 GPIO 매핑만 바꿔 다른 릴레이를 연결할 수 있나요?

그렇다. **같은 논리 출력 계약을 만족하는 릴레이라면 출력 binding을 바꾸고
제어 소스와 컴파일된 Program은 그대로 사용한다.**
프로그램은 릴레이의 GPIO 번호 대신 `pump` 같은 논리 출력을 사용한다.

```ghost
control PumpRequest {
  input run_request, stop: Bool;
  output pump: Bool;
  pump <- run_request && !stop;
}
```

`pump = true`는 펌프 운전 요청이다. GPIO의 HIGH를 직접 뜻하지 않는다.
다음은 연결 설명이며 binding 파일의 문법은 아니다.

```text
변경 전: 논리 출력 pump → 출력 Driver → GPIO A → 릴레이 A
변경 후: 논리 출력 pump → 출력 Driver → GPIO B → 릴레이 B
```

새 릴레이가 LOW에서 켜지는 방식이라면 Driver·설치 설정에서 극성을 맞춰
동일한 운전 요청을 수행하게 한다. 부팅·장애 시 실제 출력값도 그 경계에서 정한다.
논리 출력의 타입이 `Bool`이라는 사실만으로 핀의 출력 가능 여부, 전기적 구동 조건,
접점 정격·배선과 연결 부하의 호환성이 보장되지는 않는다.

이 예는 같은 펌프 역할을 담당하는 릴레이를 교체하는 경우다.
다른 부하나 다른 역할의 장치를 연결해도 기존 제어 규칙이 적합하다는 뜻은 아니다.
또한 `pump`가 참이라는 사실은 실제 릴레이 접점이나 펌프의 동작 확인이 아니다.
동작 확인이 필요한 규칙은 별도 피드백 입력을 사용한다.

출력 binding 변경은 설치 판본과 적용 절차로 관리한다.
프로그램 재컴파일이 불필요하다는 사실이 운전 중 무중단 배선 교체를 허용하지는 않는다.

**왜 논리 출력과 GPIO를 나누나요?** 제어는 “펌프를 운전한다”는 의도를 표현하고,
Driver와 설치 연결은 해당 릴레이에 필요한 전기 신호로 그 의도를 적용하기 때문이다.

**문법 근거**

- `input`, `output`, `<-`: [Reference §1.4 문법 표기법](reference/01-source-and-syntax.md#14-문법-표기법)
- `&&`, `!`: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)
- 출력 요청과 적용·물리 확인의 구분: [Reference §4.7 requested, safe, applied, confirmed](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)
- 논리 port와 물리 endpoint·극성·부하: [Reference §6.2 definition, instance와 논리 port](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)
- 호환 출력 교체 시 소스·Program 유지: [Reference §6.3 호환 장치 교체와 재컴파일 독립성](reference/06-composition-and-replay.md#호환-장치-교체와-재컴파일-독립성)
- 설치 변경의 적용 경계: [Reference §4.10 mode와 live settings](reference/04-sensors-constraints-control.md#410-mode와-live-settings)

<a id="q39"></a>
## 39. Waveshare 같은 확장 보드로 출력 수를 늘릴 수 있나요?

가능하다. **논리 출력을 직접 GPIO뿐 아니라 확장 장치의 채널에도 연결할 수 있다.**
Driver가 확장 장치의 통신과 채널 제어를 맡고, binding이 각 논리 출력을 해당 채널에 연결한다.

```ghost
control TwoRelayRequests {
  input request1, request2: Bool;
  output relay1, relay2: Bool;
  relay1 <- request1;
  relay2 <- request2;
}
```

다음은 설치 연결 설명이며 binding 파일의 문법은 아니다.

```text
relay1 → 확장 출력 Driver → 확장 보드 1번 채널
relay2 → 확장 출력 Driver → 확장 보드 2번 채널
```

예를 들어 [Waveshare Modbus RTU Relay 16CH 공식 문서](https://www.waveshare.com/wiki/Modbus_RTU_Relay_16CH)는
RS485의 Modbus 명령으로 릴레이를 제어하는 방식을 설명한다.
이 경우 GhostFlow의 출력 binding은 직접 GPIO 번호 대신 장치 주소와 릴레이 채널로 연결한다.
Waveshare라는 제조사 이름만으로 모든 보드의 통신 방식이 같다고 가정하지 않는다.

**단순 멀티플렉서와 독립 출력 확장은 구분한다.**
예를 들어 [TI CD74HC4067](https://www.ti.com/product/CD74HC4067)은 공통 신호에 연결할 채널을 선택하는 소자다.
그 자체로 여러 릴레이의 ON/OFF 상태를 각각 유지하는 출력 장치가 되지는 않는다.
독립적인 지속 출력을 원하면 각 채널의 상태를 유지할 수 있는 확장 장치·회로와 Driver 계약이 필요하다.

기존 논리 출력을 호환되는 확장 채널로 옮기는 경우에는 제어 소스 수정이나 재컴파일이 필요 없다.
다만 새 장치들을 위한 논리 출력과 제어 동작까지 추가한다면 그 부분은 프로그램 변경이다.
Driver는 필요한 채널 수·갱신 시간·출력 유지·통신 장애 시 동작을 만족해야 한다.
한 tick에서 여러 출력을 계산했다는 사실만으로 물리 릴레이가 동시에 전환되는 것은 아니다.

**왜 확장 방식은 Driver에 두나요?** 같은 제어 의도를 직접 GPIO, 확장 칩, 통신형 릴레이에
연결할 때마다 제어 코드에 버스 명령과 채널 주소를 넣지 않도록 하기 위해서다.

**문법 근거**

- 여러 `input`, `output` 선언과 `<-`: [Reference §1.4 문법 표기법](reference/01-source-and-syntax.md#14-문법-표기법)
- 확장 장치 채널을 포함하는 물리 endpoint: [Reference §6.2 definition, instance와 논리 port](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)
- 호환 binding 변경과 Program 유지: [Reference §6.3 호환 장치 교체와 재컴파일 독립성](reference/06-composition-and-replay.md#호환-장치-교체와-재컴파일-독립성)
- 논리적 확정과 실제 출력 동시성의 구분: [Reference §2.8 tick과 상태 snapshot](reference/02-types-expressions-state.md#28-tick과-상태-snapshot)

<a id="q40"></a>
## 40. RS485 I/O 확장 보드의 입력과 출력도 매핑할 수 있나요?

가능하다. **보드의 각 입력·출력 채널을 GhostFlow의 논리 port에 연결한다.**
Driver는 해당 보드의 통신 규약에 따라 입력을 읽고 출력 명령을 전달한다.
제어 소스에는 RS485 주소나 통신 명령을 넣지 않는다.

다음은 설치 매핑의 설명 예다. 실행 문법이나 통신 프레임 형식이 아니다.

```text
보드 주소 1, DI 채널 1 → 입력 Driver → 논리 입력 start
보드 주소 1, DI 채널 2 → 입력 Driver → 논리 입력 stop
논리 출력 pump → 출력 Driver → 보드 주소 1, DO 채널 3
```

이 연결을 사용하는 제어 프로그램은 직접 GPIO를 사용할 때와 같다.

```ghost
control RemoteIoRequest {
  input start, stop: Bool;
  output pump: Bool;
  pump <- start && !stop;
}
```

이 예는 시작 입력이 참인 동안 출력하는 규칙이며 자기유지 동작은 [3번](#q03)을 따른다.
주소, 채널, 통신 속도와 프레임 설정은 설치·Driver 경계에서 관리한다.
RS485 연결이라는 사실만으로 통신 명령까지 같아지는 것은 아니다.
예를 들어 Modbus RTU 보드라면 그 규약과 해당 보드의 레지스터·채널 정의를 처리해야 한다.

입력의 갱신 주기·유효성 및 통신 장애 처리는 기존 논리 입력 계약을 만족해야 한다.
위 코드의 Bool 입력 두 개가 통신 장애를 자동 감지하는 것은 아니다.
측정 입력의 정상·오류를 제어에서 구분해야 한다면 [33번](#q33)의 `sensor` 계약을 사용한다.
출력 명령 전송이나 응답도 실제 접점·설비 동작 확인과 구분한다.

기존 입력·출력을 호환되는 RS485 채널로 옮기는 경우에는 binding을 바꾸고
제어 소스와 컴파일된 Program은 유지한다. 새로운 논리 port나 제어 동작을 추가하는 것은 소스 변경이다.

**왜 통신 주소를 제어 코드 밖에 두나요?** 같은 시작·정지·펌프 규칙을
로컬 GPIO와 통신형 I/O에서 그대로 사용하기 위해서다.

**문법 근거**

- `input`, `output`, `<-`: [Reference §1.4 문법 표기법](reference/01-source-and-syntax.md#14-문법-표기법)
- `&&`, `!`: [Reference §2.6 표현식과 연산자](reference/02-types-expressions-state.md#26-표현식과-연산자)
- 통신 장치 채널과 논리 port 연결: [Reference §6.2 definition, instance와 논리 port](reference/06-composition-and-replay.md#62-definition-instance와-논리-port)
- 호환 채널 변경 시 소스·Program 유지: [Reference §6.3 호환 장치 교체와 재컴파일 독립성](reference/06-composition-and-replay.md#호환-장치-교체와-재컴파일-독립성)
- 입력의 샘플·품질·시간 계약: [Reference §4.2 샘플 계약과 sensor 처리 순서](reference/04-sensors-constraints-control.md#42-샘플-계약과-sensor-처리-순서)
- 출력 적용과 실제 동작 확인: [Reference §4.7 requested, safe, applied, confirmed](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)

<a id="q41"></a>
## 41. 컴파일러 CLI로 문서를 검사하거나 컴파일하려면?

Node.js 기반 `ghostc` CLI를 사용한다. Node.js 요구 버전은 22 이상이다.
다음 명령은 `ghostflow-language` 저장소 루트에서 실행한다.

```sh
# 산출물을 저장하지 않고 검사
npm run compile -- --check examples/scheduled-watering.ghost.md

# 컴파일하여 산출물 저장
npm run compile -- examples/scheduled-watering.ghost.md build/scheduled-watering.gfb
```

직접 실행할 때는 `node tools/ghostc.mjs` 뒤에 같은 인자를 전달한다.
입력은 설명을 포함한 완전한 `.ghost.md` 문서다. 코드 블록만 별도로 추출해 넘기지 않는다.
`--check`는 소스를 컴파일하여 검사하지만 산출물을 기록하지 않는다.
이 검사는 프로그램 실행이나 실제 센서·릴레이 동작 확인을 대신하지 않는다.

**왜 문서 전체를 넘기나요?** 실행 규칙과 작성 의도·소스 위치를 같은 정본 판본으로 처리하기 위해서다.

**문법 근거**

- 정본 `.ghost.md`와 실행 블록: [Reference §1.1 왜 문서 하나가 소스인가](reference/01-source-and-syntax.md#11-왜-문서-하나가-소스인가)
- 컴파일러·실행 환경·Driver의 책임: [Reference §8.2 계층별 책임](reference/08-language-runtime-and-device-boundaries.md#82-계층별-책임)
- CLI 인자와 실행 진입점: [ghostc CLI](../tools/ghostc.mjs), [npm 명령과 Node.js 요구 버전](../package.json)

## FAQ를 추가할 때

질문은 “이 구문이 무엇인가요?”보다 “이 동작을 어떻게 작성하나요?”로 적는다.
답에는 입력의 의미, 코드, 상태·시간의 경계 동작과 작성 이유를 포함한다.
모든 답변 끝에 **문법 근거**를 반드시 둔다. 사용한 문법을 나열하고,
각 항목에 **Reference 장·절 번호, 절 제목, 해당 절로 이동하는 직접 링크**를 붙인다.
공통 선언 외의 문법도 빠짐없이 연결하며, 사례 파일 링크는 추가 읽을거리로 제공한다.
단편과 독립 프로그램, 설계 표기를 구분한다. 새 언어 규칙을 FAQ에서 조용히 만들지 않는다.
