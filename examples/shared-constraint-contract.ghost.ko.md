<!-- translation-source: examples/shared-constraint-contract.ghost.md -->
[English canonical source](shared-constraint-contract.ghost.md)

# 완전한 공유 자원 검사 계약

control 하나인 이 문서는 검사된 **실행 불가능한 descriptor**입니다.
소프트웨어 전용 논리 mapping 전체를 아래에 보입니다. control을 설치하거나
물리 출력을 보호하지 않습니다. runtime enforcement는 별도 #158 계약입니다.
입력·출력 이름은 논리 포트이고 resource ID는 발견한 하드웨어가 아니라 가상
자원을 나타냅니다.

이 가상 loop의 안전 값은 명시적으로 pump=false·valve=true를 선택합니다.
작성한 pump-needs-valve 필수 조건을 만족합니다. 모든 출력을 OFF로 만드는
기본값이나 물리 출력 순서를 지시하는 것이 아닙니다.

```ghost
// Source revision: issue531-quality-shared-contract-v1
control SharedPumpPolicy {
  resource station: Station;
  resource pump1: BoolActuator;
  resource valve1: BoolActuator;
  input automatic, manual, pump_request, valve_request: Bool;
  output pump, valve: Bool;
  pump <- pump_request |> recover(false);
  valve <- valve_request |> recover(true);
  constraints SharedRules for station {
    exclusive at admission { automatic, manual };
    require at safe_output pump1.on => any_on({ valve1 });
    safe { pump1 = false; valve1 = true; }
  }
}
```

저장소 루트에서 다음 JavaScript를 실행하면 논리 mapping만 검사합니다.
해시는 이 정확한 문서와 검사 artifact에서 가져옵니다. 설치 mapping은
identity와 typed port를 제공하며 별도 프로그램이나 대체 정책을 담지 않습니다.
모든 resource alias와 mode의 연결을 명시합니다. 정책·설명 revision·artifact·
binding이 바뀌면 다시 검사해야 합니다.

```js
import fs from 'node:fs';
import { compileSourceSync } from './tools/compile-source.mjs';
import { validateResourceConstraintBinding } from './runtimes/node/resource-constraints-binding.mjs';

const filename = 'examples/shared-constraint-contract.ghost.md';
const compilation = compileSourceSync(fs.readFileSync(filename, 'utf8'), { filename });
const mapping = {
  format: 'GhostFlow/resource-constraints-binding-v1',
  revision: 'virtual-installation-r1',
  sourceDocumentSha256: compilation.sourceDocument.sha256,
  artifactSha256: compilation.manifest.bytecodeSha256,
  resources: [
    { name: 'station', resourceId: 'virtual/loop' },
    { name: 'pump1', resourceId: 'virtual/pump', output: 'pump' },
    { name: 'valve1', resourceId: 'virtual/valve', output: 'valve' },
  ],
  modes: [
    { group: 'SharedRules', name: 'automatic', input: 'automatic' },
    { group: 'SharedRules', name: 'manual', input: 'manual' },
  ],
};
const validated = validateResourceConstraintBinding(compilation, mapping);
console.log(validated.executable); // false: validation grants no execution
```

누락·불일치 identity나 port, 이전 해시, 위장된 같은 resource ID, 중복된
exclusive 입력, mapping 안의 정책 필드는 거부합니다. native와 WASM module
loader는 descriptor byte를 거부하며 JSON의 `executable` 값을 바꿔도 실행하지
않습니다. 공유 계약 실행에는 admission 중재, 실행 중 안전 전환, 회복과 모든
사용 경로를 담당하는 단일 writer의 구현·검증이 필요합니다. 이 논리 mapping은
물리 output ABI를 정의하지 않습니다.
