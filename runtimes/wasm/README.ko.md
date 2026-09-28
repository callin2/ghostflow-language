<!-- translation-source: runtimes/wasm/README.md -->
[영문 원문](README.md)

# GhostFlow WASM 런타임

이 `cdylib`는 ESP-IDF에서 사용하는 것과 동일한 `ghostflow-core` 크레이트를 사용합니다. JavaScript 또는 wasm-bindgen 의존성은 없습니다. 브라우저는 `gf_alloc`으로 모듈 바이트 공간을 할당하고 `.gfb` 모듈을 선형 메모리에 복사한 뒤 내보낸 C ABI를 호출합니다. 여러 핸들을 사용하면 실제 타임라인과 가상 타임라인을 나란히 실행할 수 있습니다. `ghostflow-runtime.mjs`는 원시 ABI용 소규모 무의존성 JavaScript 래퍼를 제공합니다.

새 제어 소스에는 `.gfb`와 신뢰된 `.manifest.json`을 함께 사용하는 `control-runtime.mjs`를 사용하세요. 이 어댑터는 **가상** 출력 기능을 설치하고 Rust 센서 엔진에 연결하며 입력 형식을 검증하고 VM 추적과 함께 품질을 기록합니다. 장치를 검색하거나 GPIO 명령을 보내지 않습니다.

`station.mjs`는 공유 펌프의 모드/소유권/할당량/지속성 경계를 노출합니다. `policy.mjs`는 독립 제약 템플릿을 스테이션 하나에 바인딩합니다. 스테이션은 JavaScript 지속성 콜백이 실제로 바이트를 영구 저장했는지 또는 드라이버가 물리적으로 멈췄는지 검증할 수 없습니다. 이는 호스트 책임입니다.

`requestStop()`을 동기적으로 호출하고 저장을 기다리기 전에 안전 지시를 적용하세요. `advance()`는 임대/일 만료 시 조치 가능한 안전 지시를 반환합니다. 런타임 오류가 발생하면 물리 호스트는 안전 상태로 전환해야 하며 오래된 의도를 재사용하면 안 됩니다.

일반 코어 프로그램에서 `GhostFlowRuntime.replayCore({ count, maxJsonBytes })`는 유지된 스캔을 양수 개수만큼 재생하며, 유지된 저널 길이를 초과할 수 없습니다. `maxJsonBytes`는 기존 제한 JSON 재생 버퍼의 양수 바이트 예산입니다. 결과는 기존 `GhostFlow/temporal-replay-v1` 레거시 엔벌로프를 사용하고 `checkpointTick`과 재생 기록을 포함합니다. 엔벌로프 이름만으로 일반 프로그램이 시간 제어 프로그램이 되지는 않습니다. 실패하면 재생은 현재 상태, 대기 중 입력, 이전의 성공한 재생 버퍼를 그대로 둡니다. VM은 기록된 모듈과 전략을 확인합니다. 동일 프로그램 증거를 얻으려면 호스트가 같은 소스 리비전, 설정 이벤트, 기능 바인딩을 유지해야 합니다. 시간 제어, 공급자, 목표 세션은 별도 재생 계약을 사용하거나 이 진입점에서 지원되지 않습니다.

[튜토리얼](../../docs/TUTORIAL.md), [구현 경계](../../docs/IMPLEMENTATION.md), [검증 증거](../../docs/VERIFICATION.md)를 참조하세요. 모든 소프트웨어 게이트는 저장소 루트에서 `npm test`로 실행합니다. `npm run tutorial`은 네이티브/WASM 아티팩트도 빌드하고 튜토리얼 단언을 실행합니다.

대상을 추가한 다음 빌드합니다.

```sh
rustup target add wasm32-unknown-unknown
cargo build -p ghostflow-wasm --target wasm32-unknown-unknown --release
```
