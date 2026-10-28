<!-- translation-source: docs/INSTALLED-SENSOR-BINDING.md -->
[English 원문](INSTALLED-SENSOR-BINDING.md)

# 설치 센서 바인딩 참조 호스트

`InstalledControlHost`는 고정된 컴파일 Program과 해시로 고정된 설치 선언의 적합성을 검사한 뒤 기존 `ControlRuntime.instantiateFramed`로 실행합니다. [REF-06-009 센서 교체](https://github.com/callin2/ghostflow-language/issues/297)와 [REF-04-039 전략 프로필 교체](https://github.com/callin2/ghostflow-language/issues/243)의 호스트 계약입니다. 장치 발견, Driver 설치, 폴링, 실물 검증은 수행하지 않습니다.

## 고정된 프로필 계약

Snapshot, 승인된 step, 성공한 binding 교체는
[선언 정보만으로 판단한 설치 승인](../contracts/integration-v1/README.ko.md)의
동일한 소유 `assessment`를 포함합니다. 그 식별자는 승인한 source, bytecode, manifest,
release, profile과 mapping을 고정합니다. Bool 출력이 선언된 방향, 타입, 극성,
`safeLevel`에 맞더라도 `assessment.physical.status`는 `unknown`입니다.
이 선언에는 독립적인 전기, fail-safe, 부하, 배선 관측이 없습니다.
물리 적합성이 Unknown이어도 유효한 host 실행은 계속 가능합니다.
교체는 발행 전에 평가를 다시 계산합니다. 거부되거나 변조된 후보는 현재 평가와 trace를 유지합니다.
반환된 평가는 host 상태와 분리됩니다.

기존 `GhostFlow/board-profile-v1` 형태는 유지합니다. 새 `GhostFlow/board-profile-v2`의 Bool 출력은 기존 방향·타입·Driver·주소·활성 극성·안전 레벨을 사용합니다. Number 또는 Bool 입력은 출력 극성 대신 `sensor` 계약을 사용합니다.

`sensor`는 `format: "GhostFlow/sensor-observation-v1"`, `canonicalUnit`, 양의 안전 정수 `maxInterSampleGapMs`를 포함합니다. Number 입력에는 유한하고 순서가 맞는 `minValue`·`maxValue`도 필요합니다. 관측 계약은 수집 주체가 실제 샘플의 source epoch, sample ID, 수집 시각, 값, `Good`·`NotReady`·`Disconnected`·`Stale`·`Invalid` 중 하나의 품질을 제공한다는 선언입니다. 오류의 자리 채움 값이 0이어도 정상값으로 바꾸지 않습니다. 기존 릴리스 SHA-256 참조가 프로필과 설치 매핑을 고정합니다. 이 선언은 물리 센서나 Driver 바이너리의 동작 증명이 아닙니다.

`validateIntegration`은 센서 바인딩의 방향·타입·정규 단위, Program의 명시적 `valid` 범위를 포함하는 측정 범위, 관측 계약, `maxInterSampleGapMs < staleMs`를 검사합니다. 정확히 같은 값도 stale 경계에 닿으므로 거부합니다. 소스의 `sample` 간격은 정보이며 별도 폴링 명령이나 두 번째 강제 기한으로 재해석하지 않습니다. 명시적 `stale_after`가 없는 v2 센서나 명시적 `valid` 범위가 없는 Number 센서는 이 한정 호스트에서 거부합니다. 기존 v1 검증의 형태와 동작은 그대로입니다.

## 실행과 교체

```js
import { InstalledControlHost } from './runtimes/wasm/installed-control-host.mjs';

const host = await InstalledControlHost.instantiate(wasmBytes, compiled, {
  runId: 'run-1', release, boardProfile, installation,
});
const result = host.step({ bindingRevision: installation.revision, nowMs: 1000,
  samples: { reading: { bindingRevision: installation.revision,
    endpointId: installation.bindings.reading,
    sample: { epoch: 1, id: 1, timestampMs: 1000, quality: 'Good', value: 42 },
  } },
});
```

`InstalledControlHost.instantiate(wasmBytes, compiled, { runId, release, boardProfile, installation })`로 시작합니다. `step`에는 현재 `bindingRevision`, `nowMs`, `samples`를 전달합니다. 각 샘플은 수집 시점의 `bindingRevision`, `endpointId`, `{ epoch, id, timestampMs, quality, value }`를 포함합니다. 호스트는 이전 리비전이나 다른 엔드포인트의 샘플을 `ControlRuntime`에 전달하기 전에 거부합니다. 호출자가 제공한 표지는 하드웨어 인증이 아닙니다. 새 샘플이 없는 scan은 빈 `samples`를 전달하며, freshness는 기존 conditioner가 판정합니다. 실행 출력은 제어 의도이며 실물 출력 증거가 아닙니다.

`replaceBinding({ runId, release, boardProfile, installation })`은 **같은 소스와 바이트코드**에 대해 후보 전체를 검사하고 새 `ControlRuntime`을 준비한 뒤 완료된 step 사이에서 게시합니다. 거부된 후보는 이전 run·바인딩·conditioner 상태·최근 trace를 보존합니다. 승인에는 사용하지 않은 바인딩 리비전과 run ID가 필요하며, 새 run의 센서는 `NotReady`에서 시작합니다. 새 수집 주체는 자체 source epoch와 sample ID를 발행해야 합니다. 새 run 경계는 이전 필터와 freshness 상태의 재사용을 막지만 무중단 상태·출력 연속성을 보장하지 않습니다. 호스트는 run ID와 바인딩 리비전을 최대 128개 보관하고 그 뒤에는 재사용을 허용하지 않고 교체를 거부합니다. 사용한 프로필 리비전의 내용을 바꿀 수도 없습니다.

이 작업은 센서 바인딩만 바꿉니다. 보드 ID·모델, 출력 배선, 설치 ID, 컴파일러·런타임·프로토콜 메타데이터, 펌웨어 digest가 바뀌면 거부합니다. 다른 물리 보드로의 이전에는 별도 설치 절차가 필요합니다. `step` 결과에는 승인된 실행의 run·소스·바이트코드·프로필·바인딩 식별자가 함께 들어가며, snapshot과 결과는 호출자 객체와 분리됩니다.

## 전략 활성화

이 한정 Program 프로필은 컴파일러가 생성한 `adaptPolicy`와 `strategies` 메타데이터도 받습니다. 호스트는 정규 소스를 재컴파일하고 전략의 match·우선순위·정책 식별자를 포함한 전체 manifest와 바이트코드를 비교한 뒤 승인합니다. 호출자가 메타데이터를 수정하면 이 비교에서 거부됩니다.

통합 검증이 모든 필수 센서 바인딩과 엔드포인트 타입을 확인한 뒤, 호스트는 연결된 센서마다 명시적 capability를 `ControlRuntime`에 전달합니다. 기존 Rust 런타임이 활성화 시점에 전략을 선택합니다. capability 존재 여부는 검증된 설치에서 결정하며 샘플 품질과 독립적입니다. `NotReady`·`Stale`을 비롯한 센서 fault는 선택된 전략 아래의 Result 관측으로 유지합니다. fault 때문에 capability를 제거하거나 `match always`를 자동 선택하지 않습니다.

교체는 후보 전체를 검증하고 전략을 활성화한 뒤 게시합니다. 예를 들어 `WithReading`이 필수 Number 센서에 match하고 현재 읽기가 Stale일 때, 후보가 그 센서를 Bool 엔드포인트에 연결하면 `type_mismatch`로 거부합니다. 기존 프로필·run·바인딩·상태·최근 trace를 보존합니다. 이후 step도 `WithReading`과 명시적 fault 분기를 계속 실행합니다. 호환 후보는 새 run으로 게시하며 센서는 `NotReady`, Program 상태는 소스의 초기값에서 시작합니다.

독립형 Program은 소스 재검증을 통과한 `control-v1` 또는 `control-v4` 바이트, 필수 Number/Bool 센서 한 개 이상, Bool 출력으로 한정합니다. 선택 센서 바인딩과 호출자가 임의로 제공한 capability는 이 호스트 프로필 범위에 포함하지 않습니다. 검증된 Bool 출력은 전략 선택의 actuator capability로 사용할 수 있습니다. 일정·타이머·signal·config·import·scalar 입력은 게시 전에 거부합니다. 실제 Device 바인딩 적용, Driver 보장, 물리 부하 동작은 별도의 증거가 필요합니다.

## 설치된 합성 실행

합성 프로필은 정본으로 고정한 source closure, Interaction Schema, 인스턴스별
state·config·timer, 필수 Number/Bool 센서, Bool 출력이 있는 `control-v10`을 받습니다.
활성화에는 `context`, 행위자별 `grants`, 선택적으로 `historyCapacity`를 전달합니다.
호스트가 내부에서 소유하는 framed `TemporarySettingsHost` 한 개가 유일한 controller를
소유합니다. 설정, 관측과 설명은 같은 실제 scan에서 나옵니다.

root에는 port 선언, instance, root 입력에서 instance 입력으로 또는 instance 출력에서
root 출력으로 직접 이어지는 연결만 허용합니다. 중첩 instance, instance 간 연결,
root 계산, schedule과 signal은 거부합니다. 경로는 컴파일러가 재구성한 정본 AST,
`sourceClosure`, `sourceMap`에서 도출하고 typed `sensorInstances` 입력 매핑과
일치해야 합니다. root와 모든 instance 센서에 대해 실제 승인한 endpoint의 단위·측정
범위·sample gap과 stale 경계를 검사합니다. 생성된 런타임 이름으로 경로를 추측하지 않습니다.

`step(frame, settingsEvent)`에 수집 packet과 추가 `contextFacts` 필드를 전달합니다.
기존 임시 설정 event 계약은 `snapshot().execution`의 현재 식별자를 사용합니다.
endpoint·binding revision·수집 형태 검사는 설정 소유자에 진입하기 전에 끝납니다.
유효한 `Invalid` 또는 `Disconnected` 관측은 오류로 conditioner에 전달하고,
epoch·sample ID·timestamp에는 공통 런타임의 샘플 식별 규칙을 그대로 적용합니다.

수락된 결과는 실제 설정 소유자 결과인 `execution`과 run·scan·논리 시각·확정된 설정
revision·승인 digest·instance 경로를 묶은 `provenance`를 포함합니다.
`explainOutput('output.east_on', result)`는 소유자의 현재 완료 결과만 받습니다.
실제 proof와 observation을 결합하고 descriptor, 해당 instance의 유효 설정, 입력 경로와
출력 endpoint를 반환합니다. 이전 결과, 뒤바꾼 경로·설정·revision은 거부합니다.
`ready` join은 연결의 유효성을 뜻하고 표현식 설명의 제공 여부는 `proof.status`가
별도로 표시합니다. state 기반 Bool proof는 제공하며 config/timer 생성 rail 표현식은
여전히 unavailable입니다. 이 근거는 물리 Driver 인증이나 state transition,
safety output, applied output, 실물 효과의 증명이 아닙니다.

`snapshot().latest`는 마지막 수락 완료 결과를 이력으로 보존합니다. 이와 별도로
`currentFrameCompletion`은 실제 런타임의 현재 완료 scan을 식별합니다. dispatch는
실행 전에 이 식별자를 지우고 완료한 뒤 새 식별자를 게시합니다. `accepted: false`로
보고되는 설정 복귀 실패를 포함해 dispatch가 실패하면 현재 출력 설명을 제공하지 않습니다.
dispatch에 진입하지 않은 수집·설정·context 사전 검사 거절은 현재 식별자를 유지합니다.
과거 proof는 바꾸지 않으며 dispatch 실패 후 `explainOutput`에서 현재 근거로 제시할 수 없습니다.

교체는 새 소유자를 완전히 준비한 뒤 게시합니다. 거절된 후보는 설정·overlay·history·
state·timer·conditioner·최신 완료 결과·assessment를 유지합니다. 성공하면 새 run에서
state·설정·conditioner를 초기화하고 이전 완료 결과를 지웁니다. 이 한정 경로는
REF-06-002와 REF-06-016의 근거이며 더 넓은 요구 범위는 미완료입니다.
`tests/installed-composition.test.mjs`는 실제 WASM 실행으로 같은 시각의 east/west 독립성,
근거 연결, 변조, 오류와 교체를 검증합니다.
