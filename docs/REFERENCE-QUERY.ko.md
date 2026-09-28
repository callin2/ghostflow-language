<!-- translation-source: docs/REFERENCE-QUERY.md -->
[영문 원문](REFERENCE-QUERY.md)

# 언어 참조 선택 조회

`tools/reference-query.mjs`는 호출 시점에 정본 [언어 참조](LANGUAGE-REFERENCE.md) 색인과 연결된 장을 읽습니다. 번호가 매겨진 `##` 절의 결정적 카탈로그를 출력합니다. 언어 규칙의 사본을 따로 보관하지 않습니다.

절 ID는 정본 제목의 번호가 매겨진 장과 절을 이용해 `ref-CC-SS` 형식으로 정합니다. 예를 들어 `ref-02-08`은 §2.8입니다. 제목이 바뀌어도 ID는 유지될 수 있습니다. 규칙을 다른 번호의 절로 옮기면 ID가 바뀝니다. 각 행에는 정본 소스 경로, 제목, GitHub 제목 인용, 분류, 주제 및 심볼 별칭, 정확한 발췌 바이트 수와 SHA-256 다이제스트가 포함됩니다. 분류는 검토된 절에 대해 관리됩니다. `unspecified`는 모든 문단이 규범적인지 도구가 주장하지 않는다는 뜻입니다. 인용된 본문을 직접 확인하세요. `sourceDigest`는 색인과 연결된 모든 장의 경로 및 SHA-256 다이제스트를 해싱합니다. 카탈로그는 호출할 때마다 다시 생성됩니다. 중복 ID와 오래된 별칭은 실패 처리됩니다.

## TOON 요청 및 결과

요청은 엄격한 TOON 객체입니다. 필드는 `operation` (`catalog` 또는 `lookup`), `budgetBytes` (정수 256–1,000,000), 그리고 lookup일 때 `sectionId`, `topic`, `symbol` 중 정확히 하나입니다. 선택자는 비어 있지 않은 문자열이어야 합니다. 알 수 없는 필드는 거부됩니다. 주제 조회는 대소문자를 구분하지 않으며, 심볼과 절 ID 조회는 정확히 일치해야 합니다. 알려진 주제 및 심볼 별칭은 카탈로그에 표시됩니다. `no_match`와 `budget_exceeded`는 명시적인 상태입니다. 성공한 TOON 응답은 메타데이터와 발췌를 포함해 `budgetBytes` 안에 들어갑니다. 작은 오류 응답은 일치 항목이 한도를 넘을 때 `requiredBytes`를 보고합니다.

```toon
operation: lookup
sectionId: ref-02-08
budgetBytes: 20000
```

`markdown` 필드는 장의 해당 절을 바이트 단위로 정확하게 잘라낸 결과로 디코딩됩니다. 제목과 마지막 개행도 포함됩니다. TOON 문자열 이스케이프는 전송 문법이며, 디코딩된 필드는 원본 Markdown입니다. 절 다이제스트로 이를 검증할 수 있습니다.

```sh
node tools/reference-query.mjs --toon-request request.toon
node tools/reference-query.mjs --toon-request - < request.toon
```

## 사람이 사용하는 CLI

```sh
node tools/reference-query.mjs catalog
node tools/reference-query.mjs lookup --section ref-02-08
node tools/reference-query.mjs lookup --topic timer --budget 20000
node tools/reference-query.mjs lookup --symbol ghostflow:anchor
```

사람용 조회는 원본 Markdown 앞에 인용 정보와 다이제스트를 출력합니다. 기본 예산은 32,768바이트입니다. `--budget`으로 변경할 수 있습니다. 일치 항목이 없으면 종료 상태 1, 잘못된 요청 또는 예산 초과는 종료 상태 2입니다.

이 조회는 주제 이름으로 문법을 추론하지 않습니다. 규칙이 더 넓은 맥락에 의존하면 인용된 정확한 절과 주변 장을 함께 읽으세요.
