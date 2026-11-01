<!-- translation-source: tasks/import-validation-plan.md -->
[영문 원문](import-validation-plan.md)

# 고정(pinned) import 검증

기준: Language Reference §6.4–6.7. 이 문서는 구현 진행 상황과 계획을 추적합니다. 언어 명세를 대체하지 않습니다.

**이 문서를 읽는 방법.** 첫 절은 현재 상태(2026-09-23)를 설명합니다. 이후 절은 이전 milestone의 기록이며 이력으로 남겨 둡니다. 그 절에 있는 "REF-06-010은 여전히 RED", "lowerer가 파싱된 모든 import를 거부한다", "공개 sourceClosure API가 없다" 같은 서술은 해당 milestone 시점에는 사실이었으며, 현재 상태로 대체되었습니다.

## 현재 실행 가능한 slice (2026-09-23)

**상태.** REF-06-010은 이제 CLI 검사와 산출물 build를 통과합니다. 아래의 옛 미지원 경로 기록은 이전 milestone을 설명합니다.

**Source closure.** `compileSource`는 명시적인
`sourceClosure: [{ filename, revision, text }]`를 받습니다.

- browser-safe 코드로 정확한 digest와 revision을 전이적으로 검증합니다.
- 파일이나 network 자원을 얻지 않습니다.
- CLI는 filesystem에서 그 정본 문서들을 수집합니다.

**합성 지원.** AST 합성은 다음을 지원합니다.

- scalar input/output port
- parameter
- state와 let 식
- 중첩 instance
- 필수 입력
- 정확한 port 타입
- 단일 writer

조합 cycle과 instance 간 next-state feedback은 거부됩니다. 문서와 instance별 source node는 artifact map에서 분리된 채로 유지됩니다.

**산출물 복원.** 복원은 전체 closure를 재컴파일하고 bytecode, manifest, trace, provenance를 비교한 뒤에야 산출물을 수용합니다.

**Closure 상한.**

| 상한 | 한도 |
| --- | --- |
| 문서 | 128 |
| 전체 소스 | 8 MiB |
| Instance | 128 |
| 식 변환 방문 | 65,536 |

**테스트.** `tests/composition-execution.test.mjs`는 Rust WASM 상태 격리, 전이적 소스 해석, 잘못된 연결, 누락된 입력, 인자 오류, 사용하지 않는 출력의 타입 검사, 산출물/provenance 변조를 다룹니다.

