# 설치 센서 바인딩 참조 호스트

`InstalledControlHost`는 고정된 컴파일 Program과 해시로 고정된 설치 선언의 적합성을 검사한 뒤 기존 `ControlRuntime.instantiateFramed`로 실행합니다. [REF-06-009](https://github.com/callin2/ghostflow-language/issues/297)의 호스트 계약입니다. 장치 발견, Driver 설치, 폴링, 실물 검증은 수행하지 않습니다.

## 고정된 프로필 계약

기존 `GhostFlow/board-profile-v1` 형태는 유지합니다. 새 `GhostFlow/board-profile-v2`의 Bool 출력은 기존 방향·타입·Driver·주소·활성 극성·안전 레벨을 사용합니다. Number 또는 Bool 입력은 출력 극성 대신 `sensor` 계약을 사용합니다.

`sensor`는 `format: "GhostFlow/sensor-observation-v1"`, `canonicalUnit`, 양의 안전 정수 `maxInterSampleGapMs`를 포함합니다. Number 입력에는 유한하고 순서가 맞는 `minValue`·`maxValue`도 필요합니다. 관측 계약은 수집 주체가 실제 샘플의 source epoch, sample ID, 수집 시각, 값, `Good`·`NotReady`·`Disconnected`·`Stale`·`Invalid` 중 하나의 품질을 제공한다는 선언입니다. 오류의 자리 채움 값이 0이어도 정상값으로 바꾸지 않습니다. 기존 릴리스 SHA-256 참조가 프로필과 설치 매핑을 고정합니다. 이 선언은 물리 센서나 Driver 바이너리의 동작 증명이 아닙니다.

`validateIntegration`은 센서 바인딩의 방향·타입·정규 단위, Program의 명시적 `valid` 범위를 포함하는 측정 범위, 관측 계약, `maxInterSampleGapMs < staleMs`를 검사합니다. 정확히 같은 값도 stale 경계에 닿으므로 거부합니다. 소스의 `sample` 간격은 정보이며 별도 폴링 명령이나 두 번째 강제 기한으로 재해석하지 않습니다. 명시적 `stale_after`가 없는 v2 센서나 명시적 `valid` 범위가 없는 Number 센서는 이 한정 호스트에서 거부합니다. 기존 v1 검증의 형태와 동작은 그대로입니다.

## 실행과 교체

`InstalledControlHost.instantiate(wasmBytes, compiled, { runId, release, boardProfile, installation })`로 시작합니다. `step`에는 현재 `bindingRevision`, `nowMs`, `samples`를 전달합니다. 각 샘플은 수집 시점의 `bindingRevision`, `endpointId`, `{ epoch, id, timestampMs, quality, value }`를 포함합니다. 호스트는 이전 리비전이나 다른 엔드포인트의 샘플을 `ControlRuntime`에 전달하기 전에 거부합니다. 호출자가 제공한 표지는 하드웨어 인증이 아닙니다. 새 샘플이 없는 scan은 빈 `samples`를 전달하며, freshness는 기존 conditioner가 판정합니다. 실행 출력은 제어 의도이며 실물 출력 증거가 아닙니다.

`replaceBinding({ runId, release, boardProfile, installation })`은 **같은 소스와 바이트코드**에 대해 후보 전체를 검사하고 새 `ControlRuntime`을 준비한 뒤 완료된 step 사이에서 게시합니다. 거부된 후보는 이전 run·바인딩·conditioner 상태·최근 trace를 보존합니다. 승인에는 사용하지 않은 바인딩 리비전과 run ID가 필요하며, 새 run의 센서는 `NotReady`에서 시작합니다. 새 수집 주체는 자체 source epoch와 sample ID를 발행해야 합니다. 새 run 경계는 이전 필터와 freshness 상태의 재사용을 막지만 무중단 상태·출력 연속성을 보장하지 않습니다. 호스트는 run ID와 바인딩 리비전을 최대 128개 보관하고 그 뒤에는 재사용을 허용하지 않고 교체를 거부합니다. 사용한 프로필 리비전의 내용을 바꿀 수도 없습니다.

이 작업은 센서 바인딩만 바꿉니다. 출력 배선, 설치 ID, 컴파일러·런타임·프로토콜 메타데이터, 펌웨어 digest가 바뀌면 거부합니다. `step` 결과에는 승인된 실행의 run·소스·바이트코드·프로필·바인딩 식별자가 함께 들어가며, snapshot과 결과는 호출자 객체와 분리됩니다.

지원 Program은 소스 재검증을 통과한 독립형 `control-v1` 또는 `control-v4` 바이트, 필수 Number/Bool 센서 한 개 이상, Bool 출력으로 한정합니다. 일정·타이머·signal·config·import·scalar 입력은 게시 전에 거부합니다. 실제 Device 바인딩 적용, Driver 보장, 물리 부하 동작은 별도의 증거가 필요합니다.
