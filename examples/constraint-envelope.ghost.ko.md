<!-- translation-source: examples/constraint-envelope.ghost.md -->
[영문 원문](constraint-envelope.ghost.md)

# 완전한 local 출력 허용 범위

이 소프트웨어 전용 예제에는 control이 정확히 하나만 있으며, import나 숨은
binding이 없습니다. 테스트 호스트가 네 입력을 모두 Bool 관측값으로 제공합니다.
네 출력은 모두 가상 Bool 의도 endpoint입니다. 이 특정 가상 endpoint에 대해서는
`false`를 명시적으로 선택한 비활성 값으로 사용합니다. 그렇다고 `false`가 임의의
물리 자원에 안전한 동작이 되는 것은 아닙니다.

요청은 목표를 표현합니다. 그다음 local 필수 규칙이 허용되는 출력을 제한합니다.
펌프에는 준비된 밸브가 필요하고, 두 방향 출력은 동시에 활성화될 수 없습니다.
이 규칙은 자동·수동 중재(arbitration) 정책을 선택하지 않으며, 출력이 하드웨어에
도달했다고 인증하지도 않습니다.

이 문서는 입력 품질을 명시하는 input-quality-v1 revision입니다. 생산자 데이터를 알 수 없으면(fault) 이 예제는 해당 입력의 마지막 관측값을 유지합니다. 초기값 `false`는 이 소스 내부의 관측 기억을 초기화할 뿐입니다. 원본 문서는 별도로 보존합니다.

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

`constraints LocalEnvelope` 블록에는 두 개의 local 규칙이 있습니다. 매 스캔마다
제어는 먼저 입력에서 *요청 의도(requested)* 출력을 계산합니다. 그다음 규칙이
이를 호스트가 실제로 받는 *안전 의도(safe)* 출력으로 투영(projection)합니다.

| 상황 | 입력 | 요청 출력 | 안전 출력 | 적용되는 규칙 |
| --- | --- | --- | --- | --- |
| 밸브 미준비 | `start=true`, `valve_ready=false` | `pump=true`, `valve=false` | `pump=false`, `valve=false` | `require at safe_output pump => valve` |
| 밸브 준비됨 | `start=true`, `valve_ready=true` | `pump=true`, `valve=true` | `pump=true`, `valve=true` | 규칙 충족. 같은 요청이 이제 허용됩니다 |
| 양방향 동시 요청 | `forward_request=true`, `reverse_request=true` | `forward=true`, `reverse=true` | `forward=false`, `reverse=false` | `mutex(forward, reverse)` |

이것은 local 출력 projection일 뿐입니다. admission(수용) 제어도 아니고 일반적인
공유 자원 enforcement도 아닙니다. 이러한 별도 단계와 명시적 binding 경계는
[제약 계약](../docs/CONSTRAINTS.md)에서 설명합니다.
