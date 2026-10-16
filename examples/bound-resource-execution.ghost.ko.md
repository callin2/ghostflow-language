<!-- translation-source: examples/bound-resource-execution.ghost.md -->
[영문 정본](bound-resource-execution.ghost.md)

# 바인딩된 공유 Bool 정책 실행

이 완전한 소프트웨어 전용 제어는 자동·수동·대체 경로의 요청을 하나의 공유 논리 펌프 제약으로 통과시킵니다. 입력은 요청이며 물리 피드백이 아닙니다. 작성된 위반 응답은 펌프 OFF와 밸브 ON입니다. 이 예제에서 명시적으로 선택한 값이며 장치 안전 시퀀스가 아닙니다.

명시적인 새 소스 리비전은 bound-input-quality-v1입니다. 정식 input은 생산자가 제공한 품질을 포함합니다. 이 예제의 요청 식은 마지막 관측값을 유지하며, false는 해당 소스 내부 기억 상태의 초기값입니다. 자동·수동 모드의 필수 승인 경계는 매 스캔마다 정상 Bool 관측값을 요구합니다. 모드를 관측할 수 없으면 스캔을 원자적으로 거부하고 수정한 동일 스캔의 재시도를 허용합니다. 이는 OFF, 트립 또는 재시작 명령을 뜻하지 않습니다. 원본 소스는 별도 이력으로 보존합니다.

<!-- ghostflow:anchor id=GF-INT-BOUND-OBSERVATIONS kind=intent status=confirmed origin=engineer -->
이 소프트웨어 예제의 마지막 요청 관측값을 유지하며 기존 자원 가드를 보존합니다.

```ghost
control BoundPump {
  resource station: Station;
  resource pump1: BoolActuator;
  resource valve1: BoolActuator;
  input automatic, manual, automatic_request, manual_request, fallback_request, valve_request: Bool;
  // ghostflow:link id=GF-INT-BOUND-OBSERVATIONS relation=implements
  state remembered_automatic: Bool = false;
  let automatic_value = case automatic { ok(value) => value; fault(_) => remembered_automatic; };
  remembered_automatic' = automatic_value;
  // ghostflow:link id=GF-INT-BOUND-OBSERVATIONS relation=implements
  state remembered_manual: Bool = false;
  let manual_value = case manual { ok(value) => value; fault(_) => remembered_manual; };
  remembered_manual' = manual_value;
  // ghostflow:link id=GF-INT-BOUND-OBSERVATIONS relation=implements
  state remembered_automatic_request: Bool = false;
  let automatic_request_value = case automatic_request { ok(value) => value; fault(_) => remembered_automatic_request; };
  remembered_automatic_request' = automatic_request_value;
  // ghostflow:link id=GF-INT-BOUND-OBSERVATIONS relation=implements
  state remembered_manual_request: Bool = false;
  let manual_request_value = case manual_request { ok(value) => value; fault(_) => remembered_manual_request; };
  remembered_manual_request' = manual_request_value;
  // ghostflow:link id=GF-INT-BOUND-OBSERVATIONS relation=implements
  state remembered_fallback_request: Bool = false;
  let fallback_request_value = case fallback_request { ok(value) => value; fault(_) => remembered_fallback_request; };
  remembered_fallback_request' = fallback_request_value;
  // ghostflow:link id=GF-INT-BOUND-OBSERVATIONS relation=implements
  state remembered_valve_request: Bool = false;
  let valve_request_value = case valve_request { ok(value) => value; fault(_) => remembered_valve_request; };
  remembered_valve_request' = valve_request_value;
  output pump, valve: Bool;
  pump <- (automatic_value && (automatic_request_value || fallback_request_value)) || (manual_value && manual_request_value);
  valve <- valve_request_value;
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
  revision: 'virtual-installation-input-v1',
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
    // Each row explicitly supplies Good software observations, including false.
    const inputs = bound.manifest.sensors.flatMap((port, index) => [
      { name: port.valueInput, value: values[index] },
      { name: port.okInput, value: true },
      { name: port.faultInput, value: 0 },
    ]);
    const { trace } = runtime.scan({ scanId, logicalTimeMs: scanId, inputs });
    console.log(JSON.stringify(trace));
  }
} finally { runtime.dispose(); }
```

