<!-- translation-source: docs/COMPILER-DIAGNOSTICS.md -->
[영문 원문](COMPILER-DIAGNOSTICS.md)

# 공개 컴파일러 진단

브라우저 및 Node 도구 체인의 `compileSource`는 `diagnosticEnvelope`를 반환합니다. 컴파일에 성공하면 `diagnostics` 배열은 비어 있습니다. 위치가 있는 컴파일 실패는 던져진 오류의 같은 속성에 포함되어 거부됩니다.

기존 오류 클래스와 메시지 유지 정책의 예외는 아래의 누락된 Interaction Schema
의도 출처 진단입니다.

## Interaction Schema 의도 출처 누락

`interactionSourceIdentity`로 스키마를 요청하면 작성된 state, timer, operator
config에 명시적인 문학적 anchor 링크가 필요합니다. 링크가 없으면 선언의 원본
Markdown 범위에서 `GF_INTENT_PROVENANCE`를 보고하고, 정확한 소스 해시와 전달된
문서/리비전 ID를 보존합니다. anchor는 코드 펜스 밖의 문단이나 인용문을 식별하고,
link 주석은 `ghost` 펜스 안에서 선언 바로 앞에 있어야 한다고 설명합니다.

`hint`는 유효한 anchor/link 구문과 기존 ID에 충돌하지 않는 예시 ID를 담습니다.
`reference`는 [작성 구문](INTENT-ANCHOR-MAP.md#minimal-authored-form)을 가리킵니다.
실제 이유가 일치하는 기존 활성 anchor에 링크하는 방법을 우선 사용하세요.
대안 예시는 `kind=assumption status=unconfirmed origin=ai` 및 `relation=assumes`로
명시됩니다. 채택하기 전에 실제 이유를 작성하고 검토해야 하며, 컴파일 성공은
의도 확인이 아닙니다. 확인된 의도는 사람이 확인하고 기존 재분류 계약을 따라야
합니다. 소스를 자동으로 수정하지 않습니다. 누락, 중복, 고아 링크, 분류 불일치,
superseded anchor/link 거부는 유지됩니다. 새 소스 리비전에 제안을 작성해도
실행 토큰과 GFB 바이트는 바뀌지 않습니다.
엔벌로프 형식은 `GhostFlow/diagnostics-v1`입니다.

```json
{
  "format": "GhostFlow/diagnostics-v1",
  "source": {
    "filename": "farm.ghost.md",
    "sha256": "<lowercase SHA-256 of the exact UTF-8 document>",
    "documentId": "<when interactionSourceIdentity was supplied>",
    "revisionId": "<when interactionSourceIdentity was supplied>"
  },
  "diagnostics": [{
    "code": "GF_PARSE",
    "severity": "error",
    "message": "expected expression, found ;",
    "span": {
      "file": "farm.ghost.md",
      "start": { "line": 6, "column": 11 },
      "end": { "line": 6, "column": 12 }
    }
  }]
}
```

좌표는 1부터 시작하며 산문과 펜스 행을 포함한 원본 `.ghost.md` 문서를 기준으로 합니다. 열은 컴파일러의 UTF-16 코드 단위 좌표입니다. `end`는 배타적이며 컴파일러가 매핑된 끝 위치를 알고 있을 때만 나옵니다. `hint`, `related`, `reference`는 선택 항목이며 컴파일러가 근거를 확보하기 전에는 없습니다. 특히 컴파일러는 메시지 문구만으로 참조 문서를 추측하지 않습니다.

현재 출력되는 코드는 문서 추출용 `GF_LITERATE`, 문법용 `GF_PARSE`, 출력 형식 불일치용 `GF_TYPE`, 조합/import 검증용 `GF_IMPORT`, 기타 컴파일러 검사인 `GF_SEMANTIC`입니다. 메시지는 파일명과 좌표 접두어를 제외한 사람이 읽는 오류 상세입니다. 가져온 문서의 진단은 그 문서를 `source`에서 이름과 해시로 식별합니다. 또한 루트 파일명, SHA-256, 제공된 문서/리비전 ID를 가진 루트 컴파일 요청을 `requestSource`에 포함합니다. 루트 식별 정보는 하위 문서에 할당하지 않습니다. `GF_IMPORT`는 누락된 import, 리비전/다이제스트 불일치, 순환 import에만 사용합니다. 조합 형식 및 의미 검사는 자체 분류를 유지합니다. 작성된 위치가 없는 입력 검증은 기존 오류를 던지며 진단 span은 제공하지 않습니다.

엔벌로프는 API 메타데이터입니다. GFB 바이트, 지속 저장된 소스 맵 아티팩트, 런타임 동작을 바꾸지 않습니다. 소스 식별 및 실행 출처 정보는 [SOURCE-MAP.md](SOURCE-MAP.md)를 따릅니다.

## 제한된 오류 수집

파싱과 선언 설정이 성공한 뒤 컴파일러는 한 검증 단계 안에서 오류를 수집합니다. 대상 단계는 `let` 바인딩, 다음 상태 할당, 일반 출력 연결 중 하나입니다. 해당 단계에서 실패가 발생하면 수집을 중단합니다. 실패한 `let` 의존 항목은 원래 오류를 재사용해 오해를 부르는 순환 정의 연쇄 오류를 막습니다. 진단은 파일명, 행, 열 순으로 정렬되며 던져지는 예외에는 처음 발견한 오류 메시지가 유지됩니다. Markdown 펜스와 가져온 문서는 작성 당시 위치를 유지합니다. 엔벌로프의 소스 식별 정보는 첫 번째 진단 문서를 설명하고, 각 진단 span은 해당 파일을 식별합니다.

오류 한도는 **서로 다른 오류 20개**입니다. 수집기는 21번째 오류가 있는지 확인한 후 API 엔벌로프 및 CLI JSON/TOON 결과에 `collection: { limit: 20, truncated: true }`를 보고합니다. 이는 더 많은 오류가 발견되었다는 뜻이지 전체 수가 아닙니다. 정확히 20개이면 초과 메타데이터를 설정하지 않습니다. CLI는 API와 동일한 진단을 투영합니다. 컴파일에 실패하면 아티팩트를 반환하거나 쓰지 않습니다.

파서 오류, 선언 설정, 함수 검증, 적응 전략, 제약 조건, 후속 하향 변환은 여전히 첫 오류에서 중단됩니다. 복구는 이 경계를 넘지 않으며 문법 수정을 시도하지 않습니다. 예상하지 못한 내부 오류나 위치가 없는 실패는 이전 소스 오류 이후에도 즉시 다시 던져집니다. 따라서 진단 수집이 컴파일러 실패를 숨기지 않습니다. 보고된 단계를 고치면 이후 단계의 오류가 드러날 수 있습니다. 오류 보고서가 문서 내 모든 실수를 열거한다고 보장하지 않습니다.
