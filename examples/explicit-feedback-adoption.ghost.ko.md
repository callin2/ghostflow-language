<!-- translation-source: examples/explicit-feedback-adoption.ghost.md -->

2026-10-05 명시적인 입력 품질 개정: 요청을 알 수 없으면 기존 운전 상태를 유지하며 2초 기한은 계속 적용한다. 품질은 물리적인 고장을 뜻하지 않는다.
[영문 원본](explicit-feedback-adoption.ghost.md)

# 명시적으로 채택한 피드백 억제

이 별도 소스는 진단 허용 규칙을 명시적으로 채택한다. 정상 true 관찰은 시간
요청을 허용한다. 정상 false 또는 모든 센서 fault는 출력을 억제한다. 이 예제의
정지 규칙은 소스에 작성한 정책이며, 피드백 부재에 대한 보편적인 대응이 아니다.
[관찰 전용 타이머](optional-feedback-timer.ghost.ko.md)는 물리 피드백 없이도 유효하며
관찰에 제어 권한을 주지 않는다.

운영자가 정한 예시 명령 시간은 2초다. 타이머는 유지된 요청의 시간을 측정한다.
이동이나 Driver 적용 시간을 측정하지 않는다. 억제는 시간을 초기화하거나
연장하지 않는다. 기한 전 복구는 남은 요청을 허용할 수 있다. 기한 이후나 정확히
기한에 복구해도 다시 시작하지 않는다. 정지와 재시작 의미는 연결한 타이머 예제와 같다.

`observation`은 필수 Bool 센서다. 참조 호스트에서 샘플을 제공하지 않으면
`NotReady`로 처리한다. 작성한 `fault(_) => false` 분기가 출력을 억제한다.
선택 capability 목록이 비어 있어도 필수 선언을 제거하지 않는다. 알 수 없는
샘플 역할이나 capability 타입 불일치는 거부한다. 불완전한 네이티브 scan frame은
결정 전에 거부한다. 어느 조건도 관찰 전용 예제나 다른 strategy를 선택하지 않는다.

채택은 이 정본 소스 리비전과 컴파일 산출물에 기록된다. 재생은 같은 문서,
바이트코드와 제공한 요청 및 샘플 frame을 사용한다. 기존 source-map 검증기는
관찰 전용 문서에 속하는 예상 리비전을 거부한다. 새 배포나 재생 서비스를
뜻하지 않는다. requested와 safe 의도는 적용 명령 및 독립적인 물리 증거와
구별한다. 진단 Bool은 이동이나 위치를 입증하지 않는다.

```ghost
control ExplicitFeedbackAdoption {
  input run_request: Bool;
  output drive: Bool;
  input observation: Bool;

  // Illustrative operator-established command duration, not measured motion.
  let calibrated_duration = 2s;
  state run: Bool = false;
  let requested = case run_request { ok(value) => value; fault(_) => run; };
  run' = requested;
  timer age = elapsed(run);
  let run_age = if requested == run then age else 0s;
  let timed_request = requested && run_age < calibrated_duration;
  let permit = case observation { ok(value) => value; fault(_) => false; };
  drive <- timed_request && permit;
}
```

계약: [필수·선택 센서와 출력 증거](../docs/reference/04-sensors-constraints-control.md),
[관찰 권한](../docs/reference/05-settings-and-observation.md).
회귀 검증: [GhostFlow #384](https://github.com/callin2/ghostflow-language/issues/384).
