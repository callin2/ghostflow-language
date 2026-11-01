<!-- translation-source: docs/ROLLING-BUDGET-EXPLANATION.md -->
[영문 원문](ROLLING-BUDGET-EXPLANATION.md)

# 영속 rolling 예산 설명

**rolling 예산**은 이동하는 시간 구간(rolling window) 안에서 자원이 ON일 수 있는 시간을
제한합니다(예: "어느 60s 구간에서든 ON 시간은 최대 30s"). 이 예산 때문에 시작이 거부되면,
운영자나 도구는 *왜* 거부되었는지, 그리고 *언제* 허용될 수 있는지 알아야 합니다.
`explainRolling`은 아무것도 바꾸지 않고 이 두 질문에 답합니다.

**호출.** `AccountingRuntime.explainRolling({ nowMs, windowMs, limitMs, reserveMs })`는
검증된 소스에 바인딩된 영속 `on_time` account를 읽습니다.

- 검증된 정본 소스가 단일 rolling window, 한도, 제안 예약량을 정합니다. 인수가 소스와
  일치하지 않으면 호출은 거부됩니다.
- 복사된 불변 바인딩은 호출자가 공개 메타데이터를 편집하려 해도 그 정책을 유지합니다.

**결과**에는 다음이 포함됩니다.

- 정본 소스 SHA와 artifact SHA
- account/target과 명시적인 호스트 자원 ID
- 조회 시각
- 사용 시간(적용 구간의 합집합)과 미결 예약 시간
- 한도와 제안 예약량
- `blocked`, 그리고 요청이 거부되면 `blockReason: 'rolling-budget'`
- `nextReleaseMs`와 `ledgerRevision`

**admission과 같은 계산.** Rust ledger(원장)는 실제 `reserveRolling` admission(수용)이
사용하는 것과 같은 적용 구간 합집합과 미결 예약량을 계산합니다. 따라서 설명의 예산 부분은
그 admission 판단과 일치합니다.

**계산 예.** 적용 구간 [0,20s]와 [10s,30s], 60s window, 30s 한도, 5s 제안을 생각해 봅니다.

- 40s 시점의 window는 [-20s, 40s]입니다. 구간의 합집합은 30s이므로 사용량은 30s입니다.
  30s + 5s는 30s 한도를 넘으므로 요청은 차단됩니다.
- 가장 이른 허용 시각은 65s입니다. 이때 window는 [5s, 65s]이고, 사용량은 25s이며,
  25s + 5s는 한도 안에 들어갑니다.
- 64.999s에서는 요청이 여전히 거부되고, 65s에서는 예약할 수 있습니다.

아래 타이밍 다이어그램은 두 적용 구간과 두 window를 보여 줍니다.

![적용 구간 [0,20s]와 [10s,30s], 40s(차단)와 65s(허용 가능)에 조회한 60s window](diagrams/rolling-budget-explanation/release-example.ko.svg)

조회는 ledger를 변경하지 않으며 시작을 허가하지도 않습니다. 용량 부족이나 중복 identity
같은 다른 admission 실패는 이 예산 설명과 별개로 다룹니다.

**`nextReleaseMs`가 약속하는 것.** `nextReleaseMs`는 새 증거가 도착하지 않는다고
가정합니다. 그 밖의 규칙은 다음과 같습니다.

- 미결 예약은 identity로 명시적으로 정산(settle)되거나 취소될 때까지 계속 차감된 상태로
  남습니다. 시간 경과나 OFF 애니메이션으로는 해제되지 않습니다.
- 그 미결 예약량과 제안량만으로 이미 한도를 넘으면, 시간에 따른 해제를 약속하지 않습니다.
- 예산이 이미 허용 가능한 상태이면 `nextReleaseMs`도 null입니다.
- 제한된 검색은 합집합 조회를 최대 64회 수행합니다.
- 시각은 u64 최댓값에서 포화하며 절대 wrap하지 않습니다.
- 저장된 어떤 구간의 종료보다 이른 시각을 조회하면 Unknown을 반환합니다. 미래 시각의
  증거로는 감소하는 전망을 세울 수 없기 때문입니다.

**Unknown.** Unknown은 null을 반환합니다. 여기에는 초기화되지 않았거나 손상된 상태, 그리고
승인되지 않은 변경(영속화가 아직 확인되지 않은 변경)이 포함됩니다.

- 정확히 영속화된 revision만 설명 증거를 제공합니다.
- revision 번호는 살아 있는 owner 내부에서만 유효합니다. restore 후에는 revision 0부터
  다시 시작합니다.
- 복구는 영속 snapshot과 정본 소스를 재생합니다. 재시작을 넘어 유지되는 revision counter에
  의존하지 않습니다.

**호스트의 책임.** 호스트는 검증된 적용 증거, 안정된 자원 바인딩, 그리고 비교 가능하고
신뢰할 수 있는 단조 타임라인을 제공합니다. 이 API는 시계나 바인딩 revision을 만들어 내지
않으며, 물리적 수신 확인(receipt)을 인증하지도 않습니다.

**적합성 (REF-04-066).** REF-04-066은 실제 WASM ledger 거부, 정확한 해제 경계, 영속화가
대기 중일 때의 Unknown, snapshot 복구, 제어 활성화를 검증합니다. 같은 snapshot에서 복구한
별도의 context ledger는 실제로 완료된 OFF 출력 관측을 만듭니다. 그 관측은 rolling 거부를
일으키지 않으며, 해당 ledger를 초기화하지도 않습니다. 애니메이션은 accounting API의 입력이
아닙니다.

**범위.** 이것은 참조용 accounting(사용량 집계) 투영입니다. 다음은 **아닙니다**.

- 프런트엔드 cabinet-view 검증
- 컴파일된 `on_time` 시작/차단과의 자동 통합
- API 배포
- 저장 매체 인증
- Device 검증

추가된 WASM export를 사용하려면 WASM 모듈을 다시 빌드해야 합니다. GFB와 ledger snapshot
형식은 바뀌지 않습니다.
