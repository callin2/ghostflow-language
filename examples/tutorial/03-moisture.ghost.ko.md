<!-- translation-source: examples/tutorial/03-moisture.ghost.md -->
[English original](03-moisture.ghost.md)
> 읽기용 번역본입니다. 컴파일할 때는 링크된 원본 `.ghost.md`를 사용하세요.

# 수분 조건 관수

작성된 의도는 유효하고 건조한 수분 signal이 있을 때만 관수를 켜 둔다. 고장 또는 정지
입력이 들어오면 자기유지 상태를 해제한다.

```ghost
control MoistureDemand {
  input start, stop: Bool;
  sensor moisture: Percent {
    sample = 1s;
    valid = 0% .. 100%;
    filter = median(5);
    stale_after = 3s;
    recover_after = 3 samples;
  }
  signal dry = hysteresis(moisture,
    on_below: 30%, off_above: 35%, initial: false);
  let dry_ok = case dry { ok(value) => value; fault(_) => false; };
  state watering: Bool = false;
  output pump, valve: Bool;
  watering' = !stop && dry_ok && (start || watering);
  valve <- watering';
  pump <- watering';
  require pump => valve;
}
```
