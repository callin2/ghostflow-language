<!-- translation-source: docs/FAILURE-REDUCTION.md -->
# 제한된 실패 축소

[원문](FAILURE-REDUCTION.md) · [의도 책임 계약](INTENT-CONSISTENCY-CONTRACT.md) · [#561](https://github.com/callin2/ghostflow-language/issues/561)

`tools/failure-reduction.mjs`의 `reduceFailure(request)`는 정본 `.ghost.md` 프로그램 하나에 대해 실패하는 `GhostFlow/scenario-v1`을 축소한다. 호출자는 기대값과 그 요구사항 판본을 제공한다. 도구는 프로그램에서 oracle을 도출하거나, 의도를 추론하거나, 근본 원인을 식별하거나, 물리 장치를 조작하지 않는다. 각 후보는 기존 `ghostsim` Rust 네이티브 또는 WASM scenario 경로로 프로그램의 정본 초기 상태부터 실행한다.

## 요청

| Field | Contract |
|---|---|
| `format` | `GhostFlow/failure-reduction-request-v1` |
| `program` | `{ filename, source }`. 선택적으로 `sourceClosure`와 #565의 정확한 `intentEvidence` record를 포함할 수 있다. `filename`은 `.ghost.md`로 끝나야 한다. |
| `scenario` | 초기 입력, 환경 profile, 순서가 있는 action을 포함하는 완전한 `GhostFlow/scenario-v1`. Action을 제거하면 이후 유효 입력이 바뀔 수 있으므로 폐루프 `plant`는 제외한다. |
| `predicate` | `{ kind: 'equals', observation, expected, at, when? }`. `observation`은 `requested`, `safe`, `stateBefore`, `stateAfter`의 `{ field, name }` 또는 전체 fault 목록을 위한 `{ field: 'faults' }`다. `at`은 `{ actionIndex, logicalTimeMs }`이며 정확히 그 시각인 원본 scan action 하나를 가리켜야 한다. 실패는 해당 scan의 실제 값이 `expected`와 **같지 않은 것**이다. 선택적 `when`은 동일 scan에서 평가하는 equality guard `{ observation, expected }`를 최대 8개 담는 비어 있지 않은 배열이다. |
| `requirement` | 외부 `{ id, revision, sha256, reference }`. 호출자의 기대 판본을 식별한다. 컴파일러는 가져오거나 인증하지 않고 보존한다. |
| `condition` | 선택 항목이며 `program.intentEvidence`에 있는 정확한 #565 condition의 `{ id, revision, sha256 }`다. 확인 범위를 보존하고 권한은 `not-authenticated` 상태로 둔다. |
| `maxAttempts` | 정수 1..128. scenario 검증에서 거부된 후보를 포함해 고려한 단일 action 삭제를 모두 센다. 원본 확인 실행은 별도이며 이 예산을 사용하지 않는다. |

알 수 없는 필드와 유효하지 않은 source, scenario, field, condition identity, budget, action/time identity는 거부된다. 첫 비동기 compile 전에 요청을 canonical JSON으로 캡처하며 크기는 3 MiB로 제한된다. Scenario bytes는 256 KiB로 제한된다. CLI는 같은 요청을 JSON 또는 TOON으로 받으며 callback이나 외부 코드를 실행하라는 지시는 허용하지 않는다.

## 검색과 결과

축소 기준은 **action 수**다. 대상 scan action은 유지하며 그 외 action은 보호되지 않는다. Reducer는 원래 순서대로 action을 하나씩 삭제해 본다. 후보가 검증되고, 새 scenario 실행이 완료되며, 제공한 모든 `when` guard가 기대값과 같고, 정확한 대상 관측값이 같은 고정 기대값을 계속 위반할 때만 삭제를 수락한다. 모든 관측은 scan ID가 바뀌더라도 보존된 대상 scan에서 한다. 수락하면 짧아진 sequence의 처음부터 검색을 다시 시작한다. Action 시각, 값, 순서, 환경, 초기 입력은 다시 쓰지 않는다. 각 삭제 후 대상의 새 scan ID를 재계산하며 보고서는 유지된 원본 scan action index를 새 scan ID에 대응시킨다.

같은 실패를 식별하는 데 필요한 조건은 호출자가 명시해야 한다. 예를 들어 “Disconnected sensor fault 중 펌프가 계속 ON”을 축소하려면 source가 `Disconnected`에만 해당하는 Boolean을 노출하고, 주 predicate에서 펌프 OFF를 기대하면서 `when`으로 해당 Boolean이 참임을 요구할 수 있다. 임의의 sensor fault를 검사하는 guard는 `NotReady`에도 일치하므로 범위가 달라진다. 도구는 guard를 추론하거나 인증하지 않는다. 전체 고정 predicate와 guard는 결과에 보존되고 hash된다. `when`이 없으면 주 equality 위반만 요구한다.

`outcome: 'reproduced'`에는 실행 가능한 `reducedScenario`, 원본/축소 scenario hash, source/GFB/manifest/선택적 closure hash, 선택한 runtime 및 host hash, WASM일 때 Node version, 고정 predicate와 digest, requirement identity, condition binding, 원본/축소 관측, 시도 횟수와 삭제 이력이 포함된다. `sourceBinding`은 이름이 있는 관측과 연결된 compiler node 및 source 위치를 제공한다. 이는 관측된 위반 위치이지 원인이나 수정 위치가 아니다. `physicalEffects`는 항상 `false`다.

`reductionStatus: 'single-deletion-minimal'`은 완전한 최종 검사에서 검증되고 실행 완료되며 동일 위반을 유지하는 action 하나 삭제가 없었다는 뜻이다. 전역적으로 가장 짧은 scenario라고 주장하지 않는다. 고정 predicate를 계속 위반하는 한 관측값 자체는 달라질 수 있다. `budget-exhausted`는 후보 제한으로 검색이 중단됐다는 뜻이다. `unresolved-candidates`는 최종 검사 후보에 관측 누락 또는 실행 실패가 있어 minimality를 주장하지 않는다는 뜻이다. 유효하지 않은 후보는 기록되지만 실패 재현으로 인정되지 않는다.

원본 실행에서 guard가 하나라도 성립하지 않으면 결과는 `original-not-applicable`이며 축소를 시작하지 않는다. Guard가 성립하지만 원본 실행이 완료되어 주 predicate가 기대값과 일치하면 결과는 `original-not-failing`이다. 원본 실행이나 선택된 관측이 하나라도 없으면 결과는 재현 실패가 아니라 `incomplete`다. 후보의 guard가 거짓이면 거부한다. Guard 관측 누락 또는 runtime/host 실패는 `unknown` 시도이며 수락하거나 minimality의 근거로 삼을 수 없다. Runtime 또는 host hash가 바뀌면 축소는 incomplete로 끝난다. 결과 출력은 1 MiB로 제한하며 초과 시 명시적으로 incomplete 처리한다.

## 실행 가능한 예제

기존 scenario runner artifact가 설치된 저장소 루트에서 실행한다.

```js
import { createHash } from 'node:crypto';
import { reduceFailure } from './tools/failure-reduction.mjs';

const source = `\`\`\`ghost
control Timer {
  state active: Bool = true;
  timer age = elapsed(active);
  output expired: Bool;
  output drive: Percent;
  expired <- age >= 10s;
  drive <- 0%;
}
\`\`\`\n`;
const request = {
  format: 'GhostFlow/failure-reduction-request-v1',
  program: { filename: 'timer.ghost.md', source },
  scenario: {
    format: 'GhostFlow/scenario-v1', id: 'timer-failure', initialInputs: [], keyBindings: [],
    actuatorBindings: [{ actuator: 'drive', output: 'drive', type: 'Percent', min: 0, max: 100 }],
    actions: [0, 1000, 5000, 10000, 15000].map(atMs => ({ kind: 'scan', atMs })),
  },
  predicate: { kind: 'equals', observation: { field: 'safe', name: 'expired' },
    expected: false, at: { actionIndex: 4, logicalTimeMs: 15000 } },
  requirement: { id: 'REQ-LIMIT', revision: 'r1',
    sha256: createHash('sha256').update('external requirement revision r1').digest('hex'),
    reference: 'example:requirements/REQ-LIMIT/r1' },
  maxAttempts: 32,
};
const result = await reduceFailure(request);
console.log(result.outcome, result.reductionStatus, result.reducedScenario?.actions);
```

`drive` virtual actuator binding은 이 예제에서 기존 WASM scenario host를 선택한다. Requirement reference는 허구다. 보고된 predicate 위반은 제공된 기대값과 실행된 virtual 관측이 서로 달랐다는 뜻일 뿐, 기대값을 인증하거나 불일치 원인을 진단하지 않는다.

같은 요청을 JSON 또는 TOON으로 저장하고 `node tools/ghostshrink.mjs --request reduction.json --format json`을 실행한다. 기본 출력은 TOON이다. 재현 결과는 종료 코드 0, 유효하지 않음·`original-not-applicable`·`original-not-failing`·incomplete 결과는 종료 코드 1을 반환한다. 반환된 `reducedScenario`는 TOON으로 직렬화해 기존 scenario runner에서 같은 컴파일 프로그램으로 재생할 수 있다.
