<!-- translation-source: docs/VERIFICATION.md -->
[영문 원문](VERIFICATION.md)

# 독립 언어 검증

내보내기는 이전 빌드 결과가 아니라 소스와 오버레이를 복사합니다. 마이그레이션 작업공간의 PASS 결과는 승계되지 않습니다. 새로 내보낸 저장소에서 다음 명령을 실행해 자체 결과를 확보합니다.

```sh
npm ci --ignore-scripts
rustup component add rustfmt
rustup target add wasm32-unknown-unknown
npm test
```

요구 환경은 Node.js 22 이상, npm, 잠금 파일 v4를 지원하는 Rust/Cargo, rustfmt, WASM 대상, macOS/Linux 네이티브 링커입니다. 설정에는 네트워크가 필요할 수 있습니다. 검증 게이트는 오프라인/잠금 Cargo를 사용하며 API, LLM, 직렬 포트, 네트워크 서비스 또는 물리 드라이버를 사용하지 않습니다. 유지되는 튜토리얼의 네이티브 실행 경로는 POSIX 전용입니다. 초기 내보내기는 Windows 지원을 주장하지 않습니다.

`tools/verify-language.mjs`는 아래 게이트를 실행합니다. 처음 실패한 명령에서 멈추며 실패 보고서를 보존합니다.

1. 도구 체인 버전을 읽고 Rust 형식을 검사합니다.
2. Rust 단위 테스트의 `include_bytes!`에 필요한 레거시 픽스처를 컴파일합니다.
3. 기존 잠금 파일로 워크스페이스 Rust 테스트를 실행합니다.
4. 동일 코어에서 레거시 네이티브 러너, 릴리스 프레임 방식 `scan_tape` 러너, 릴리스 WASM을 빌드합니다.
5. 프레임 네이티브/WASM 테이프 동등성을 포함한 명시적 언어/통합 계약 Node 제품군을 실행합니다([SCAN-TAPE-PARITY.md](SCAN-TAPE-PARITY.md) 참조).
6. 새로 빌드한 러너로 튜토리얼을 실행하고 네이티브/WASM 추적을 비교합니다.
7. 네이티브 리소스 보고서, 두 네이티브 러너 다이제스트, WASM 다이제스트, 소스 해시를 기록합니다.

Node 제품군은 컴파일러 오류, 리터레이트 추출, 아티팩트 맵, 매니페스트 기반 제어 실행, 제약/정책, 일정 및 발생 승인, 신호/스테이션 ABI 동작, 참조 파일 ledger, 가상 픽스처를 이용한 순수 통합 식별/증거 거부 검사를 다룹니다. 일부 어댑터 테스트는 주입된 ABI 객체를 사용합니다. 실제 컴파일 WASM 동작은 제어/스테이션 테스트 및 튜토리얼 동등성에서 별도로 확인합니다. 테스트는 소스 수준 적합성 범위이며 전체 런타임 또는 장치 동작의 증명이 아닙니다.

정본 회귀 사례인 `examples/vfd-speed.ghost.md`는 Bool/Number 혼합 제어를 컴파일하고 릴리스 WASM에서 `vm.safe` 프레임 8개를 순차 확인합니다. 출력된 입력/출력 형식도 확인합니다. 처음 실패한 WASM SHA-256은 `3a8450b3001e04f52fe6a3a2e7d4cde0c16316171e69f345483ecde2d319ef36`였습니다. 이 바이너리는 첫 스캔 전에 232바이트 GFB를 `unknown expression opcode` 오류로 거부했습니다. 언어 리비전 `fa0a005e43bd98ce0cb22e49b263d89ee796cd30`에서 WASM을 다시 빌드했을 때 SHA-256은 `b4495901b3399c57ed0a0b204b4d226b03819bcc251c368d9dcfa82b147c32b3`였고 프레임 8개 모두 통과했습니다. 이전 바이너리의 빌드 리비전은 알 수 없습니다. 이 관찰은 호환되지 않는 기존 바이너리가 재사용된 사례이며 소스 컴파일러/로더 결함을 뜻하지 않습니다. 전체 `npm test`는 이 회귀 사례 전에 WASM을 다시 빌드하므로 새 컴파일러/런타임 쌍이 호환되지 않으면 실패합니다. 부분 명령 `npm run test:node`는 호환되지 않는 WASM 바이너리를 재사용하면 실패합니다.

검증된 빌드 뒤에는 `node --test tests/vfd-speed.test.mjs`로 집중된 헤드리스 검사를 실행할 수 있습니다. 성공할 때마다 `build/vfd-speed-runs/` 아래에 새 파일을 씁니다. 기대 시나리오를 관측 VM 추적과 분리하고 소스/시나리오 해시, 컴파일러 리비전 및 소스 트리 해시, 바이트코드 해시, WASM 해시를 기록합니다. 스캔 전에 누락 입력, 잘못된 Bool/Number 형식, NaN, 무한대도 거부합니다. 이는 가상 제어 출력이며 모터 속도나 물리 전압을 측정하지 않습니다.

`build/verification.json`은 최신 전체 호스트 결과입니다. `build/verification-runs/`의 고유 파일은 이전 결과를 보존하고 `build/tutorial/`에는 다시 생성한 프로그램과 추적을 둡니다. 모두 무시되는 실행 증거입니다. 부분 `npm run test:node`는 기존 WASM과 릴리스 네이티브 빌드 둘 다 필요하며 `build/verification-node.json`을 씁니다. 최신 전체 결과는 그대로 둡니다.

API 수용, 실제 농가 언어 평가, 펌웨어 호환성, 보드 업로드, GPIO, 배선, 물리 동작은 각각 식별된 소비자 테스트가 필요합니다. 이 저장소의 성공한 호스트 보고서에 그런 주장을 덧붙이지 마세요.

리비전 지정 GitHub Actions 인계 및 소비자 검증 한도는 [WASM CI 아티팩트](WASM-CI-ARTIFACTS.md)를 참조하세요.

[이슈 #357](https://github.com/callin2/ghostflow-language/issues/357)에 따라 항상
실행되는 Verified WASM 워크플로는 문서 검사 또는 기존 전체
`Verify WASM (current)` / `Verify WASM (frontend-pin)` 작업을 선택합니다.
보수적인 일반 문서 허용 목록과 정확한 변경 비교 규칙은
[개발 워크플로](DEVELOPMENT-WORKFLOW.ko.md)에 기록되어 있습니다. 다른 모든 변경과
수동 실행은 전체 검증을 실행합니다. 정확한 리비전의 검증된 WASM 인계가 필요하면
`source_sha`를 지정해 수동 실행합니다. 문서 전용 성공은 WASM을 빌드하거나
컴파일러/런타임 동작을 입증하지 않습니다.

최종 `Verification result` 검사는 경로가 건너뛰어지거나 실패해도 실행됩니다.
분류 실패, 취소, 건너뛰기, 누락되거나 알 수 없는 모드, 선택된 경로의 비성공
결과는 실패로 처리합니다. 선택되지 않은 경로만 건너뛸 수 있으며 해당 경로의
예상치 못한 실패, 취소 또는 누락 결과도 실패로 처리합니다.
병합 전에 이 결과가 성공해야 합니다. 기존 브랜치 보호 설정은 변경하지 않습니다.
경로 분류와 결과 전파는 전체 언어 제품군에도 등록된
`tests/ci-verification-routing.test.mjs`로 회귀 검사합니다.
