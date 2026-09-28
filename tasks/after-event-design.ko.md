<!-- translation-source: tasks/after-event-design.md -->

[영문 원본](after-event-design.md)

# `after_event` 설계 기록

상태: **제품 동작 선택 완료; 범위가 제한된 Rust 선행 구현 완료**.
이 문서는 Reference §4.4와 REF-04-026을 기록한다. 컴파일러 구현 수용을
주장하지 않는다.

## 필요한 의미

`after_event(event, predicate, window: d, quality: measured)`는 식별된 사건의
타임스탬프 `e`부터 반개구간 `[e, e + d)`에서 술어를 평가한다.
정확한 끝 경계는 제외한다. 결과는 서로 다른 사건 식별자마다 추적한다.
제품 계약으로 명시적으로 선택하지 않는 한 하나의 전역 타이머로
축소해서는 안 된다.

컴파일러는 이제 `event started: Event;`를 파싱하고 직접적인
`after_event(started, valve_open, window: 10s, quality: measured)` 형태를 타입 검사한다.
식별된 Event, 직접 선언한 Bool sensor, measured 품질, 양의 상수 Duration을
실행 불가능한 manifest descriptor에 기록한다. Event 전달과 식별자별 결과 ABI가
제공될 때까지 공개 `compileSource` 경로는 `after_event` 연산자에서 거부한다.
RED/GREEN 근거: `node --test tests/after-event-contract.test.mjs`
(이전 0/7, 이후 7/7). REF-04-026의 수용 fixture는 아직 실행 의미를 증명하지 않는다.

Rust 선행 구현은 `crates/ghostflow-core::after_event::AfterEvent<N>`이다.
고정 `[Option<EventResult>; N]` 저장소를 사용하고, 각 `EventKey`를 독립적으로
추적하며, `[e,e+d)`에서만 measured 술어를 적용하고, 제외된 끝 경계에서 만료시키며,
종결 결과의 확인 처리를 트랜잭션으로 준비한다. 집중 검증은
`cargo test -p ghostflow-core --test after_event` (10/10)이다.
`stage_batch`는 tick을 원자적으로 준비한다. 순서는 만료, 종결 결과 확인 처리,
소스 식별자 순서의 시작, 술어 관측이다. 시작 타임스탬프의 술어는 모든 동시 시작을
충족할 수 있다. 이전 사건의 정확한 끝 경계에서 관측한 술어는 그 이전 사건을
충족할 수 없다. 용량 또는 관측 오류는 확인 처리, 만료, 소스 식별자 상한 기록,
시계 전진을 포함한 준비된 변경 전체를 폐기한다. 명시적 rollback도 같은 격리를
제공한다. 이는 native API 선행 조건이며, 공개 Event binding이나 scalar signal
projection 계약은 아니다.
GFB/WASM 인코딩, event binding, 식별자별 projection, checkpoint/replay,
provenance 통합은 미결이다.

## 필요한 근거와 상태

- 각 물리 술어 sample에는 sample 타임스탬프, epoch, id, 품질, 값이 있다.
  사건 발생에는 자체 타임스탬프와 서로 다른 식별자가 있다.
- 사건 식별자는 binding 계약 아래에서 불투명하고 충돌에 안전해야 한다.
  짧은 해시로 대체하는 방식은 승인된 식별 체계가 아니다.
- 구현은 생성된 Event-present, Event-epoch, Event-id, Event-timestamp 입력이나
  그와 동등한 명시적 ABI를 정의해야 한다. 보존 방식과 소스 연결을 검사할 수 있어야 한다.
- 수용, 거부, fault, 경계 평가는 다른 temporal evidence와 같은
  transaction/checkpoint/proof 규칙을 사용해야 한다. 거부된 tick은 사건 상태나
  술어 근거를 부분적으로 전진시킬 수 없다.
- Replay/checkpoint 데이터는 사건 식별자, 소스 타임스탬프, epoch와
  새 사건을 중복 사건과 구분하는 데 필요한 근거를 보존해야 한다.

## 선택한 중첩 사건 동작

서로 다른 모든 사건 식별자마다 독립된 결과를 유지한다. 중첩 사건도 구분할 수 있어야 한다.
새 사건이 이전의 대기 중 또는 완료된 결과를 대체하지 않는다.
이는 언어 동작을 확정하지만, 범위가 제한된 projection, 보존, replay 인코딩,
자원 구성까지 선택한 것은 아니다.

## 그 밖의 미결 계약

- 여러 활성 사건 결과의 scalar projection과 보존. 예를 들어 사건 A가 만료되고
  중첩된 사건 B가 충족된 경우, Reference의 `opened |> recover(false)` 형태는
  어떤 식별자가 scalar Bool을 공급하는지 정하지 않는다. 지금 GFB projection을
  인코딩하면 `latest`, `oldest`, `any` 중 하나를 암묵적으로 선택하게 된다.
  어느 것도 그 자체로 선택된 식별자별 결과 계약을 보존하지 못한다.
  산출물에는 명시적인 식별자 색인 결과 뷰(또는 명시적 projection 규칙)와
  보존 결과 수의 상한이 필요하다.
- 대기 중 결과와 부정 결과의 의미.
- 사건 및 술어 sample의 지연과 전달 상한.
- 사건 fault 영역과 품질 전이.
- 단조 시계 영역과 epoch 초기화 동작.
- 중첩 사건과 checkpoint proof의 자원 한계.

## 다음 GFB 산출물 계약

새 버전이 지정된 prelude는 site/name, Event 소스 tag/name, Bool sensor 소스 tag/name,
양의 window, measured 품질과 고정 입력 binding을 담을 수 있다. 입력 binding은
Event 존재 여부/소스 epoch/id/타임스탬프와 술어 sample 식별자, 타임스탬프, 값,
품질을 연결한다. Loader는 활성화 전에 필드 타입, 서로 다른 binding, 소스 식별자,
자원 상한을 검증해야 한다. 사건별 결과 projection에는 Event key와
Pending/Satisfied/Expired 상태가 있어야 한다. 이제 runtime tick 처리는
`AfterEvent<N>::stage_batch`로 같은 타임스탬프의 시작과 술어 관측을 처리하고
한 번 commit하거나 rollback할 수 있다. Host에는 여전히 명시적 전달 binding과
자원 구성이 필요하다. 공개 GFB descriptor가 실행 지원을 주장하기 전에
식별자 색인 projection과 그 scalar 소비 의미를 해결해야 한다.
컴파일러의 현재 위치 정보가 있는 진단이 수용 경계로 남는다.

생성된 Event-present/epoch/id/timestamp 입력이라는 기술 후보는 구현 방향일 뿐이다.
승인된 ABI나 언어 확장은 아니다. 설치된 프로그램의 근거, 영속적인 §6.8 식별자,
하드웨어 사건 전달과 물리 I/O는 이 설계 기록의 범위 밖이다.
