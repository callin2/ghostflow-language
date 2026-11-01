<!-- translation-source: AGENTS.md -->
[영문 원문](AGENTS.md)

# GhostFlow 언어 소유권

이 문서는 이 저장소에서 작업하는 AI 코딩 에이전트와 다른 기여자를 위한
규칙입니다. 어떤 작업이든 시작하기 전에 첫 절을 읽으세요.

**문서 찾기와 유지**

- 범위가 제한된 검색, 위임 실행, 증거 재사용에는
  [개발 작업 흐름](docs/DEVELOPMENT-WORKFLOW.ko.md)을 따르세요.
- 문서 경로와 제목은 `npm run docs:find -- --limit 8 QUERY`로 찾으세요.
- 문서 편집 묶음 하나가 끝나면 `npm run docs:index`를 실행한 뒤
  `npm run docs:check`를 실행하세요.

**언어 참조를 기준으로 삼기**

- 언어, 런타임, 설정 또는 Interaction IR 작업 전에
  [언어 참조](docs/LANGUAGE-REFERENCE.md)를 읽으세요.
- 언어 참조는 언어 철학, 문법, 의미, 기능 근거에 대한 공통 기준입니다.
- 구현 상태와 진행 보고는 참조 문서에 넣지 마세요.
- 언어 의미를 바꾸면 참조 문서의 관련 절과 그 근거를 함께 갱신하세요.

**언어 변경을 changelog에 기록하기**

- 모든 언어 규칙 변경과, 관찰 가능한 언어 동작을 바꾸는 모든 버그 수정은
  같은 PR에서 루트 `CHANGELOG.md`와 `CHANGELOG.ko.md`에 기록하세요.