**센서와 순수 함수 합성**은
[#377](https://github.com/callin2/ghostflow-language/issues/377)에서 추가되었습니다.

- Root의 원본 패킷은 독립적인 instance별 conditioner로 나누어 공급됩니다.
- 공개 센서는 `manifest.sensors`에 남습니다. 비공개 descriptor는 `sourceSensor`, `instance`, `port`와 함께 `manifest.sensorInstances`에 있습니다.
- Payload, 선택성(optionality), 선언한 샘플링 간격은 반드시 일치해야 합니다.
- 함수 파라미터와 case 바인딩은 lexical 범위를 유지합니다.
- 집중 테스트는 독립적인 필터링, fault, 복구, stale, scan rollback, 비공개 패킷 거부, 소스 복원, 그리고 실제 conditioning된 frame의 native/WASM 비교를 포함합니다.
- GFB/ABI/frame 프로토콜은 바뀌지 않았습니다.

**아직 지원하지 않는 항목:**

- timer/schedule/config/enum/resource/constraint 선언의 합성
- import된 intent-link 확장
- qualified 공개 function/type export

이 항목들은 instance 의미를 조용히 잃는 대신 명시적으로 실패합니다. Import된 revision 라벨은 공급된 closure identity와 대조해 검사합니다. 그 진위는 호출자나 catalog가 책임집니다.

## 구현된 parser slice

*과거 milestone.*

`ControlParser`는 최상위 고정 import header를 받아 별도의 `imports` AST 목록에 보관합니다. 각 항목은 다음을 보존합니다.

- alias
- 상대 `.ghost.md` locator
- revision
- digest
- source-node identity
- 모든 pin 필드의 token 위치

누락된 revision/digest, 잘못된 digest 문법, 빈/latest revision, 비정본/절대/network locator, 중복 alias는 작성된 token 위치에서 오류로 보고합니다. 기존 문서형 소스(literate) 진단 위치 재매핑이 적용됩니다.

Lowerer는 컴파일 전에 파싱된 모든 import를 다음 메시지로 거부했습니다.
`import execution requires a verified source closure and composition lowering,
which are not yet supported`. 사용하지 않는 import를 포함해 어떤 import도 조용히 무시될 수 없었습니다. 비어 있지 않은 revision 문자열을 파싱했다고 해서 resolver의 revision이 불변임이 증명되지는 않습니다.

TDD 증거:

- `build/import-header-red.log`: 테스트 14건이 모두 옛 parser 경계에서 실패했습니다.
- `build/import-header-green.log`: 집중 및 영향받은 syntax 테스트 272/272 통과. `tests/import-header.test.mjs`의 새 테스트 14건을 모두 포함합니다.
- 새 suite는 `tools/verify-language.mjs`에 명시적으로 등록되어 있습니다.

이 milestone 시점에 REF-06-010에는 여전히 수용된 합성이 없었습니다. 그 수용 기대값과 다른 모든 Reference 기대값은 변경되지 않았습니다.

## Parameter와 합성 문법 slice

*과거 milestone.*

**Parameter.** `parameter` 기본값은 타입이 지정된 불변 값으로 컴파일되며, 운영자 설정과 독립적으로 `manifest.parameters`에 기록됩니다.

- 앞으로의(forward) parameter 참조는 선언 순서에 의존하지 않고 해석됩니다.
- 순환 기본값, 타입 불일치, input·state·가변 config에 대한 의존성은 거부됩니다.

**합성 문법.** Parser는 `instance` 선언, 이름 있는 specialization 인자, `connect` endpoint를 원래 소스 위치와 함께 보존합니다. Local 합성 검증은 다음을 거부합니다.

- 알 수 없는 import alias/instance
- 중복 instance 선언과 중복 인자
- 잘못된 root port 방향
- 경쟁하는 공급자. 식과 `connect`가 모두 정의한 root 출력도 포함합니다.

**이 milestone의 한계.** 공개 컴파일러는 검증된 source closure가 없는 유효한 import를 여전히 거부했습니다. Import된 인자 이름/타입, 필수 port, 정확한 port 및 센서 계약, instance 격리, 실행 가능한 합성은 주장하지 않았습니다.

**증거.**

- REF-06-010은 RED로 남았습니다.
- REF-06-103은 이제 실제 duplicate-supplier 진단으로 통과합니다.
- `tests/import-composition.test.mjs`에는 통과하는 집중 테스트 21건이 있습니다.
- import/header/digest/control/compiler 결합 실행은 42/42 통과합니다.

## 다음 최소 구현 경계

*과거 계획.*

당시 환경 중립적인 `tools/compile-source.mjs`는 정본 문서 하나만 받았고 resolver/source-closure 입력이 없었습니다. `tools/ghostc.mjs`는 root 문서만 읽었습니다. 완전한 다음 slice에는 다음이 필요했습니다.

1. 각 정본 filename/locator, 불변 revision identity, 원문, 검증된 UTF-8 digest를 담는 명시적인 supplied-document closure 계약. Browser와 Node에서 같은 validator를 사용합니다. Validator는 파일이나 network 데이터를 암묵적으로 얻어서는 안 됩니다.
2. (당시 미지원이던) instance 본문을 파싱하지 않고도 재사용할 수 있는 import-header 추출. Regex scanner 대신 parser의 token 규칙을 재사용합니다.
3. Import하는 문서를 기준으로 한 상대 locator 해석. 해석은 제공된 closure 안으로만 이루어집니다. Locator 표기는 source identity가 아닙니다.
4. 누락된 의존성, revision 불일치, digest 불일치, 모호한 locator binding, 전이적 import cycle에 대한 진단. 각 진단은 import하는 소스 span을 보존합니다. Root import뿐 아니라 전이적 의존성까지 검증합니다. 검증된 결과에는 원래의 전체 설명문과 identity를 보존합니다.
5. Closure는 검증하지만 composition lowering/provenance가 구현되기 전까지 instance 실행은 여전히 거부하는 공개 컴파일러 통합. CLI의 filesystem 수집은 같은 계약으로 들어가는 별도 adapter입니다.

**필수 테스트.** 유효한 2단계 고정 closure와 각각 격리된 손상 사례를 짝지어 검사합니다. diamond 재사용, 서로 다른 definition에서의 alias 재사용, 경로 정규화, cycle, byte/문서 자원 경계도 다룹니다. 검증이 공급된 closure를 바꿔서는 안 됩니다.

입력 계약은 여전히 main integrator가 내릴 설계 결정이었습니다. Parser slice는 추측에 기반한 공개 resolver API를 추가하지 않았습니다.

그 뒤 REF-06-010에는 instance/parameter/connect 파싱, instance별 상태 격리, 정확한 port/품질 검사, 의존 순서, 전이적 next-state 제한, 단일 writer, source/revision provenance가 추가로 필요했습니다. 소스 텍스트를 평탄화하고 원래 문서 identity를 버리는 것은 허용되는 지름길이 아닙니다.

## CLI 직접 digest preflight

*과거 milestone.*

이 작은 slice는 `tools/ghostc.mjs`에 있습니다. 지원하지 않는 instance 본문을 파싱하기 전에 CLI는 다음을 수행합니다.

1. `parseControlImports`를 재사용해 import header를 검사합니다.
2. 각 직접 상대 locator를 import하는 root filename 기준으로 해석합니다.
3. 고정된 SHA-256을 원래 파일 byte와 비교합니다.

Import된 설명문, UTF-8 인코딩, CRLF byte는 변경 없이 그대로 포함됩니다. 잘못된 UTF-8, 너무 큰 문서, 읽을 수 없는 파일, digest 불일치는 산출물이 게시되기 전에 작성된 import token 위치에서 거부됩니다.

이 milestone에서는 직접 filesystem 무결성 검증일 뿐이었습니다. 공개 sourceClosure API, 재귀 resolver, revision 진위 증명, 수용된 합성은 없었습니다. 일치하는 의존성도 기존의 미지원 컴파일러 경로에 도달했습니다. Browser 컴파일은 이 CLI helper를 통해 파일을 얻지 않습니다.

**증거.** `tests/import-cli-digest.test.mjs`는 변경하지 않은 REF-06-102 fixture를 check와 build 두 mode에서 실행합니다. 정확한 UTF-8/CRLF 일치, import된 설명문 변조, 기존 산출물 보존, 누락된 파일, 잘못된 UTF-8을 다룹니다.

- `build/import-cli-digest-red.log`는 실패 4건과, 이미 통과하던 미지원 경로 대조군 1건을 기록했습니다.
- `build/import-cli-digest-green2.log`는 156/156 통과를 기록합니다. 새 사례 5건 모두, import parser coverage, 기존 전체 CLI syntax 진단 suite를 포함합니다.
- Reference 기대값은 변경되지 않았습니다.
