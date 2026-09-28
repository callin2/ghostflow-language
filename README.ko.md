<!-- translation-source: README.md -->
[English / 한국어 문서](docs/DOCUMENTATION.ko.md) · [English README](README.md)

# ghostflow-language

GhostFlow 언어 컴파일러 및 이식 가능한 실행 플랫폼입니다. JavaScript가 파싱, 형식 검사, 하향 변환을 담당합니다. Rust는 검증된 바이트코드 실행, 신호 처리, 스테이션 중재를 담당합니다. 네이티브와 WASM 테스트는 동일한 Rust 코어를 사용합니다.

언어 철학, 문법, 의미, 기능의 근거를 공유하는 기준인 [언어 참조](docs/LANGUAGE-REFERENCE.md)부터 시작하세요. 현재 소유권, 성숙도, 실행 증거는 [참조 기능 상태](docs/REFERENCE-FEATURE-STATUS.md)를 확인하세요. 참조 문서는 의미를 정의하고, 상태 문서는 수용 증거를 기록합니다.

작업 중심 예제는 [GhostFlow 코딩 FAQ](docs/language_faq.md)를 참조하세요. `examples/` 아래의 `.ghost.md` 파일은 정본 컴파일 가능 문서입니다. 인접한 `.ghost` 파일은 과거의 비실행 증거입니다. 실행 가능한 FAQ 및 프로그래밍 예제는 컴파일 가능해야 합니다. 집중 검사인 `tests/docs-runnable-examples.test.mjs`는 컴파일러 및 호스트 게이트에서 실행됩니다.

```text
.ghost.md → compileSource → .gfb + manifest + source map
                                         ↓
                         네이티브 / WASM 이식형 Rust 코어
```

`tools/browser-toolchain.mjs`는 공개 브라우저/Worker 컴파일러 진입점입니다. Node 진입점과 동일한 완전한 정본 `.ghost.md` 문서 및 변경 불가능한 소스 식별 정보를 받지만 Node I/O 의존성이 없습니다. `tools/toolchain.mjs`는 Node 래퍼이자 아티팩트 읽기/쓰기 경계입니다.

제품 배포는 `tools/portable-package.mjs`를 통해 `.ghost.md` 결과를 감쌉니다. 하나의 서명된 패키지가 정확한 소스, GFB, 매니페스트, 소스 맵, 호스트 호환성 식별 정보를 보존합니다. 브라우저 및 Device 소비자는 복원한 GFB 바이트를 WASM 또는 네이티브 로더에 전달하기 전에 같은 검증기 계약을 사용합니다. [Portable GFB package v1](docs/PORTABLE-PACKAGE.md)을 참조하세요.

이 저장소에는 `tools/` 컴파일러/CLI/튜토리얼 코드, `crates/ghostflow-core`, `runtimes/wasm`, 참조 Node ledger 어댑터, 일부 `tests/`, 언어 `docs/`, 가상 `examples/`가 들어 있습니다. 마이그레이션 내보내기에서 기존 상대 import와 의미를 보존했습니다.

## 로컬 검증

Node.js 22 이상과 npm을 사용하세요. Rust 도구 체인은 Cargo 잠금 파일 v4, `rustfmt`, `wasm32-unknown-unknown`을 지원해야 합니다. 유지되는 튜토리얼에는 POSIX 네이티브 러너 경로가 필요하므로 macOS 또는 Linux를 사용하세요. 설정 중 의존성을 내려받을 수 있습니다.

```sh
npm ci --ignore-scripts
rustup component add rustfmt
rustup target add wasm32-unknown-unknown
npm test
```

`npm test`는 호스트 검사만 실행하며 `build/verification.json`과 고유 실행 기록을 씁니다. 기존 단위 테스트 하나가 해당 픽스처를 포함하므로 Rust 테스트 전에 `build/irrigation.gfb`를 생성합니다. Cargo 게이트는 `--locked --offline` 및 로컬 `target/`을 사용합니다. 현재 두 Rust 크레이트는 워크스페이스 의존성만 사용합니다.

최신 소스 예제는 다음과 같이 실행합니다.

```sh
npm run compile:example
npm run tutorial
```

`npm run test:compiler`는 WASM 빌드 없이 컴파일러/리터레이트/제약 동작을 확인합니다. `npm run test:node`는 이미 빌드된 WASM 아티팩트를 사용해 명시된 언어 Node 테스트 제품군을 실행하고 별도의 부분 보고서를 기록합니다. 전체 호스트 게이트를 대체하지 않습니다. [튜토리얼](docs/TUTORIAL.md)을 참조하세요.

## 소스, 생성 아티팩트, 소비자

정본 로직은 GhostFlow 소스입니다. GFB1은 생성된 바이너리 코드이며, `GhostFlow/control-v1`은 생성되는 호스트 매니페스트 형식입니다. 독립 `constraints` 소스는 `GhostFlow/constraints-v1`로 컴파일됩니다. JSON 인코딩만으로 배포, 사이트 메타데이터 또는 대화 기록이 제어 프로그램이 되는 것은 아닙니다.

API 프로젝트는 설치 정보를 LLM에 제공하고, 생성된 완전한 소스에 이 컴파일러를 실행합니다. Device 프로젝트는 고정된 코어와 아티팩트 번들을 사용하고 지원 기능을 검사하며 I/O를 담당합니다. 프런트엔드 프로젝트는 농가 사용자 경험을 제공합니다. API와 펌웨어는 별도로 릴리스됩니다. 여기의 호스트 테스트는 농가 의도 품질이나 GPIO 동작을 입증하지 않습니다.

릴리스/번들 소비자는 정확한 소스/바이트코드/매니페스트 해시, 컴파일러/코어 리비전, 지원 프로파일/ABI를 식별해야 합니다. `contracts/integration-v1`과 `tools/integration-contract.mjs`에는 통합 팀의 순수 식별/증거 검사 및 가상 픽스처가 있습니다. 이 도구는 배포를 실행하거나 컴파일러 형식을 바꾸지 않습니다. `npm run test:contract`로 단독 실행할 수 있습니다. [구현 경계](docs/IMPLEMENTATION.md), [검증](docs/VERIFICATION.md), [소유권](AGENTS.md)을 참조하세요.

이 프로젝트는 [MIT License](LICENSE)에 따라 배포됩니다.

이 내보내기에는 이전 `build/` 결과, POC, 펌웨어, 라이브 모델 연결기, 사이트 설치 정보, 비공개 채팅 기록이 포함되지 않습니다. 이 체크아웃에서 호스트 게이트를 실행해 자체 증거를 만드세요.
