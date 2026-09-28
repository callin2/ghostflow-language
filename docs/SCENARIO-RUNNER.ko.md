<!-- translation-source: docs/SCENARIO-RUNNER.md -->
[영문 원문](SCENARIO-RUNNER.md)

# 가상 시나리오 러너

컴파일러, 시뮬레이터, 콘솔, 소유권 경계를 함께 설명하는 내용은 [저작 및 가상 시뮬레이션 아키텍처](LLM-TOOLCHAIN-ARCHITECTURE.md)를 참조하세요.

`ghostsim`은 명시적 가상 시간 동작을 입력으로 받아 새 Rust 코어에서 컴파일된 GhostFlow 제어를 실행합니다. 일반 입력 프로그램에는 네이티브 프레임 러너를 사용합니다. 센서, 가상 액추에이터, 인증 구간, Solar 프로그램은 기존 Rust/WASM 제어 호스트를 사용합니다. 물리 장치 드라이버는 열지 않습니다. `requestedVirtualIntent`와 `safeVirtualIntent` 필드는 논리적 의도만 설명합니다. 명시적으로 바인딩된 가상 액추에이터는 시나리오 드라이버가 안전한 숫자 목표를 수락하고 적용했다는 사실을 추가 기록할 수 있습니다. 이는 가상 증거이며 장치 확인을 뜻하지 않습니다.

WASM 호스트는 일반 센서, 윈도우, 적응 제어에 프레임 스캔을 사용합니다. 인증된 Bool 구간과 Solar는 프레임 ABI가 없어 기존 레거시 런타임 진입점을 사용합니다. 시나리오 호스트는 이들에 재생 전용 스캔 ID를 지정합니다. 두 경로 모두 동일한 이식 가능한 Rust 평가 코어를 사용합니다.

저장소 루트에서 포함된 예제를 빌드하고 실행합니다.

```sh
node tools/ghostc.mjs examples/tutorial/01-latch.ghost.md build/01-latch.gfb
cargo build --locked --offline --release -p ghostflow-core --example scenario_scan
npm run build:wasm
node tools/ghostsim.mjs build/01-latch.gfb examples/scenarios/latching-pump.toon --format toon
node tools/ghostsim.mjs build/01-latch.gfb examples/scenarios/latching-pump.toon --format json
```

