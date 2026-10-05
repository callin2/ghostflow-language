<!-- translation-source: examples/authoring/pump-rev-1.ghost.md -->
[English original](pump-rev-1.ghost.md)
> 읽기용 번역본입니다. 컴파일할 때는 링크된 원본 `.ghost.md`를 사용하세요.

# 허가 조건이 있는 펌프 요청

문서 `GF-EXAMPLE-PUMP`의 개정 1이다. 완전한 리터레이트 후보 문서다. 사용자는
정지가 우선하며 허가가 없으면 펌프의 안전 의도가 차단된다고 확인했다.

<!-- ghostflow:anchor id=GF-INT-PUMP-REQUEST kind=intent status=confirmed origin=user -->
> START는 펌프를 요청한다. STOP은 요청을 취소한다.

<!-- ghostflow:anchor id=GF-INT-PUMP-PERMIT kind=intent status=confirmed origin=user -->
> 허가가 없으면 펌프를 차단해야 한다.

<!-- ghostflow:anchor id=GF-ASM-PUMP-MAX-RUN kind=assumption status=unconfirmed origin=ai -->
> 최대 운전 시간이 필요할 수 있다. 값과 재시작 규칙은 제공되지 않았다. 타이머를 추가하기 전에 사용자에게 확인한다.

입력 품질을 명시하는 새 리비전 rev-1-input-v1입니다. 알 수 없는 요청은 기존 상태를 유지하며 새 요청을 만들지 않습니다. 정상 STOP 또는 해제된 START는 요청을 취소합니다. 원본 이력과 기존 측정값은 별도로 보존합니다.

```ghost
control PumpRequest {
  input start, stop, permit_ok: Bool;
  output pump, permit: Bool;
  // ghostflow:link id=GF-INT-PUMP-REQUEST relation=implements
  state requested: Bool = false;
  let start_good = case start { ok(_) => true; fault(_) => false; };
  let stop_good = case stop { ok(_) => true; fault(_) => false; };
  let start_value = case start { ok(value) => value; fault(_) => requested; };
  let stop_value = case stop { ok(value) => value; fault(_) => false; };
  requested' = if stop_good && stop_value then false
    else if start_good && !start_value then false
    else if start_good && stop_good then start_value && !stop_value
    else requested;

  // ghostflow:link id=GF-INT-PUMP-PERMIT relation=implements
  state permission: Bool = false;
  permission' = case permit_ok { ok(value) => value; fault(_) => permission; };

  // ghostflow:link id=GF-INT-PUMP-REQUEST relation=implements
  pump <- start && ;
  permit <- permission';

  // ghostflow:link id=GF-INT-PUMP-PERMIT relation=constrains
  require pump => permit;
}
```
