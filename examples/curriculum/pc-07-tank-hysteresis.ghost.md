# PC-07 — 탱크 수위 두 점 제어와 충돌 안전

> 교육용 시나리오: PLC 대체 교육과정의 상·하한 수위 제어를 두 개의
> 디지털 수위 스위치와 명시적인 상태 전이로 학습하기 위한 예제다. 실제
> 사용자 발화를 그대로 인용한 문서가 아니다.

이 문서가 PC-07의 유일한 canonical literate 실행 원본이다. 기존
[tutorial/03-moisture](../tutorial/03-moisture.ghost.md)는 연속 수분 센서의
median 필터·품질 상태·hysteresis를 함께 다루는 별개의 예제이므로 보존하고
참조한다. 이 과는 아날로그 값이나 연속 센서 처리가 아니라, 물리적인 상·하한
스위치를 이용한 탱크 충전 제어를 다룬다.

`low_level_reached`가 참이면 물이 하한 스위치에 도달해 그 스위치를 적신
상태이고, `high_level_reached`가 참이면 상한 스위치에 도달해 적신 상태다.
정상 순서는 상한에 도달하기 전에 하한에도 도달하는 것이므로
`high_level_reached=true`이고 `low_level_reached=false`인 입력은 센서
충돌이다. 공통 `stop_ok` 같은 정지·보호 허가는 이 과의 입력에 섞지 않고
PC-08/PC-10에서 다시
결합한다. `fill_pump`는 펌프가 실제로 돌았다는 피드백이 아니라 충전 접촉기에
보낼 논리 명령이다.

```ghost
control TankLevelHysteresis {
  input low_level_reached, high_level_reached: Bool;
  output fill_pump: Bool;

  type Phase = Idle | Filling | SensorConflict;
  state phase: Phase = Idle;

  let conflict = high_level_reached && !low_level_reached;

  phase' = case phase {
    Idle =>
      if conflict then SensorConflict
      else if !low_level_reached then Filling
      else Idle;

    Filling =>
      if conflict then SensorConflict
      else if high_level_reached then Idle
      else Filling;

    SensorConflict =>
      if conflict then SensorConflict
      else Idle;
  };

  fill_pump <- phase' == Filling;
}
```

충돌은 모든 상태에서 가장 먼저 처리되므로 펌프 명령을 끈다. 충전 중에는
하한 스위치가 계속 젖어 있어도 `Filling`을 유지하며, 상한 스위치가 젖는
순간 `Idle`로 전이한다. 이처럼 두 스위치의 단순한 현재값만으로 매 scan의
결과를 정하지 않고 `phase`를 함께 보므로, 하한과 상한 사이의 상태를 유지할
수 있다.

처음부터 `low_level_reached=true, high_level_reached=false`인 중간 수위는
이미 하한을 지난 상태로 간주해 펌프를 켜지 않는다. 반대로 처음부터 두
스위치가 모두 거짓이면 아래 저수위로 시작한 것으로 간주해 다음 scan에서
충전을 시작한다. 충돌이 해소된 scan은 의도적으로 `Idle/off` 한 번으로
복구한다. 그 다음 scan부터만 정상적인 자동 평가를 하므로, 충돌 직후의
불완전하거나 아직 해석되지 않은 입력으로 즉시 재기동하지 않는다. 충돌
해소 뒤 두 스위치가 모두 거짓이면 그 다음 scan에서 아래 저수위로 평가되어
충전할 수 있다.

정규화된 두 입력이 정상이라는 이 예제의 범위에서는
`low_level_reached=false, high_level_reached=false`가 아래 저수위를 뜻한다.
단선·고착과 미상 품질까지 같은 Bool 조합으로 추측하지 않으며, 그런 진단과
공통 정지·보호 허가는 PC-08/PC-10의 범위로 남긴다. 실제 스위치의 정상
배선, 물의 이동, 펌프 회전, 유량은 이 논리 예제와 checker의 증거 범위
밖이다. PC-10에서 timeout·fault latch·reset을 추가할 때 이 경계를 확장한다.

`tools/check-pc-07.mjs`는 각 사례마다 새 WASM `ControlRuntime`을 만들고 기존
WASM을 재빌드하지 않는다. checker의 PASS는 literate source가 현재 compiler로
컴파일되고 기존 WASM에서 논리 명령 trace가 기대와 일치했다는 뜻이다.
소스·checker·compiler·toolchain·literate extractor·WASM·adapter와 기대값의
SHA-256을 함께 출력해 실행 증거의 대상을 고정한다.
