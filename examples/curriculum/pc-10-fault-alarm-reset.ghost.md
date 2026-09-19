# PC-10 — Fault·Alarm·Reset이 있는 순차 급수

<!-- ghostflow:anchor id=GF-INT-PC10-FAULT-ALARM-RESET-V1 kind=intent status=confirmed origin=imported -->
> 교육용 시나리오: 밸브를 열고 확인한 뒤 펌프를 운전한다. 정상 STOP은
> 비고장 정지지만, 비상정지 관측·과부하·센서 모순·피드백 상실·구동 불가·
> 이동 timeout은 원인을 붙잡아 두고 안전하게 멈춘다. 저수원은 예외적으로
> 확인된 열린 밸브에서만 펌프를 먼저 끈 후 밸브를 닫을 수 있다.

이 문서는 PC-10의 유일한 canonical literate 실행 원본이다. PC-09
[밸브·펌프 순차 급수](pc-09-sequential-water-supply.ghost.md)는 정상 순서와
피드백을, [PC-05 limit feedback](pc-05-limit-feedback.ghost.md)는 밸브 위치
관측을 각각 보존한다. 이 과는 그것들을 대체하지 않고 timeout, 고장 원인
latch, alarm, reset의 의미를 추가한다.

## 교육용 I/O와 첫 제어함의 예산

이 예제는 **첫 8DI 장치에 1:1로 배치할 수 있는 배선도나 firmware 계약이
아니다.** 독자가 제어 의미를 잃지 않도록 semantic input을 분리한 standalone
교육 인터페이스다.

```text
입력 (9 Bool)
  start_request, reset_request, stop_ok, emergency_stop_ok, overload_ok,
  source_water_ok, valve_drive_ok, open_limit, close_limit

출력 (4 Bool)
  valve_open_contactor, valve_close_contactor, pump_contactor, alarm
```

완성된 급수 제어함의 흔한 의미 예산은 기존 `START`, `STOP`, `MODE`, 탱크
하한, 탱크 상한, open limit, close limit, overload의 **8개**다. 여기에
`RESET`, E-stop 상태 관측, source-water-low가 **3개** 더 필요하고,
`valve_drive_ok`까지 분리하면 총 **12개 의미**가 된다. 이 예제의 9개 입력은
그중 PC-10의 안전 행동에 필요한 의미를 보여 준다. `MODE`와 탱크 상·하한은
PC-08/PC-07의 별도 의미이므로 여기에서 거짓으로 합치지 않는다.

실제 설치는 다음 중 하나를 선택해야 하며, 그 선택은 설치별로 아직 확정하지
않았다.

- 외부 safety-chain으로 여러 원인을 집계한다. 단, 별도 관측을 하지 않으면
  GhostFlow가 원인별 설명을 할 수 없다.
- START/MODE/RESET은 인증된 host command로 만들고, STOP과 물리 안전회로는
  배선 상태로 유지한다.
- DI를 확장해 각 원인을 그대로 관측한다.

E-stop은 에너지를 제거하는 **외부 hardwired safety chain**이며
`emergency_stop_ok`는 그 상태를 설명하기 위한 관측 입력이다. 이 GhostFlow
출력이나 alarm은 접촉기 에너지 차단을 보장하지 않는다.

## 의도와 결정된 안전 규칙

- 정상 `stop_ok == false`는 고장이 아니다. 즉시 모든 MCU motion output을 끄고
  alarm도 끈 채 `Idle`로 돌아간다. 닫힌 위치가 외부에서 다시 확인되고 START가
  해제된 뒤 새로 눌려야 하며, 자동 재시작하지 않는다.
- `FaultCause`는 최초 원인을 latch한다. 한 scan에 여러 원인이 있으면
  `EmergencyStop > Overload > ValveDriveUnavailable > SensorConflict >
  FeedbackLost > OpenTimeout/CloseTimeout > LowSourceWater` 순서로 결정한다.
  뒤늦게 달라진 live input은 latch 원인을 바꾸지 않지만, 이후 닫힘을 막은
  현재 조건은 trace에서 별도로 관측할 수 있다.
