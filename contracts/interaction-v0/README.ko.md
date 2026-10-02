<!-- translation-source: contracts/interaction-v0/README.md -->

[English 원문](README.md)

# Interaction 스키마 및 런타임 스냅샷 v0

이 계약은 `GF-IR-1`/TASK-121.1을 위한 렌더러 중립 **호스트 소프트웨어** 경계입니다. 정적 의미 설명자와 완료된 런타임 관찰 하나를 별도로 정의합니다. 컴파일러 출력은 #71에서 구현합니다. #72는 `tools/interaction-runtime-snapshot.mjs`를 통해 이미 완료된 네이티브 또는 WASM 추적만 투영합니다. 이 어댑터는 스캔을 평가하거나 I/O를 수행하거나 요청/안전 출력을 변경하지 않습니다.

`GhostFlow/interaction-schema-v0`와 `GhostFlow/runtime-snapshot-v0`는 각각 자체 `version`을 가집니다. 버전은 호환성 레이블이지 정확한 스키마 인스턴스 식별자가 아닙니다. 스냅샷에는 `snapshot.schema.sha256`의 정적 스키마 정규 JSON SHA-256도 있습니다. 소비자는 이 다이제스트, 형식, 버전을 제공된 정적 문서와 연결해야 합니다.

스키마 다이제스트는 이 저장소의 `canonicalJson(schema, {rejectSparseArrays: true, rejectUnsafeIntegers: true})`가 생성한 UTF-8 바이트의 SHA-256입니다. 정확한 규칙은 다음과 같습니다. 각 일반 객체 키를 ECMAScript UTF-16 코드 단위 순서로 재귀 정렬하고, 배열 요소 순서를 유지하며, 잘못된 유니코드를 거부한 뒤 ECMAScript `JSON.stringify`로 문자열을 인코딩합니다. 불리언과 null은 JSON 리터럴로 인코딩하고, 유한한 IEEE-754 숫자는 안전하지 않은 정수를 거부하면서 ECMAScript `JSON.stringify` 표기법으로 인코딩합니다(`-0`은 `0`). 공백을 출력하지 않습니다. 희소 배열, 일반 객체가 아닌 객체, 비유한 숫자 및 깊이 64 초과 중첩은 거부합니다. 소비자는 제공된 다이제스트를 비교합니다. 다른 언어의 생성자는 일치하는 스냅샷을 발행하기 전에 이 바이트를 정확히 재현해야 합니다. 형식 버전만 일치하는 것으로는 충분하지 않습니다.

## 정적 스키마

스키마는 고정된 `module`(`id`, 컴파일러 추적 `moduleFingerprint`, 매니페스트 `bytecodeSha256`)과 소스 문서(`documentId`, `revisionId`, `format`, `kind`, 소스 `sha256`) 식별자를 가집니다. `module.id`는 공개 제어 모듈 식별자이고, `moduleFingerprint`는 컴파일 모듈의 안정적인 16자리 16진수 추적 지문이며, `bytecodeSha256`은 출력 매니페스트 바이트코드의 소문자 SHA-256입니다. 지문과 아티팩트 다이제스트는 서로 다르며 둘 다 필요합니다. `source.documentId`는 하나의 작성 문서 리비전 전반에서 안정적인 불투명 공개 식별자입니다. `source.revisionId`는 저장된 정식 리비전 하나를 위한 불투명하고 불변인 식별자입니다. `source.sha256`은 그 리비전의 UTF-8 소스 바이트 SHA-256입니다. 두 소스 식별자 모두 경로가 아니므로 대화 또는 리비전 저장소의 문서를 지원합니다. 픽스처의 저장소 경로는 테스트 하네스에서만 사용됩니다.

`source.kind`는 정확히 `literate`입니다. GhostFlow의 정식 작성·검토·버전 관리 소스는 literate 문서입니다. 제품/컴파일러 입력은 정식 `.ghost.md`만 가능합니다. 일반 코드는 거부되며 지원되는 작성, 가져오기, 아티팩트 또는 Interaction Schema 대체 입력이 될 수 없습니다.

