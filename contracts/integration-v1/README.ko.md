<!-- translation-source: contracts/integration-v1/README.md -->
[English 원문](README.md)

# 통합 계약 v1

이 문서는 TASK32를 위한 소규모 호환성 및 증거 계약입니다. 고정된 언어/런타임/장치 릴리스를 명명된 설치와 개별 프로그램 실행에 연결합니다. 구현은 `tools/integration-contract.mjs`이며 Node 내장 SHA-256 구현만 의존합니다. 파일, 네트워크, 컴파일러, LLM, 런타임, 직렬 포트 또는 GPIO 작업은 수행하지 않습니다.

`valid: true`는 제공된 레코드의 구조가 일관되고 확인된 식별자와 해시가 일치한다는 뜻입니다. 게이트 통과, 장치 접촉, 프로그램의 올바른 동작, 핀 배선의 전기적 안전성 또는 물 공급을 뜻하지 않습니다. `fail`이 기록된 실행도 유효한 레코드일 수 있습니다.

## 레코드와 소유권

**release**에는 프로그램 소스 해시, 부팅 ID, 타임스탬프 또는 테스트 결과가 없습니다. 이는 **run**에 속합니다. 새 프로그램이나 장치 재부팅은 릴리스 식별자를 유지하면서 새 실행을 만들 수 있습니다. 고정된 구성요소, 프로필 또는 설치 매핑의 변경에는 새 릴리스 다이제스트가 필요합니다.

| 레코드 / 필드 | 소유자와 의미 |
| --- | --- |
| `release.schema` | 계약 관리자. 정확히 `GhostFlow/integration-release-v1`입니다. |
| `release.toolchain.version`, `.sha256` | 언어 릴리스 소유자. 컴파일러 재현에 필요한 의존성을 포함한 버전과 정확한 배포물/아티팩트 해시입니다. |
| `release.runtimeSemanticsVersion` | 언어/런타임 소유자. 컴파일러와 런타임이 함께 지원하는 실행 의미 식별자입니다. |
| `release.bytecodeFormat` | 언어/런타임 소유자. 공유 바이트코드 형식 식별자입니다. |
| `release.protocolVersion` | API/전송 및 펌웨어 소유자. 명시적인 공유 프로토콜 식별자입니다. |
| `release.device.firmwareSha256` | 펌웨어 릴리스 소유자. 프로그램 모듈과 별개인 정확한 펌웨어 이미지의 SHA-256입니다. |
| `release.device.boardProfile` | 보드 통합자. 승인된 보드 프로필의 `{id, revision, sha256}`입니다. |
| `release.installation` | 현장/설치 소유자. 승인된 논리 매핑의 `{id, revision, sha256}`입니다. |
| `boardProfile.boardModel`, `.endpoints` | 보드 통합자. 보드 문서와 별도 물리 검사에 근거한 특정 보드/리비전 및 검토된 채널 정의입니다. |
| `installation.boardProfile`, `.bindings` | 현장 소유자. 승인된 프로필 참조와 명시적 논리 이름-엔드포인트 ID 사전입니다. |
| `run.releaseSha256`, `.artifacts` | 통합 실행기. 릴리스 다이제스트 및 해당 실행에 사용한 정확한 소스/모듈/매니페스트 다이제스트입니다. |
| `run.kind` | 증거 생성자. `recorded-evidence` 또는 `fictional-fixture`입니다. 예제를 공유할 때 픽스처 표기를 유지해야 합니다. |
| `run.startedAt`, `.finishedAt` | 증거 생성자. 밀리초가 있는 표준 UTC ISO 타임스탬프입니다. |
| `run.device` | 장치 관찰 어댑터. 관찰한 부팅 ID, 관찰 시각, 펌웨어/프로필/설치/런타임/프로토콜 식별자와 소스/모듈 해시입니다. 없으면 `null`입니다. |
| `run.device.installation` | 장치 관찰 어댑터. 실제 설치된 매핑의 `{id, revision, sha256}`입니다. `run.device`가 null이 아니면 필수이며 `release.installation`과 비교합니다. |
| `run.gates.host`, `.hardware`, `.physical` | 해당 테스트 또는 관찰 소유자. 독립 상태, 증거 출처/참조 및 결과의 정확한 범위입니다. |

