<!-- translation-source: tasks/schedule-clock-design.md -->

[영문 원본](schedule-clock-design.md)

# Trusted-only schedule 시계 gate

상태: native 시계 구성요소 구현 및 수용 완료; VM/ABI 통합 미완료.

이 문서는 Reference §3.1과 §3.5에 근거한
[Solar pulse admission](schedule-pulse-design.md)의 시계 구성요소를 다룬다.
아직 소스 schedule을 VM에 연결하거나 occurrence admission을 구현하지 않는다.

## 계약

- 호출자는 불변 snapshot 하나를 공급한다. Gate는 기계 시계를 읽지 않으며
  암묵적인 관측 주기나 gap 기본값이 없다.
- 생성에는 양의 정확한 Duration gap과 명시적 run epoch가 필요하다.
  단조 시각과 epoch는 정확한 안전 정수다. Wall time은 Reference DateTime
  영역으로 제한한다. 선택적인 uncertainty는 정확한 음이 아닌 값이다.
- 상태 변경 전에 범위, run epoch, 단조 시간 진행을 검증한다.
  다른 epoch에는 새 run이 필요하다. 이 gate를 조용히 초기화할 수 없다.
- Wall time이 없거나 신뢰되지 않으면 `ClockUnknown`을 반환한다. 원래
  사유와 불투명한 source revision을 보존한다. Uncertainty가 없으면 그대로
  없으며, 그 사실만으로 신뢰된 wall instant를 무효화하지 않는다.
- 첫 신뢰 관측은 `BootBaseline`을 설정한다. Unknown 이후 신뢰 복구는
  `RecoveryBaseline`을 설정한다. 어느 것도 admission pulse가 아니다.
- 연속된 신뢰 관측에서는 단조 delta와 양의 wall delta를 명시적 gap과
  비교한다. 같으면 허용하고, 더 크면 `ObservationGap`이다.
  Wall rollback은 허용한다.
- 이전 유효 wall instant와 신뢰된 상한 기록을 분리한다. Wall 값이
  1000, 900, 1050이면 마지막 양의 delta는 50이 아니라 150이다.
  따라서 gap 100에서는 `ObservationGap`을 보고해야 한다.
- 이전 및 갱신된 신뢰 상한 기록을 모두 하류 admission engine에 공개한다.
  갱신된 기록만으로는 새로 통과한 사건을 분류할 수 없다.
- Runtime 통합은 복제본을 준비하고 전체 tick 성공과 함께만 commit한다.
  구성요소 자체도 검증 실패 시 상태를 보존한다.

Live state는 고정 scalar 필드를 담는다. Snapshot/observation revision과
사유 문자열은 빌려 쓰며 gate에 보존하지 않는다. 이는 향후 소유 fact/journal
저장소를 주장하지 않는다. 그 저장소에는
[wire 제안](schedule-wire-design.md)의 명시적인 통합 자원 계획이 필요하다.

## 수용 경계

집중 테스트는 각 시계의 정확한 gap과 gap+1, rollback 뒤 전진 gap,
Unknown/복구, 바뀌지 않은 타임스탬프, 선택적 uncertainty,
불투명한 revision/사유 보존, 정확한 수치 경계, epoch 불일치,
단조 시간 역행, 준비된 후보 폐기/재시도를 다뤄야 한다.

Native 구성요소 수용은 컴파일러, WASM ABI, occurrence 중복 방지,
held-clock 정책, 영속 복원, 전체 schedule 수용이 아니다.
미결인 multiple-crossing 제품 결정은 이 시계 구성요소에 영향을 주지 않는다.

## 근거

- Sol이 `crates/ghostflow-core/src/schedule_clock.rs`를 구현했다. Root는
  상태 변경, 이전/갱신 상한 기록, 끝점 assertion을 검토했다.
- `build/schedule-clock-red.log`: 최초 공개 시계 API 테스트는 새 타입이
  아직 없어 컴파일에 실패했다. 이는 이후의 모든 경계 vector에 대한
  runtime RED 결과가 아니다.
- `build/schedule-clock-first-green.log`: 최초 시계 경로 통과.
- `build/schedule-clock-final-green.log`: 집중 테스트 6건 통과.
  수용되는 수치 끝점, 정확한 gap/gap+1, 같은 타임스탬프, provenance,
  정확한 거부 메시지, 변경되지 않은 상태, 폐기된 stage의 재시도 동등성을 포함한다.
- `build/schedule-clock-core-regression.log`: core 테스트 148건 모두 통과, 종료 코드 0.
- `build/schedule-clock-catalog.log`: Luna가 변경되지 않은 core 원자성 테스트
  locator를 한 줄 옮긴 뒤 catalog 테스트 5건 통과. Digest는 변경되지 않았다.
- `cargo fmt --all -- --check`와 `git diff --check` 통과.

새 전체 host gate나 WASM build는 실행하지 않았다. Rust API는 정수 필드를 받는다.
향후 fact-packet decoding은 host의 소수 숫자를 별도로 거부해야 한다.
