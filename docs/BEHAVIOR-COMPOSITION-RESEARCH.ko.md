<!-- translation-source: docs/BEHAVIOR-COMPOSITION-RESEARCH.md -->
[영어 원문](BEHAVIOR-COMPOSITION-RESEARCH.md)

# 동작 조합: 연구와 아키텍처 검토

날짜: 2026-09-20. 상위 항목: [GF-COMPOSE #99](https://github.com/callin2/ghostflow-language/issues/99).
검토한 언어 revision: `ffdbc96461eca67908252507fb851fa4dabd9a2c`.
상태: 연구 요약과 제안된 설계 방향. 이 문서가 조합을 구현하는 것은 아니다.
하위 이슈는 구현 전에 범위가 한정된 설계 증거를 만든다.

## 정정 기록 (2026-09-20)

이 기록은 확립된 언어 규칙, 합의된 설계 수정, 미해결 구현 선택을 구분한다.
설계 증거일 뿐이다. 규범 언어 문서를 변경하거나 구현 또는 검증을 주장하지 않는다.

- **기존 실행 불변조건:** `x`는 이전 상태를 읽고 `x'`는 후보 다음 값을 정의한다.
  모든 전이는 같은 입력/이전 상태 snapshot을 사용한다. 다음 상태 참조는 출력 식에서만
  허용되며 다른 전이나 `let`에서는 허용되지 않는다. 상태와 논리 출력 결과는 함께
  확정된다. 조합 순환과 중복 출력 정의는 유효하지 않다. 모든 조합에서 이 규칙을
  보존한다. 이는 열린 질문이 아니다. 각 출력 채널에는 권위 있는 직접 정의가 하나만
  있다. 경쟁하는 직접 작성자는 컴파일에 실패해야 하며 절대로 배포해서는 안 된다.
  이것이 기존 station의 단일 작성자 자원 관리자를 없애지는 않는다. station 요청은
  경쟁하는 직접 쓰기가 아니다. 물리 endpoint alias 검사는 별도 binding 검증으로 남는다.
- **기존 Driver 경계:** GhostFlow는 typed Source와 Intent를 정의한다. Driver의 기반은
  소프트웨어, 특수 하드웨어 또는 둘 다일 수 있다. 정밀 측정/프로토콜/raw-ISR과 scan
  처리의 구분은 이 경계에 속한다. Driver에 농장 정책을 숨기지 않고 의미 있는 typed
  event나 측정을 core 논리에 전달한다. 포착 시각, 수신/평가 시각, 품질은 서로 다르다.
  명령 acknowledgement는 물리 동작의 증거가 아니다.
- **합의된 설계 수정이며 현재 구현은 아님:** runtime에서 조정 가능한 property 변경은
  live event다. 여러 property를 바꾸는 한 동작은 하나의 atomic event다. 전체 event를
  검증한다. 값 하나라도 invalid이면 아무 변경 없이 모두 거부한다. 승인되면 운전 중에도
  event를 처리하는 시점부터 활성 논리가 새 값을 사용한다. 적용을 다음 관수 cycle,
  새 run 또는 정지 mode로 미루지 않는다. 이 event 때문에 source를 다시 쓰거나 재컴파일,
  firmware/bytecode 갱신, 전체 controller 정지/재시작을 하지 않는다. program과 run identity를
  보존하고 settings revision/effective event position을 전진시킨다. 이에 따라 기존 규칙이
  출력을 바꿀 수 있다. 암묵 reset이나 오래된 program join의 자동 재해석은 없다.
  실제 ESP 재시작 후에도 settings는 유지된다. 그 물리 재시작은 여전히 새 run identity를
  시작한다.
- **현재 명세의 충돌:** [`CONSTRAINTS.md`](CONSTRAINTS.md) 179–204행,
  [`LANGUAGE-SURFACE.md`](LANGUAGE-SURFACE.md) 66–69행,
  [`LANGUAGE.md`](LANGUAGE.md) 460–461행은 현재 정지된 Configure 변경을 요구한다.
  #89에도 이전의 정지/새 run 제안이 있다. 합의된 live property 수정과 조정해야 하는
  이전 문서화 동작으로 취급한다. 수정이 이미 규범이거나 구현됐다고 조용히 주장하지
  않는다. 현재 source-edit helper는 지원되는 동작이다. source를 편집하고 재컴파일한다.
  합의된 live property 경로의 구현은 아니다. #89/#90은 해당 workstream 소유자로 남는다.
  남은 작업은 mechanism, ABI, 검증, 명세 정합성에 관한 것이다. 사용자가 live settings를
  원하는지는 미해결 질문이 아니다.
- **재시작과 입력:** 재시작은 GhostFlow 논리가 반응을 작성하는 일반 event다. 전역
  resume/manual 정책을 강요하지 않는다. runtime 이전 전기적 startup, disconnect와
  failure 의무는 Device/Driver가 유지한다. 입력 전달은 interrupt/scan 포착과 무관하게
  지원 용량 안에서 occurrence와 값 관측을 기본적으로 보존해야 한다. 대기 중 값을
  최신 값으로 교체하는 것은 입력별 명시 opt-in일 때만 허용한다. overflow/loss는
  거부하거나 보고해야 하며 조용히 받아들여서는 안 된다. 이는 무제한 영속 event history나
  새 incident 저장소가 아니다. 순서, event-to-tick 대응, source batching, 상한과 복구
  mechanism은 미정이다. hard deadline이나 priority scheduler는 명세되지 않았다.
- **운영 경계:** 일반 사용에서 동작들은 독립적으로 운전한다. 실행 program이나 ESP
  firmware 갱신은 해당 ESP 전체 controller의 maintenance stop을 사용한다. property event는
  그렇지 않다. 공유 전기 의존성은 설치 문맥에 속한다. 이는 Device가 그 경계를 구현하거나
  검증했다는 증거가 아니다.

정적 조합은 선호되는 가설이며 선택된 lowering이나 ABI가 아니다. 아래 native/WASM
적합성 검사는 제안이며 새로 실행한 결과가 아니다. 두 번째 canonical JSON program,
자동 solver 또는 저장 framework를 도입하지 않는다.

## 제품 목표

노력을 줄인다. 설명 가능성을 높인다. 추적 가능성을 높인다.

농부는 적은 기술적 결정으로 준비된 동작을 적용하고 다른 동작을 추가하며 예상치 못한
결과를 이해할 수 있어야 한다. 소프트웨어와 하드웨어 엔지니어는 관련 없는 log에서
이력을 다시 구성하지 않고 같은 결과를 조사할 수 있어야 한다. 기능은 사용자 문제를
명시하고 어떤 노력을 없애거나 어떤 설명/증거를 제공하는지 보여야 한다.

| 참여자 | 질문 | 필요한 결과 |
| --- | --- | --- |
| 농부 | 이 동작을 여기에 적용할 수 있는가? | 이해 가능한 요구사항, 차단 사유, 필요한 농장별 결정. |
| 농부 | 왜 관수가 시작되지 않았는가? | 근거 있는 이유, 운영 영향, 유용한 다음 행동. |
| 소프트웨어 엔지니어 / 동작 작성자 | 어떤 논리가 결과를 만들었는가? | 정확한 정의/instance, source revision, settings, inputs, state, constraint 판단. |
| 하드웨어 엔지니어 / 설치자 | 설비에 무엇이 전달됐는가? | 정확한 설치 binding, 적용 결과, 이용 가능한 물리 관측. |

설정 단계, 기술적 결정, 정정, 도움 요청과 진단 노력을 측정한다. 사용자가 차단된
행동을 설명할 수 있는지, 엔지니어가 뒷받침하는 증거에 도달할 수 있는지 측정한다.
baseline과 수치 개선 목표에는 기록된 walkthrough와 이후 참여자 검증이 필요하다.
이 연구에서는 둘 다 측정되지 않았다. 휴리스틱 walkthrough는 사용자 연구가 아니다.

## 완료된 위임 연구

범위가 한정된 아홉 연구 산출물은 완료됐으며 Luna reviewer가 독립적으로 검토했다.
모든 작성자는 low effort의 `gpt-5.6-luna`를 사용했다. 이는 연구 증거와 제안된 설계
방향이며 구현된 조합이나 측정된 사용자, Device, 물리 acceptance가 아니다.

- [R1 사용자 결과](research/GF-COMPOSE-R1-USER-OUTCOMES.md)
- [R2 권한과 identity](research/GF-COMPOSE-R2-AUTHORITY-IDENTITY.md)
- [R3 실행](research/GF-COMPOSE-R3-EXECUTION.md)
- [R4 port와 binding](research/GF-COMPOSE-R4-PORTS-BINDINGS.md)
- [R5 계약](research/GF-COMPOSE-R5-CONTRACTS.md)
- [R6 override](research/GF-COMPOSE-R6-OVERRIDES.md)
- [R7 package](research/GF-COMPOSE-R7-PACKAGES.md)
- [R8 incident 증거](research/GF-COMPOSE-R8-INCIDENT-EVIDENCE.md)
- [R9 acceptance와 인계](research/GF-COMPOSE-R9-ACCEPTANCE.md)

R9는 compiler/runtime 실행과 ABI, package/import closure와 검증, 설치 constraint 권한,
instance와 deployment identity, binding/applied-evidence 계약, incident/application/Device
history 증거에 관한 아키텍처 결정을 미정으로 남긴다. 이는 의존하는 작업 부분을 막는다.
이슈 결과 게시는 coordinator가 담당한다. 이 기록은 GitHub 이슈 종료를 주장하지 않는다.

## 연구 결과

source와 이슈 감사는 다음 사실을 뒷받침한다. 열린 이슈 설명은 요구사항이나 제안이며
해당 기능이 구현됐다는 증거가 아니다.

| 증거 | 현재 사실 | 조합에 대한 영향 |
| --- | --- | --- |
| [Compiler 진입점](../tools/compile-source.mjs) | `compileSource`는 하나의 canonical literate 문서를 받고 source identity를 보존한다. | 여러 imported source에는 명시적 provenance 설계가 필요하다. |
| [Core tick](../crates/ghostflow-core/src/lib.rs), `Runtime::tick` | 전이는 이전 상태를 읽고 intent는 정의된 상태 view를 사용하며 safety가 requested output을 해소한다. | instance 조합에서도 확립된 동시 snapshot/commit 규칙을 보존한다. control 내부 cycle 거부는 확정됐다. instance/import 간 참조 encoding과 검증만 열린 결정일 수 있다. |
| [Station core](../crates/ghostflow-core/src/station.rs), [constraint 계약](CONSTRAINTS.md) | 상한이 있는 pump-station arbiter와 별도의 canonical constraint 컴파일 경로가 이미 있다. | 재사용을 감사한다. 이 mechanism이 일반 동작 조합이나 임의 arbitration을 확립하지는 않는다. |
| [Intent anchor](INTENT-ANCHOR-MAP.md) | 생성된 provenance는 편집 가능한 두 번째 program이 아니다. 추론된 가정과 확인된 intent/premise는 구분된다. | view와 추출된 주장은 실행을 조용히 바꿀 수 없다. |
| [통합 계약](../contracts/integration-v1/README.md) | binding은 typed logical name을 endpoint에 대응시킨다. v1은 endpoint aliasing을 거부한다. 소프트웨어 입력은 물리 DI를 소비하지 않아도 된다. | 공유 출력과 자원 accounting에는 명시적인 호환성 결정이 필요하다. |
| [Portable package](PORTABLE-PACKAGE.md) | 하나의 source revision, GFB bytes, manifest, map, runtime identity와 binding revision을 함께 서명한다. | 재사용 동작과 설치된 deployment는 binding lifecycle이 다르다. |
| [Interaction 계약](../contracts/interaction-v0/README.md) | 정적 descriptor와 완료된 observation은 정확한 schema/source/module/run identity로 join한다. | 조합 instance에 맞춰 기존 identity 연결을 확장한다. |
| [Settings #89](https://github.com/callin2/ghostflow-language/issues/89) | 이전 정지/새 run 제안은 합의된 live runtime property 수정과 충돌한다. source-edit/recompile helper는 현재 지원되는 동작이지만 live 경로가 아니다. | 규범 문서를 조정하고 mechanism/ABI/검증을 정의한다. import specialization은 별개로 남는다. |
| [Explanation #88](https://github.com/callin2/ghostflow-language/issues/88), [event #74](https://github.com/callin2/ghostflow-language/issues/74) | explanation과 event/command 의미에는 이미 소유자가 있다. | 중복 시스템 대신 조합에 특유한 join과 빈틈을 연구한다. |
| [설치 #62](https://github.com/callin2/farm_studio_system/issues/62) | 독립적으로 강제되며 약화할 수 없는 설치 constraint를 제안한다. | 이 저장소의 canonical source 경계를 기준으로 표현과 enforcement를 결정한다. |

외부 선례는 권고의 참고이며 GhostFlow 의미를 정의하지 않는다.

- [Observable import](https://old.observablehq.com/documentation/notebooks/imports)는 version
  고정과 dependency 교체를 보여준다. imported evaluation은 lazy일 수 있다.
  GhostFlow 실행은 display가 값을 관찰하는지에 의존해서는 안 된다.
- [W3C PROV-DM](https://www.w3.org/TR/prov-dm/)은 entity, activity, 책임 agent를 구분한다.
  source/artifact/event provenance의 용어를 점검하는 데 유용하다. RDF, graph database나
  전체 ontology를 채택하라는 요구사항은 아니다.

## 아키텍처 권고

### A1. 연결된 identity를 가진 명시적 권한

canonical `.ghost.md` source와 고정된 imported source가 실행 동작을 소유한다.
API 소유 기록은 revision, 설치 문맥과 deployment를 식별한다. Device 소유 profile,
driver와 observation은 물리 정보를 제공한다. portable Rust core가 실행을 소유한다.
frontend는 semantic descriptor와 기록된 결과를 소비한다. 실행 규칙을 바꾸는 대화형
또는 시각적 편집은 source 변경 후보가 된다.

시스템 설치 이슈 #62는 실제 미해결 경계를 도입한다. 실행 가능한 설치 constraint가
두 번째 비공식 JSON program이 되어서는 안 된다. 기존 constraint 경로를 사용해 설치
계약이 별도로 컴파일된 canonical constraint source를 참조할 수 있는지, 명시적인
프로젝트 간 경계 revision이 필요한지 연구한다. 어느 쪽도 승인됐다고 가정하지 않는다.

### A2. Typed 관계와 구체적인 graph projection

공유 semantic 용어와 identity 연결을 유지한다. 모든 농장, source와 history 관계를
하나의 범용 DAG에 맞추도록 요구하지 않는다. import, scan 내부 의존성, explanation graph,
설비 관계와 시간에 걸친 observation의 edge 종류와 cycle 규칙을 각각 식별한다.

정의 identity, 불변 정의 revision, instance identity, logical port, 물리 설비,
runtime occurrence는 서로 다른 개념이다. 표시 이름과 문서 위치가 이 identity를
대신해서는 안 된다.

### A3. 정적 조합을 먼저 조사

하나의 실행 program으로 compiler가 조합하는 방법과 여러 VM을 조정하는 방법을 비교한다.
현재 실행 core를 재사용할 수 있으므로 정적 조합이 선호 가설이다. 아직 입증된 lowering이나
ABI 결정은 아니다.

비교에서는 확정된 이전/다음 상태 계약을 보존하면서 입력 sampling과 논리 시간을 보여야
한다. 모든 전이는 같은 이전 상태/입력 snapshot을 읽는다. 다음 상태 참조는 출력 식에만
있다. 논리 상태/출력 commit은 동시다. 이 의미는 조합의 결정 대상이 아니다. 비교에서는
timer 격리, 초기화/reset, fault 범위와 출력 해소도 보여야 한다. 같은 정의의 두 instance는
상태가 격리돼야 한다. 같은 instance identity에서 선언 순서를 바꿔도 동작이 바뀌면 안 된다.
scan 간 feedback에는 명시적 의미가 필요하다. 순간 의존성 cycle을 암묵적으로 풀지 않는다.

분석에서 기존 자원 상한을 유지한다. DI/RO 용량만으로는 전체 program state, bytecode,
식 비용, memory 또는 target timing을 알 수 없다.

### A4. 기존 설치 binding 보존

미사용 채널 제안은 명시적인 기존 binding을 유지해야 한다. 결정적 allocation만으로
동작을 추가할 때 이전 배선이 보존되는 것은 아니다. 제안, 사용자가 확인한 mapping,
관측된 설치를 구분한다.

선택한 입력이 실제로 물리 DI를 요구할 때만 물리 입력을 센다. 상위 항목의 DI 2 / RO 7
결과는 유선 디지털 입력 두 개를 가정한다. 소프트웨어 manual-start 명령은 별도 자원
사례다. 적합성 증거 부재는 compatible이 아니라 unknown으로 표현한다.

### A5. 첫 계약 profile의 범위 한정

명시적인 port 호환성, dependency 존재, parameter 상한, 채널당 하나의 권위 있는 직접
출력 정의로 시작한다. 경쟁하는 직접 작성자는 compile error이며 배포할 수 없다.
이는 기존 station manager의 명시적 station 요청 자원 arbitration을 금지하지 않는다.
그곳에서는 station manager가 직접 작성자로 남는다. 물리 endpoint alias 검사는 별도
binding 검증으로 남는다. 새 mechanism을 제안하기 전에 해당 manager를 감사한다.
조합 profile은 기존 station 동작을 재정의해서는 안 된다.

선언된 가정, 테스트된 성질, 정적으로 확립된 성질, runtime에서 강제되는 constraint를
구분한다. 모든 호환성 또는 검증 주장에는 범위가 필요하다. 분리된 출력도 공유 물,
전력 또는 다른 물리 자원에 영향을 줄 수 있다. 전기 채널 독립성이 물리 독립성을
증명하지는 않는다. 일반 temporal/safety 증명은 첫 profile의 범위 밖이다.

### A6. Override lifecycle 분리

import 시 parameter, runtime operator settings, dependency 선택, 물리 binding을 별도로
기록한다. 합의된 live property 경로는 program/run identity를 보존하고 settings
revision/effective event position을 전진시킨다. ESP 재시작 후에도 값을 유지하면서
재시작된 runtime에는 새 run identity를 부여한다. 이전 정지/새 run 문서를 #89와 조정한다.
parameterized schedule에는 #90을 사용한다. 이 수정은 아직 규범이거나 구현된 것이 아니다.

### A7. 명시적 확장 결정과 함께 package 검증 재사용

컴파일 전에 정확한 transitive dependency를 고정한다. source bundle 확장과 기존 artifact를
감싸는 composition envelope를 비교한다. 완전한 source closure, compiler replay, contract
descriptor와 map이 조합 artifact에 어떻게 결속되는지 결정한다. imported source provenance를
평탄화해 없애지 않는다.

기존 trust/revocation과 consumer 호환성 요구사항을 보존한다. 신뢰하는 package 발행자라는
사실은 deployment 권한이나 물리 acceptance를 확립하지 않는다. 재사용 export는 현장
binding, 현장 secret과 대화 기록을 제외한다. 조합이 signing mechanism을 다시 구현해서는
안 된다.

### A8. 하나의 event, 참여자별 설명

농부용 문장과 엔지니어용 상세 view는 같은 incident와 정확한 실행 문맥을 참조해야 한다.
requested output, 해소된 safe output, host/driver 적용과 이용 가능한 물리 feedback을 구분한다.

저수위 예에서는 저수위 signal이 관수를 차단했다고 보고한다. 그 signal을 탱크가 물리적으로
비었다는 근거 없는 주장으로 바꾸지 않는다. 재시작 후 반복되는 scan 번호는 이전 event를
식별할 수 없다. feedback 부재, journal gap, 이용 불가능한 artifact를 계속 드러낸다.

#88, #74, Interaction 계약과
[Device historian #28](https://github.com/callin2/farm-device/issues/28)을 재사용한다.
언어는 상한이 있는 의미와 provenance를 제공한다. retention, transport, 화면과 물리 관측은
기존 소유자의 책임으로 남는다.

## 상위 항목 분해

| #99 절 | 처리 | 연구 task |
| --- | --- | --- |
| 1, 9, 11: vision과 작성 경험 | 참여자 문제와 측정 가능한 결과로 변환한다. | R1 |
| 2: 하나의 Semantic DAG | 권한, identity와 명시적 graph projection으로 정제한다. | R2 |
| 3: 재사용 동작 | 유지한다. instance 실행과 격리를 정의한다. | R2, R3 |
| 4: 관수와 환기 | fixture로 유지한다. 거부와 incident 사례를 추가한다. | R4, R9 |
| 5: logical port와 physical IO | 유지한다. 기존 binding과 unknown 증거를 보존한다. | R4 |
| 6: parameter, binding, dependency | 분리를 유지하고 revision 영향을 명시한다. | R6 |
| 7: 계약 | 첫 profile의 범위를 한정하고 arbitration 소유권을 재사용한다. | R5 |
| 8: composition/link pipeline | 순수 compiler 작업을 설치와 deployment에서 분리한다. | R2–R7 |
| 10: source/package sketch | 문법은 예시로 유지한다. provenance와 package 호환성을 연구한다. | R7 |
| 12: 열린 질문 | 이름 있는 연구 deliverable에 배정한다. | R1–R8 |
| 13: 비목표 | 유지한다. 일반 graph platform이나 새 진단 저장 engine을 추가하지 않는다. | 전체 |
| 14: 제안된 deliverable | 사용자 journey와 아키텍처 의존성을 중심으로 순서를 바꾼다. | R9 |
| 여러 절의 explanation/trace | 부정적 결과를 포함하는 초기 요구사항으로 만든다. | R8, R9 |

원래 번호만 적힌 Device Query 참조 #27은 이 저장소에서 잘못됐다. language #27은 DateTime
작업이다. 확인된 관련 source는 [system #74, Track D](https://github.com/callin2/farm_studio_system/issues/74)와
[설치 #62](https://github.com/callin2/farm_studio_system/issues/62)다.

## 연구 순서와 이슈 색인

P0는 일찍 해결할 위험이 큰 제품/아키텍처 질문을 뜻한다. P1은 범위를 한정한 첫 조합
작업에 필요한 설계 세부다. 연구 우선순위이며 구현이나 제품 검증 완료의 선언이 아니다.

<!-- compose-issue-index:start -->
| Task | 우선순위 | 범위가 한정된 deliverable | 필수 의존성 |
| --- | --- | --- | --- |
| [R1 #100](https://github.com/callin2/ghostflow-language/issues/100) | P0 | 참여자 journey와 측정 protocol | 없음 |
| [R2 #101](https://github.com/callin2/ghostflow-language/issues/101) | P0 | 권한/identity matrix와 graph 경계 | 없음 |
| [R3 #102](https://github.com/callin2/ghostflow-language/issues/102) | P0 | 실행 비교와 명시적 scan 표 | R2 |
| [R4 #103](https://github.com/callin2/ghostflow-language/issues/103) | P1 | Port/resource와 안정적인 binding 결정 표 | R2 |
| [R5 #104](https://github.com/callin2/ghostflow-language/issues/104) | P1 | 첫 contract profile과 거부 진단 | R3, R4 |
| [R6 #105](https://github.com/callin2/ghostflow-language/issues/105) | P1 | Override lifecycle과 revision 변경 matrix | R2 |
| [R7 #106](https://github.com/callin2/ghostflow-language/issues/106) | P1 | 재사용 package/import closure 설계 비교 | R2, R3, R6 |
| [R8 #107](https://github.com/callin2/ghostflow-language/issues/107) | P0 | 농부에서 엔지니어로 이어지는 incident 증거 walkthrough | R1, R2, R3 |
| [R9 #108](https://github.com/callin2/ghostflow-language/issues/108) | P1 | Acceptance matrix와 구현 인계 순서 | R1–R8 |
<!-- compose-issue-index:end -->

task는 중복 local checkbox backlog가 아니라 GitHub에서 추적한다.
[계획 색인](../tasks/plan.md)은 이 요약과 tracker를 가리킨다.
R1과 R2는 함께 시작할 수 있다. R2 이후 R3/R4/R6는 독립적으로 진행할 수 있다.
R3 이후 explanation 연구 R8과 package 연구 R7은 나머지 입력이 있을 때 진행할 수 있다.
R9는 일찍 초안을 만들 수 있지만 R1–R8 전에 확정할 수 없다.

관련 이슈는 interface 참조다. 그 전체 완료가 이 연구 문서의 필수 의존성은 아니다.
미완료 capability가 필요한 구현은 나중에 그 특정 의존성을 선언해야 한다. 기존 상위
항목과 소유권을 유지한다. #89, #95, #88 또는 다른 기존 작업을 #99 아래로 옮기지 않는다.

## 대표 acceptance 시나리오

이는 제안된 테스트 또는 walkthrough 명세이며 실행된 결과가 아니다.

| 시나리오 | 예상 증거 |
| --- | --- |
| 관수 적용 후 4팬 환기 추가 | 유선 입력 두 개일 때 DI 2 / RO 7. 기존 관수 binding은 불변. |
| 소프트웨어 manual-start 명령 사용 | 그 입력이 물리 DI를 소비하지 않는 이유를 설명한다. DI 합계를 고정하지 않는다. |
| 관수 instance 두 개 생성 | 서로 다른 instance/state/timer/provenance identity. 같은 definition revision은 허용. |
| 같은 이름의 instance 순서 변경 | 명시된 input/time trace에서 같은 semantic output과 안정적인 binding. |
| 하나의 pump에 배타적 소유자 두 개 bind | 두 instance/port identity와 이해 가능한 이유를 포함해 거부. |
| 한 출력 채널에 경쟁하는 직접 작성자 두 개 정의 | 컴파일 거부. 배포 가능한 artifact 없음. 기존 단일 작성자 manager가 중재하는 명시적 station 요청은 거부하지 않음. |
| 잘못된 port type, dependency 부재 또는 suitability 불명 | 구체적 error/unknown 결과. 성공한 deployment라고 주장하지 않음. |
| 저수위가 관수 차단 | 농부 설명이 정확한 input, rule, requested/safe output과 run에 연결됨. |
| Driver 적용 실패 또는 feedback 부재 | 명령과 관측된 결과를 구분해 보존. |
| 재시작, crash 또는 journal gap | boot/run 경계와 마지막 이용 가능한 증거를 보존. 없는 증거를 명시. |
| parameter, settings 또는 binding 변경 | revision 변경 matrix 적용. 오래된 증거 join 거부. |
| 운전 중 한 동작으로 여러 live property 변경 | 하나의 event. 승인 시 program/run identity 변경이나 controller 정지 없이 모두 적용. 값 하나라도 invalid이면 변경 없이 전체 event 거부. |
| 승인된 property 이후 재시작 | property 값 유지. 재시작 반응은 GhostFlow가 작성하고 새 run 시작. Device startup 전기 의무는 별개로 유지. |
| 부하 중 occurrence와 관측값 전달 | 용량 안에서는 기본적으로 보존. 명시 opt-in 입력만 최신 값 교체. overflow/loss는 거부하거나 보고. 무제한 history를 뜻하지 않음. |
| imported definition upgrade | 명시적인 고정 revision 변경과 영향을 받는 instance/contract/provenance 영향. floating dependency 갱신 없음. |
| Native/WASM replay | 같은 고정 artifact, settings, input tape, logical time, output과 지원 trace identity 비교. |

기존 상태 규칙은 모든 시나리오에서 확정돼 있다. 각 전이는 같은 이전 상태/입력 snapshot을
읽는다. `next` 참조는 출력 식에만 있다. 상태와 논리 출력 결과는 함께 commit한다.
lowering이나 ABI 질문이 아니다. 조합이 이 규칙을 보존하는 구체적 mechanism은 미정이다.

제안된 native/WASM 적합성은 운전 중 property 영향, invalid 다중 property event의 전부 거부,
불변 source/program hash와 run identity, 새 run identity와 GhostFlow 작성 재시작 반응을 가진
재시작 후 persistence, 명시적 coalescing/overflow 사례, 기존 prime 및 station 단일 작성자
적합성 보존을 다뤄야 한다. 이 검사는 제안이며 실행되지 않았다. Host 적합성, API 통합,
Device 실행, 물리 commissioning, 농부/엔지니어 usability는 별도 증거 종류다.
host fixture 통과는 다른 종류를 완료하지 않는다. 향후 실행 테스트는
`tools/verify-language.mjs`에 명시적으로 등록하고 `docs/VERIFICATION.md`를 따라야 한다.

## 작은 모델을 위한 인계 규칙

각 이슈는 독립적이다. 문서 artifact 하나, 정확한 시작 source, 고정 constraint, 번호 있는
단계, 예, 예상 표 column, 의존성, 완료 검사 세 개를 포함한다. 대화 history가 필요하지
않다. 예상 범위는 집중된 연구 한 번이며 보통 약 80–160행의 출력 파일 하나다.

검토한 revision을 증거 baseline으로 사용한다. 실제 조사한 revision에 관련 차이가 있으면
기록한다. 큰 module 전체가 아니라 필요한 정의를 읽는다. 현재 code, 열린 제안과 권고를
구분한다.

새 runtime, ABI, source 권한, 저장 engine 또는 프로젝트 간 소유자를 조용히 선택하지
않는다. 정해진 출력에 대안과 구체적인 반례를 제시한다. 증거가 없으면 `unresolved`라고
쓰고 없는 증거와 소유자를 명시한 뒤 뒷받침되는 부분을 완료한다. 아키텍처 acceptance는
검토 checkpoint로 남는다. 작은 모델에 암묵적으로 위임된 task가 아니다.

## 검토 checkpoint와 보류 범위

R1–R3 이후에는 사용자 결과, 권한과 실행 대안을 검토한다. R4–R8 이후에는 binding, 계약,
lifecycle, package 호환성과 증거 연결을 함께 검토한다. R9는 결정된 내용과 정확한 미해결
구현 blocker를 기록한다. 하위 연구 완료가 구현을 자동 승인하지는 않는다.

임의 graph query, 범용 ontology, marketplace, 새 UI renderer, 분산 orchestration, 일반
temporal 정리 증명, 기존 #95 작업을 넘는 공유 actuator 정책은 보류한다. 구체적인 사용자
문제가 필요하다. 자연어 추출과 대화 memory는 API/제품 작업으로 남는다.
[system memory #68](https://github.com/callin2/farm_studio_system/issues/68)이 이미 그 더 넓은
provenance lifecycle을 소유한다.