프로필과 설치 ID/리비전은 비어 있지 않은 문자열입니다. 릴리스는 이름과 함께 다이제스트도 고정합니다. 모든 SHA-256 필드는 소문자 16진수 64자입니다. 버전 식별자는 정확히 비교합니다. 검증기는 semver 범위나 보드 계열 이름으로 호환성을 추측하지 않습니다.

보드 엔드포인트에는 `direction`(`input`/`output`), `type`(매니페스트 의미 유형), `driver`, `address`, `activeLevel`(`high`/`low`) 및 `safeLevel`(숫자 `0`/`1`)이 있습니다. v1 프로필은 디지털 전기 엔드포인트와 소프트웨어 입력용 명시적 논리 엔드포인트를 지원하며 아날로그 회로는 모델링하지 않습니다. `driver`와 `address`는 프로필이 소유하는 명시적 식별자이며 중복 쌍은 거부됩니다. 예약 핀은 사용 가능한 엔드포인트로 나타나면 안 됩니다. 주소 문자열은 이 검증기에서 불투명 값이며 의미 해석은 프로필 통합자 책임입니다.

바인딩은 `{ "pump": "relay.1" }` 같은 사전이지 배열이나 인라인 핀 할당이 아닙니다. 모든 `manifest.inputs`/`manifest.outputs` 항목에는 방향과 의미 유형이 일치하는 정확한 이름 바인딩이 필요합니다. 선언 순서는 영향을 주지 않습니다. 프로그램에서 사용하지 않는 추가 현장 바인딩은 허용되지만 v1에서는 여러 논리 이름을 하나의 엔드포인트에 별칭으로 연결할 수 없습니다. 생성 클록, 센서 및 기타 런타임 제공 입력은 런타임 책임입니다. 검증기는 입력을 새로 도출하거나 제어 로직을 생성하지 않습니다.

선언된 모든 입력에 물리 DI 채널이 필요한 것은 아닙니다. 예를 들어 소프트웨어 `start` 입력은 고정 프로필에 `{direction: "input", type: "Bool", driver: "software-input", address: "commands/start", activeLevel: "high", safeLevel: 0}`으로 선언된 명시적 엔드포인트 ID `command.start`에 바인딩할 수 있습니다. 여기서 driver/address는 논리 입력을 식별합니다. `activeLevel`과 `safeLevel`은 전기 핀이나 풀 설정이 아니라 불리언 규약과 기본값을 나타냅니다. 소프트웨어 입력을 공급하는 방법은 런타임 어댑터가 소유합니다. 이 매핑에도 명시적 이름, 일치하는 유형/방향 및 프로필/설치 다이제스트가 필요합니다. 검증기는 여기에 DI 핀을 할당하지 않습니다.

`relay.1`을 선언되지 않은 `GPIO7`로 바꾸면 실패합니다. 프로필 엔드포인트를 확장기 채널에서 일반 GPIO로 바꾸면 프로필 다이제스트가 바뀌므로 고정된 릴리스와 일치하지 않아 실패합니다. 메타데이터 검사를 통과하는 일관되지만 잘못된 프로필은 가능할 수 있습니다. 프로필 검토와 전기 테스트는 별도 게이트로 남습니다. 소프트웨어 판독값으로는 설치된 부하가 올바른지 확인할 수 없습니다.

## 증거 규칙

각 게이트는 정확히 `{status, source: {type, reference}, scope}` 형식입니다. 세 게이트는 필수이며 서로 독립적입니다. 보드/물리에 대한 통합 통과 상태는 없습니다.

