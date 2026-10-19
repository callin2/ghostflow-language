<!-- translation-source: docs/BEHAVIOR-COMPARISON.md -->
# 제한된 동작 비교

[원문](BEHAVIOR-COMPARISON.md) · [의도 책임 계약](INTENT-CONSISTENCY-CONTRACT.md) · [#560](https://github.com/callin2/ghostflow-language/issues/560)

`tools/behavior-comparison.mjs`의 `compareBehavior(request)`는 정본 `.ghost.md` 소스 두 개를 컴파일하고, 동일한 고정 `GhostFlow/scenario-v1`을 각 소스의 정본 초기 상태에서 한 번씩 실행한다. 기존 `ghostsim` Rust 네이티브 또는 WASM runner를 사용한다. 호출자는 관측 항목, 정확한 scan/time 범위, 선택적 기대 변화를 정한다. 결과는 해당 범위에서 실제로 계산된 virtual requested/safe intent, state, fault를 보고한다. 농부의 의도를 추론하거나, 실제 장치를 작동하거나, 물리 효과를 확립하지 않는다.

## 요청과 API

공개 요청은 JSON 호환 object다.

| Field | Contract |
|---|---|
| `format` | `GhostFlow/behavior-comparison-request-v1` |
| `baseline`, `candidate` | `{ filename, source }`. `filename`은 `.ghost.md`로 끝나야 하며, 선택적으로 컴파일러의 `sourceClosure`와 [intent evidence](INTENT-EVIDENCE.ko.md)의 `intentEvidence`를 포함할 수 있다. 두 source 모두 비동기 작업 전에 캡처된다. |
| `scenario` | 초기 입력과 순서가 있는 action을 포함하는 완전한 `GhostFlow/scenario-v1` object 하나. 동일하게 캡처된 scenario를 두 manifest 각각에 대해 검증하고 독립 실행한다. 출력 의존 피드백이 다음 입력을 다르게 만들 수 있으므로 `plant`는 거부한다. 동일한 제공 sample에서 sensor conditioning 결과가 달라지는 것은 관측 가능한 동작이다. |
| `observations` | `{ field, name }`의 비어 있지 않은 목록(최대 32개). `requested`, `safe`, `stateBefore`, `stateAfter`를 대상으로 하며 `{ field: 'faults' }`는 전체 fault 목록을 선택한다. 이름이 지정된 field는 두 컴파일 결과의 출력 manifest 또는 상태 trace binding 모두에 있어야 한다. 목록에 지정된 관측만 비교 결과에 포함된다. |
| `scope` | `{ from: { scanId, logicalTimeMs }, to: { scanId, logicalTimeMs } }`. 두 endpoint 모두 실제 실행된 scan과 정확히 일치해야 한다. 관측에는 두 endpoint가 포함된다. |
| `assertions` | 아래 호출자 제공 predicate의 선택 목록(최대 64개). 생략하면 기대 변화 판단 없이 관측 결과만 반환한다. |

`const report = await compareBehavior(request)`를 사용한다. 유효하지 않은 source, metadata, scenario, observation 또는 request 형식이면 API가 오류를 던진다. 실행이 시작됐지만 완료할 수 없으면 `outcome: 'incomplete'`, 각 측 오류와 사용 가능한 부분 관측을 반환한다. **모든 assertion은 `unknown`이다.** 비교가 완료되면 scan별 값과 `equal`, 그리고 선택 범위 안에서만 계산한 changed/unchanged 개수를 보고한다. 출력은 설치 명령으로 취급되지 않는다. 결과의 `physicalEffects`는 항상 `false`다.

결과는 전체 request, scenario, 정본 source 문서, GFB bytes, manifest, 선택적 source closure, 선택적 intent evidence를 SHA-256으로 결속한다. 선택된 runtime/host 경로와 hash, WASM host 사용 시 Node version도 기록한다. 이는 실행 identity이며 서명이 아니다. 초기 state는 각 정본 source에 선언된 상태다. 초기 state 변경은 프로그램 차이의 일부다.

### 선택적 predicate

각 assertion은 고유한 `id`, `kind`, 그리고 이미 `observations`에 나열된 `observation`을 가진다.

| Kind | Additional fields | Evaluation |
|---|---|---|
| `unchanged` | 없음 | `scope` 안의 모든 scan에서 선택한 값이 두 프로그램 사이에 같다. |
| `equals` | `side: 'baseline'\|'candidate'`, 정확한 `at: { scanId, logicalTimeMs }`, `expected` JSON value | 지정한 쪽의 해당 scan 실제 값이 제공된 값과 같다. |
| `bool-on-duration-delta` | 안전 정수 `expectedDeltaMs` | `candidateMs - baselineMs`가 제공된 delta와 같다. 정확한 scope endpoint 사이의 true Bool 구간 `[scan_i, scan_(i+1))`만 센다. 마지막 scan은 endpoint이며 이후로 외삽하지 않는다. |

Assertion은 `evidence: { side, condition: { id, revision, sha256 } }`를 선택적으로 추가할 수 있다. 이 참조는 해당 쪽에서 제공된 `intentEvidence` condition과 `intentConditionDigest(condition)`를 포함해 일치해야 한다. 보고서는 condition의 확인 범위와 `authority: 'not-authenticated'`를 보존한다. 이 link가 없으면 `evidenceBinding: 'unlinked'`로 표시한다. `satisfied`는 관측 scan 범위에서 제공된 predicate가 성립했다는 뜻일 뿐이다. Interpretation이 확인됐거나, condition이 독립 oracle이거나, 변경이 사용자 의도에 부합한다는 뜻이 아니다. 성공 주장만으로 기대값이 사라지지 않도록 assertion 전체 명세와 digest를 보고서에 유지한다.

## 실행 가능한 예제

기존 scenario runner artifact를 사용할 수 있는 저장소 루트에서 실행한다.

```js
import { compareBehavior } from './tools/behavior-comparison.mjs';

const program = seconds => `\`\`\`ghost
control Timer {
  state active: Bool = true;
  timer age = elapsed(active);
  output expired: Bool;
  output drive: Percent;
  expired <- age >= ${seconds}s;
  drive <- 0%;
}
\`\`\`\n`;
const at = (scanId, logicalTimeMs) => ({ scanId, logicalTimeMs });
const request = {
  format: 'GhostFlow/behavior-comparison-request-v1',
  baseline: { filename: 'timer-10.ghost.md', source: program(10) },
  candidate: { filename: 'timer-15.ghost.md', source: program(15) },
  scenario: {
    format: 'GhostFlow/scenario-v1', id: 'timer', initialInputs: [], keyBindings: [],
    actuatorBindings: [{ actuator: 'drive', output: 'drive', type: 'Percent', min: 0, max: 100 }],
    actions: [0, 10000, 15000, 20000].map(atMs => ({ kind: 'scan', atMs })),
  },
  observations: [{ field: 'safe', name: 'expired' }],
  scope: { from: at(0, 0), to: at(3, 20000) },
  assertions: [
    { id: 'delay', kind: 'bool-on-duration-delta',
      observation: { field: 'safe', name: 'expired' }, expectedDeltaMs: -5000 },
  ],
};
const report = await compareBehavior(request);
console.log(report.outcome, report.assertions);
```

예제의 `drive` binding은 기존 WASM scenario host를 선택한다. 값은 virtual이며 실제 actuator에 관한 주장을 담지 않는다. 기대 delta는 이 예제에서 독립적으로 제공한 값이며 어느 프로그램에서도 생성되지 않는다.

구조화 CLI 호출은 같은 request를 JSON 또는 TOON으로 직렬화한 뒤 `node tools/ghostcompare.mjs --request comparison.json --format json`을 실행한다. 기본 출력은 TOON이며 `--format toon`도 허용된다. 비교 완료 시 종료 코드 0, 거부되거나 미완료 결과는 종료 코드 1이다. CLI는 최대 3 MiB의 request bytes를 읽고 캡처된 scenario는 256 KiB로 제한된다. 결과는 1 MiB로 제한되며 초과하면 모든 assertion이 unknown인 incomplete 결과가 된다. API와 CLI는 request 안의 JavaScript callback을 허용하지 않는다.