각 설명자는 공개적이고 안정적인 작성 `id`와 `name`, 의미 `kind`, 컴파일러/소스 의미 `sourceType`, 명시적 `access`, 출처 정보를 가집니다. v0은 `state`, `timer`, `counter`를 허용하며 접근은 정확히 `['read']`입니다. 모두 관찰 전용 내부 값입니다. counter는 기존 literate 링크에 `meaning=counter`가 연결된 작성 `Int` 상태입니다. 주석 없는 `Int`, 임의 `Number`, 정수처럼 보이는 런타임 값 또는 이름만으로 counter 의미가 생기지 않습니다. 따라서 counter 출처에는 작성 소스 노드 종류인 `state`가 유지됩니다. 설정, 명령, 입력, 이벤트, 알람 및 설명은 #70의 소관인 후속 작업입니다. 이 계약은 해당 설계가 나오기 전까지 `write` 또는 `execute` 접근을 허용하지 않습니다. `sourceType`에는 `builtin` `Bool`, `Int`, `Number`, `Duration` 또는 명명된 `nominal` 유형과 의미 단위가 담깁니다. 런타임 JSON 표기로 유형을 선택하지 않습니다. 정적 설명자가 지정하기 때문에 `0`은 `Number` 또는 `Duration`으로 남습니다.

컴파일러가 선언을 확인한 enum의 `nominal` `sourceType`에는 선언 순서의 정확한
`enumMembers: [{"name":"Idle","value":0}, ...]` 표도 담깁니다. 서수는 명시적이고
중복이 없으며 0부터 시작합니다. 다른 nominal 유형에는 이 필드가 없습니다.
정상 enum 관측값은 선언된 서수와 일치해야 합니다. 알 수 없는 값에 이름을 추측해
붙이지 않습니다. 이 표는 스키마 해시와 소스 판본 식별 결합에 포함됩니다.
스키마 버전 `0.2`가 이 필드를 추가하며 런타임 스냅샷 버전은 `0.1`입니다.

스키마 버전 `0.3`은 enum 멤버에 선택적 일반 텍스트 `displayLabel`을 추가합니다.
정식 `.ghost.md`의 제어 블록에서 다음처럼 작성합니다.

```ghost
type Phase = Idle { label = "대기"; } | Running;
```

첫 멤버는 `{"name":"Idle","value":0,"displayLabel":"대기"}`로 생성됩니다.
레이블이 없는 멤버는 `displayLabel`을 생략하며 소비자는 `displayLabel ?? name`을
표시합니다. 레이블은 웹, HMI, 모바일 소비자를 위한 표시 메타데이터입니다.
enum 식별자, 순번, 제어 의미, GFB 바이트와 VM ABI는 바뀌지 않습니다.
기존 JSON 문자열 이스케이프 규칙과 Unicode를 지원합니다. 빈 문자열, 공백만 있는
문자열, 중복 `label` 항목과 다른 멤버 옵션은 컴파일 오류입니다. 소비자는 레이블을
마크업이 아닌 텍스트로 렌더링합니다. 레이블은 정확한 스키마 다이제스트에 포함되므로
레이블 수정에는 일치하는 소스 리비전과 스냅샷 식별자가 필요합니다.
런타임 스냅샷 버전은 `0.1`이며 관찰 값은 숫자 순번입니다.
import된 enum 조합은 계속 지원하지 않으며 기존 진단을 유지합니다.

유효한 무상태 제어는 식별된 스키마와 `descriptors: []`를 가집니다. 이는 정확한 literate 리비전과 컴파일 모듈에 관찰할 공개 상태나 타이머가 없다는 뜻입니다. 스키마, 소스 식별자 또는 모듈 식별자가 없다는 뜻은 아닙니다. 대응하는 완료 스냅샷은 `observations: []`를 가지면서 정확한 스키마 다이제스트, 모듈, 소스, 실행 및 완료 스캔 식별자를 유지합니다. 직접 입력-출력 제어를 관찰 가능하게 만들 목적으로 생성자가 불리언 상태나 타이머를 만들어서는 안 됩니다.

각 설명자는 양수 컴파일러 소스맵 노드 ID와 하나 이상의 literate 의도 앵커도 이름으로 지정합니다. 설명자 ID/이름 및 앵커 ID는 공개 값이며 예약 접두사 `__gf_`를 거부합니다. 소스맵 노드 ID는 컴파일러 출처용 숫자이며 생성 VM 슬롯 이름이 아닙니다. 픽스처 테스트는 기록된 각 노드/종류 및 앵커 링크가 이 정확한 소스 리비전에 존재하는지 확인합니다. 설명자 생성은 #71에서 구현합니다. 런타임 투영은 공개 스냅샷을 내기 전에 컴파일된 정식 literate 아티팩트에서 해당 스키마를 재구성하고 검증합니다.

