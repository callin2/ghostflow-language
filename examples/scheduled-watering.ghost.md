# 하루 시간표에 따른 순차 관수

이 문서는 설명과 GhostFlow 코드를 함께 담는다. control/literate 컴파일러와
manifest 호스트로 실행한다. 물리 출력이 아닌 가상 튜토리얼이다.
이 문서가 정식 실행 프로그램이며, `scheduled-watering.ghost`는 비실행 역사 증거다.

선택한 시각마다 1번 구역을 급수하고 이어서 2번 구역을 급수한다.
두 구역은 펌프 하나를 공유한다.

```ghost
// Executable with ghostc and the manifest-aware virtual host; no GPIO driver.
control ScheduledWatering {
```

## 언제 시작하는가

하루를 15분 간격의 96칸으로 나누고 원하는 시각들을 선택한다.
예제는 한국 시각 06:00, 06:15, 12:30, 18:45에 시작한다.

```ghost
  schedule starts: DailySlots<15min> {
    timezone = "Asia/Seoul";
    selected = [06:00, 06:15, 12:30, 18:45];
  }
```

## 얼마나 급수하는가

각 구역에 5분씩 급수한다. 밸브를 연 뒤 펌프를 켜기까지 2초를 둔다.
펌프를 끈 뒤에도 해당 밸브를 2초 유지하고, 구역 사이에는 모두 닫힌 상태로
2초를 둔다. 이 시간들은 실제 장치의 동작 확인을 대신하는 센서값은 아니다.

```ghost
  config water1_time: Duration = 5min;
  config water2_time: Duration = 5min;
  config valve_delay: Duration = 2s;
  config pump_stop_delay: Duration = 2s;
  config switch_delay: Duration = 2s;

  output pump, valve1, valve2: Bool;
```

## 어디까지 진행했는가

phase는 현재 단계이며 age는 이 단계에 머문 시간이다.
단계 변경을 확정하면 age는 0으로 돌아간다. 단계와 타이머 상태는 고스트 실행에서
함께 복원한다.

```ghost
  type Phase =
      Idle
    | Open1
    | Water1
    | Stop1
    | Switch
    | Open2
    | Water2
    | Stop2;

  state phase: Phase = Idle;
  timer age = elapsed(phase);
```

## 다음 단계는 무엇인가

시간표 시작 신호는 Idle에서만 받는다. 운전 중 도착한 예약은 건너뛰며 대기열을
만들지 않는다. 각 단계는 경과 시간을 확인하므로 전체 제어 루프를 막지 않는다.

```ghost
  phase' = case phase {
    Idle =>
      if starts.due then Open1 else Idle;

    Open1 =>
      if age >= valve_delay then Water1 else Open1;

    Water1 =>
      if age >= water1_time then Stop1 else Water1;

    Stop1 =>
      if age >= pump_stop_delay then Switch else Stop1;

    Switch =>
      if age >= switch_delay then Open2 else Switch;

    Open2 =>
      if age >= valve_delay then Water2 else Open2;

    Water2 =>
      if age >= water2_time then Stop2 else Water2;

    Stop2 =>
      if age >= pump_stop_delay then Idle else Stop2;
  };
```

## 실제로 무엇을 요청하는가

다음 단계에서 열어 둘 밸브와 펌프의 의도를 계산한다. 출력 정의를 코드 블록별로
실행하는 것이 아니라, 한 tick의 후보 출력을 함께 계산하고 제약을 적용한다.

```ghost
  valve1 <- phase' in {Open1, Water1, Stop1};
  valve2 <- phase' in {Open2, Water2, Stop2};
  pump   <- phase' in {Water1, Water2};

  require pump => (valve1 || valve2);
  require !(valve1 && valve2);
}
```

## 예상 진행

아래 표는 설명 자료다. 실행 코드나 프로그램 입력으로 읽지 않는다.
한 주기는 설정상 약 10분 10초이며 실제 전이에는 tick 해상도의 오차가 더해진다.

| 단계 | 시간 | 펌프 | 밸브 1 | 밸브 2 |
|---|---|---|---|---|
| Open1 | 2초 | 꺼짐 | 열림 요청 | 닫힘 요청 |
| Water1 | 5분 | 켜짐 | 열림 요청 | 닫힘 요청 |
| Stop1 | 2초 | 꺼짐 | 열림 요청 | 닫힘 요청 |
| Switch | 2초 | 꺼짐 | 닫힘 요청 | 닫힘 요청 |
| Open2 | 2초 | 꺼짐 | 닫힘 요청 | 열림 요청 |
| Water2 | 5분 | 켜짐 | 닫힘 요청 | 열림 요청 |
| Stop2 | 2초 | 꺼짐 | 닫힘 요청 | 열림 요청 |
| Idle | 다음 예약까지 | 꺼짐 | 닫힘 요청 | 닫힘 요청 |