- [언어 규칙 변경 기록 절차](docs/DEVELOPMENT-WORKFLOW.ko.md#언어-규칙-변경-기록)를
  따르세요.

**판단하기 전에 출력 수명 주기 확인하기**

- GhostFlow 제어/출력 수명 주기, 시뮬레이터 동작, Device 출력 실패 정책을
  판단하기 전에
  [참조 §4.7](docs/reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)과
  [물리 순서](docs/LLM-TOOLCHAIN-ARCHITECTURE.ko.md#물리-driver와-device-경계)를 읽으세요.
- 명령 결과 수명 주기와 requested, safe, applied, confirmed 출력 증거를
  구별하세요.
- 어떤 정책이 없다거나 물리 동작이 검증되었다고 주장하기 전에, 검토 대상인
  실제 `farm-device` 펌웨어 리비전을 확인하세요.

**이 저장소가 소유하는 것**

이 저장소는 GhostFlow 문법, 파싱, 타입 검사, 하향 변환(lowering), GFB1 인코딩,
이식 가능한 Rust VM/신호/스테이션 엔진과 그 WASM ABI, 참조 호스트 어댑터와
적합성 테스트를 소유합니다. 실행 의미를 바꾸는 변경에서는 컴파일러와 런타임
변경을 함께 유지하세요.

## 경계

그 밖의 모든 것은 다른 저장소와 모듈이 소유합니다. 다음 경계를 지키세요.

- **API 호스트.** API 호스트는 LLM 요청, 설치 맥락, 대화 기록, 소스 리비전
  저장, 배포 오케스트레이션을 소유합니다. LLM은 완전한 GhostFlow 후보를
  작성하고, 이 컴파일러는 LLM이나 API 서비스 없이 그 후보를 검증합니다.
- **Device 저장소.** Device 저장소는 펌웨어, 보드 프로필, 핀 매핑,
  driver/renderer 통합, 감시 타이머(watchdog), 시계, 물리 I/O를 소유합니다.
  - 이식 가능한 코어는 명시된 리비전으로 사용하세요. 이 저장소의 변경이 Device
    릴리스나 하드웨어 검증을 뜻하지는 않습니다.
  - 입력 driver와 출력 renderer 소스는 `farm-device-drivers`에 속합니다.
    Renderer는 논리 출력을 릴레이, 모터, 램프 또는 화면에 적용하고, 캐비닛
    UI는 `@ghostflow/cabinet-view`입니다. Device는 host/board 통합을 소유합니다.
- **프런트엔드.** 프런트엔드는 농가 사용자 상호작용과 시각화를 소유합니다.
  설치 라벨, capability, 바인딩은 외부 맥락입니다. 실행 규칙은 별도의 JSON
  프로그램이 아니라 버전 관리되는 GhostFlow 소스와 그 컴파일 아티팩트에 둡니다.
- **참조 어댑터.** `runtimes/wasm`과 `runtimes/node/ledger.mjs`는 참조
  어댑터입니다. 매니페스트를 검증하고, 생성 입력과 예약 발생, 지속성을 공급할 수
  있습니다. 식/상태/의도 실행은 공유 Rust 코어에 둡니다.

## 작업 방식

**문서를 양언어로 유지하기**

- 작성한 문서는 완전한 영어 버전과 한국어 버전을 유지하세요. 여기에는 철학,
  아키텍처, 명세, 도구 체인 안내, 설계 계획, 교육용 예제가 포함됩니다. 보고서와
  실행 증거는 한 언어로만 둘 수 있습니다.
- 기존 소스 경로를 유지하고 형제 `.en.md` 또는 `.ko.md` 번역을 추가하세요.
  번역된 예제는 읽기용 투영본이며, 절대 새 정본 컴파일 입력이 아닙니다.
- 같은 변경에서 두 버전과 그 검토된 해시를 `docs/translations.json`에
  갱신하세요. 보고서, 생성 아티팩트, 테스트 데이터 제외 항목은 그 사유와 함께
  여기에 기록하세요.
- `npm run docs:check`를 실행하세요. 해시는 최신 여부를 확인할 뿐, 번역의 의미
  품질을 확인하지는 않습니다.
- 전체 정책은 `docs/DOCUMENTATION-LANGUAGES.ko.md`, 영어/한국어 문서 목록은
  `docs/DOCUMENTATION.ko.md`를 참조하세요.

**안전하게 편집하고 범위 지키기**

- 소스 편집에는 `apply_patch`를 사용하고 무관한 작업을 보존하세요.
- 제품 서버, POC UI, 자격 증명, 모델 연결기, 보드 펌웨어, 장치 호출, 가져온 대화
  기록을 이 저장소에 추가하지 마세요.
- 테스트는 `tools/verify-language.mjs`에 명시적으로 나열하세요. 와일드카드로
  형제 제품 테스트를 찾아 넣어서는 절대 안 됩니다.

**검증하기**

- 의존성과 WASM Rust 대상이 설치된 뒤 호스트 검증에 `npm test`를 실행하세요.
  이 명령은 Cargo를 호출하기 전에 Rust 테스트에 필요한 픽스처를 컴파일하고,
  WASM/네이티브 러너를 빌드한 뒤 언어 테스트와 튜토리얼을 실행합니다.
- 실행 가능한 FAQ와 프로그래밍 샘플을 바꾸면, 그 샘플을 집중 컴파일러 검사인
  `tests/docs-runnable-examples.test.mjs`에 계속 포함하세요.
- `contracts/requirements/catalog.json`이 참조하는 파일을 편집한 뒤에는
  `node --test tests/requirement-catalog.test.mjs`를 실행하세요. 행이 이동하면
  바뀌지 않은 발췌 범위를 옮기고 기대 해시는 보존하세요.
- 집중 package 검사에는 `npm run test:portable-package`를 사용하세요. 이 명령은
  package 회귀 검사 전에 빠른 catalog preflight를 실행합니다.

**증거를 분리해 두기**

- 릴리스 기록에는 소스 및 아티팩트 해시를 보존하세요.
- 생성된 검증 및 튜토리얼 추적 기록은 무시되는 `build/` 디렉터리 아래의 실행
  증거이며, 소스 릴리스와 구분됩니다.
- 호스트 검증은 Device, API, 농가 UX 검증과 구분해 보고하세요.

**과거 벤치마크 보호하기**

- 정당한 소스 변경 때문에 CI가 identity 차이를 보고했다는 이유만으로 과거
  벤치마크나 그 고정 다이제스트를 덮어써서는 절대 안 됩니다.
- 세 가지를 분리하세요. 체크아웃된 파일에서 파생한 현재 provenance(출처),
  독립적으로 고정된 과거 스냅샷 무결성, 측정된 동작 비교입니다.
- 해시를 바꾸기 전에 그 계약을 진단하세요. 의도적인 새 벤치마크는 날짜가 붙은
  새 아티팩트로 남기세요. provenance 변경과 저장된 기록의 변조는 회귀 테스트로
  다루세요.
- [`docs/2026-09-24-authoring-baseline-provenance.ko.md`](docs/2026-09-24-authoring-baseline-provenance.ko.md)를
  참조하세요.

**프로그래밍 책이 바뀌면 PC-01 다이제스트 재생성하기**

- 프로그래밍 책이 바뀌면 검증 전에 `npm run generate:pc01`을 실행하세요.
- 생성기는 교육과정 카탈로그와 replay 매니페스트에서 PC-01의 현재 소스
  다이제스트만 갱신합니다.
- replay 프레임, checkpoint, 다른 강의, 날짜가 붙은 벤치마크 증거는 고정해
  두세요. 남은 불일치는 다시 쓰지 말고 원인을 진단하세요.

## v1 호환성 정리: 정본 문서형 소스만 사용

- 이 1.0 이전 도구 체인은 제품 컴파일에 정본 `.ghost.md` 문서형 소스(literate)
  문서를 받습니다. 대체 경로가 수용되고 검증되면, 대체된 활성 소스/API/fallback
  경로와 그 호환성 테스트를 제거하세요.
- 호환성은 명시적으로 승인된, 구체적인 현재 사용자, 데이터 또는 배포 요구가
  있을 때만 추가하세요. 과거 원자료는 명확히 격리된 증거로 남길 수 있지만,
  실행 가능한 fallback이 되어서는 절대 안 됩니다.

## 자동 build identity — System #199

공식 빌드는 공유 온라인 할당기에서 빌드 번호를 받습니다.

**할당**

- `npm run build:wasm`, `make wasm`, `npm test`와 직접 verifier 명령은
  `scripts/vendor/BUILD-IDENTITY.json`에 고정된 정확한 바이트의 System 도구를
  통해 온라인으로 빌드 번호를 할당합니다.
- 현재 모든 Cargo crate의 base version은 0.1.0입니다. 빌드 hook은 할당 전에
  이 일치를 확인합니다. 향후 버전이 달라지면 명시적인 artifact base-version
  계약이 필요합니다.
- 번호를 수동으로 고르거나 내부 guard를 우회하지 마세요.
- Raw Cargo는 의존성/개발자 컴파일이며, 공식적으로 식별된 handoff가 아닙니다.

**Identity 기록**

- 생성된 `build/build-identity.json`은 발급된 전체 사람용 빌드 버전을 실제 출력
  SHA-256에 결속합니다.
- 전체 검증은 native/framed 출력 해시를 포함하고 그 identity를 보고서에
  복사합니다.
- CI packaging은 실제 WASM SHA/source를 검증하고 같은 identity를 handoff
  manifest에 넣습니다.
- 런타임 ABI/export는 바뀌지 않습니다. 이 hook이 없던 과거 고정 소스에는 ID를
  소급해 붙이지 않습니다.

**실패**

- 실패한 재빌드는 컴파일 전에 이전 identity를 무효화하고 그 번호를 소모합니다.
- metadata 전용 원격 `build-counter` 브랜치는 정리 대상에서 제외하세요.
- 오프라인/읽기 전용 authority는 컴파일 전에 실패합니다. counter를 추측하거나
  reset해서는 절대 안 됩니다.

**테스트와 소유권**

- `npm run test:build-identity`는 로컬 bare authority와 합성 컴파일러로 identity
  전파, 실패 시 번호 소모, 내부 guard를 테스트합니다. 이 테스트가 실제 WASM
  컴파일을 입증하지는 않습니다. 그것은 기존의 전체 CI 컴파일러/packaging gate가
  입증합니다.
- 공유 정본 할당기는
  [System #199](https://github.com/callin2/farm_studio_system/issues/199)가
  소유합니다. 벤더링된 바이트/checksum을 보존하세요.
- Source SHA는 커밋된 HEAD만 나타냅니다.

**호환성과 식별자**

마이그레이션 내보내기는 컴파일러/런타임 의미를 보존합니다. 형식이나 ABI를
바꾸려면 명시적인 호환성 결정과 적합성 테스트가 필요합니다. 패키지 버전, 소스
언어 프로필, GFB1 형식, 매니페스트 형식, Device 펌웨어 버전은 서로 다른
식별자입니다. `docs/IMPLEMENTATION.ko.md`와 `docs/VERIFICATION.ko.md`를
참조하세요.