`timer.age`는 `elapsed(watering)`을 다음처럼 나타냅니다.

```json
{"kind":"elapsed_since_change","subjectId":"state.watering"}
```

`watering` 같은 Bool 대상에서 이는 Bool이 마지막으로 바뀐 뒤의 경과 시간이지, 활성/ON 상태가 누적된 시간이 아닙니다. Bool이 참일 때만 타이머를 사용하는 제어에서는 로직이 해당 나이를 활성 지속 시간으로 해석할 수 있지만, 타이머 자체는 어느 쪽 전환 뒤에도 경과 시간을 측정합니다. `Phase` 같은 nominal enum 대상에서 `elapsed(phase)`는 단계 경과 시간입니다. enum 값이 바뀔 때마다 초기화되고 현재 단계와 상관없이 계속 진행됩니다. `examples/enum-phase-age.ghost.md` 및 집중 컴파일러/WASM 테스트는 상태가 nominal `Phase`로 남고, 타이머는 대상이 `state.phase`인 `Duration`임을 보여줍니다.

위젯, 레이아웃, 표시 여부, 색, 좌표 또는 렌더러 정책 필드는 없습니다. 렌더러는 기본적으로 타이머를 표시하고 불리언 상태를 숨길 수 있지만 해당 정책은 이 IR의 일부가 아닙니다.

## 완료된 런타임 스냅샷과 상태

완료 스캔을 반복 관찰할 때는 컴파일 아티팩트와 실행 epoch마다
`prepareCompletedScanSnapshot({ compilation, schema?, runId })`를 한 번 호출합니다.
반환값은 고정된 `{ schema, expected, emit({ completion, trace, settingsState? }) }`
생성자입니다. 준비 단계는 정적 아티팩트 입력을 복사한 뒤 정확한 스키마를 검증합니다.
공개 스키마는 깊게 불변이며 추적 메타데이터와 config 설명자는 비공개 불변 복사본입니다.
검증에만 쓰는 소스와 바이트 버퍼는 버립니다. 호출자 데이터나 이전 스냅샷을 수정해도
후속 발행은 바뀌지 않습니다. `expected`는
`joinRuntimeSnapshot(schema, snapshot, expected)`를 위해 한 번 계산합니다.
매 emit은 완료 정보, 논리 클록, 추적 모듈 식별자, 현재 Rust 설정, 관찰 유형,
Interaction 계약 및 생성 이름 배제를 계속 검사합니다. 재컴파일 또는 재시작할 때는
새 실행 ID로 생성자를 다시 준비합니다. 생성자는 해당 Worker나 호스트 안에 둡니다.
함수는 전송 페이로드가 아닙니다. `emitCompletedScanSnapshot`은 같은 검증 경로의
일회 호출 형태로 유지합니다.

스냅샷은 `completed-scan` 하나입니다. `runId`는 호스트/런타임 인스턴스 소유의 불투명 공개 epoch입니다. 같은 소스도 `scanId: 0`에서 재시작할 수 있으므로 재설정이나 새 실행 때 바뀌어야 합니다. `completion`에는 음수가 아닌 `scanId`와 논리 밀리초가 있습니다. 스냅샷에는 누락 없이 모든 설명자당 관찰이 정확히 하나 있어야 하며 값이 없어도 `unavailable` 관찰을 명시해야 합니다. 따라서 설명자가 없는 스키마의 관찰은 정확히 0개입니다. v0은 별도의 tick 식별자를 정의하지 않습니다. 프레임 호스트가 완료 식별자를 소유합니다. 타이머가 있는 제어는 완료 추적에 컴파일러 생성 비공개 클록도 가지며 생성자는 해당 값이 `completion.logicalTimeMs`와 같아야 합니다. 상태만 있는 제어는 관찰만을 위해 생성 타이머 클록을 얻지 않습니다. 완료 프레임만으로 충분하며 공개 또는 비공개 타이머를 만들어내지 않습니다.

관찰별 페이로드 상태는 의도적으로 최소화했습니다.

