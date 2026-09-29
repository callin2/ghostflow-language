<!-- translation-source: tasks/import-validation-plan.md -->

[영문 원본](import-validation-plan.md)

# 고정된 import 검증

기준: Language Reference §6.4–6.7. 이는 구현 진행과 계획이며
언어 명세를 대체하지 않는다.

## 현재 실행 가능한 slice (2026-09-23)

REF-06-010은 이제 CLI 검사와 산출물 build를 통과한다. 아래 옛 미지원 경로
기록은 이전 milestone을 설명한다. `compileSource`는 명시적
`sourceClosure: [{ filename, revision, text }]`를 받는다. 파일이나 network
자원을 얻지 않고 browser-safe 코드로 전이적 정확한 digest/revision을 검증한다.
CLI는 filesystem에서 정본 문서를 수집한다.

AST 합성은 scalar input/output port, parameter, state/let 식,
중첩 instance, 필수 입력, 정확한 port 타입, 단일 writer를 지원한다.
조합 cycle과 instance 간 next-state feedback은 거부한다.
문서와 instance별 source node는 artifact map에서 분리하여 유지한다.
산출물 복원은 전체 closure를 재컴파일하고 bytecode, manifest,
trace, provenance를 비교한 뒤 수용한다. Closure 상한은 문서 128개,
전체 소스 8 MiB, instance 128개, 식 변환 방문 65,536회다.

`tests/composition-execution.test.mjs`는 Rust WASM 상태 격리,
전이적 소스 해석, 잘못된 연결, 누락 입력, 인자 오류,
미사용 출력 타입 검사, 산출물/provenance 변조를 다룬다.

