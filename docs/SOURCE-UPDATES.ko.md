<!-- translation-source: docs/SOURCE-UPDATES.md -->
[English](SOURCE-UPDATES.md)

# GhostFlow 원문 변경 비교와 업데이트 범위

`tools/source-changes.mjs`와 `tools/update-request.mjs`는 브라우저와 Node에서 함께 쓸 수 있는 모듈이다. 이 기능은 현재 저장소의 구조 비교와 변경 범위 점검을 제공한다. 운영 대화나 장치 설치 흐름에 연결되어 있지는 않다.

## 원문 비교

```js
import { inspectSourceChanges, sourceChangeInventory } from './tools/source-changes.mjs'

const inventory = sourceChangeInventory(beforeDocument)
const comparison = inspectSourceChanges(beforeDocument, afterDocument)
```

인벤토리는 `GhostFlow/source-change-inventory-v1`, 비교 결과는 `GhostFlow/source-changes-v1` 형식이다. 비교는 파서가 인식한 제어 선언과 YAML 하드웨어 front matter의 구조를 다섯 범주로 나눈다.

| 범주 | 의미 |
| --- | --- |
| `config-default` | 기존 설정의 초기 기본값 |
| `config-definition` | 설정 선언, 유형, 범위, 접근 메타데이터 등의 정의 |
| `control-rule` | 상태, 타이머, 스케줄, 연결을 포함한 제어 규칙 |
| `logical-io` | 논리 입력·출력 선언 및 외부 calendar·provider 선언 |
| `hardware` | 원문 front matter에 적힌 장치·배선 구성 |

각 변경에는 `target`과 `operation`(`add`, `remove`, `modify`) 및 `before`/`after` 구조가 포함된다. 설명문, 주석, 코드 위치, 선언 순서와 그룹 표현만 달라진 경우에는 구조 변경으로 보고하지 않는다.

## 명령줄

```sh
node tools/ghostdiff.mjs before.ghost.md after.ghost.md
node tools/ghostdiff.mjs before.ghost.md after.ghost.md --json
node tools/ghostdiff.mjs --help
```

인자를 생략하면 도움말을 표시하고 종료 코드 0으로 끝난다. 두 파일 비교가 성공하면 사람이 읽는 범주별 요약 또는 `--json` 결과를 내고 종료 코드 0을 반환한다. 인자, 파일, UTF-8, 원문 구문이 잘못되면 종료 코드 2를 반환한다. 읽기 전용이며 두 파일을 수정하거나 컴파일·실행·설치를 하지 않는다.

## 모듈 공유

브라우저와 Node 도구의 진입점은 같은 함수를 내보낸다. 브라우저 번들러에서 `tools/source-changes.mjs`를 직접 가져올 수도 있다. 파일은 CLI만 읽으며, 공용 모듈은 두 문자열을 받아 구조화된 결과를 반환한다.

커밋된 버전으로 소스 전용 패키지를 만들려면 다음을 실행한다.

```sh
node tools/package-source-changes.mjs /tmp/ghostflow-source-package
```

생성된 `@ghostflow/source-changes` 압축 패키지는 루트에서 비교기를, `./update-request`에서 사전 검사 모듈을, `ghostdiff`로 실행 명령을 제공한다. `provenance.json`에는 소유 저장소의 커밋과 파일 해시가 기록된다. 이 패키지는 실행 컴파일러·VM·펌웨어를 빌드하거나 인증하지 않으며, 다른 모듈의 사용 버전을 자동으로 바꾸지 않는다.

## 사전 범위 요청

Authoring이 후보 원문을 생성하기 전에, 현재 원문을 기준으로 요청 범위를 점검한다. 이 모듈은 자연어 해석이나 원문 생성을 하지 않는다.