- `Opening`과 `Closing`의 timeout은 10초다. 정확히 10초인 scan에 목표 limit가
  함께 관측되면 limit가 timeout보다 먼저 이긴다. 한 scan에 여러 state를
  건너뛰지 않는다.
- `LowSourceWater`만 조건부 orderly close를 허용한다. 이미 열린 위치가
  확인돼 있고 STOP/E-stop/overload/valve-drive/sensor 조건이 닫힘을 허용하면,
  먼저 한 논리 scan `FaultPumpStopping`에서 모든 motion output을 끈 뒤
  `FaultClosing`에서만 닫힘 명령을 낸다. 그렇지 않으면 즉시 all-off
  `Faulted`다. `FaultClosing`은 close limit, timeout, 또는 motion inhibition을
  만나면 끝나며 최초 fault cause는 유지한다.
- reset은 latch된 원인뿐 아니라 현재의 모든 fault 조건이 해제되고
  `known_closed`일 때만 가능하다. 그 조건이 된 뒤
  RESET을 한 번 해제하고 다시 눌러야 한다. 조건이 해제되는 동안 RESET을 계속
  누르고 있었다면 reset되지 않는다. reset은 `Idle`/OFF로만 되돌리고 START를
  대신하지 않는다.

## GhostFlow source

```ghost
control FaultAlarmResetWaterSupply {
  input start_request, reset_request, stop_ok, emergency_stop_ok, overload_ok,
    source_water_ok, valve_drive_ok, open_limit, close_limit: Bool;
  output valve_open_contactor, valve_close_contactor, pump_contactor, alarm: Bool;

  config settle_delay: Duration = 2s;
  config watering_time: Duration = 5min;
  config opening_timeout: Duration = 10s;
  config closing_timeout: Duration = 10s;

  type Phase = Idle | Opening | Settling | Watering | PumpStopping | Closing |
    FaultPumpStopping | FaultClosing | Faulted;
  type FaultCause = None | EmergencyStop | Overload | LowSourceWater |
    ValveDriveUnavailable | SensorConflict | FeedbackLost | OpenTimeout | CloseTimeout;

  // ghostflow:link id=GF-INT-PC10-FAULT-ALARM-RESET-V1 relation=implements
  state phase: Phase = Idle;
  // ghostflow:link id=GF-INT-PC10-FAULT-ALARM-RESET-V1 relation=implements
  state fault_cause: FaultCause = None;
  // ghostflow:link id=GF-INT-PC10-FAULT-ALARM-RESET-V1 relation=implements
  state request_armed: Bool = false;
  // ghostflow:link id=GF-INT-PC10-FAULT-ALARM-RESET-V1 relation=implements
  state reset_armed: Bool = false;
  // ghostflow:link id=GF-INT-PC10-FAULT-ALARM-RESET-V1 relation=implements
  timer age = elapsed(phase);

  let normal_permit = stop_ok && emergency_stop_ok && overload_ok && source_water_ok && valve_drive_ok;
  let fault_motion_permit = stop_ok && emergency_stop_ok && overload_ok && valve_drive_ok;
  let conflict = open_limit && close_limit;
  let known_closed = close_limit && !open_limit;
  let known_open = open_limit && !close_limit;
  let start_event = request_armed && start_request;
  let reset_event = reset_armed && reset_request;
  let fault_cleared = case fault_cause {
    None => true;
    EmergencyStop => emergency_stop_ok;
    Overload => overload_ok;
    LowSourceWater => source_water_ok;
    ValveDriveUnavailable => valve_drive_ok;
    SensorConflict => !conflict;
    FeedbackLost => known_closed;
    OpenTimeout => known_closed;
    CloseTimeout => known_closed;
  };
  let fault_free_now = emergency_stop_ok && overload_ok && source_water_ok &&
    valve_drive_ok && !conflict;
  let reset_allowed = fault_cause != None && fault_cleared && fault_free_now && known_closed;
  let immediate_cause =
    if !emergency_stop_ok then EmergencyStop
    else if !overload_ok then Overload
    else if !valve_drive_ok then ValveDriveUnavailable
    else if conflict then SensorConflict
    else if phase in {Settling, Watering, PumpStopping} && !known_open then FeedbackLost
    else if phase == Opening && !open_limit && age >= opening_timeout then OpenTimeout
    else if phase == Closing && !close_limit && age >= closing_timeout then CloseTimeout
    else if !source_water_ok && phase in {Idle, Opening, Settling, Watering, PumpStopping} then LowSourceWater
    else None;

  request_armed' = phase == Idle && fault_cause == None && normal_permit && !conflict && known_closed && !start_request;
  reset_armed' = phase == Faulted && reset_allowed && !reset_request;
  fault_cause' =
    if phase == Faulted && reset_event && reset_allowed then None
    else if fault_cause != None then fault_cause
    else immediate_cause;

  phase' = case phase {
    Idle =>
      if immediate_cause != None then Faulted
      else if !stop_ok then Idle
      else if start_event && known_closed then Opening
      else Idle;

    Opening =>
      if immediate_cause != None then Faulted
      else if !stop_ok then Idle
      else if known_open then Settling
      else Opening;

    Settling =>
      if immediate_cause == LowSourceWater && known_open && fault_motion_permit then FaultPumpStopping
      else if immediate_cause != None then Faulted
      else if !stop_ok then Idle
      else if age >= settle_delay then Watering
      else Settling;

    Watering =>
      if immediate_cause == LowSourceWater && known_open && fault_motion_permit then FaultPumpStopping
      else if immediate_cause != None then Faulted
      else if !stop_ok then Idle
      else if age >= watering_time then PumpStopping
      else Watering;

    PumpStopping =>
      if immediate_cause == LowSourceWater && known_open && fault_motion_permit then FaultPumpStopping
      else if immediate_cause != None then Faulted
      else if !stop_ok then Idle
      else Closing;

    Closing =>
      if immediate_cause != None then Faulted
      else if !stop_ok then Idle
      else if known_closed then Idle
      else Closing;

    FaultPumpStopping =>
      if !fault_motion_permit || conflict then Faulted
      else FaultClosing;

    FaultClosing =>
      if !fault_motion_permit || conflict then Faulted
      else if known_closed then Faulted
      else if age >= closing_timeout then Faulted
      else FaultClosing;

    Faulted =>
      if reset_event && reset_allowed then Idle
      else Faulted;
  };

  valve_open_contactor <- phase' == Opening;
  valve_close_contactor <- phase' in {Closing, FaultClosing};
  pump_contactor <- phase' == Watering;
  alarm <- phase' in {FaultPumpStopping, FaultClosing, Faulted};
  mutex(valve_open_contactor, valve_close_contactor);
  require !(pump_contactor && valve_open_contactor);
  require !(pump_contactor && valve_close_contactor);
}
```

`FaultPumpStopping`의 alarm은 원인을 이미 알렸음을, 꺼진 세 motion output은
밸브를 닫기 전 펌프가 꺼진 한 논리 scan임을 보여 준다. `FaultClosing`의 명령은
software가 요청하는 닫힘일 뿐이며, E-stop hardwired chain의 에너지 차단이나
실제 밸브 이동을 주장하지 않는다.

## 검증 경계

`tools/check-pc-10.mjs`는 각 scenario에서 새 `ControlRuntime`을 만들고, 현존
WASM artifact를 재빌드하지 않는다. compiler/WASM trace PASS는 GhostFlow의
virtual state/output 계산이 기대와 일치한다는 증거다. Web UX, MCU upload,
접촉기 폐쇄, 밸브 이동, 펌프 회전, 유량 및 외부 safety chain의 physical
acceptance는 이 예제와 checker의 범위 밖이다.