시나리오는 [TOON 명세](https://github.com/toon-format/spec/blob/main/SPEC.md)를 따르며 `@toon-format/toon` 4.1.1의 엄격 모드로 디코딩됩니다. 필수 필드는 `format`, `id`, `initialInputs`, `keyBindings`, `actions`입니다. 각 초기 입력은 `{name,type,value}`이며 호스트 시계 `__gf_now_ms`를 제외한 모든 선언 입력을 포함해야 합니다. 형식은 `Bool`, `Number`, `Int`입니다. 바인딩은 숫자 키 1–8을 서로 다른 Bool 입력에 연결합니다. 기존대로 액션에는 형식이 지정된 `input`, `key`, `scan`이 포함됩니다. `sample` 액션은 다음 스캔에 사용할 식별된 센서 관측 하나를 제공합니다. `interval` 액션은 다음 스캔에 Driver 인증 Bool 구간을 제공합니다. 명시적 `temporal` 활성화 프로파일이 필요합니다. 샘플이 없으면 NotReady로 남으며 개별 관측만으로 연속 참을 뜻하지 않습니다. 적응 제어는 명시적인 `capabilities` 목록을 쓸 수 있습니다. 빈 목록은 선택 센서가 없음을 뜻합니다. Solar 제어에는 명시적인 `solar` 활성화 프로파일과 시계 및 공급자 발생 증거를 포함한 각 스캔의 `solarFacts`가 필요합니다. 호스트는 Solar due 값을 꾸며내지 않습니다. 프로그램을 평가하는 동작은 `scan`뿐입니다. `atMs`는 정확한 비음수 단조 비감소 논리 밀리초 값입니다. 입력 변화가 없는 후속 스캔도 경과 타이머를 진행시킵니다.

선택적 `actuatorBindings` 프로파일은 매니페스트 출력을 일반 가상 연속 액추에이터에 연결합니다.

```toon
actuatorBindings[1]{actuator,output,type,min,max,feedbackSensor}:
  roof-vent,vent_position,Percent,0,80,vent_position_feedback
```

`actuator`는 시나리오 내부 식별자입니다. `output`과 `type`은 Bool이 아닌 동일 매니페스트 출력을 선택해야 합니다. `min` 및 `max`는 유한한 드라이버 수락 범위입니다. 안전 목표가 해당 범위를 벗어나면 적용 행을 보고하기 전에 스캔을 거부합니다. `feedbackSensor`는 선택 항목이며 같은 형식의 매니페스트 센서여야 합니다. 지정하면 추적에는 형식이 지정된 처리값과 최신 명시 샘플의 `epoch`, `id`, `timestampMs` 출처 정보가 포함됩니다. 바인딩은 피드백을 만들어내거나 적용 출력을 해당 센서에 연결하지 않습니다. 새 관측을 모델링하려면 이후 `sample` 액션을 제공하세요.

첫 폐루프 환경 모델은 명시적으로 `GhostFlow/greenhouse-temperature-v1`입니다. `Temperature` 센서 하나를 `Percent` 가상 지붕 환기구 하나에 연결합니다.

```toon
plant:
  kind: GhostFlow/greenhouse-temperature-v1
  sensor: inside_temperature
  actuator: roof-vent
  epoch: 1
  initialTemperature: { value: 26.85, unit: °C }
  outsideTemperature: { value: 290, unit: K }
  heatingKPerSecond: 0.002
  leakPerSecond: 0.0001
  ventilationPerSecond: 0.01
```

`initialTemperature`와 `outsideTemperature`는 `°C` 또는 `K`를 사용하는 유한한 형식 값이어야 하며 절대영도 이상이어야 합니다. 대응하는 목표 설정 구성에는 `°C` 또는 `K`인 `displayUnit`을 명시해야 합니다. 플랜트 추적은 선택된 설정 단위를 사용합니다. 단위 메타데이터가 없거나 지원되지 않으면 첫 스캔 전에 시나리오를 거부합니다. 호스트는 숫자의 크기나 표준 단위 `K`에서 표시 단위를 추론하지 않습니다. 각 구간에서 모델은 직전 적용된 환기구 위치를 일정하게 유지하고 정준 Kelvin 단위로 다음 식을 해석적으로 풉니다.

```text
dT/dt = heatingKPerSecond
        - (leakPerSecond + ventilationPerSecond * positionPercent / 100)
          * (T - outsideTemperature)
```

스캔 경계에서 호스트는 먼저 `atMs`까지 적분한 뒤 정준 Kelvin 결과를 생성된 `Good` GhostFlow `Temperature` 샘플로 출력합니다. Rust 제어가 그 샘플을 읽습니다. 평가 및 가상 액추에이터 범위 검사가 성공하면 스캔 행이 커밋되고 안전한 환기 목표가 다음 구간의 적용 위치가 됩니다. 평가 또는 드라이버 수락이 실패하면 해당 경계에 대한 행을 남기지 않고 실행을 종료합니다. 평가 전 플랜트 계산 결과는 보고되거나 재사용되지 않습니다. 따라서 거부된 스캔이 적용 값이나 커밋된 플랜트 전이를 만들었다고 주장하지 않습니다. 공개 추적에는 선택한 표시 단위의 형식화된 `insideTemperature`, `outsideTemperature`, 이전 적용 위치, 생성 샘플 출처 정보가 기록됩니다. 명시적 `sample` 액션은 플랜트가 소유한 센서에 값을 제공할 수 없습니다. 이 모델에는 노이즈, 지연, 선언 액추에이터 범위를 넘는 포화, 물리 확인이 없습니다.

러너는 실행 전에 아티팩트의 저장된 소스 맵과 정확한 GFB 바이트가 일치하는지 검증합니다. 결과에는 시나리오 SHA-256, GFB SHA-256, 정본 `.ghost.md` 문서 SHA-256과 파일명, 있을 경우 변경 불가 문서/리비전 ID가 포함됩니다. 각 스캔에는 논리 시간, 전체 입력 스냅샷, 요청 및 안전 가상 의도, 오류, 전후 상태가 나옵니다. 바인딩된 액추에이터는 `requested`, `safe`, `applied`가 있는 `virtualActuators`에도 나타납니다. `confirmed` 단계는 없습니다. 같은 아티팩트 및 시나리오 바이트로 새 실행을 하면 같은 의미 추적이 나옵니다. 결과는 TOON 또는 JSON으로 된 `GhostFlow/scenario-result-v1` 문서 하나입니다. 엄격히 디코딩한 TOON은 JSON과 같은 값을 만듭니다.

4회 스캔 `latching-pump.toon` 예제의 측정 결과 크기는 압축 JSON에서 **466토큰 / UTF-8 1,491바이트**, TOON에서 **517토큰 / 1,677바이트**입니다. `tiktoken` `cl100k_base`, `@toon-format/toon` 4.1.1을 사용했습니다. 이 중첩 추적은 TOON에서 약간 더 크며 두 형식은 같은 데이터를 전달합니다.

잘못된 TOON, 누락/알 수 없는 입력, 잘못된 형식, 중복 바인딩, 유효하지 않은 키, 역행 시간은 오류 위치가 있고 스캔 행이 없는 버전 지정 `outcome: rejected` 결과를 냅니다. 런타임 실패는 `outcome: runtime-error`, 액션 인덱스, 그 전까지 커밋된 스캔만 반환합니다. 시간 초과, 출력 버퍼 오버플로, 잘못된 하위 프로세스 출력, 인코딩 결과 크기 초과를 포함한 호스트/전송 실패는 `outcome: host-error`, `traceComplete: false`, 스캔 행 없음으로 나타납니다. 이때 `scans: []`는 관측을 이용할 수 없다는 뜻이지 스캔이 전혀 실행되지 않았다는 증거가 아닙니다. 모든 실패는 0이 아닌 상태로 종료됩니다. 한도는 시나리오 텍스트 256 KiB, 액션 1,024개, 스캔 256개, 선택한 `--format`으로 인코딩한 결과 1 MiB입니다. 한도 근처에서는 JSON은 성공하지만 TOON은 초과할 수 있습니다. 둘 다 한도 안이면 엄격한 TOON 디코딩으로 JSON과 같은 결과를 얻습니다. 한도 초과는 잘린 성공 결과를 내지 않고 명시적으로 실패합니다. 네이티브 하위 프로세스는 비공개 JSON 액션을 받고 `KeyboardMapper`, `ScanDriver`를 사용합니다. WASM 호스트는 동일한 이식 가능 Rust 코어와 기존 신호, 시간, Solar 어댑터를 사용합니다.

시뮬레이터의 `atMs`는 시나리오 호스트가 제공합니다. 장치에서는 단조 타이머 시간과 신뢰된 벽시계/달력 정보가 호스트 시계 및 공급자 바인딩에서 옵니다. RTC, NTP, 네트워크 사용 가능 여부는 언어 코어의 범위가 아닙니다. 유효한 오프라인 RTC로 달력 시간을 제공할 수 있고 NTP는 선택적 보정입니다. 이러한 바인딩 전반에서 소스 언어의 타이머와 달력 의미는 동일합니다. 현재 일정, 정산, 시간 descriptor로 출력되는 전체 제어는 `ghostsim`에서 여전히 실행 불가합니다. [날짜가 지정된 시뮬레이터 기준선](REFERENCE-SIMULATOR-BASELINE-2026-09-23.md)을 참조하세요.