| 상태 | 결정 주체/시점 | 필수 필드 | 의미 |
| --- | --- | --- | --- |
| `ready` | 완료 후 신뢰된 스냅샷 생성자 | `value` | 정적 설명자의 의미 유형에 해당하는 값입니다. `false`와 `0`은 값이지 부재가 아닙니다. |
| `unavailable` | 신뢰된 생성자 | `reason` | 이 완료 관찰에는 값이 없습니다. |
| `error` | 신뢰된 생성자 | `error` | 이 설명자를 관찰할 수 없었습니다. |
| `stale` | 검증 소비자의 조인 | 파생 사유 | 구조적으로 유효한 스냅샷이 소비자가 기대하는 스키마, 모듈, 소스 또는 실행 식별자와 다릅니다. 자체 선언 관찰 상태로는 허용되지 않습니다. |

설정은 명시적으로 업그레이드된 profile을 씁니다. `setting` 설명자를 하나라도 포함한
정적 스키마는 스키마 버전 `0.4`를, 런타임 스냅샷은 스냅샷 버전 `0.2`를 씁니다.
설정이 없는 스키마는 기존 스키마 `0.3`과 스냅샷 `0.1` 그대로이며, 예전 설정
스냅샷을 새 profile로 조용히 재해석하지 않습니다.

`setting` 관찰이 있는 스냅샷은 전역 `settingsRevision`도 가집니다. 각 설정 관찰에는
`defaultValue`, `emissionRevision`, `applicationPosition`이 필요하고, `ready` 관찰에는
추가로 `override`가 필요합니다. `defaultValue`는 정적 소스 리터럴이며 fallback이 아닙니다.
`emissionRevision`과 `applicationPosition`은 해당 설정에 실제로 수락된 emission의 revision과
이벤트 위치입니다. 초기 소스 관찰은 revision `0`, `applicationPosition: null`,
`override: false`를 쓰며 현재 값은 `defaultValue`와 정확히 같아야 합니다. 이후 수락된
성공 emission은 값이 default와 같아도 나중 revision/위치와 `override: true`를 씁니다.
수락된 설정 fault는 현재 Result의 fault와 같은 provenance 필드를 유지하되 ready 전용
`override`는 노출하지 않으며, 이전 성공 `value`나 합성 default를 effective 값으로 노출하지
않습니다. 설정이 아닌 설명자는 기존의 최소 상태 필드를 유지합니다.

선택적 예상 식별자가 제공된 경우에만 검증기가 정확한 stale 사유와 함께 `join.status: "stale"`을 보고합니다. 예상 조인은 스키마 형식/버전/다이제스트, 모듈 ID/지문/바이트코드 SHA, 소스 문서 ID/리비전 ID/SHA 및 실행 ID를 비교할 수 있습니다. `scanId`는 한 실행 내부의 순서 좌표일 뿐이므로 제외됩니다. 문서 내부의 스키마/스냅샷 불일치는 stale 데이터가 아니라 검증 `error`입니다. 이 구분은 신뢰할 수 없는 페이로드가 식별 실패를 숨기려고 스스로 stale이라고 표시하는 일을 막습니다.

## 픽스처와 검증

`examples/five-minute-watering.ghost.md`는 literate 5분 급수 픽스처입니다. 정적/동적 JSON 예제는 실제 `false` 및 `0` 값을 포함하며 정확한 counter/`Int` 표현을 추가하지 않고 Number와 `Percent`를 작성 상태 설명자로 나타냅니다. `validate.mjs`는 알 수 없는 필드, 공개 식별자, 출처, 의미 유형, 정확한 스키마 다이제스트, 정적 식별자, 완료 정보 및 설명자 전체 포함 여부를 엄격히 검사합니다. 레코드만 검증하며 장치, 물리 동작, 프론트엔드, 컴파일러 출력 또는 런타임 수집을 주장하지 않습니다.

## 공유 적합성 코퍼스

`examples/corpus.json`은 각 테스트 사례의 정식 소스 리비전과 컴파일 모듈 식별자를 고정합니다. 첫 사례는 정식 5분 급수 제어이며 원래 의도, 논리 장비 매핑 및 소프트웨어 전용 증거 경계는 해당 `.ghost.md`에 기록됩니다. `examples/multiple-values.ghost.md`는 두 번째 정식 프로그램입니다. 작성된 Bool 상태 두 개와 경과 타이머, Number 상태 하나, nominal `Percent` 상태 하나가 있습니다. 둘 다 현재 컴파일러가 허용하는 문법을 사용하며 새로운 설명자 종류를 암시하지 않습니다.

