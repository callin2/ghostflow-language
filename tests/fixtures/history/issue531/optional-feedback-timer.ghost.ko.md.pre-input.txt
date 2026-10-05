<!-- translation-source: examples/optional-feedback-timer.ghost.md -->
[영문 원본](optional-feedback-timer.ghost.md)
> 읽기용 번역입니다. 연결된 원본 `.ghost.md`를 컴파일합니다.

# 선택 관찰을 포함한 타이머 제어

이 예제에서 작업자가 정한 명령 시간은 2초입니다. 설명을 위한 값이며 특정 설치의 측정된 이동 시간이나 승인된 설정값이 아닙니다. 설치별로 명시적으로 확인한 값으로만 바꿉니다. 출력 의도 계산에는 물리 feedback이 필요하지 않습니다.

`run_request`는 유지형 Bool 요청입니다. 처음 수락한 true scan에서 새 구간을 시작합니다. 반복 true scan은 타이머를 초기화하지 않습니다. 2초 경계에서 requested와 safe `drive`는 false가 됩니다. 요청을 true로 유지해도 다시 시작하지 않습니다. false scan은 즉시 정지하고 `run = false`를 commit합니다. 이후 true scan은 새 구간을 시작합니다. 수락한 scan 사이의 false/true pulse는 타이머를 초기화할 수 없습니다. 새 runtime은 state와 timer를 초기화하며 첫 true 요청은 새 구간을 시작합니다.

`age`는 commit된 Bool state `run`의 경과 시간입니다. 요청한 state가 바뀌는 결정에서 `run_age`는 0입니다. 따라서 시작과 정지는 현재 결정에서 적용됩니다. 타이머는 공급된 단조 scan 시간을 사용합니다. 경계에 정확한 scan이 없으면 다음 수락한 scan에서 제한을 적용합니다.

선택 `observation` capability가 설치되어 있으면 `Observed`, 없으면 `Baseline`을 선택합니다. 두 strategy의 actuator 의도는 동일합니다. 정상 true, 정상 false, sample 부재와 설치된 sensor fault는 production host가 반환하는 별도 sensor 관찰에 남습니다. 없는 선택 sensor에 대해 host는 `NotReady` reading placeholder를 반환합니다. capability metadata와 선택한 strategy가 부재를 구분합니다. sample 공급으로 없는 capability를 만들 수 없습니다. fault는 부재 strategy를 선택하지 않습니다. 이 예제는 관찰에 제어 권한을 부여하지 않습니다.

타이머 완료는 작성된 명령 시간의 종료입니다. Driver 적용, relay 접점 작동, 부하 이동 또는 위치를 증명하지 않습니다. requested 의도, safe 의도, applied 명령과 독립 물리 증거는 구분됩니다.

```ghost
control OptionalFeedbackTimer {
  input run_request: Bool;
  output drive: Bool;
  sensor observation?: Bool;

  // Example value established by the operator; not a measured position.
  let calibrated_duration = 2s;
  state run: Bool = false;
  run' = run_request;
  timer age = elapsed(run);
  let run_age = if run_request == run then age else 0s;
  let timed_request = run_request && run_age < calibrated_duration;

  adapt observation_policy {
    strategy Observed priority 10 match (observation: sensor<Bool>) {
      drive <- timed_request;
    }
    strategy Baseline priority 0 match always {
      drive <- timed_request;
    }
  }
}
```

관련 계약: [선택 sensor와 출력 증거](../docs/reference/04-sensors-constraints-control.md), [관찰과 권한](../docs/reference/05-settings-and-observation.md). 회귀와 workflow 등록: [GhostFlow #382](https://github.com/callin2/ghostflow-language/issues/382).