두 번째 요청은 실행 중 필수 조건을 위반하여 작성된 안전 벡터를 적용합니다. 모든 출력을 OFF로 만들지 않습니다. 밸브 요청만 복원해도 펌프는 재시작하지 않습니다. 중립 프레임으로 트립을 해제한 뒤 새 수동 요청도 같은 제약을 통과해야 합니다. 바인딩은 활성화 동안 불변이며 매 평가마다 필요합니다. 네이티브 호스트는 설치의 모든 작성자가 하나의 `ResourceBindingRegistry`를 공유하게 해야 합니다. 참조 Node 호스트도 서로 다른 WASM 인스턴스 사이의 중복 작성자를 거부합니다. 독립 레지스트리는 별개의 설치 권한이며 하나의 공유 자원을 중재하는 방법이 아닙니다.

실행 프로필은 모든 출력이 명시적으로 보호된 하나의 Bool GFB1 v1/v3 요청 제어를 지원합니다. 문맥·회계·연속 제어 프로필과 공유 정책을 가진 import 조합은 안전하게 거부됩니다. 특수 Station 임대·정리 계약은 별개로 유지됩니다. 하드웨어 적용·확인된 정지·물리 시퀀스·PID 연결·협력하는 다중 제어기 중재를 검증한 것은 아닙니다.

## 브라우저와 Worker 공개 모듈

브라우저와 Worker는 `tools/browser-toolchain.mjs`에서 `compileSource`,
`compileBoundResourceControl`, `verifyBoundResourceCompilation`,
`observeBoundResourceTrace`를 가져옵니다. `BoundResourceControlRuntime`은
`runtimes/wasm/bound-resource-control.mjs`에서 가져옵니다. 정확한 정규 문서,
설치 바인딩, 가져온 WASM 바이트를 전달합니다. `instantiate(wasmBytes, bound)`는
검증된 writer를 만들고, `scan(frame)`은 프레임이 포함된 Rust 결과를 반환하며,
`dispose()`는 자원 점유를 해제합니다. 런타임 생성 실패도 대기 중인 점유를
해제합니다. 컴파일러와 런타임 모듈 그래프에는 Node 내장 모듈이나 `Buffer`
의존성이 없습니다. 위 Node 경로는 현재 예제를 위해 동일한 런타임을 재수출합니다.

상호작용 스키마를 표시할 때는 `compileSource`에 `interactionSourceIdentity`를
전달합니다. 바인딩은 문서·리비전 식별자를 유지하고 실행 가능한 GFB17 바이트에
맞게 스키마의 모듈 식별자를 다시 생성합니다. 스키마 검증은 두 식별자를 모두
재구성하며, 검증된 descriptor 자체는 실행 가능해지지 않습니다. 입력과 출력은
검증된 제어 manifest에서 가져오고 바인딩된 manifest에서도 정확한 이름과 타입을
유지합니다.

유한 프로필에는 작성한 Bool 상태를 포함할 수 있습니다. 상호작용 계약에 따라
관찰할 각 상태를 확인된 literate 의도 anchor와 연결합니다. 검증된 descriptor는
실행 저장소 바인딩 없이 소스 출처를 전달하며, 바인딩 단계는 실제로 낮춘 프로그램에서
실행 바인딩을 얻습니다. 완료된 WASM scan 스냅샷은 비어 있지 않은 스키마에서도
동일한 공개 상호작용 생성기를 통해 상태의 관찰값을 표시합니다.

JavaScript writer 레지스트리는 비동기 생성 대기를 포함하여 하나의 realm에 있는
하나의 모듈 인스턴스만 다룹니다. 서로 다른 Worker·창·독립적으로 로드된 모듈
인스턴스는 별도 레지스트리를 가집니다. 설치 호스트는 이 writer들을 시작하기
전에 하나의 공유 권한에서 안정적인 자원 ID를 예약하고, 실패·폐기·Worker 종료
시 이를 해제해야 합니다. realm 내부의 보호는 Worker 사이의 중재나 물리적
보장을 제공하지 않습니다.