코퍼스 옆의 각 `.scan-tape.json`은 버전이 있는 렌더러 중립 테스트 자극입니다. 모든 프레임은 완료 스캔, 논리 시각 및 컴파일된 매니페스트 순서의 모든 이름 있는 선언 입력을 기록합니다. 실행마다 다른 `runId`를 쓰고 `scanId`는 0부터 연속적으로 증가합니다. 테이프 다이제스트는 `digest` 멤버를 뺀 전체 테이프 객체의 엄격한 정규 JSON SHA-256이며 희소 배열과 안전하지 않은 정수를 거부하는 이 저장소의 `canonicalJson`을 사용합니다. 이 입력 테이프는 관리되는 테스트 데이터이지 또 다른 GhostFlow 제어 소스가 아닙니다.

`observationExpectations`는 검증기 전용 `unavailable` 사례를 기술할 수 있습니다. 이는 런타임 관찰을 주장하지 않으며 체크인된 스냅샷에도 복사되지 않습니다. 코퍼스 검증기는 정확한 `.ghost.md` 바이트를 컴파일하고 소스/모듈/아티팩트 식별자를 확인하며 완전한 입력, 연속된 실행별 스캔 ID, 감소하지 않는 논리 시각 및 기존 스키마/스냅샷 투영을 검증합니다. 다음 명령으로 실행합니다.

`node contracts/interaction-v0/verify-corpus.mjs` 또는 `node --test tests/interaction-corpus.test.mjs`를 실행합니다. 5분 급수의 체크인된 스키마와 스냅샷, 그리고 이후의 스키마/스냅샷/GFB 파일은 파생 투영물입니다. literate 문서만 정식 제어 소스로 남습니다. 두 번째 프로그램은 수동 관리 plain `.ghost` 대응 파일이나 조작된 런타임 스냅샷을 의도적으로 갖지 않습니다.

`tests/interaction-runtime-snapshot.test.mjs`는 각 정확한 코퍼스 소스와 테이프를 릴리스 네이티브 프레임 실행기 및 실제 프레임 WASM ABI에 재생합니다. 완료 추적을 투영하고 타이머 논리 클록 값을 포함해 네이티브와 WASM의 공개 스냅샷이 바이트 단위로 같은지 요구합니다. 또한 비활성화, 매 스캔 읽기 및 지연 소비자 실행을 비교합니다. 관찰은 커밋 상태, 요청 출력 또는 안전 출력을 바꾸면 안 됩니다. 이는 호스트 네이티브/WASM 증거일 뿐 브라우저 승인, 펌웨어 실행 또는 물리 장치 동작을 주장하지 않습니다.

여기서 거부한 v0 대안은 신뢰할 수 없는 관찰에 `ready`와 함께 `stale`을 넣는 것입니다. 그러면 생성자의 주장이 소비자의 식별자 조인을 대신하게 됩니다. 검증 중 파생하면 문서를 작게 유지하면서 재시작 및 리비전 불일치를 명시할 수 있습니다.

## 설정 provenance 검증

새 `0.4` setting descriptor에는 canonical source의 `defaultValue`가 포함된다.
producer는 runtime 기본값을 컴파일된 config literal과 비교하고 validator는 각 동적
기본값을 그 정적 descriptor에 연결한다. 행의 `emissionRevision`은 전역
`settingsRevision` 이하이며 최신 수락 전역 revision이 적어도 한 행에 있어야 한다.
한 atomic revision의 행들은 같은 `applicationPosition`을 갖는다. revision 0은
초기 source 성공값이며 fault나 변경 이력을 뜻하지 않는다. position은 실행별 좌표라
checkpoint 복원 전후에 증가할 필요가 없다. context checkpoint 버전 4가 이 필드를
저장하고 새 owner 변경 전에 값·이력·allocator 및 revision 상관관계를 검증한다.

명시적 legacy schema `0.3` / snapshot `0.1` 설정 문서는 원래 필드와 digest로
계속 검증한다. 새 provenance 주장을 포함하지 않고 `0.4` / `0.2`로 재해석하지
않으며 새 설정 producer는 새 profile을 사용한다. 설정이 없는 문서와 과거 고정
digest는 유지한다. REF-05-012 테스트는 실제 native와 framed WASM의 전체
outcome·설정·checkpoint 동등성, 권한 및 VM transaction 거부, source 기본값
변조와 checksum을 복구한 의미적 restore 변조를 검증한다. 설정 관측 계약이며
실행 descriptor binding·변경 권한 부여·publishing 식별자 발급·Device 채택을
주장하지 않는다.