| 상태 | 의미 |
| --- | --- |
| `not_run` | 테스트를 수행하지 않았습니다. source는 `none`, reference는 `null`이어야 합니다. |
| `pass` | 명시된 증거 출처에 따라 범위가 통과했습니다. |
| `fail` | 명시된 증거 출처에 따라 범위가 실패했습니다. |
| `unknown` | 사용 가능한 정보로 결과를 확정할 수 없습니다. 통과로 바꾸지 않습니다. |

| 게이트 | `none` 외에 허용되는 출처 유형 |
| --- | --- |
| `host` | `host-tests`, `injected-fixture` |
| `hardware` | `device-status`, `gpio-readback`, `register-readback` |
| `physical` | `physical-observation` |

`pass`/`fail`에는 출처와 비어 있지 않은 레코드 참조가 필요합니다. `none`은 `not_run`/`unknown`에만 허용됩니다. `scope`는 항상 비어 있을 수 없습니다. 하드웨어 또는 물리 `pass`에는 릴리스 및 아티팩트에 연결된 장치 관찰도 필요합니다. 연결 해제/실패 증거는 null 장치 식별자와 `fail`/`unknown` 하드웨어 상태로 존재할 수 있습니다. 참조는 생성자가 소유하는 레코드 ID 또는 경로입니다. 이 모듈은 이를 열거나 내용의 진위를 인증하지 않습니다.

호스트 통과는 하드웨어 또는 물리 상태를 대신 채우지 않습니다. GPIO/레지스터/장치 판독값은 물리 통과의 출처가 될 수 없습니다. 물리 관찰에는 무엇을 관찰했는지 명시해야 합니다. 단자 전압, LED 상태, 접점 상태 및 물 공급은 서로 다른 주장입니다. 허용된 `physical-observation` 레코드도 여기서는 선언일 뿐입니다. 검증기는 사실 여부를 확인하거나 더 넓은 동작을 추론할 수 없습니다. 액티브 로우 채널에서는 논리 출력과 전기 레벨을 같은 값처럼 비교해서도 안 됩니다.

장치 관찰에는 `bootId`, `observedAt`, `firmwareSha256`, `boardProfile: {id, revision, sha256}`, `installation: {id, revision, sha256}`, `runtimeSemanticsVersion`, `bytecodeFormat`, `protocolVersion`, `sourceSha256` 및 `moduleSha256`가 있습니다. 타임스탬프는 실행 구간 안에 있어야 합니다. 게이트 상태와 무관하게 장치 레코드가 있으면 설치 식별자는 필수입니다. 설치의 세 필드는 모두 `release.installation`과 일치해야 합니다. 펌웨어, 프로필 및 프로그램 해시가 같아도 설치 매핑이 다른 경우를 감출 수 없습니다. 식별자 비교에는 어댑터가 제공한 관찰값을 씁니다. 예상 릴리스 값에서 복사한 뒤 관찰값이라고 표시해서는 안 됩니다. 현재 POC 프로토콜은 모든 필드를 제공하기 전에 명시적인 어댑터/기능 확장이 필요할 수 있습니다. 누락된 관찰값은 추측하지 않습니다. 이 계약은 해당 프로토콜을 수정하거나 펌웨어 증명을 구현하지 않습니다.

## 해시와 순수 API

`sha256(textOrBytes)`는 정확한 UTF-8 원문 또는 `Uint8Array`/`Buffer` 바이트를 해시합니다. 개행을 덧붙이거나 유니코드/줄바꿈을 정규화하지 않습니다. 실행의 `moduleSha256`은 현재 컴파일러와 직렬 프로토콜에서 `bytecodeSha256`이라 부르는 해시입니다. 제공 매니페스트의 `bytecodeSha256`은 모듈 바이트와 일치해야 합니다.

`jsonSha256(json)`은 객체 키를 재귀적으로 정렬하고 배열 순서와 문자열 내용은 유지한 뒤 간결한 UTF-8 JSON을 해시합니다. 유한한 JSON 데이터만 허용합니다. `undefined`와 순환 참조는 거부됩니다. 프로필, 매핑, 매니페스트 및 릴리스 메타데이터 다이제스트에는 이 계약 전용 인코딩을 사용합니다. 소스, 모듈, 펌웨어 및 툴체인 아티팩트 해시는 항상 정확한 아티팩트 바이트를 사용합니다.

