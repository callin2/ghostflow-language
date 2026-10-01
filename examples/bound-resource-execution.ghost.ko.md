<!-- translation-source: examples/bound-resource-execution.ghost.md -->
[영문 정본](bound-resource-execution.ghost.md)

# 바인딩된 공유 Bool 정책 실행

이 완전한 소프트웨어 전용 제어는 자동·수동·대체 경로의 요청을 하나의 공유 논리 펌프 제약으로 통과시킵니다. 입력은 요청이며 물리 피드백이 아닙니다. 작성된 위반 응답은 펌프 OFF와 밸브 ON입니다. 이 예제에서 명시적으로 선택한 값이며 장치 안전 시퀀스가 아닙니다.

```ghost
control BoundPump {
  resource station: Station;
  resource pump1: BoolActuator;
  resource valve1: BoolActuator;
  input automatic, manual, automatic_request, manual_request, fallback_request, valve_request: Bool;
  output pump, valve: Bool;
  pump <- (automatic && (automatic_request || fallback_request)) || (manual && manual_request);
  valve <- valve_request;
  constraints SharedRules for station {
    exclusive at admission { automatic, manual };
    require at safe_output pump1.on => any_on({ valve1 });
    safe { pump1 = false; valve1 = true; }
  }
}
```

WASM 타깃을 빌드한 후 저장소 루트에서 아래 완전한 JavaScript 코드를 실행합니다. 소스·산출물·리비전·자원·모드·출력 정체성을 모두 제공합니다. 참조 호스트는 산출물을 검증하고 유일한 논리 작성자를 소유하며 물리 I/O를 수행하지 않습니다. 같은 필수 제약은 이식 가능한 Rust 코어와 네이티브 실행기에서 실행됩니다.

```js
import fs from 'node:fs';
import { compileSourceSync } from './tools/compile-source.mjs';
import { compileBoundResourceControl } from './tools/bound-resource-control.mjs';
import { BoundResourceControlRuntime } from './runtimes/node/bound-resource-control.mjs';

const filename = 'examples/bound-resource-execution.ghost.md';
const checked = compileSourceSync(fs.readFileSync(filename, 'utf8'), { filename });
const bound = compileBoundResourceControl(checked, {
  format: 'GhostFlow/resource-constraints-binding-v1',
  revision: 'virtual-installation-r1',
  sourceDocumentSha256: checked.sourceDocument.sha256,
  artifactSha256: checked.manifest.bytecodeSha256,
  resources: [
    { name: 'station', resourceId: 'virtual/bound-loop' },
    { name: 'pump1', resourceId: 'virtual/bound-pump', output: 'pump' },
    { name: 'valve1', resourceId: 'virtual/bound-valve', output: 'valve' },
  ],
  modes: [
    { group: 'SharedRules', name: 'automatic', input: 'automatic' },
    { group: 'SharedRules', name: 'manual', input: 'manual' },
  ],
});
const wasm = fs.readFileSync('target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm');
const runtime = await BoundResourceControlRuntime.instantiate(wasm, bound);
const requests = [
  [true, false, true, false, false, true],
  [true, false, true, false, false, false],
  [true, false, true, false, false, true],
  [false, false, false, false, false, true],
  [false, true, false, true, false, true],
];
try {
  for (const [scanId, values] of requests.entries()) {
    const inputs = checked.manifest.control.inputs.map((port, index) => ({ name: port.name, value: values[index] }));
    const { trace } = runtime.scan({ scanId, logicalTimeMs: scanId, inputs });
    console.log(JSON.stringify(trace));
  }
} finally { runtime.dispose(); }
```

두 번째 요청은 실행 중 필수 조건을 위반하여 작성된 안전 벡터를 적용합니다. 모든 출력을 OFF로 만들지 않습니다. 밸브 요청만 복원해도 펌프는 재시작하지 않습니다. 중립 프레임으로 트립을 해제한 뒤 새 수동 요청도 같은 제약을 통과해야 합니다. 바인딩은 활성화 동안 불변이며 매 평가마다 필요합니다. 네이티브 호스트는 설치의 모든 작성자가 하나의 `ResourceBindingRegistry`를 공유하게 해야 합니다. 참조 Node 호스트도 서로 다른 WASM 인스턴스 사이의 중복 작성자를 거부합니다. 독립 레지스트리는 별개의 설치 권한이며 하나의 공유 자원을 중재하는 방법이 아닙니다.

실행 프로필은 모든 출력이 명시적으로 보호된 하나의 Bool GFB1 v1/v3 요청 제어를 지원합니다. 문맥·회계·연속 제어 프로필과 공유 정책을 가진 import 조합은 안전하게 거부됩니다. 특수 Station 임대·정리 계약은 별개로 유지됩니다. 하드웨어 적용·확인된 정지·물리 시퀀스·PID 연결·협력하는 다중 제어기 중재를 검증한 것은 아닙니다.
