<!-- translation-source: docs/INTENT-EVIDENCE.md -->
# 의도 근거 작성 API

[원문](INTENT-EVIDENCE.md)

공통 [의도 책임 계약](INTENT-CONSISTENCY-CONTRACT.md)을 구현하며 [#565](https://github.com/callin2/ghostflow-language/issues/565)에서 추적한다.
컴파일러는 외부 해석/결정/조건 기록을 검증하고 보존할 수 있다. 구조, 정확한 소스 identity, 작성된 링크와 내부 판본 일관성을 검사한다. 자연어를 해석하거나, 결정 권한을 인증하거나, 조건을 실행하거나, 장치를 관측하지 않는다.

## 공개 진입점

`tools/toolchain.mjs` (Node)와 `tools/browser-toolchain.mjs` (browser/Worker)는 모두 `compileSource(source, { filename, intentEvidence })`를 받는다. 선택적 record는 `compilation.intentEvidence`에 `GhostFlow/intent-evidence-report-v1` 보고서를 추가한다. 옵션이 없으면 기존 컴파일 출력은 바뀌지 않는다. 유효한 근거의 유무에 따라 GFB bytes와 control manifest는 바뀌지 않는다.

두 진입점은 `intentInterpretationDigest`, `intentConditionDigest`, `INTENT_EVIDENCE_LIMITS`를 export한다. Digest는 정렬된 object key와 보존된 array 순서를 사용하는 canonical JSON으로 계산한다. Interpretation digest에는 `id`, `revision`, `original`, `text`, `anchorIds`가 포함되고 decision은 제외된다. Condition digest에는 record 전체가 포함된다.

제공된 metadata가 유효하지 않으면 구조화된 진단과 `evidencePath`를 포함한 `GF_INTENT_EVIDENCE` 오류를 던진다. 유효한 assumption, undecided 항목, 누락된 외부 검사, 부분 확인 interpretation은 컴파일 오류를 일으키지 않는다. 이는 선택적 작성 요청을 검증하며 runtime이나 배포 gate를 추가하지 않는다.

## Record schema

아래에 명시한 모든 필드는 별도 표시가 없는 한 필수다. 알 수 없는 필드, 중복 식별자, 유효하지 않은 enum 값, 맞지 않는 참조는 거부한다. 이는 provenance record이며 실행 가능한 conditions DSL이 아니다.

| Record | Fields |
|---|---|
| Root | `format: GhostFlow/intent-evidence-v1`, `sourceDocumentSha256`, `interpretations[]`, `conditions[]`, `checks[]` |
| Interpretation | `id`, `revision`, `original: { id, revision, reference }`, `text`, `anchorIds[]`, `decision` |
| Condition | `id`, `revision`, `interpretation: { id, revision }`, `statement`, `scope`, `nodeIds[]` |
| Condition reference | `id`, `revision`, `sha256` from `intentConditionDigest` |
| External check | `id`, `judgment`, `conditions[]` of condition references, `result`, `producer`, `evidenceRef`, `scope`, `at`, `context` |

ID와 revision 이름은 `[A-Za-z][A-Za-z0-9._:-]{0,127}`에 맞는다. Compiler node ID는 `sourceMap`/`intentLinks`가 반환하는 숫자 ID다. 소스 줄이나 이름으로 만들지 말고 컴파일 결과에서 복사한다. 각 condition node에는 해당 interpretation의 anchor 중 하나로 향하는 기존 작성 link가 있어야 한다. 빈 node list는 허용되며 link 없음으로 보고된다. 컴파일의 intent metadata에 있는 anchor만 선택할 수 있다. 이는 가져온 문서나 annotation이 없는 코드의 link를 추론하지 않는다.

Original reference는 호출자가 제공하는 외부 불변 record 위치다. 컴파일러는 이를 가져오거나 인증하지 않고 보존한다. `statement`와 `scope`는 외부에서 선택한 단위, 시간, 가정, 관측 범위를 포함해 해석되지 않는 텍스트로 남는다. Array 순서는 record hash에 포함된다. Record는 프로그램 일부를 다룰 수 있으며, 표현되지 않은 활성 anchor는 coverage에 계속 표시된다.

제한: canonical UTF-8 기준 262,144 bytes, 각 array 최대 128개 항목, 일반 텍스트 필드당 최대 8,192자, canonical JSON 중첩 깊이 16. Sparse array, 유한하지 않은 수, 안전 범위를 벗어난 정수, 잘못된 Unicode, JSON이 아닌 object는 거부된다. CLI는 추가로 원본 파일 크기를 제한한다. Timestamp는 초 단위 또는 밀리초 세 자리의 `Z` 형식 유효 UTC ISO 문자열이어야 한다. 시간 유효성은 문법 검사일 뿐이며 실제 시계나 정책상 경과 시간을 추론하지 않는다.

### Decision variants

| `decision.kind` | Additional fields | Meaning |
|---|---|---|
| `confirmed` | `actor`, `authorityRef`, `recordRef`, `at`, `interpretationSha256`, `conditions[]` of exact condition references | Hash된 interpretation과 나열한 condition에 대해 제공된 확인 record다. 권한은 인증되지 않은 상태로 남는다. |
| `policy-derived` | All confirmed fields plus `policy: { id, revision, reference }`, `applicationRef`, `validity: current/expired/unknown` | 정책/적용 근거를 보존한다. `current`는 제공자의 주장이고 컴파일러가 확립하지 않는다. 적용 가능성이 만료/unknown이면 `policy-not-current`로 표시한다. |
| `assumption` | `actor`, `reason` | LLM 제안이다. 연결된 anchor는 `kind=assumption status=unconfirmed origin=ai`여야 한다. |
| `undecided` | `question`, `owner` (nonempty text or `null`) | 해결되지 않은 외부 결정이다. 연결 anchor가 있다면 unconfirmed여야 한다. 새 anchor enum은 도입하지 않는다. |

Confirmed/policy-derived record는 anchor가 제공된 경우 기존 confirmed intent/premise anchor를 요구한다. 작성된 assumption을 조용히 확인 처리할 수 없다. Superseded anchor는 거부된다. 하나의 활성 anchor는 이 record에서 여러 current interpretation을 가질 수 없다. 확인의 명시 목록 밖에 있는 condition은 `outside-confirmed-scope`로 남는다. 빈 목록은 코드 condition을 하나도 확인하지 않는다. 이전 confirmation digest를 유지한 채 interpretation text 또는 나열된 condition을 바꾸면 실패한다. Hash는 일관되지 않은 재사용을 감지하지만, 일관되게 다시 작성한 위조 confirmation을 감지하지는 않는다.

### External check context

`judgment`는 `requirements-consistency`, `code-compliance`, `device-compliance` 중 하나다. `result`는 `satisfied`, `violated`, `unknown` 중 하나다. 각 check는 정확한 condition 판본/digest를 하나 이상 참조하고 다음을 제공한다.

| Context field | Rule |
|---|---|
| `sourceDocumentSha256`, `bytecodeSha256` | 이 canonical compilation과 같아야 한다. |
| `method` | `static`, `scenario`, `physical` 중 하나다. |
| `setupRef` | Checker/runtime/target 판본, inputs, initial state, settings, verification scope를 기록한 외부 record다. 역참조하지 않고 보존한다. |
| `run` | `scenario`/`physical`에서는 필수이고 `static`에서는 금지한다: `{ id, scanId, logicalTimeMs }`. Scan/time은 음수가 아닌 안전 정수다. |
| `device` | `physical` 및 `device-compliance`에서만 필수다: `{ id, installationRef, commandRef, observationRef, clockRef, stage, quality }`. |

Device `stage`는 `requested`, `safe`, `applied`, `readback`, `confirmed` 중 하나이며 `quality`는 `ok`, `unknown`, `fault` 중 하나다. 이들은 보고되는 증거 단계다. ACK나 호출자의 `satisfied` 결과가 물리 증명으로 바뀌지는 않는다. Check의 run/time/device 필드는 보존되고 형태가 검사되지만, 이 컴파일러는 대조할 신뢰 가능한 현재 runtime sample을 갖고 있지 않다. 소비자는 자신의 관측 경계에서 해당 identity와 증거를 검증해야 한다. 모순되는 외부 주장은 새로 인증된 판단이 아니라 보고된 주장으로 드러난다.

## 결과 읽기

`validation`은 구조/source/link 일관성 검사의 성공을 보고한다. `decisions`는 각 결정 분류와 확인 범위를 `authority: not-authenticated`와 함께 보존한다. `conditions`에는 node/check ID와 `recorded`, `outside-confirmed-scope`, `policy-not-current`, `unconfirmed`, `undecided` 확인 상태가 나열된다. `coverage`에는 표현되지 않은 anchor와 link가 없는 condition이 나열된다.

`externalChecks`는 `trust: external-report`와 함께 `reportedResult`를 노출한다. 네 `judgments`는 모두 `not-evaluated`다. metadata checker 자체는 의도, 요구사항, 프로그램, 장치를 판단하지 않는다. 실제 소유자가 사용할 수 있도록 필요한 record를 제공한다. 전체적인 intent-compliant Boolean은 생성하지 않는다. 보고서에는 분리된 검증 record, `recordSha256`, source digest, bytecode digest가 포함된다.

## 실행 가능한 작성 예제

저장소 루트에서 Node의 module 입력 모드로 다음 JavaScript를 실행한다. 기존 가상 펌프 fixture를 사용하며 아래 confirmation은 예제 데이터일 뿐 실제 운전 승인이 아니다. 두 번째 condition은 의도적으로 확인 범위 밖에 둔다.

```js
import fs from 'node:fs';
import { compileSource, intentInterpretationDigest, intentConditionDigest } from './tools/toolchain.mjs';
const filename = 'examples/authoring/pump-rev-2.ghost.md';
const source = fs.readFileSync(filename, 'utf8');
const base = await compileSource(source, { filename });
const interpretation = {
  id: 'I-PERMIT', revision: 'r1',
  original: { id: 'U-PERMIT', revision: 'r1', reference: 'example:fictional-request' },
  text: 'Block the pump when permission is absent.',
  anchorIds: ['GF-INT-PUMP-PERMIT'],
};
const condition = {
  id: 'C-PERMIT', revision: 'r1', interpretation: { id: 'I-PERMIT', revision: 'r1' },
  statement: 'Safe pump intent is OFF when permission is false.',
  scope: 'Logical accepted scans only; no physical stopping deadline.',
  nodeIds: base.traceMetadata.intentLinks.filter(x => x.anchorId === 'GF-INT-PUMP-PERMIT' && x.relation === 'constrains').map(x => x.nodeId),
};
interpretation.decision = {
  kind: 'confirmed', actor: 'fictional-operator', authorityRef: 'example:authority',
  recordRef: 'example:confirmation', at: '2026-10-19T00:00:00Z',
  interpretationSha256: intentInterpretationDigest(interpretation),
  conditions: [{ id: condition.id, revision: condition.revision, sha256: intentConditionDigest(condition) }],
};
const evidence = {
  format: 'GhostFlow/intent-evidence-v1', sourceDocumentSha256: base.sourceDocument.sha256,
  interpretations: [interpretation],
  conditions: [condition, { ...condition, id: 'C-RESTART', statement: 'Restart behavior is not confirmed.', nodeIds: [] }],
  checks: [],
};
const result = await compileSource(source, { filename, intentEvidence: evidence });
console.log(result.intentEvidence.conditions);
fs.mkdirSync('build/intent-evidence', { recursive: true });
fs.writeFileSync('build/intent-evidence/record.json', JSON.stringify(evidence, null, 2));
```

예상 상태는 `C-PERMIT: recorded`, `C-RESTART: outside-confirmed-scope`다. 시나리오는 실행하지 않았으며 `checks`는 비어 있다. 구조화 CLI 요청에는 선택적 파일 경로를 다음처럼 추가한다.

```toon
format: GhostFlow/cli-request-v1
operation: check
source:
  path: examples/authoring/pump-rev-2.ghost.md
  documentId: GF-EXAMPLE-PUMP
  revisionId: rev-2-input-v1
intentEvidencePath: build/intent-evidence/record.json
```

이 요청을 `build/intent-evidence/request.toon`으로 저장하고 `node tools/ghostc.mjs --request build/intent-evidence/request.toon --format json`을 실행한다. CLI는 `intentEvidence`에 보고서를 반환하며 기본 출력 형식은 TOON이다. `operation: compile`에서는 `artifactPath`도 제공한다. 누락/형식 오류/크기 초과 evidence 파일과 일관성 없는 record는 `GF_INTENT_EVIDENCE`와 함께 0이 아닌 종료 상태를 반환한다. 기존 artifact 파일은 교체하지 않는다.

## Persistence and supported boundary

`writeArtifact`는 standalone `.map.json` companion의 선택적 `intentEvidence` field에 검증된 record를 저장한다. `restoreArtifactSourceMap`은 canonical source를 재컴파일하고 record를 검증해 새로 도출된 보고서를 반환한다. 저장된 verdict를 신뢰하지 않는다. 특정 record가 필요한 호출자는 `expectedSourceSha256`와 함께 `expectedIntentEvidenceSha256: report.recordSha256`를 전달한다. 그러면 record 누락 또는 변경 시 거부된다. 기대 digest가 없으면 record가 없는 일반 artifact와의 호환성을 위해 부재를 허용한다. 서명되지 않은 map과 hash는 작성자 인증이나 공모된 교체 방지를 제공하지 않는다.

`portable-package-v1`은 별도의 엄격한 서명 source-map profile을 갖는다. 이 외부 작성 record를 전달하지 않는다. Builder는 근거가 포함된 compilation을 `unsupported-intent-evidence`로 명시적으로 거부해 조용한 손실을 막는다. 해당 package profile을 사용할 때는 외부 record를 별도 보존하고 의도적으로 옵션 없이 컴파일한다. 이 구현은 서명 package 형식, firmware, runtime, 승인 서비스, 배포 정책을 변경하지 않는다. 향후 서명 package를 통한 전달은 같은 evidence 경계를 유지하고 소비자 호환성을 명시적으로 정해야 한다.

실행 가능한 회귀 검사 모음은 `tests/intent-evidence.test.mjs`이며 전체 검증과 coverage에 등록되어 있다. 부분 결정, GFB가 유지된 판본 불일치, 유효하지 않은 link, 외부/물리 주장 한계, browser 동작, persistence, CLI artifact 보존을 다룬다. 기존 anchor/CLI 및 package 검사는 주변 계약을 계속 다룬다.
