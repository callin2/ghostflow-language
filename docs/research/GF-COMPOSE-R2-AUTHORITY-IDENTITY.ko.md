<!-- translation-source: docs/research/GF-COMPOSE-R2-AUTHORITY-IDENTITY.md -->
[영어 원문](GF-COMPOSE-R2-AUTHORITY-IDENTITY.md)

# GF-COMPOSE R2: 권한과 identity

## 사용자 문제

화면의 pump, 엔지니어의 trace, 물리 설치를 조용히 같은 것으로 취급해서는 안 된다.
조합에는 연결된 identity가 필요하지만 graph view를 두 번째 실행 source로 만들어서는
안 된다. 아래 권고는 canonical `.ghost.md` 규칙의 권위를 유지하고 Rust core에서
실행하며 API, Device, frontend 책임을 명시한다.

## 조사한 revision의 증거

증거는 `ffdbc96461eca67908252507fb851fa4dabd9a2c`(working-tree `HEAD`)에서 조사했다.
`compileSource`는 하나의 canonical literate source를 받고 `sourceDocument`
(`format`, `kind`, `filename`, `text`, `sha256`)를 저장하며 `documentId`와 `revisionId`를
포함하는 interaction identity를 내보낼 수 있다. compiler는 module fingerprint/bytecode
provenance와 source map도 내보낸다. filename과 source 위치는 trace 좌표이며 공개 identity가 아니다.

interaction 계약은 현재 정적 descriptor와 완료된 snapshot을 source document/revision,
module ID/fingerprint/bytecode digest, schema digest, `runId`로 join한다. `scanId`는 한 run
안에서만 순서가 있다. reset이나 새 run은 `runId`를 바꿔야 한다. 따라서 두 run의
`scanId=0`은 같은 occurrence가 아니다. 이는 구현된 계약 사실이며 조합 제안이 아니다.

intent-anchor map은 생성된 provenance가 편집 가능한 source가 아니며 intent를 추론하거나
승인하지 않는다고 명시한다. `docs/CONSTRAINTS.md`는 host 소유의 범위가 한정된 named-constraint
경로를 설명하고 설치 binding이 control source 외부에 있다고 명시한다. 현재 control
parser는 `constraints` construct를 거부하고 standalone constraints parser는 의도적으로
제한돼 있다. 이 문서는 통합된 constraint runtime을 주장하지 않는다.

## 표와 예

### 권한 matrix

| 개념 | 현재 권위 있는 소유자 | 기존 identity field | 제안된 조합 추가 사항 | 증거 참조 |
|---|---|---|---|---|
| Canonical source | Language/API source revision 저장소 | `documentId`, `revisionId`, source `sha256`, `kind=literate` | 정확한 source closure와 각 imported revision 유지. filename이나 label 사용 금지 | [`compile-source.mjs`](../../tools/compile-source.mjs); [`interaction-v0`](../../contracts/interaction-v0/README.md) |
| Imported definition revision | 언어 검증을 수반하는 API package/revision orchestration | Source document/revision과 compiled module identity | 정확한 revision으로 고정한 불변 import edge 추가. 표시 이름으로 import 금지 | [`interaction-v0`](../../contracts/interaction-v0/README.md); [`PORTABLE-PACKAGE.md`](../PORTABLE-PACKAGE.md) |
| 동작 instance | API composition/deployment 기록. Rust core가 실행 | 현재 공개 instance field는 확립되지 않음 | 불투명한 `instanceId`를 추가하고 definition revision에 연결. instance state/provenance 격리 필요 | Interaction 계약에는 run identity가 있지만 composition instance field는 없음. 제안 |
| Logical port | Language manifest/compiler 선언 | 작성된 descriptor `id`/`name`, kind, type, source-map provenance | 안정적인 작성 port ID 유지. 표시 경로 이름 변경이 아니라 instance 한정 추가 | [`interaction-v0`](../../contracts/interaction-v0/README.md); [`integration-v1`](../../contracts/integration-v1/README.md) |
| 물리 설비/binding | Device profile과 API 설치 문맥 | `bindingRevision`, board/profile과 명시적 logical-name-to-endpoint mapping | 조합 join에 binding revision/digest 추가. physical ID는 logical port ID가 아님 | [`integration-v1`](../../contracts/integration-v1/README.md); [`PORTABLE-PACKAGE.md`](../PORTABLE-PACKAGE.md) |
| Settings | API/operator 설치 문맥. 실행 default는 source 소유로 유지 | 여기에는 일반 composition settings identity가 구현되지 않음 | source/program/run identity와 구분되는 settings revision/effective event position으로 runtime property join. import parameter는 별개 유지 | [`CONSTRAINTS.md`](../CONSTRAINTS.md); #89/#90 |
| Runtime occurrence | Host/runtime snapshot 생산자 | `runId`, 완료 `scanId`, logical time | run + instance + scan에서 도출한 instance 한정 occurrence key 추가. `runId` 대체나 `scanId` 재정의 금지 | [`interaction-v0`](../../contracts/interaction-v0/README.md) |

