<!-- translation-source: docs/AI-CONTRIBUTION-PACKAGE.md -->
# 범위를 제한한 AI 기여 작업 패키지

한국어 | [English](AI-CONTRIBUTION-PACKAGE.md)

이 구체적인 패키지는 [#134](https://github.com/callin2/ghostflow-language/issues/134)를 지원한다.
전체 대화 기록을 가져오지 않고 경계 회귀 하나를 조사할 수 있는 근거를 제공한다.
언어 규칙 변경이나 장치 실행을 승인하지 않는다. 전체 저장소 검증 절차는
[CONTRIBUTING](../CONTRIBUTING.ko.md)과 [개발 절차](DEVELOPMENT-WORKFLOW.ko.md)를 따른다.

## 정확한 baseline과 작업

준비 baseline은 dev `5f87876a170a9e4c7da9d15f4c99a70c502e7b1a`다.
각 기여에서 실제 base/candidate SHA와 작업 트리 상태를 기록한다.
이 과거 baseline이 새 head의 검증 결과를 대신하지 않는다.
이 패키지는 compiler나 Rust 동작을 변경하지 않고 근거를 추가한다.

작업: 금지된 경계에서 intent가 허용되는 회귀를 조사한다.
고정 사례는 숫자 moisture가 42.5 이상이면 `pump=false`를 요구한다.
수정 제안은 독립적으로 정한 oracle을 유지해야 한다.
이 사례를 모든 설비의 안전 정책으로 일반화하지 않는다.

최소 읽기 범위와 계약:

- `GF-REQ-cf3758241cf74c21`: requested intent와 safe intent의 구분.
  [catalog](../contracts/requirements/catalog.json), Reference
  [§4.7](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed).
- `GF-REQ-fe719c3299fc1258`: 상태/intent의 원자적 commit.
  [Reference §2.8](reference/02-types-expressions-state.md),
  [요구사항 validator](../contracts/requirements/validate.mjs).
- [runtime conformance](../tests/runtime-conformance.test.mjs)의
  `GF-TEST-contribution-field-boundary` selector.
- 정확한 canonical 입력 [numeric-threshold.ghost.md](../tests/fixtures/contribution-134/numeric-threshold.ghost.md)와
  독립 [oracle.json](../tests/fixtures/contribution-134/oracle.json).

현장 사례에서 파생한 source/oracle은 Device #43의 software-input,
virtual-output 사례의 불변 revision
[`618e45046f1c8be748eeec6767d5ffe0ea997a11`](https://github.com/callin2/farm-device/tree/618e45046f1c8be748eeec6767d5ffe0ea997a11/tools/hil/cases/numeric-threshold-virtual-ro1)에서 가져왔다.
선택된 board는 `waveshare-esp32-s3-eth-8di-8ro-r8n16`이다.
이 identity는 출처이며 이번 언어 기여에서 board를 검증했다는 뜻이 아니다.
oracle은 42.4→true, 42.5→false, 42.6→false, 42.4→true다.
기대값은 compiler 출력이나 native/WASM 일치로 생성하지 않는다.

## 재현과 민감도 확인

고정된 의존성과 native/WASM target을 준비한 뒤 실행한다.

```sh
npm ci --ignore-scripts
cargo build --locked --offline -p ghostflow-core --release --example run
npm run build:wasm
node --test --test-name-pattern GF-TEST-contribution-field-boundary tests/runtime-conformance.test.mjs
node --test tests/runtime-conformance.test.mjs tests/requirement-catalog.test.mjs
```

설치된 경우 기존 compact wrapper를 사용한다. 의존성 준비에는 저장소의
일반적인 locked Cargo fetch가 먼저 필요할 수 있다. 인프라 실패를 별도로
보고한다. `npm test`와 CI는 여전히 전체 회귀 검증 gate다.

focused test는 원본 fixture를 한 번 compile하고 동일 bytes/input tape를
native Rust와 WASM에 공급한다. requested/safe 결과를 현장 oracle과 비교한다.
WASM ABI의 명시적 input-clear negative는 `missing input moisture`로 거부하고 확정된
출력을 보존하며 다음 명시적 입력에서 복구한다. 이것은 언어 negative case이며
Device 품질 저하 시험이 아니다. CSV native runner는 완전히 빈 줄을 건너뛰므로
이 단일 입력 누락을 native 비교로 주장하지 않는다. 고정된 adapter는 Number 입력을 0으로
초기화하고 partial update의 이전 값을 유지했으며 quality channel이 없었다.

메모리 안의 임시 mutation 두 개는 `<`를 `<=`로 바꾸거나 조건을 `true`로
대체한다. 양 target에서 정상 compile/실행된 뒤 변경하지 않은 oracle assertion이
실패해야 한다. green test는 이 assertion이 RED가 되는지 검사한다.
compiler crash, timeout, runner 누락을 mutation 검출 성공으로 계산하지 않는다.
이 시연은 product source를 변경하지 않는다.

## 수정 허용 범위와 검토 근거

기여 범위는 재현된 결함을 소유하는 compiler/core 경로와 focused regression으로
제한한다. 동작이 바뀌는 경우에만 관련 양언어 규칙 문서/changelog를 함께 고친다.
Device firmware, binding, driver, deployment, UI 정책, 과거 benchmark hash는
변경하지 않는다. 현재 패키지는 근거만 추가한다. 실제 회귀 수정에는 자체
before/after 재현이 필요하다.

issue/PR template은 정확한 identity, 명령/exit status, before/after 결과,
독립 기대값, 범위와 잔여 공백을 요구한다. 다음 diff 항목을 따로 검토한다.

1. 경계 연산자를 포함한 보호식 제거 또는 약화.
2. `oracle.json` 및 test의 독립 상수 기대값 변경.
3. test 삭제, `.skip`/`.todo`, selector/runner-list 제거, assertion 손실.
4. 요구사항 `status`, `testIds`, locator digest, `pendingReason` 변경.

`git diff BASE_SHA...HEAD -- tests/fixtures/contribution-134 tests/runtime-conformance.test.mjs tools/verify-language.mjs contracts/requirements/catalog.json`을
사용하고 구현 diff는 별도로 읽는다. catalog 검증은 잘못된 참조/status 계약을
검출하지만 약해진 oracle이 올바른지 판단하지 못한다. 정당한 명세 변경에는
권위 있는 근거 인용과 별도의 독립 의미 검토가 필요하다.
구현과 기대값을 함께 바꾼 사실만으로 정확성이 증명되지 않는다.

native/WASM 일치는 해당 input tape의 이식 근거다. 둘은 Rust를 공유하므로
같은 오해도 공유할 수 있다. 현장 oracle은 독립적인 경계 기대를 추가할 뿐
보편적인 정확성이나 물리 보호를 증명하지 않는다. 접점, 부하, missing-quality
channel, driver failure, reboot, live settings, power interruption, HIL trust
boundary는 검증하지 않는다. Device #43/#45가 해당 owner와 공백을 유지한다.
완료 보고에는 정확한 CI/report/artifact identity와 새로운 postmerge 근거를 남긴다.
