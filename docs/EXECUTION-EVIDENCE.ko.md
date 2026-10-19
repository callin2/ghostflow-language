<!-- translation-source: docs/EXECUTION-EVIDENCE.md -->
[영어 원문](EXECUTION-EVIDENCE.md)

# 완료된 실행 하나 설명하기

`tools/execution-evidence.mjs`는 호출자가 제공한 accepted scan 하나를 순수하게 투영하는 `explainExecution(request)`를 내보낸다. `node tools/ghostwhy.mjs --request request.json --format json`은 JSON 또는 TOON에서 같은 결과를 제공하며, 기본 출력 형식은 TOON이다. 이 계약은 공통 [#565](https://github.com/callin2/ghostflow-language/issues/565) 계약에서 [#563](https://github.com/callin2/ghostflow-language/issues/563)을 구현한다.

API는 명시적인 document 및 revision ID와 함께 canonical `.ghost.md` source를 다시 컴파일한다. 컴파일러의 output explanation, completed-scan snapshot, 정확한 proof/snapshot join을 재사용한다. 새 evaluator를 실행하거나 device에 접속하지 않는다. Accepted scan 결과는 여전히 호출자가 제공한다. runtime outcome에는 native run ID가 없으므로 `runId`는 호출자가 주장하는 값이며, 생성된 proof와 snapshot 전반에서 일관되는지 검사한다. 이 절차는 runtime producer를 인증하지 않는다. 기존 explanation은 제한된 Boolean requested-output 경로를 지원한다. 지원하지 않는 kind와 꺼진 instruction witness는 `unavailable`로 남고, 건너뛴 노드는 `not-evaluated`로 남는다. 조합된 source는 `sourceClosure`로 제공할 수 있지만, 기존 explanation producer는 투영할 output strategy가 없어 조합 artifact를 거부한다. API는 import를 디스크에서 읽지 않는다.

## 요청

최상위 객체에는 정확한 `schema: "GhostFlow/execution-evidence-request-v1"`, `source`, `runId`, `outputId`, `result`가 있어야 한다. 선택 필드는 `sourceClosure`, `intentEvidence`, `expectedDevice`, `deviceEvidence`다.

| 필드 | 계약 |
| --- | --- |
| `source` | 완전한 canonical literate source의 `{ text, filename, documentId, revisionId }`. `text`는 최대 262,144자다. |
| `sourceClosure` | 컴파일러에 전달하는 `{ filename, revision, text }` 객체의 제한된 배열(선택). 파일을 조회하지 않는다. |
| `runId` | 기존 snapshot validator가 검사하는 공개 execution epoch. |
| `outputId` | 정확한 requested output ID. 예: `output.pump`. |
| `result` | 완료된 scan 하나에서 호출자가 제공한 `{ accepted: true, outcome }`. 가능한 경우 trace와 instruction witness를 포함한다. 기존 explanation/snapshot validator가 module, source, completion, output 및 witness 경로를 검사한다. |
| `intentEvidence` | 컴파일러가 검증하고 결속하는 완전한 `GhostFlow/intent-evidence-v1` record(선택). 원래 interpretations, conditions, decisions 및 external checks는 계속 제공된 record다. |
| `expectedDevice` | `deviceEvidence`와 함께 필수: `{ deviceId, bootId, installationRef, clockRef, requestId }`. 이 예상 ID들은 evidence bundle과 별개로 호출자가 제공한다. |
| `deviceEvidence` | 아래 설명의 `{ identity, records }`(선택). |

`deviceEvidence.identity`에는 `sourceDocumentId`, `sourceRevisionId`, `sourceSha256`, `bytecodeSha256`, `runId`, `scanId`, `logicalTimeMs`, `outputId`, `deviceId`, `bootId`, `installationRef`, `clockRef`, `requestId`가 필요하다. 앞의 여덟 항목은 컴파일된 source 및 accepted scan과 대조하고, 뒤의 다섯 항목은 `expectedDevice`와 대조한다. bundle의 모든 stage는 **producer가 주장한 대로** 이 envelope identity를 공유한다. 불일치가 있으면 identity 진단과 함께 전체 bundle이 `unlinked`로 남고, 어떤 stage도 device 결론에 기여하지 않는다.

`records`는 최대 128개 record의 배열이다. 각 record에는 `kind`, `id`, `requestId`, 정규 UTC 밀리초 `at`, 불투명한 `ref`가 필요하다.

| Kind | 추가 필드 | 의미 |
| --- | --- | --- |
| `driver-request` | `stage: "requested" \| "safe"`, Boolean 또는 유한한 숫자 `value` | `id`와 `requestId`에 envelope request ID를 사용해야 한다. 값은 선택한 stage의 실제 output 값과 같아야 한다. |
| `ack` | `outcome: "accepted" \| "rejected" \| "fault" \| "unknown"` | ACK는 정확한 driver request ID를 참조한다. Acceptance는 보고된 command 결과이며 물리적 확인이 아니다. |
| `register-readback` | `quality: "ok" \| "fault" \| "unknown"`, `ok`일 때만 `value` | 호출자가 제공한 register 관측. |
| `physical-feedback` | 같은 quality/value 규칙 | 호출자가 제공한 물리 관측이며 여기서 독립 검증하지 않는다. |

하나의 request에는 각 kind의 record를 하나씩만 허용한다. 누락된 stage는 각각 따로 나열한다. 한 stage에 서로 다른 ID가 있거나, record가 중복되거나, 참조 대상이 없거나, request ID가 틀리거나, stage 값이 accepted scan과 다르거나, 보고 값이 request와 다르거나, 보고 timestamp가 driver request보다 앞서면 진단을 남긴다. 검토할 수 있도록 record를 보존한다. 최신 항목 우선 선택은 없으며 timestamp 근접성으로 join하지 않는다. timestamp는 정규 형식인지, 제공된 clock reference 안에서 불가능한 순서가 있는지만 확인한다. API는 clock 정확성, device 권한, 서명, 전송 또는 물리적 효과를 검증하지 않는다.

## 결과

성공 결과에는 `schema: "GhostFlow/execution-evidence-result-v1"`과 `outcome: "completed"`가 있다. 정확한 source document/revision/bytecode identity, scan completion, `requestSha256` 및 다음 정보가 포함된다.

- `requested.value`, `requested.proof`, `requested.descriptor`: 실제 requested 값, 평가되거나 건너뛴 노드의 제한된 proof, canonical node/source/anchor mapping. 평가된 노드의 `supportsResult`는 requested Boolean proof 경로만 설명한다.
- `safe.value`: 같은 accepted scan의 safe output. 선언된 output type과 대조하며 requested intent와 분리해 둔다. renderer가 적용했다는 주장은 하지 않는다.
- `authored`: 컴파일러가 검증한 원래 interpretations와 conditions, confirmation 범위, external checks, 각 condition의 authored-node와 이 requested proof 간 관계. `supports-requested-result`는 연결된 authored node가 runtime expression 결과를 뒷받침한다는 뜻이다. interpretation이나 requirement가 옳다는 증거는 아니다. `not-evaluated` 상태를 명시적으로 유지한다. Intent-fit, compliance, device 판단은 계속 `not-evaluated`다.
- `device`: 호출자가 제공한 원래 envelope와 records, `not-authenticated` 신뢰 상태, 진단. 상태는 `not-supplied`, `unlinked`, `linked-external-report`, `conflicted` 중 하나다. 완전히 연결된 bundle도 external report로 남으며, 물리적 성공이나 compliance 판정이 아니다.

형식이 잘못된 입력이나 유효하지 않은 compiler/proof join은 오류를 발생시킨다. CLI는 `outcome: "rejected"`를 출력하고 종료 코드 1로 끝난다. 완전한 요청은 직렬화된 UTF-8 기준 524,288 bytes, 깊이 24, device record 128개로 제한된다. 출력 한도는 524,288 bytes다. 확장 결과가 이 한도를 넘으면 API는 `output-limit` 진단을 담은 `outcome: "incomplete"`를 반환하고 일부 evidence는 반환하지 않는다. CLI는 종료 코드 1로 끝난다. 컴파일 전에 입력을 복사하며 결과는 호출자 객체와 별칭을 공유하지 않는다.

실제 local WASM scan과 JSON/TOON parity를 포함한 실행 가능한 허구 regression은 다음으로 실행한다.

```sh
node --test tests/execution-evidence.test.mjs
```

테스트의 device ID와 보고는 만들어낸 값이다. local WASM scan은 host 동작만 확인하며 Device 설치, 하드웨어 관측 또는 농부 수용 결과가 아니다.
