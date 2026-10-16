<!-- translation-source: examples/constraint-envelope.ghost.md -->
[English canonical source](constraint-envelope.ghost.md)

# 완전한 local 출력 허용 범위

이 소프트웨어 전용 예제에는 control 하나만 있으며 import나 숨은 binding이
없습니다. 네 입력은 테스트 호스트가 제공하는 Bool 관찰값이고, 네 출력은 가상
Bool intent endpoint입니다. 이 가상 endpoint에 대해서는 false를 명시적으로
선택한 비활성 값으로 사용합니다. 이것이 임의의 물리 자원에 안전한 동작이라는
뜻은 아닙니다.

요청은 목표를 표현합니다. local 필수 규칙은 허용되는 출력을 제한합니다.
펌프에는 준비된 밸브가 필요하고 두 방향 출력은 동시에 활성화할 수 없습니다.
이 규칙은 자동·수동 중재 정책을 선택하거나 하드웨어에 출력이 적용되었다고
인증하지 않습니다.

입력 품질을 명시하는 새 리비전 input-quality-v1입니다. 알 수 없는 입력은 이 예제의 이전 관측값을 유지하며, 초기 false는 가상 예제의 상태 초기화입니다. 원본 문서는 별도 이력으로 보존합니다.

```ghost
control OutputEnvelope {
  input observed_start, observed_valve_ready, observed_forward_request, observed_reverse_request: Bool;
  state remembered_start: Bool = false;
  let start = case observed_start { ok(value) => value; fault(_) => remembered_start; };
  remembered_start' = start;
  state remembered_valve_ready: Bool = false;
  let valve_ready = case observed_valve_ready { ok(value) => value; fault(_) => remembered_valve_ready; };
  remembered_valve_ready' = valve_ready;
  state remembered_forward_request: Bool = false;
  let forward_request = case observed_forward_request { ok(value) => value; fault(_) => remembered_forward_request; };
  remembered_forward_request' = forward_request;
  state remembered_reverse_request: Bool = false;
  let reverse_request = case observed_reverse_request { ok(value) => value; fault(_) => remembered_reverse_request; };
  remembered_reverse_request' = reverse_request;
  output pump, valve, forward, reverse: Bool;
  pump <- start;
  valve <- valve_ready;
  forward <- forward_request;
  reverse <- reverse_request;

  constraints LocalEnvelope {
    require at safe_output pump => valve;
    mutex(forward, reverse);
  }
}
```

start=true이고 valve_ready=false이면 requested pump=true가 safe pump=false로
바뀝니다. valve_ready가 true로 회복하면 같은 요청이 허용됩니다. 양쪽 방향을
동시에 요청하면 두 방향 출력은 모두 false가 됩니다. 이것은 local 출력
projection이며 admission이나 일반 공유 자원 enforcement가 아닙니다. 별도
평가 단계와 명시적 binding 경계는 [제약 계약](../docs/CONSTRAINTS.md)을 보세요.
