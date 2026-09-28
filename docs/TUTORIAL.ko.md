<!-- translation-source: docs/TUTORIAL.md -->
[영문 원문](TUTORIAL.md)

# 호스트 실행 튜토리얼

이 독립 체크아웃의 전체 언어 게이트는 `npm test`로 실행합니다. 의존성과 네이티브/WASM 도구 체인을 설치한 뒤 `npm run tutorial`을 실행하면 `tools/tutorial.mjs`를 실행합니다. 두 러너를 빌드합니다. 모든 출력은 가상 의도이며, 명령을 실행할 때 결과를 로컬에 기록합니다.

| 예제 | 소스 | 러너가 확인하는 내용 |
|---|---|---|
| 래치 | [01-latch.ghost.md](../examples/tutorial/01-latch.ghost.md) | 정지 우선순위, 유지 상태, 펌프/밸브 요구 사항 |
| 일정 | [02-watering.ghost.md](../examples/tutorial/02-watering.ghost.md) | 일일 구간, 경과 타이머, 순차 밸브 상태 |
| 수분 | [03-moisture.ghost.md](../examples/tutorial/03-moisture.ghost.md) | 중앙값, 오래된 값/연결 끊김 처리, 자동 시작 없는 복구 |
| 공유 스테이션 | [04-extra-valves.ghost.md](../examples/tutorial/04-extra-valves.ghost.md) | 생성된 제약 정책으로 하나의 스테이션을 공유하는 두 제어기 |
| 재생 | 래치 입력 스냅샷을 사용하는 격리 VM | 기록된 가상 입력의 결정적 재실행 |

각 제어기는 실제 `compileSource`로 컴파일합니다. WASM 추적이 정확한 입력 스냅샷을 네이티브 러너에 제공하며, 튜토리얼은 VM 추적 JSON이 같은지 단언합니다. 이는 공통 입력에서 VM 실행을 비교합니다. 물리 샘플링, 시계 동기화 또는 MCU 호스트 동작을 비교하지는 않습니다.

단일 제어기를 실행하려면:

```sh
node tools/ghostc.mjs examples/tutorial/01-latch.ghost.md build/tutorial/latch.gfb
cargo run --locked --offline -p ghostflow-core --example run -- build/tutorial/latch.gfb examples/tutorial/01-latch.csv
```

생성된 `.gfb` 파일에는 `.manifest.json` 및 `.map.json` 사이드카가 있습니다. 튜토리얼 증거는 `build/tutorial/evidence.json`, 프로그램별 `.trace.json`과 `.inputs.csv`, 그리고 공유 스테이션 정책/바인딩/추적 파일에 저장됩니다. 이 파일은 무시되는 로컬 출력이며 소스 릴리스에서 다시 생성됩니다.

변경되지 않은 튜토리얼 러너에는 기존 필드 `hardware: "deferred-by-user"`가 있습니다. 이 언어 저장소에서는 이는 상속된 호스트 전용 증거 메타데이터입니다. 현재 권한이나 다른 프로젝트 보드 상태를 나타내지 않습니다. 최상위 호스트 게이트는 `hardwareTested: false` 및 `llmTested: false`를 명시적으로 기록합니다.

[구현 제한](IMPLEMENTATION.md)과 [검증 요구 사항](VERIFICATION.md)을 참조하세요.
