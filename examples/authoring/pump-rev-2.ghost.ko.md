<!-- translation-source: examples/authoring/pump-rev-2.ghost.md -->
[영문 원문](pump-rev-2.ghost.md)

# 허가 조건이 있는 펌프 요청

이 파일은 문서 `GF-EXAMPLE-PUMP`의 revision `rev-2-input-v1`입니다. [개정 1](pump-rev-1.ghost.ko.md)의
불완전한 식을, 진단이 보고한 바로 그 문서 위치에서 수정합니다. 사용자는 두 가지 규칙을 확인했습니다. STOP이 우선하며, 허가가 없으면 펌프의 안전 의도(safe)가 차단됩니다.

<!-- ghostflow:anchor id=GF-INT-PUMP-REQUEST kind=intent status=confirmed origin=user -->
> START는 펌프를 요청합니다. STOP은 요청을 취소합니다.

<!-- ghostflow:anchor id=GF-INT-PUMP-PERMIT kind=intent status=confirmed origin=user -->
> 허가가 없으면 펌프를 차단해야 합니다.

<!-- ghostflow:anchor id=GF-ASM-PUMP-MAX-RUN kind=assumption status=unconfirmed origin=ai -->
> 최대 운전 시간이 필요할 수 있습니다. 그 값과 재시작 규칙은 제공되지 않았습니다. 타이머를 추가하기 전에 사용자에게 확인합니다.

이 소스는 입력 품질을 명시하는 input-quality-v1 revision입니다. 각 입력은 생산자(producer)가 제공한 품질(`ok` 또는 `fault`)을 함께 전달합니다. 알 수 없는(fault) 요청은 저장된 요청 상태를 유지하며, 새 요청을 만들 수는 없습니다. 품질이 확인된 STOP, 또는 품질이 확인된 상태에서 해제된 START는 요청을 취소합니다. 원본 소스 바이트와 날짜가 기록된 벤치마크 증거는 별도로 보존합니다. 수정된 대입은 `pump <- requested';`입니다. 따라서 펌프 요청은 다음 요청 상태를 따르고, 허가가 없는 동안에는 `require pump => permit`이 이를 차단합니다.

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
  pump <- requested';
  permit <- permission';

  // ghostflow:link id=GF-INT-PUMP-PERMIT relation=constrains
  require pump => permit;
}
```
