<!-- translation-source: docs/INTENT-DECISIONS.md -->
[영어 원문](INTENT-DECISIONS.md)

# 작성된 의도 결정 확인하기

`tools/intent-decisions.mjs`의 `inspectIntentDecisions(request)`는 canonical GhostFlow source와 컴파일러가 검증한 `intent-evidence-v1`을 조회하는 순수 API다. `node tools/ghostdecisions.mjs --request request.json --format json`은 JSON/TOON CLI이며, 기본 출력 형식은 TOON이다. 이 API는 [#565](https://github.com/callin2/ghostflow-language/issues/565)을 사용하여 [#564](https://github.com/callin2/ghostflow-language/issues/564)을 구현한다.

이 API는 자연어에서 의도를 추론하거나, 질문을 생성하거나, 결정을 승인하거나, 행위자를 인증하거나, 요구사항을 강제하거나, runtime gate를 바꾸거나, 제어 기본값을 합성하지 않는다. 제공된 각 canonical source를 다시 컴파일하고 기존 컴파일러의 작성된 anchor 및 intent evidence 검증을 사용한다. 원래의 외부 record는 컴파일러의 제한적인 구조 결론과 나란히 계속 표시된다. 네 decision kind는 각각 구분해서 유지한다: `confirmed`, `policy-derived`, `assumption`, `undecided`.

## 요청

최상위 객체에는 `schema: "GhostFlow/intent-decisions-request-v1"`과 `current`가 필요하다. `requirementContract`, `previous`, `transitions`를 제공할 수 있다. `transitions`가 있으면 `previous`가 필요하다.

`current`와 선택적인 `previous`에는 각각 다음 항목이 필요하다.

- `source: { text, filename, documentId, revisionId }`. `text`는 완전한 canonical `.ghost.md` 프로그램이고, ID는 작성된 해당 revision을 명시적으로 가리킨다.
- `intentEvidence`: 완전한 `GhostFlow/intent-evidence-v1` record. source와 독립적으로 컴파일하고 결속한다. 이전 evidence의 source digest, interpretation confirmation digest, condition digest 또는 authored node link가 맞지 않으면 거부한다.
- 선택적인 `sourceClosure`: `{ filename, revision, text }`의 제한된 배열로, 명시적 import를 위해 컴파일러에 직접 전달한다. 조회는 import 파일을 디스크에서 읽지 않는다.

Import를 컴파일하면 결과의 `source.sourceClosureSha256`은 import된 document revision과 정확한 text를 포함하는 컴파일러의 canonical closure를 hash한다. Root document/revision ID가 같아도 closure가 바뀌면 `source-revision-reused`에 해당한다. Root source SHA가 바뀌지 않은 경우에도 마찬가지다. Import SHA pin은 컴파일러가 계속 강제한다.

`requirementContract`는 선택적이고 외부에서 제공된다. 형태는 `{ id, revision, reference, requirements }`다. 명시적인 빈 `requirements: []`는 충족되지 않은 요구사항이 없는 `supplied` 상태이고, 생략하면 `not-supplied`다. 각 requirement는 다음 필드를 정확히 포함한다.

```json
{
  "id": "R-PUMP",
  "interpretation": { "id": "I-PUMP", "revision": "r1", "sha256": "<optional exact content SHA-256>" },
  "level": "confirmed",
  "conditionRefs": [{ "id": "C-PUMP", "revision": "r1", "sha256": "<exact condition SHA-256>" }],
  "actionRefs": ["action:deploy"],
  "claimRefs": ["claim:ready"],
  "onUnmet": "hold"
}
```

`interpretation.id`는 필수이고 `revision`, `sha256`은 정확한 pin을 위한 선택 필드다. digest는 기존 `intentInterpretationDigest`이며, 해석된 내용은 포함하지만 주장된 confirmation은 제외한다. `conditionRefs`는 선택 필드다. 제공하는 경우 해당 interpretation이 소유한 condition의 정확한 id/revision/digest 참조를 담는다. `level`은 `represented` 또는 `confirmed`다. `represented`는 일치하는 interpretation과 제공된 condition 참조만 요구한다. assumption 또는 undecided 상태도 포함할 수 있으며 그 상태를 바꾸지 않는다. `confirmed`는 여기에 더해 컴파일러가 보고한 `recorded` confirmation(현재 상태인 policy-derived decision 포함)과 **제공된 각 condition 참조**의 `recorded` 상태를 요구한다. condition 참조를 제공하지 않으면 interpretation decision만 검사하며, 모든 condition이 확인되었다고 간주하지 않는다. `onUnmet`은 `report`, `hold`, `block` 중 하나다. `actionRefs`와 `claimRefs`는 서로 구분되는 고유 문자열 배열이다. 이는 외부 consumer를 위한 메타데이터로 반환된다. 조회가 hold 또는 block을 실행하지 않는다.

미충족 code는 interpretation 누락, interpretation revision/content 불일치, condition 누락 또는 변경, confirmed 범위 밖 condition, `undecided`, `unconfirmed`, `policy-not-current` 같은 decision 상태를 구분한다. 명시적으로 제공된 requirement만 검사한다. contract가 없으면 누락된 requirement를 추론하지 않는다.

## 이전 revision과 transition

`previous`가 제공되면 독립적으로 컴파일하고 검증한다. 각 interpretation 행에는 다음이 포함된다.

- `contentSha256`: decision을 제외한 해석된 내용에 대해 컴파일러가 기존 방식으로 계산하는 digest.
- `recordSha256`: canonical JSON `{ interpretation, conditions }`의 SHA-256. 완전한 decision과 해당 interpretation이 소유한 **모든 condition**을 포함한다. 따라서 해석 문장이나 bytecode가 바뀌지 않아도 condition만 바뀌면 이 비교 identity가 달라진다.

비교 결과에는 완전한 record 양쪽과 함께 `added`, `removed`, `unchanged`, `changed` 행이 반환된다. ID가 같으면 ID 기준으로 짝을 짓는다. ID가 다른 rename은 모호하지 않은 명시적 transition을 통해서만 짝을 짓는다. Transition은 `{ from: { id, revision, sha256 }, to: { id, revision, sha256 }, actor, recordRef, at }` 형태이며 digest는 전체 `recordSha256` 값이다. 각 pin은 일대일이어야 하며 중복, 모호함, 오래됨, 불일치가 있는 pin은 거부한다. transition이 없는 변경 행에는 `transition-link-missing`이 붙는다. 같은 ID와 revision에서 해석된 내용이 바뀌면 `interpretation-revision-reused`가 붙고, condition ID와 revision이 같은데 condition 내용이 바뀌면 `condition-revision-reused:<id>`가 붙는다. Root 비교는 document ID와 revision ID가 같은데 source bytes가 바뀐 경우 `source-revision-reused`를 표시한다. 이는 진단이며 runtime blocker가 아니다. decision이나 condition만 바뀌면 해석 내용 revision은 그대로 둘 수 있지만, 변경된 전체 record에는 여전히 transition link가 필요하다. 이름 변경에는 동일 ID의 interpretation revision 경고를 적용하지 않는다. 이전 confirmation을 현재 source로 자동 이전하지 않는다.

## 결과와 한도

성공 결과는 `GhostFlow/intent-decisions-result-v1`, `outcome: "completed"`, 정확한 request/source/evidence digest, `current.decisions`, `current.judgments`, `requirements`, `comparison`, `trust`를 반환한다. 각 decision에는 원래 interpretation, 원래 source 참조, decision, 해당 interpretation이 소유한 모든 condition과 confirmation 범위 및 external check ID가 유지된다. 기존 judgment는 `not-evaluated`로 남고, 행위자 권한은 `not-authenticated`로 남는다. Policy의 `current`, `expired`, `unknown`은 원래 record에서 각각 구분되며, expired/unknown은 `confirmed` requirement를 충족할 수 없다. Source와 bytecode hash는 별도로 보고하므로 bytecode가 같더라도 prose 변경을 구별할 수 있다.

입력은 순환이 없는 JSON 데이터이며 직렬화된 UTF-8 기준 524,288 bytes, 깊이 24로 제한된다. Source text는 최대 262,144자다. Source closure는 최대 32개 항목이며, requirements, transition record 및 기타 제한 목록은 최대 128개 항목이다. 희소 배열, 중복 ID/참조, 잘못된 필드, 잘못된 timestamp는 거부된다. API는 컴파일 전에 입력을 복사하며 결과는 호출자 객체와 별칭을 공유하지 않는다. 완전한 출력은 UTF-8 기준 최대 524,288 bytes다. 확장 결과가 이 한도를 넘으면 API는 정확한 request SHA-256과 `output-limit` 진단이 포함된 `outcome: "incomplete"`만 반환하며, 충족 또는 확인된 답변의 일부는 제공하지 않는다. CLI는 종료 코드 1로 끝난다. 형식이 잘못된 입력은 CLI에서 `rejected`를 출력하고 종료 코드 1로 끝난다.

저장소 root에서 실행 가능한 허구 regression을 실행한다.

```sh
node --test tests/intent-decisions.test.mjs
```

이 테스트는 네 decision 상태, 일부만 확인된 상태, 명시적 requirement 정책, source 변경, 정확한 transition, 한도, JSON/TOON parity를 다룬다. Fixture의 행위자와 참조는 만들어낸 값이며, 외부 권한이나 device 동작을 입증하지 않는다.