제안된 field는 설계 권고일 뿐이다. 이 연구는 새 identifier generator, wire schema,
ABI를 승인하지 않는다.

정정 사항 (2026-09-20): identity join은 program/run identity와 live settings revision 및
effective event position을 구분해야 한다. runtime에서 조정 가능한 property는 승인된
live event다. 하나의 다중 property 동작을 atomic하게 검증하고 모든 property를 바꾸거나
하나도 바꾸지 않는다. 승인된 변경은 활성 논리 실행 중에도 처리 시점에 적용된다.
재컴파일, 새 program/run, 전체 controller 정지가 필요하지 않다. 실제 ESP 재시작 후에도
property는 유지되지만 물리 재시작은 새 run identity를 만든다. 합의된 설계 수정이며 구현된
동작이 아니다. [`CONSTRAINTS.md`](../CONSTRAINTS.md)와 [`LANGUAGE.md`](../LANGUAGE.md)의
이전 정지된 Configure 요구사항은 #89/#90에서 조정해야 한다. 현재 source-rewrite/recompile
helper는 이 live 경로가 아니다. 암묵 reset이나 stale-program join 재해석을 뜻하지 않는다.
durability, 순서, ABI, 검증은 설계의 미해결 부분으로 남는다.

### Identity 변경 matrix

| Event | 안정적인 logical identity | 정확한 revision / occurrence 영향 |
|---|---|---|
| 표시 이름 변경 | definition, instance, logical port, binding 불변 | UI label만 변경. 새 physical binding 승인 아님 |
| Source 위치 이동 | 같은 저장 문서를 옮기면 document identity 불변 | Revision/source digest는 불변일 수 있음. source 좌표는 변경 가능. 새 작성 revision에는 새 `revisionId`와 digest 필요 |
| 하나의 정의에 instance 두 개 | 같은 definition revision. 서로 다른 `instanceId`와 격리된 state/timer/provenance | 각 instance는 자체 binding/settings join과 runtime occurrence namespace를 받음 |
| Source upgrade | API가 continuity를 명시적으로 선언할 때만 같은 logical definition | 새 `revisionId`, source digest와 일반적으로 새 module/artifact identity. deployment가 새 revision을 명시적으로 선택해야 함 |
| Binding 변경 | Logical port와 동작 instance는 안정적 유지 | 새 binding revision/digest와 새 installation/deployment 결정. physical endpoint identity 변경 |
| 재시작 | Definition, instance, binding은 안정적으로 유지 가능 | 새 `runId`. `scanId`는 0으로 돌아갈 수 있음. runtime occurrence를 `scanId`만으로 식별하지 않음 |

풀이 예(수작업 분석이며 실행 증거 아님): `east-irrigation`과 `west-irrigation`은 하나의
불변 definition revision을 참조한다. instance ID, state/timer 저장소, settings join,
provenance는 서로 다르다. 화면의 east pump 이름 변경은 binding이나 logical port를
바꾸지 않는다. 재시작 후 `run-A/scanId=0`과 `run-B/scanId=0`은 다른 occurrence다.

### Graph projection과 cycle 정책

범용 ontology 대신 여러 typed projection이 있어야 한다.