```js
import {
  validateReleaseIdentity, validateRunEvidence, validateIntegration,
} from './tools/integration-contract.mjs';

const artifacts = { source, module: compiled.bytes, manifest: compiled.manifest };
const releaseCheck = validateReleaseIdentity(release, { boardProfile, installation });
const runCheck = validateRunEvidence(runEvidence, { release, artifacts });
const allChecks = validateIntegration({
  release, boardProfile, installation, artifacts, runEvidence,
});
// Each result: { valid: boolean, errors: [{ path, code, message }] }
```

`validateReleaseIdentity`는 제공한 프로필/매핑 내용과 고정 참조를 모두 검사합니다. `validateRunEvidence`는 릴리스에 대한 실행 선언과 아티팩트 바이트를 검사하며 프로필/매핑 내용은 별도로 검사된다고 가정합니다. `validateIntegration`은 둘 다 수행하고 매니페스트 이름 바인딩을 검사합니다. 메타데이터/아티팩트만 검증하려면 `runEvidence`를 생략하거나 null로 전달합니다. 게이트 기본값을 만들지 않고, 물리 채널을 해석하지 않으며, 실행을 주장하지도 않습니다. 입력은 변경하지 않습니다. 검증 오류 순서는 결정적입니다. 해시 도우미는 지원되지 않는 입력에 `TypeError`를 던지고, 검증기는 오류 레코드를 반환합니다.

기존 `compileSource`는 언어 파싱, 의미 분석, 모듈 생성 및 매니페스트 생성을 소유합니다. 런타임 구현은 실행, 타이머, 일정 및 동작 테스트를 소유합니다. 이 계약은 그 출력에 해시를 붙이고 선언된 식별자를 비교합니다. 소스/모듈 대응을 입증하기 위해 소스를 다시 컴파일하거나 펌웨어 바이너리를 조사하거나 GPIO를 추론하거나 런타임 동작을 복제하지 않습니다. 이 검증기는 바인딩을 배포하지 않습니다. 향후 어댑터는 검증된 매핑을 명시적으로 사용하고 실제 설치한 바인딩을 기록해야 합니다.

프론트엔드/API 빌드 버전은 릴리스 다이제스트를 참조하는 외부 통합 BOM에 추가할 수 있습니다. 이 언어/장치 계약에서 필수 필드일 필요는 없습니다. 이 파일들을 언어 저장소로 옮길 때 필요한 것은 검증기, 이 디렉터리 및 전용 테스트뿐입니다. POC 가져오기나 서브모듈은 필요하지 않습니다.

## 가상 예제와 회귀 테스트

`examples/fictional-fixture.json`은 완전한 가상 연결 레코드 집합입니다. 모듈 바이트와 소스는 의도적으로 실행 불가능합니다. 툴체인 및 펌웨어 해시는 설명용 식별자이며 메타데이터/소스/모듈 다이제스트는 내부적으로 일관됩니다. API 사용 시 `artifacts.moduleHex`를 바이트로 디코딩해 `artifacts.module`로 전달합니다(hex는 JSON 픽스처 인코딩일 뿐입니다).

테스트는 이 픽스처만 사용합니다. 보드, LLM, 컴파일러 또는 실제 HTTP 서비스는 호출하지 않으며 증거 파일도 생성하지 않습니다. 다음 명령만 실행합니다.

```sh
node --test tests/integration-contract.test.mjs
```

테스트는 잘못된 보드와 프로필, 일반 GPIO 대체, 매핑 변경, 선언 순서 독립성, 불일치 아티팩트, 관찰 식별자 불일치, 호스트/판독 증거를 물리 통과로 승격하지 못하게 하는 규칙을 다룹니다. 이 테스트가 입증하는 것은 계약 동작뿐입니다.
