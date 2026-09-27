# Language Reference 개별 수용 테스트

Reference의 기대 동작을 먼저 고정하고, 컴파일러 수정은 별도 작업으로 진행한다.
현재 컴파일러가 거부한다는 이유로 정상 소스의 기대값을 `reject`로 바꾸지 않는다.

첫 실행 결과와 그대로 남긴 실패 사례는 [BASELINE.md](BASELINE.md)에 기록한다.
기존 결정 대기 49건의 확정 위치와 검증 형태는 [DECISIONS.md](DECISIONS.md)에 기록한다.
엣지 케이스·경계값 보완과 새로 드러난 결함은 [EDGE-CASES.md](EDGE-CASES.md)에 기록한다.

## 실행

`ghostflow-language` 저장소 루트에서 Node.js 22 이상으로 실행한다.

```sh
npm run test:reference

# 특정 계약만 실행
node --test --test-name-pattern=REF-01-001 tests/reference-cli.test.mjs
```

실행기는 실제 `tools/ghostc.mjs`를 별도 프로세스로 호출한다.
각 실행 가능한 사례에 대해 `--check`와 산출물 생성 경로를 검사한다.
검사 모드가 실패해도 산출물 생성 모드를 실행하며, 두 모드의 실패와 진단을 함께 기록한다.
정상 소스는 종료 코드 0과 비어 있지 않은 산출물을 요구한다.
성공 산출물의 공개 source map에서 정본 원문과 source/bytecode digest의 결속도 검사한다.
잘못된 소스는 종료 코드 1을 요구한다. CLI 사용법 오류(2), crash, timeout은 정상 거부로 인정하지 않는다.
모든 fixture는 독립 임시 디렉터리에서 작성한다. 정본 `.ghost.md` 문서를 전달하며
잘못된 확장자 등을 검사하는 부정 사례만 그 계약을 의도적으로 위반한다.
import 사례는 `files`에 완전한 의존 `.ghost.md` 원문을 함께 둔다. 루트 문서의
import는 그 원문의 정확한 SHA-256을 고정한다. 의존 파일도 같은 임시 디렉터리에 작성한다.

상세 결과는 `build/reference-tests.json`에 저장한다. `results`와 `summary`에는 실제 실행한
컴파일 사례만 기록한다. `externallyCoveredCatalog`는
[`feature-status` 카탈로그](../../contracts/feature-status/catalog.json)에 연결된 정확한 활성 테스트
selector를 표시한다. 이 CLI가 외부 oracle을 실행했다는 뜻은 아니다. 전체 언어 gate의 통과 결과가
실행 증거다. `pendingCatalog`에는 외부 oracle도 없는 `specified`/`decision` 사례만 남는다.
`catalogCounts`와 frozen core 수치는 필터와 무관한 전체 목록의 링크 수이며 실행 결과가 아니다.
이름 필터로 실행한 결과는 전체 수용 결과로 사용하지 않는다.
카탈로그 검사 자체가 필터로 제외되면 `catalogValidation`은 `not-run`이다.

## 사례의 상태

| 상태 | 의미 | 실행 보고 |
|---|---|---|
| `executable` | 확정 문법의 컴파일 수용/거부 사례 | 실제 CLI 호출; 기대와 다르면 실패 |
| `specified` | 입력·행동·기대 결과가 작성된 런타임·환경·Driver·UI·도구 계약 | 활성 외부 oracle 링크가 있으면 `externally-covered`; 없으면 TODO. 어느 쪽도 CLI 실행 통과 수에 포함하지 않음 |
| `decision` | 기대 의미 또는 결정 경계는 있으나 확정 문법·정책이 필요한 사례 | 필요한 결정을 reason에 기록; TODO이며 지원 증거가 아님 |

언어의 모든 항목을 컴파일 성공만으로 검증할 수는 없다. 타이머의 실제 경과,
출력 적용·피드백, 재시작 복원, UI 동작에는 각 경계의 실행 관찰이 필요하다.
이 작업은 해당 사례의 조건과 기대 결과까지 작성한다. 런타임·Driver 어댑터는 별도다.
2026-09-22 문법 정책 결정은 Reference에 먼저 반영하고 컴파일 수용·거부 기대값으로 고정한다.
운전 정책의 실제 값은 작성자가 명시하는 인자이며 전역 언어 결정 대기로 분류하지 않는다.

확정된 컴파일 요구가 현재 실패하는 경우에는 그대로 실패하도록 유지한다.
이를 `specified`나 `decision`으로 옮기거나 skip/expected-failure로 감추지 않는다.

## 구성과 추적

- `cases/00-principles.json`: Reference 설계 철학 10개.
- `cases/01-source-types.json`: Reference 1–2장.
- `cases/02-time-control.json`: Reference 3–4장.
- `cases/03-settings-boundaries.json`: Reference 5–8장.
- `../reference-cli.test.mjs`: 명시된 사례 파일만 읽는 실행기와 카탈로그 검사.

각 사례에는 안정적인 ID, 특정 규칙, Reference 절 링크, 책임 계층이 있다.
실행 사례에는 독립 소스와 `accept`/`reject` 기대값이 있다.
비실행 사례에도 `given`, `when`, `then`, `reason`을 각각 작성한다.
각 미검증 비실행 사례에는 개별 GitHub 이슈의 전체 URL을 `issue`에 기록한다.
이슈 본문은 원래 사례 JSON으로 연결하고, 사례는 이슈로 돌아가는 링크를 유지한다.
검증 후에도 링크를 남긴다. 이슈 링크 자체는 실행 증거가 아니며, 실제 oracle이
연결·검증된 경우에만 pending 분류에서 빠진다.
번호가 있는 모든 Reference 절은 적어도 하나의 사례에서 추적되어야 한다.
중첩 절을 인용한 사례는 해당 상위 절에도 연결된다.

절 링크의 존재는 문서 추적성 검사이며 그 절의 모든 동작을 검증했다는 뜻은 아니다.
개별 정상·오류·경계 사례와 비실행 계약을 함께 검토해야 한다.
컴파일 산출물의 존재만으로 실행 의미나 실제 장치 수용을 주장하지 않는다.

## 기대값 수정 기준

Reference의 명시적 규칙을 근거로 수정한다. 모호한 규칙은 어떤 결정이 필요한지 기록한다.
테스트 fixture 자체의 문법 실수는 고치되, 컴파일러의 현재 결과를 정답으로 복사하지 않는다.
컴파일러·런타임 소스는 이 테스트 작성 작업에서 수정하지 않는다.
