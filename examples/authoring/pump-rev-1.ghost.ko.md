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

```ghost
control PumpRequest {
  input start, stop, permit_ok: Bool;
  output pump, permit: Bool;

  // ghostflow:link id=GF-INT-PUMP-REQUEST relation=implements
  pump <- start && ;
  permit <- permit_ok;

  // ghostflow:link id=GF-INT-PUMP-PERMIT relation=constrains
  require pump => permit;
}
```