| Projection | 허용 edge 의미 | Cycle 정책 |
|---|---|---|
| Import 의존성 | Definition revision이 정확한 definition revision을 import | 권고: 컴파일 전에 dependency cycle 거부. display/reference cycle은 실행 import cycle이 아님 |
| Scan 내부 평가 | 식, port, output 사이 read/dependency edge | 기존 불변조건: 순간 dependency cycle 거부. state feedback은 scan 간 기존 이전 상태/다음 상태 의미를 통해서만 합법적 |
| Explanation | Result/decision이 source node, anchor, constraint 판단, 정확한 문맥을 가리킴 | 권고: 수렴하는 참조와 반복 증거 허용. cycle은 data error이며 runtime feedback이 아님 |
| 설비 관계 | Logical port가 endpoint/설비에 bind되거나 설비가 자원 공유 | 권고: 명시적 relation type의 설비 graph 허용. topology에서 실행 순서 추론 금지. 모호한 소유권 거부 |
| 시간에 걸친 history | 같은 run, instance, 시간 순서에서 occurrence가 이전 occurrence를 뒤따름 | 권고: 반복 event로서 temporal cycle 허용. 순서 있는 occurrence 좌표 필수. 여러 재시작을 하나의 history로 합치지 않음 |

이 edge 의미는 범위가 한정된 권고다. 범용 graph database, serialization이나 프로젝트 간
ontology를 정의하지 않는다.

승인된 live property event는 data 값만 바꾼다. 검증된 실행 graph를 바꾸지 않고 모든
기존 cycle/phase 제한을 보존한다. dependency 검증 우회를 만들거나 다음 상태를 읽을 수
있는 식을 바꾸지 못한다. stale-program join을 조용히 재해석하지 않는다.

### 설치 constraint 충돌

시스템 설치 이슈 #62는 독립적으로 강제되며 약화할 수 없는 설치 constraint를 제안한다.
운영 memory 이슈 #68은 이제 근거 있는 아키텍처 문맥을 제공한다. 원본 대화와 구조화된
memory 주장은 분리되며 정확한 source span/provenance로 연결된다. 확인 상태는 관측,
추론, 농부 확인, 거부, superseded 정보를 구분한다. memory는 자동으로 현재의 진실이
되지 않는다. memory는 결정이 존재하는 이유를 설명할 수 있지만 대화는 실행 source가
아니다. GhostFlow revision을 바꾸기 전에 확인된 결정이 필요하다. 이는 시스템/API 제안
증거이며 이 저장소에 구현된 언어 계약이 아니다.

#68은 memory → decision → source → program/settings/installation contract → execution/outcome의
추적 가능성도 요구한다. 전체 대화 전달 대신 상한이 있는 provenance-aware 검색을 요구하며,
검색이나 LLM 실패가 유효한 program 또는 local control을 손상하지 못하도록 failure 격리를
요구한다. 원본 및 구조화 memory는 export/delete/local archive와 별도의 AI 학습 동의를
지원해야 한다. 이 요구사항은 provenance 연결과 privacy/retention 경계를 추가한다.
memory, label, frontend graph에 권한을 추가하지 않는다.

충돌은 구체적이다. 이 저장소는 canonical `.ghost.md`가 실행 규칙을 소유한다고 명시하지만
설치 constraint는 설치 경계에서 강제할 수 있어야 한다. 두 선택지가 남아 있다.

1. **별도의 canonical constraint 컴파일.** 설치 constraint를 기존 named-constraint source
   경로에 유지한다. API는 별도로 컴파일한 constraint artifact를 canonical 동작 package에
   join하고 두 digest를 고정한다. installer가 constraint artifact를 강제한다. 영향:
   두 실행 artifact에는 명시적인 join, lifecycle, trust, failure 계약이 필요하다.
   어느 쪽도 다른 쪽을 조용히 override해서는 안 된다.
2. **명시적인 프로젝트 간 경계 revision.** API/시스템 소유자가 canonical 동작 revision,
   constraint revision, binding, enforcement 소유자를 참조하는 설치 경계 revision을
   게시한다. 영향: 이 저장소는 계속 동작 의미를 소유하지만 acceptance는 프로젝트 간
   계약과 revision이 있는 경계 artifact에 의존한다.

어느 선택지도 여기서 선택하지 않는다. #62 시스템 아키텍처 소유자가 언어 소유자 및
API/deployment 소유자와 함께 constraint가 별도 compiled artifact인지 명시적 경계 revision
아래의 참조인지 결정해야 한다. JSON overlay를 승인되지 않은 두 번째 source로 채택해서는
안 된다.

