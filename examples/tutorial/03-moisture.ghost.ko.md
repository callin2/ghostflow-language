<!-- translation-source: examples/tutorial/03-moisture.ghost.md -->
[English original](03-moisture.ghost.md)
> 읽기용 번역본입니다. 컴파일할 때는 링크된 원본 `.ghost.md`를 사용하세요.

# 수분 조건 관수

작성된 의도는 유효하고 건조한 수분 signal이 있을 때만 관수를 켜 둔다. 고장 또는 정지
입력이 들어오면 자기유지 상태를 해제한다.

이 producer-quality revision은 작성된 수분 fault 분기를 유지한다. START와 STOP은 생산자가 전달한 관측 불가를 명시적으로 처리하며 정상 버튼 값에서 물리적 고장을 추론하지 않는다. 이전 소스는 `tests/fixtures/history/issue531/03-moisture.ghost.ko.md.pre-input.txt`에 보존한다.

```ghost
// Source revision: issue531-producer-quality-tutorial03-v1
control MoistureDemand {
  input start, stop: Bool;
  input moisture: Percent {
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
  let start_requested = start |> recover(false);
  let stop_requested = stop |> recover(true);
  watering' = !stop_requested && dry_ok && (start_requested || watering);
  valve <- watering';
  pump <- watering';
  require pump => valve;
}
```