```js
import { planSourceUpdate, verifySourceUpdate } from './tools/update-request.mjs'

const request = {
  format: 'GhostFlow/update-request-v1',
  sourceSha256: sourceChangeInventory(beforeDocument).sha256,
  items: [
    {
      id: 'duration',
      summary: 'Adjust the default watering duration',
      changes: [{ operation: 'modify', target: { kind: 'config', name: 'duration', part: 'default' } }],
      requires: [],
      usesInputs: [],
    },
  ],
}

const plan = planSourceUpdate(beforeDocument, request, { editor: 'simple' })
// The planner does not authorize or perform edits.
const check = verifySourceUpdate(beforeDocument, candidateDocument, request, {
  editor: 'simple', approved: ['duration'],
})
```

요청은 정확히 다음 최상위 필드를 가진다.

- `format`: `GhostFlow/update-request-v1`
- `sourceSha256`: 현재 원문 인벤토리의 64자리 소문자 SHA-256
- `items`: 1~64개 변경 항목

각 항목은 정확히 `id`, `summary`, `changes`, `requires`, `usesInputs`를 가진다. `id`는 고유 식별자이며, `summary`는 설명이다. `changes`는 1~16개의 `{ operation, target }` 객체다. `target`은 정확히 `{ kind, name, part }`다. 작업은 `add`, `remove`, `modify`; 설정 기본값 대상은 `{ kind: 'config', part: 'default' }`, 설정 정의는 `part: 'definition'`, 그 밖의 선언 대상은 `part: 'declaration'`을 쓴다. 대상이 현재 원문에 존재하는지는 작업과 일치해야 하며, 같은 대상을 두 번 지정할 수 없다. 기본값은 기존 설정의 `modify`만 허용된다.

`requires`는 선행 항목 ID 목록이고 `usesInputs`는 해당 항목이 사용하는 입력 이름 목록이다. 알려지지 않은 ID, 순환 의존성, 중복 대상, 잘못된 필드, 현재 원문 SHA와 다른 요청은 거부된다.

`editor: 'simple'`은 설정 기본값·정의와 기존에 사용 중인 입력으로 표현하는 규칙 변경을 허용한다. 논리 I/O 선언, 장치·배선, import 변경은 이 편집 범위 밖으로 분류한다. 새 입력 선언이나 아직 쓰이지 않는 입력을 규칙에서 사용하려는 항목도 보류된다. 보류 항목에 의존하는 항목은 함께 보류되어야 한다. 항목 하나에 허용·보류 대상이 섞이면 항목 전체가 보류된다. `editor: 'full'`은 이 단순 편집기 범위 제한을 적용하지 않는다.

계획 결과는 `GhostFlow/update-plan-v1` 형식으로 `apply`와 사유가 붙은 `deferred` 항목을 반환한다. 이 함수는 편집을 실행하지 않는다. `verifySourceUpdate`는 승인된 항목과 그 선행 항목을 확인하고, 후보 원문에서 승인 범위를 벗어난 구조 변경을 보고한다. 단순 편집기에서는 새로 사용된 입력이나 새 미해결 참조도 실패로 처리한다. 후보 원문 자체가 파싱되지 않으면 검증은 예외로 끝난다.

논리 I/O·장치/배선 변경과 그 변경에 의존하는 작업을 농가 개인 TODO로 대화에 남기는 동작은 아직 구현되어 있지 않다. 범위 결과의 `deferred`는 분류 결과일 뿐 TODO 저장이나 대화 표시가 아니다.

## 보장 범위와 경계

- 비교는 구문 분석과 구조 비교다. 의미적 컴파일, 실행, 장치 적합성이나 안전성을 인증하지 않는다.
- import 문 자체는 비교 대상이다. import된 파일을 따라가거나 가져온 선언의 구조까지 확장 비교하지 않는다.
- YAML front matter에 적힌 하드웨어 구조만 비교한다. 호스트가 제공하는 `remote-panel` 등의 외부 메타데이터나 실시간 설정 값은 인증·검증하지 않는다.
- `config-default`는 원문에 선언된 기본값이다. 현재 장치에서 스트림으로 변경된 설정 이벤트나 실제 적용값을 뜻하지 않는다.
- 편집기 이름이나 UI 플래그는 권한 부여가 아니다. 이 도구는 접근 제어, 승인, 계정 권한 또는 설치를 제공하지 않는다.
- 공유 모듈은 아직 운영 채팅/API/장치 설치 흐름에 연결되지 않았다.