#68 memory 연결은 이 선택을 해결하지 않는다. 선택된 constraint artifact나 경계 revision이
확인된 결정에서 참조되고 원래 memory provenance를 유지하면서 canonical `.ghost.md` 규칙을
보존하도록 요구한다. API/시스템 소유자는 사용자가 privacy/retention 제어를 행사할 때 memory
참조를 보존, 편집 삭제, 삭제 중 어떻게 처리할지도 정의해야 한다. 삭제된 memory를 조용히
현재 증거로 취급하지 않으면서 source/runtime identity는 유효하게 남아야 한다.

## 권고

권한 matrix와 identity 변경 규칙을 composition 검토 baseline으로 채택한다. 조합은 불변
definition revision을 고정하고 불투명 instance identity를 추가하며 작성된 logical port
ID를 보존해야 한다. installation, settings, module, schema, source, run identity를 혼동하지
않고 join해야 한다. projection별 edge/cycle 규칙을 사용한다. #62 경계 결정과 instance
identity를 위한 명시적 계약 확장 후에만 구현을 시작한다. label과 filename은 표시/trace
data로 유지한다.

## 미해결 질문과 소유자

- API/deployment 소유자: instance lifecycle, source upgrade의 continuity, settings
  revision/effective-event-position 표현 정의. mechanism 설계이며 live settings 존재
  여부에 관한 미결 결정이 아니다.
- Language + API 소유자: 두 번째 편집 가능 source 없이 imported source closure를 고정하고
  표현하는 방법 결정.
- #62 설치/시스템 소유자와 language/API 소유자: 위 선택지 1 또는 2를 선택하고 enforcement,
  trust, failure join 정의.
- Device 소유자: 물리 설비 identity, binding revision, 적용된 binding을 구성하는 증거 정의.
  이 저장소가 추론해서는 안 된다.
- 계약 소유자: instance 한정 runtime occurrence의 향후 wire 표현 결정. 현재 v0에는 해당
  field가 없다.
- #68 API/시스템 운영 memory 소유자: memory-record identity, 정확한 원본 span/구조화 주장
  provenance, 확인/supersession join, retention/export/delete 동작, memory-to-decision 연결 정의.
- API/system + language 소유자: 민감한 내용을 보존하지 않으면서 source provenance에 충분한
  tombstone과 digest를 삭제/편집 삭제 후 보존할지 결정.

### 인접 연구에 대한 영향

- **R3:** 조합된 실행 identity를 확인된 결정/source revision과 비교한다. memory 검색이나
  LLM 해석은 실행 전 문맥이며 runtime 입력이 아니다. 재시작과 instance 격리는 core 실행
  질문으로 남는다.
- **R4:** logical port/physical binding 증거를 memory 주장과 분리한다. 기억된 설비 사실이나
  예외는 설치 계약과 현재 device 증거 없이 binding 변경을 승인하지 못한다.
- **R6:** memory 유래 결정, import parameter, runtime settings, installation revision을
  별도 lifecycle로 모델링한다. source/settings 변경은 확인된 결정을 참조하고 원본/구조화
  provenance를 보존해야 한다. stale 또는 superseded memory가 활성 settings를 조용히 갱신하면
  안 된다.

## 검증

- [x] 조사한 commit 기록: `ffdbc96461eca67908252507fb851fa4dabd9a2c`.
- [x] 권한/identity 표가 명시된 모든 개념과 event를 다룸. label과 filename을 identity로
  사용하지 않음.
- [x] Graph 정책은 projection별 범위로 한정. state feedback과 순간 dependency cycle 구분.
- [x] Constraint 충돌에 구체적 선택지 두 개, 영향, 명시된 소유자가 있음. 새 권한, wire
  schema, ABI, runtime을 선택하지 않음.
- [x] Code/계약의 주장과 제안, 미해결 이슈 문구, 수작업 예를 구분.
- [x] #68에서 제공된 결과는 시스템/API 제안 문맥으로 기록. 구현된 언어 동작 아님.
  실제 소유권/privacy 질문은 미해결 유지.
- [x] 문서만의 범위 보존. Runtime suite를 실행하거나 주장하지 않음. `git diff --check`와
  link/source 검토가 coordinator의 최종 acceptance 검사임. 이 문서는 구현 주장을 포함하지 않음.