[#377](https://github.com/callin2/ghostflow-language/issues/377)에서 sensor와 순수 함수 합성을 추가했다.
Root 원본 패킷을 독립적인 instance conditioner에 나누어 공급한다. 공개 sensor는
`manifest.sensors`에, 비공개 descriptor는 `sourceSensor`, `instance`, `port`를 가진
`manifest.sensorInstances`에 둔다. Payload·선택성·선언한 sample 간격은 일치해야 한다.
함수 인자와 case 바인딩은 lexical scope를 유지한다. 독립 filter·fault·recovery·stale,
scan rollback·비공개 패킷 거부·소스 복원·실제 conditioning frame의 native/WASM 비교를
집중 테스트한다. GFB·ABI·frame protocol은 바뀌지 않는다.

아직 미지원: timer/schedule/config/enum/resource/constraint
선언의 합성, imported intent-link 확장, qualified 공개 function/type export.
Instance 의미를 조용히 잃는 대신 명시적으로 실패한다.
Imported revision label은 공급된 closure 식별자와 비교한다.
호출자/catalog가 그 진위를 책임진다.

## 구현된 parser slice

`ControlParser`는 최상위 고정 import header를 받고 별도의 `imports` AST 목록을
유지한다. 각 항목은 alias, 상대 `.ghost.md` locator, revision, digest,
source-node 식별자, 모든 pin 필드의 token 위치를 보존한다.
누락 revision/digest, 잘못된 digest 문법, 빈/latest revision,
비정본/절대/network locator, 중복 alias를 작성된 token에서 진단한다.
기존 literate 진단 위치 재매핑을 적용한다.

Lowerer는 컴파일 전에 파싱된 모든 import를 다음으로 거부한다.
`import execution requires a verified source closure and composition lowering,
which are not yet supported`. 미사용 import도 조용히 무시할 수 없다.
비어 있지 않은 revision 문자열을 파싱했다고 resolver의 revision이 불변임을 증명하지는 않는다.

TDD 근거:

- `build/import-header-red.log`: 테스트 14건 모두 옛 parser 경계에서 실패.
- `build/import-header-green.log`: 집중/영향받은 syntax 테스트 272/272 통과.
  `tests/import-header.test.mjs`의 새 테스트 14건 모두를 포함한다.
- 새 suite는 `tools/verify-language.mjs`에 명시적으로 등록했다.

REF-06-010에는 여전히 수용된 합성이 없다. 해당 수용 기대값과 다른 모든
Reference 기대값은 변경하지 않는다.

## Parameter와 합성 문법 slice

`parameter` 기본값은 이제 타입이 지정된 불변 값으로 컴파일되고
operator setting과 독립적으로 `manifest.parameters`에 기록된다.
앞선 parameter 참조는 선언 순서와 무관하게 해석된다. 순환 기본값,
타입 불일치, input/state/가변 config 의존성은 거부한다.

Parser는 `instance` 선언, 이름 있는 specialization 인자,
`connect` endpoint와 원래 소스 위치를 보존한다.
Local 합성 검증은 알 수 없는 import alias/instance, 중복 instance 선언과 인자,
잘못된 root port 방향, 경쟁 공급자를 거부한다.
식과 `connect`가 모두 정의한 root 출력도 포함한다.

공개 컴파일러는 검증된 source closure 없는 유효 import를 여전히 거부한다.
Imported 인자 이름/타입, 필수 port, 정확한 port/sensor 계약,
instance 격리, 실행 가능한 합성을 주장하지 않는다.
REF-06-010은 RED로 남는다. REF-06-103은 이제 실제 duplicate-supplier 진단으로
통과한다. `tests/import-composition.test.mjs`의 집중 테스트 21건이 통과한다.
결합 import/header/digest/control/compiler 실행은 42/42 통과한다.

## 다음 최소 구현 경계

현재 환경 중립적인 `tools/compile-source.mjs`는 정본 문서 하나를 받는다.
Resolver/source-closure 입력은 없다. `tools/ghostc.mjs`는 root 문서만 읽는다.
다음의 완전한 slice에는 다음이 필요하다.

1. 각 정본 filename/locator, 불변 revision 식별자, 원문,
   검증된 UTF-8 digest를 담는 명시적 supplied-document closure 계약.
   Browser와 Node에서 같은 validator를 사용한다.
   Validator는 파일이나 network 데이터를 암묵적으로 얻어서는 안 된다.
2. 현재 미지원 instance 본문을 파싱하지 않고 재사용할 수 있는 import-header 추출.
   Regex scanner 대신 parser의 token 규칙을 재사용한다.
3. Importing 문서 기준 상대 locator 해석. 제공된 closure 안에서만 해석한다.
   Locator 표기는 source 식별자가 아니다.
4. Importing source span을 보존하는 누락 의존성, revision 불일치,
   digest 불일치, 모호한 locator binding, 전이적 import-cycle 진단.
   Root import뿐 아니라 전이적 의존성을 검증한다.
   검증 결과에 원래 전체 설명문과 식별자를 보존한다.
5. Closure를 검증하지만 composition lowering/provenance 구현 전까지
   instance 실행은 여전히 거부하는 공개 compiler 통합.
   CLI filesystem 수집은 동일 계약으로 들어가는 별도 adapter다.

테스트는 유효한 2단계 고정 closure와 각각 격리된 손상 사례를 짝짓고,
diamond 재사용, 서로 다른 definition의 alias 재사용, 경로 정규화,
cycle, byte/문서 자원 경계를 다뤄야 한다. 검증이 제공된 closure를 바꿔서는 안 된다.
입력 계약은 여전히 main integrator의 설계 결정이다.
이 parser slice는 추측에 기반한 공개 resolver API를 추가하지 않는다.

그 뒤 REF-06-010에는 instance/parameter/connect 파싱,
instance별 상태 격리, 정확한 port/품질 검사, 의존 순서,
전이적 next-state 제한, 단일 writer, source/revision provenance가 추가로 필요하다.
소스 텍스트를 평탄화하고 원래 문서 식별자를 버리는 것은 허용되는 지름길이 아니다.

## CLI 직접 digest preflight

다음 작은 slice는 이제 `tools/ghostc.mjs`에 있다. CLI는 `parseControlImports`를
재사용하여 미지원 instance 파싱 전에 header를 검사하고, 각 직접 상대 locator를
importing root filename 기준으로 해석하며 고정 SHA-256과 원래 파일 byte를 비교한다.
Imported 설명문, UTF-8 encoding, CRLF byte는 변경 없이 포함된다.
잘못된 UTF-8, 너무 큰 문서, 읽을 수 없는 파일, digest 불일치는
산출물 게시 전에 작성된 import token에서 거부한다.

이는 직접 filesystem 무결성 검증일 뿐이다. 공개 sourceClosure API,
재귀 resolver, revision 진위 proof, 수용된 합성은 없다.
일치하는 의존성도 기존 미지원 compiler 경로에 도달한다.
Browser 컴파일은 이 CLI helper를 통해 파일을 얻지 않는다.

`tests/import-cli-digest.test.mjs`는 변경하지 않은 REF-06-102 fixture를
check/build 두 mode에서 검사한다. 정확한 UTF-8/CRLF 일치,
imported 설명문 변조, 기존 산출물 보존, 누락 파일, 잘못된 UTF-8을 다룬다.
`build/import-cli-digest-red.log`는 실패 4건과 이미 통과하던 미지원 경로 대조군
1건을 기록했다. `build/import-cli-digest-green2.log`는 156/156 통과를 기록한다.
새 사례 5건 모두, import parser coverage, 기존 전체 CLI syntax 진단 suite를 포함한다.
Reference 기대값은 변경하지 않았다.
