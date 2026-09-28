<!-- translation-source: tasks/temporal-policy-decisions.md -->

[영문 원본](temporal-policy-decisions.md)

# Temporal 정책 결정

상태: **승인된 제품 결정을 Reference §§3.5, 4.4에 기록함**.
이 파일은 테스트 및 기술 계약 계획 기록으로 남는다.
Compiler/runtime 지원을 주장하지 않는다.

## 확정된 결정

### `true_for`

`true_for(..., quality: measured)`는 설치된 Driver가 실제 관측을 인증한
연속 구간만 누적할 수 있다. 별도 point sample은 그 사이 구간을 인증하지 않는다.
Compiler/runtime은 sample 사이를 보간하거나 expected cadence, scan cadence,
중복 sample, clock-only tick을 관측된 연속성으로 취급해서는 안 된다.

Reference §4.4의 기존 `true_for` 문장 뒤에 적용:

> 연속성은 Driver가 실제 관측되었다고 인증한 interval만 이어 붙인다. 서로 떨어진
> sample 사이를 보간하거나 expected cadence, scan cadence, duplicate, clock-only tick을
> 관측 증거로 간주하지 않는다.

### `after_event`

서로 다른 모든 start event에는 독립적으로 추적된 결과가 있다.
중첩 event도 구분 가능하게 유지한다. 이후 start event는 이전의 pending 또는
completed 결과를 덮어쓰지 않는다. 기존 반개구간 `[e,e+window)`은
각 event 식별자에 계속 적용한다.

Reference §4.4의 기존 `after_event` 문장 뒤에 적용:

> 겹치는 event도 identity별 result를 독립적으로 유지한다. 새 start event는 이전
> pending 또는 completed result를 덮어쓰지 않는다.

이는 `tasks/after-event-design.md`에서 미결로 표시했던 제품 선택을 해결한다.
독립적인 event별 결과를 선택한다.

### 여러 schedule crossing

하나의 수용된 관측 구간이 같은 schedule의 occurrence를 두 개 이상 통과하면
통과한 모든 occurrence를 missed로 기록하고 아무것도 실행하지 않는다.
이 규칙은 multiple-crossing에 한정된다. 정확히 하나의 occurrence를 통과한
scan은 일반 pulse admission 규칙을 계속 사용한다.

Reference §3.5의 관측 gap과 복구 아래에 적용:

> 하나의 accepted observation interval에서 같은 schedule의 occurrence를 둘 이상
> 교차하면 교차한 occurrence를 모두 missed로 기록하고 어느 것도 실행하지 않는다.
> 정확히 하나만 교차한 경우에는 ordinary admission 규칙을 그대로 적용한다.

## 결정적인 명세 시나리오

1. **인증된 연속성:** 서로 맞닿은 Driver 인증 true interval 두 개의
   합집합이 양의 duration에 도달하면 경계에서 `true_for`가 참이다.
2. **보간 금지:** `t=0`, `t=d`의 true point sample 사이에 인증 구간이 없으면
   기대 또는 실제 scan 주기와 무관하게 `true_for`를 충족하지 않는다.
3. **연속성 단절:** 인증 coverage의 gap, false interval,
   허용되지 않은 품질은 누적 true interval을 초기화한다.
4. **중첩 event:** event `A`가 시작하고 `A` window 끝 전에 `B`가 시작한다.
   술어 관측은 개별 접근 가능한 `A`, `B` 결과를 갱신한다. `B`는 `A`를 대체하지 않는다.
5. **반개구간 event 경계:** 정확히 `e + window`의 근거는 그 event 결과에서만
   제외하며 다른 중첩 결과를 지울 수 없다.
6. **여러 Solar crossing:** `gap = skip_after(3days)`에서 Solar occurrence 두 개를
   담은 수용 구간은 둘 다 missed로 기록하고 어느 것도 실행하지 않는다.
   동일 재시도는 commit 뒤 두 기록을 중복시킬 수 없다.
7. **Single-crossing 대조군:** 같은 schedule에서 occurrence 하나를 통과하면
   일반 술어/admission 동작을 따른다. 새 missed 정책이 광범위하게 적용되지 않음을 증명한다.

## 여전히 필요한 기술 계약

이 결정은 다음 구현 계약을 선택하지 않는다.

- Driver interval-certificate wire 형태, trust binding, coverage 검증,
  clock/epoch 식별자, 변환된 signal을 통한 proof 전파.
- 인증 interval의 제한된 상태, checkpoint, replay, 자원 집계.
- Event 입력 ABI, 불투명한 식별자 binding, 개별 접근 가능한 결과 projection,
  결과 보존, overlap 용량, 지연, negative/pending 결과 형태, event fault/품질 동작.
- 여러 schedule crossing의 타입이 지정된 missed 사유와 trace 표현,
  완전한 provider-fact 상한, occurrence ledger 용량, replay encoding, 보정 처리.
- 구체적인 byte 배치, ABI, 저장 예산, overflow 규칙, deployment provider capability.
