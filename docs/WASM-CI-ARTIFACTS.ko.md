<!-- translation-source: docs/WASM-CI-ARTIFACTS.md -->
[영문 원문](WASM-CI-ARTIFACTS.md)

# 리비전 지정 GhostFlow WASM CI 아티팩트

이슈 [language #97](https://github.com/callin2/ghostflow-language/issues/97)은 [frontend #210](https://github.com/callin2/farm_studio_frontend/issues/210)의 실제 WASM 게이트를 진행시키기 위한 인계를 정의합니다. 이는 워크플로 및 검증 계약입니다. 호스팅 실행과 독립적인 다운로드 검증이 끝나기 전까지 아티팩트가 존재한다고 주장하지 않습니다.

## 범위와 의존성

- 병합 ref가 아니라 현재 체크아웃된 PR head를 빌드합니다.
- 프런트엔드의 활성 언어 핀 `b2f2874dd0238207558dfa4cc83077d322356a6c`을 빌드합니다.
- 수동 실행에서는 선택적으로 source_sha를 제공할 수 있습니다. 생략하면 현재 워크플로 커밋을 사용합니다. 제공할 경우 40자리 전체 커밋 SHA여야 합니다. 짧은 SHA, 브랜치, 태그, 변경 가능한 ref는 유효하지 않습니다.
- source.commit은 정확한 언어 소스 테스트 핀입니다. ci.commit은 워크플로가 체크아웃한 PR head, push head 또는 dispatch 커밋을 기록하며 서로 다를 수 있습니다.
- 실제 호스팅 실행에서 아티팩트가 생성되고 다운로드 검증이 통과할 때까지 #97은 열어 둡니다. 로컬 Rust 통과만으로는 이슈를 닫지 않습니다.
- [API #30](https://github.com/callin2/farm_studio_api/issues/30)은 별도입니다. [Frontend #207](https://github.com/callin2/farm_studio_frontend/issues/207)은 상위 맥락입니다. [Frontend #211](https://github.com/callin2/farm_studio_frontend/issues/211)에는 성능 작업이 포함됩니다. 이 아티팩트는 실제 Android 전달 결과를 나타내지 않습니다.

패키징 전에 워크플로는 정확한 소스 커밋, 트리, Cargo.lock 해시를 확인하고 기록해야 합니다. 요청한 커밋이 없거나 추적되는 체크아웃이 더럽거나 추적 소스 해시가 다르면 실패해야 합니다. 검증기와 인계는 `tools/verification-sources.mjs`의 전체 소스 해시 목록을 공유하며 모든 크레이트를 포함합니다. 내용이 달라진 항목뿐 아니라 보고서에서 빠지거나 추가된 항목도 거부합니다.

## 설정 및 게이트

설정 단계에서는 네트워크를 허용합니다.

1. PR head 또는 요청된 전체 source_sha를 체크아웃하고 커밋 및 트리를 검증합니다.
2. Node 22와 Rust stable을 설치합니다. 정확한 node, npm, rustc, cargo, rustc -vV 출력을 기록합니다. 이는 출처 정보이며 재현성 주장은 아닙니다.
3. `npm ci --ignore-scripts`를 실행합니다.
4. 네이티브 패키지 검증기 의존성을 포함해 현재 main의 crates.io 의존성에 `cargo fetch --locked`를 실행합니다.

검증 중 Cargo는 오프라인 및 잠금 모드여야 합니다. 이것이 전체 네트워크 접근을 비활성화한다는 뜻은 아닙니다. 현재 전체 npm 테스트는 이미 WASM 빌드를 호출합니다. Cargo를 오프라인 모드로 두고 기존 게이트를 실행합니다.

```sh
CARGO_NET_OFFLINE=true npm test
```

전체 테스트/보고서 단계 뒤에 WASM을 다시 수동 빌드하지 마세요. 기존 단일 빌드가 패키징할 바이너리와 해시의 출처입니다.

## 패키지, 보고서, 매니페스트

주 구현은 `tools/package-verified-wasm.mjs`입니다. 다음을 인계합니다.

```text
ghostflow_wasm.wasm
verification.json
manifest.json
```

보고서는 다음을 요구해야 합니다.

```json
{
  "format": "GhostFlow/language-verification-v1",
  "scope": "language-host",
  "passed": true,
  "wasm": {
    "builtByThisRun": true,
    "sha256": "<packaged binary sha256>",
    "bytes": 0
  }
}
```

스크립트는 잘못되었거나 일치하지 않는 소스, 보고서, 바이너리, 매니페스트 데이터에서 예외를 던집니다. 보고서의 wasm.sha256과 wasm.bytes는 패키징한 바이너리와 일치해야 합니다.

manifest.json에는 GhostFlow/verified-wasm-artifact-v1 형식과 다음 필드가 있어야 합니다.

- source.repository, source.commit, source.tree, source.cargoLockSha256
- binary.path, binary.bytes, binary.sha256
- verification.path, verification.sha256, verification.scope
- toolchain.node, toolchain.npm, toolchain.rustc, toolchain.cargo, toolchain.rustcVerbose
- build.command [npm, test], target wasm32-unknown-unknown, profile release
- ci.repository, ci.commit, ci.workflowRef, ci.workflowSha, ci.runId, ci.runAttempt, ci.runUrl

ci.workflowSha는 워크플로 파일 blob SHA가 아니라 워크플로를 포함한 커밋입니다. 도구 버전은 실행된 도구를 기록할 뿐 아티팩트를 재현 가능하게 만들지 않습니다. SHA-256 값은 무결성 검사이며 서명된 증명이 아닙니다.

## 업로드, 이름 지정, 다운로드 검증

기존 전체 npm 테스트와 패키징 스크립트가 성공한 뒤에만 업로드합니다. 보존 기간은 14일로 하고 이름은 다음 형식으로 사용합니다.

```text
ghostflow-wasm-<current|frontend-pin>-<source_sha>-<runid>-<attempt>
```

실패 실행은 별도의 실패 보고서를 업로드할 수 있지만 실패한 WASM 인계는 업로드하지 않습니다. 대체 바이너리나 꾸며낸 빌드 표시는 없습니다.

소비자는 다운로드한 파일을 신뢰 가능한 기대값과 비교해 검증해야 합니다.

1. 세 파일이 모두 있는지 확인하고 매니페스트와 보고서를 파싱합니다.
2. 정확한 형식, 기대 저장소, 소스 핀, 트리, 잠금 파일 해시, 대상, 프로파일, 보고서 요구 사항을 확인합니다.
3. 바이너리 및 보고서 해시와 바이트 수를 다시 계산해 매니페스트/보고서 값과 비교합니다.
4. 예상 호스팅 실행, ci.commit head, 워크플로 ref, 워크플로 커밋을 확인합니다. 다운로드한 zip과 매니페스트 자체로 신뢰를 부여하지 않습니다.

일반 소스 빌드도 계속 지원합니다. 이 아티팩트는 검증된 빌드 인계이지 완전한 프런트엔드 가드 표시나 설치된 장치 매핑이 아닙니다. 의미 엔진이나 JavaScript 대체 구현을 추가하지 않습니다.
