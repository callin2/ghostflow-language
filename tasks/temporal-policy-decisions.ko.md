<!-- translation-source: tasks/temporal-policy-decisions.md -->
[영문 원문](temporal-policy-decisions.md)

# Temporal 정책 결정

**상태: 승인된 제품 결정이며, Reference §§3.5와 4.4에 기록되었습니다.**

이 파일은 테스트와 기술 계약을 위한 계획 기록으로 남습니다. 컴파일러나 runtime의
지원을 주장하지 않습니다.

**이 문서의 구성:**

| 주제 | 한 줄 결정 | Reference |
| --- | --- | --- |
| `true_for` | Driver가 인증한 연속 구간만 셉니다. 보간하지 않습니다. | §4.4 |
| `after_event` | 각 start event는 자신만의 독립적인 결과를 유지합니다. | §4.4 |
| 여러 schedule crossing | 통과한 occurrence는 모두 missed이며, 아무것도 실행하지 않습니다. | §3.5 |

아래 각 결정은 Reference에 적용된 한국어 문장을 인용합니다.

## 확정된 결정

### `true_for`

`true_for(..., quality: measured)`는 설치된 Driver가 실제로 관측되었다고 인증한
연속 구간만 누적할 수 있습니다. 서로 떨어진 point sample은 그 사이 구간을
인증하지 않습니다.

컴파일러/runtime은 다음을 해서는 안 됩니다:

- sample 사이를 보간하는 것;
- expected cadence, scan cadence, 중복 sample, clock-only tick을 관측된 연속성으로
  취급하는 것.

Reference §4.4의 기존 `true_for` 문장 뒤에 적용된 문장:

> 연속성은 Driver가 실제 관측되었다고 인증한 interval만 이어 붙인다. 서로 떨어진
> sample 사이를 보간하거나 expected cadence, scan cadence, duplicate, clock-only tick을
> 관측 증거로 간주하지 않는다.

### `after_event`

서로 다른 모든 start event는 독립적으로 추적되는 결과를 가집니다.

- 겹치는 event도 서로 구분할 수 있게 유지됩니다.
- 나중의 start event는 이전의 pending 또는 completed 결과를 덮어쓰지 않습니다.
- 기존의 반개구간 `[e,e+window)`은 각 event 식별자에 계속 적용됩니다.

Reference §4.4의 기존 `after_event` 문장 뒤에 적용된 문장:

> 겹치는 event도 identity별 result를 독립적으로 유지한다. 새 start event는 이전
> pending 또는 completed result를 덮어쓰지 않는다.

이로써 `tasks/after-event-design.md`에서 미결로 표시했던 제품 선택이
해결됩니다. 독립적인 event별 결과를 선택합니다.

### 여러 schedule crossing

하나의 수용된 관측 구간이 같은 schedule의 occurrence를 둘 이상 통과하면, 통과한
occurrence를 모두 missed로 기록하고 그중 어느 것도 실행하지 않습니다.

이 규칙은 multiple-crossing 경우에만 적용됩니다. 정확히 하나의 occurrence를
통과한 scan은 여전히 일반 pulse admission 규칙을 사용합니다.

Reference §3.5의 관측 공백과 복구 아래에 적용된 문장:

> 하나의 accepted observation interval에서 같은 schedule의 occurrence를 둘 이상
> 교차하면 교차한 occurrence를 모두 missed로 기록하고 어느 것도 실행하지 않는다.
> 정확히 하나만 교차한 경우에는 ordinary admission 규칙을 그대로 적용한다.

## 결정적인 명세 시나리오

각 시나리오는 승인된 동작과 그럴듯하지만 잘못된 동작을 구분합니다.

1. **인증된 연속성:** 서로 맞닿은 Driver 인증 true 구간 두 개의 합집합이 양의
   지속 시간에 도달하면, 그 경계에서 `true_for`가 참이 됩니다.
2. **보간 금지:** `t=0`과 `t=d`에 true point sample이 있고 그 사이에 인증된 구간이
   없으면, 기대 scan 주기나 실제 scan 주기와 관계없이 `true_for`를 충족하지
   않습니다.
3. **연속성 단절:** 인증 coverage의 공백, false 구간, 허용되지 않는 품질은 누적된
   true 구간을 초기화합니다.
4. **겹치는 event:** event `A`가 시작되고, `A`의 window가 끝나기 전에 event `B`가
   시작됩니다. 술어 관측은 따로 접근할 수 있는 `A`와 `B` 결과를 각각 갱신합니다.
   `B`가 `A`를 대체하는 일은 절대 없습니다.
5. **반개구간 event 경계:** 정확히 `e + window` 시점의 증거는 그 event의 결과에서만
   제외되며, 겹치는 다른 결과를 지울 수 없습니다.
6. **여러 Solar crossing:** `gap = skip_after(3days)`에서 Solar occurrence 두 개를
   포함한 수용 구간은 둘 다 missed로 기록하고 어느 것도 실행하지 않습니다. 동일한
   재시도는 commit 후 두 기록을 중복시킬 수 없습니다.
7. **Single-crossing 대조:** 같은 schedule에서 occurrence 하나만 통과하면 일반
   술어/admission 동작을 따릅니다. 이는 새 missed 정책이 광범위하게 적용되지
   않았음을 증명합니다.

## 여전히 필요한 기술 계약

이 결정들은 다음 구현 계약을 정하지 **않습니다**:

- Driver 구간 인증서(interval certificate)의 wire 형태, trust binding, coverage
  검증, clock/epoch 식별자, 변환된 signal을 거치는 proof 전파.
- 인증된 구간을 위한 제한된 상태, checkpoint, replay, 자원 집계.
- Event 입력 ABI, 불투명한 식별자 binding, 따로 접근 가능한 결과 projection, 결과
  보존, 겹침 용량, 지연, negative/pending 결과 형태, event fault/품질 동작.
- 여러 schedule crossing에 대한 타입이 지정된 missed 사유와 trace 표현, 완전한
  provider-fact 상한, occurrence-ledger 용량, replay encoding, 보정 처리.
- 구체적인 바이트 배치, ABI, 저장 예산, overflow 규칙, 배포 provider capability.
