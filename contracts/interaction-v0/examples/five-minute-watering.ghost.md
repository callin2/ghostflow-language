# 5분 급수 제어

## 현재 동작

- 논리 시각 0에서 `watering`과 모든 출력은 꺼져 있고 `age`는 0입니다.
- DI1은 순간 급수 요청이며, false에서 true로 바뀌는 한 번의 입력만 새 급수를 시작합니다; 누르고 있는 동안에는 다시 시작하지 않고, 놓으면 다음 누름을 위한 에지만 다시 준비됩니다.
- DI2 정지 또는 DI3 저수위가 들어오면 현재 급수와 출력을 즉시 끄며, 두 정지 입력은 새 DI1 요청보다 우선합니다.
- DI2/DI3 중 하나로 끝난 급수 실행은 재개하지 않으며, 정지 입력을 해제해도 급수는 다시 켜지지 않습니다; DI1을 놓은 뒤 새로 눌러야 새 실행과 새 5분 구간이 시작됩니다.
- 승인된 `watering` 상태가 true이면 RO1 펌프와 RO2 급수 밸브를 함께 켜고, false이면 둘 다 끕니다; DI4–DI8은 spare 입력이고 RO3–RO8은 항상 꺼져 있습니다.
- `age = elapsed(watering)`은 Bool 상태가 마지막으로 바뀐 뒤의 경과 시간이며, `watering`이 true인 동안에만 5분 제한에 사용됩니다; 정확히 5분이 되면 그 급수 실행을 끝내고, 이후 새 DI1 에지는 새 시간 구간을 시작합니다.

## 가상 장비 연결

| 채널 | 이름 | 종류 |
|---|---|---|
| DI1 | 급수 요청 | button |
| DI2 | 정지 | button |
| DI3 | 저수위 | sensor |
| RO1 | 펌프 | pump |
| RO2 | 급수 밸브 | valve |

## 원본 의도와 가정

<!-- ghostflow:anchor id=GF-INT-FIXTURE-WATERING-V1 kind=intent status=confirmed origin=user -->
원본 요청(2026-09-15, callin2/ghostflow-language#81, Backlog TASK-121.8.1):
“DI1 momentary request: only a false-to-true edge starts/restarts watering;
DI2 stop and DI3 low-water each stop immediately and have priority; clearing
either condition or holding DI1 must not restart; RO1 pump and RO2 watering
valve operate in lockstep from the accepted watering state; timer age =
elapsed(watering), exact 5min cutoff.”

- 제어 의미에서 DI1 true는 버튼을 누른 상태이고 DI2/DI3 true는 해당 정지 조건이 들어온 상태라고 가정합니다; 실제 접점의 전기적 극성은 이 문서에서 정하지 않습니다.
- 표는 소프트웨어의 가상 채널 연결이며 Waveshare 단자 번호나 실제 배선을 뜻하지 않습니다.

```ghost
control FiveMinuteWatering {
  input DI1, DI2, DI3, DI4, DI5, DI6, DI7, DI8: Bool;
  let watering_limit = 5min;
  output RO1, RO2, RO3, RO4, RO5, RO6, RO7, RO8: Bool;

  // ghostflow:link id=GF-INT-FIXTURE-WATERING-V1 relation=implements
  state request_was_high: Bool = false;
  // ghostflow:link id=GF-INT-FIXTURE-WATERING-V1 relation=implements
  state watering: Bool = false;
  // ghostflow:link id=GF-INT-FIXTURE-WATERING-V1 relation=implements
  timer age = elapsed(watering);

  request_was_high' = DI1;
  watering' = !DI2 && !DI3
    && ((DI1 && !request_was_high) || (watering && age < watering_limit));

  // ghostflow:link id=GF-INT-FIXTURE-WATERING-V1 relation=implements
  RO1 <- watering';
  // ghostflow:link id=GF-INT-FIXTURE-WATERING-V1 relation=implements
  RO2 <- watering';
  RO3 <- false;
  RO4 <- false;
  RO5 <- false;
  RO6 <- false;
  RO7 <- false;
  RO8 <- false;
}
```

## 검증 경계

이 리터레이트 문서와 파생 corpus 파일은 소프트웨어 검증용입니다. 펌웨어
통합이나 실제 펌프·밸브·릴레이·접점의 동작을 시험하거나 증명하지 않습니다.
