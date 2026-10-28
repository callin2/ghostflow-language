<!-- translation-source: docs/PROGRAM-REPLACEMENT-HOST.md -->
[영어 원문](PROGRAM-REPLACEMENT-HOST.md)

# 참조 Program 교체 host

`ProgramReplacementHost`는 컴파일된 GhostFlow Program 하나를 실행하고, 완료된 tick 사이에서 검증된 교체를 확정한다. 평가와 상태 이전에는 기존 Rust core를 사용한다. 이 참조 adapter는 설치, Driver 호출, 출력 적용 또는 물리 검증을 수행하지 않는다.

## 예제 실행

이 저장소 루트에서 WASM 산출물이 `target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm`에 있을 때 실행한다.

```sh
node examples/program-replacement-host.mjs
```

예제는 완전한 `.ghost.md` 문서 두 개를 컴파일하고, 가상의 Integration v1 board profile과 설치 정보를 공급한다. 입력 관측으로 한 번 실행한 뒤 Program을 교체하고 새 관측으로 실행한다. 출력은 서로 다른 source, artifact, run identity를 보여준다. 교체 후 첫 trace에는 이전 `held` 상태와 새 state의 기본값이 나타난다. 가상 profile과 호출자가 제공한 관측은 장치 증거가 아니다.

## API와 교체 경계

```js
const host = await ProgramReplacementHost.instantiate(wasmBytes, artifact, {
  runId, release, boardProfile, installation, historyCapacity: 128,
});
const result = host.step({ observations: {
  enabled: { ok: true, value: true, source: 'virtual-input', observationId: 'sample-1' },
} });
const boundary = host.replace({ artifact: candidate, runId: 'next-run' });
host.dispose();
```

`artifact`는 `sourceDocument`, `manifest`, `bytes`를 담은 compiler 결과다. host는 이를 복사하고 정확한 정본 source와 제공된 closure를 다시 컴파일하여 source, manifest, bytecode identity를 검사한 뒤 load한다. 고정된 Integration v1 release/profile/installation 기록과 필수 논리 센서 binding도 검증한다. 설치 capability 집합은 이 host 수명 동안 고정된다. Integration 유효성은 구조적 일치이며 board 배선이나 물리 결과의 인증이 아니다.

매 `step`은 모든 논리 Bool 입력의 관측을 제공해야 한다. 각 입력은 호출자가 밝힌 `source`와 `observationId`를 가진 Result다. 오류는 `{ok:false,fault:'Disconnected'|'Stale'|'Invalid'|'NotReady',source,observationId}`를 쓴다. host는 이 선언을 수락된 core trace와 함께 보존하지만 독립적으로 확인된 센서 관측으로 승격하지 않는다. 잘못된 입력 묶음은 입력을 설정하기 전에 거부한다. 반환된 trace와 identity는 같은 수락된 tick에 속한다. 반환값과 snapshot은 host 내부 상태에서 분리된 복사본이다.

`replace`는 Rust `hotSwap` 호출 전에 후보를 완전히 검증하고 복사한다. 검증 또는 core 호환성 검사에 실패하면 이전 Program, state, run과 마지막 수락 trace가 유지된다. 성공하면 새 source/artifact/run identity를 공개하고 마지막 trace를 비운다. core가 입력 cache를 폐기하므로 다음 tick에는 완전한 새 관측이 필요하다. 같은 이름·타입의 state 이전은 core가 전담하며 JavaScript에서 복사하지 않는다. 사용한 run ID는 재사용할 수 없다. 정해진 이력 capacity에 도달하면 ID를 잊는 대신 추가 교체를 거부한다.

## 지원 범위와 한계

새 snapshot은 호출자가 새 schema의 모든 관측을 다시 제공한다는 뜻이며, host가 이전 입력 cache를 물려받지 않는다. 장치에서 새로 채취한 값이나 새로운 observation ID를 요구한다는 뜻은 아니다. 같은 sample이 여러 tick 동안 최신 관측일 수 있다. sample의 나이와 진위는 별도 관측 계약에서 다룬다.

참조 host는 Bool 논리 입력·출력을 가진 `GhostFlow/control-v1`과 `control-v4`를 지원하며 Int 제어 state를 포함할 수 있다. 조합, settings, timer, signal, schedule, 센서 conditioning, optional sensor, resource/objective 정책, 출력 관측 rail 및 lifecycle/context profile은 실행 중 Program을 바꾸기 전에 거부한다. 전체 framed `ControlRuntime`에는 별도 sensor/context 상태가 있고 framed hot-swap ABI가 없으므로 해당 이전에는 별도 transaction 설계가 필요하다. Device/Driver 설치, 출력 적용, feedback 및 물리 수용은 독립된 소유 경계에 남는다.

관련 사례: [REF-06-020](https://github.com/callin2/ghostflow-language/issues/305), [REF-06-022](https://github.com/callin2/ghostflow-language/issues/307).
