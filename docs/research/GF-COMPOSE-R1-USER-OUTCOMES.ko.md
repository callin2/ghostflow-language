<!-- translation-source: docs/research/GF-COMPOSE-R1-USER-OUTCOMES.md -->
[영어 원문](GF-COMPOSE-R1-USER-OUTCOMES.md)

# GF-COMPOSE R1: 사용자 결과와 측정 protocol

상위 항목: [#99](https://github.com/callin2/ghostflow-language/issues/99)
이슈: [#100](https://github.com/callin2/ghostflow-language/issues/100)
조사한 증거 revision: `ffdbc96461eca67908252507fb851fa4dabd9a2c`
상태: 연구/설계. 참여자 session이나 수치 baseline은 완료되지 않았다.

## 사용자 문제

농부는 적은 기술적 결정으로 준비된 동작을 적용해야 한다. 농장에서 필요한 사항과
행동이 차단됐을 때 해야 할 일을 알아야 한다. 소프트웨어 엔지니어와 동작 작성자는
결과의 정확한 정의, revision, instance, 입력, 상태, constraint 판단을 알아야 한다.
하드웨어 엔지니어와 설치자는 설치 binding, 적용 결과, 이용 가능한 물리 feedback을
알아야 한다. 제품 결과는 노력 감소, 설명 가능성 증가, 추적 가능성 증가다.

첫 journey는 준비된 동작 선택, 쉬운 말로 된 요구사항 검토, 농장/설치 사실 확인,
적용, 구체적 승인 결과 또는 구체적 blocker 수신, 같은 incident를 열어 기술 증거
확인이다. 농부의 어떤 단계도 import나 graph를 요구하지 않는다.

## 조사한 revision의 증거

- `compileSource`는 하나의 canonical `.ghost.md` literate 문서를 받고 source identity를
  보존한다. 따라서 제품 조합과 imported source provenance는 제안이며 현재 compiler
  동작이 아니다. [`tools/compile-source.mjs`](../../tools/compile-source.mjs) 참조.
- interaction 계약은 정적 descriptor와 완료된 runtime observation을 정의한다.
  정확한 schema, module, source, run join을 요구한다. `stale`은 검증하는 consumer가
  도출한다. 현재는 읽기 전용 `state`와 `timer` descriptor만 허용한다.
  [`contracts/interaction-v0/README.md`](../../contracts/interaction-v0/README.md) 참조.
- integration 계약은 source/module/device/profile/installation identity를 구분한다.
  host 통과는 하드웨어나 물리 성공을 확립하지 않는다. 증거 부재는 unknown으로 남는다.
  [`contracts/integration-v1/README.md`](../../contracts/integration-v1/README.md) 참조.
- local composition 요약은 참여자별 view를 가진 하나의 event를 제안한다. 설계 권고이며
  구현된 동작이 아니다. frontend, API, Device는 [`AGENTS.md`](../../AGENTS.md)에 명시된
  소유자로 남는다.

## 표와 예

“현재 노력” cell은 명시적인 가상 workflow다. walkthrough는 수작업 분석이며 실행이나
참여자 증거가 아니다.

| 시나리오 | 참여자 | Trigger | 현재 노력 / 가설 | 필요한 사용자 결정 | 제안된 표시 답변 | 뒷받침하는 증거 | 성공 측정 |
|---|---|---|---|---|---|---|---|
| 관수 적용 | 농부 | 준비된 관수 동작을 적용하려 함 | 가설: 기술 요구사항을 읽고 suitability나 binding이 불명확하면 엔지니어에게 질문 | 현장, 수원, 필요한 설치 사실 확인 | “여기에 관수를 적용할 수 있습니다.” 필요한 사실, 확인된 binding, revision 표시 | Source/module identity, typed logical binding, installation identity | 설정 단계, 기술적 결정, 정정, 도움 요청 기록. 농부가 확인된 사항을 말할 수 있음 |
| 환기 추가 | 농부, 설치자 | 관수 이후 4팬 환기 동작 추가 | 가설: 기존 관수 배선이 변경될지 수동 확인 | 팬 수, 이용 가능한 출력, 물리 설치 사실 확인 | “환기는 호환됩니다.” 또는 이름 있는 unknown/blocker. 기존 관수 binding 보존 표시 | Integration binding, 정확한 profile/installation revision, 제안된 composition 호환성 결과 | 설명 없는 rebinding 없음. 사용자가 필요한 각 결정과 unknown을 식별 |
| Pump 소유권 충돌 거부 | 농부, 소프트웨어 엔지니어 | 두 동작 instance가 하나의 pump의 배타적 소유권 주장 | 가설: 충돌이 늦게 발견되거나 엔지니어 log에만 설명됨 | 한 소유자 선택 또는 충돌 동작 제거/변경 | “적용할 수 없습니다. 동작 A와 동작 B가 pump X의 소유권을 주장합니다.” 두 logical port identity 표시 | 선언된 output/port identity, 제안된 첫 profile 배타적 소유권 규칙 | deployment 전 충돌 거부. 두 사용자 모두 충돌하는 주장을 식별 |
| 저수위 차단 설명 | 농부, 소프트웨어 엔지니어 | Pump ON 요청 중 `low_water=true` | 가설: 농부는 “관수가 시작되지 않음”만 보고 엔지니어는 input과 rule을 별도로 재구성 | 농부는 탱크나 저수위 설치 확인. 엔지니어는 정확한 run과 rule 검증 | 농부: “저수위 신호가 관수를 차단했습니다. 탱크를 확인하세요.” 엔지니어: 같은 incident가 `low_water`, constraint, requested output, safe output, run에 연결됨 | 완료된 scan identity, input/constraint provenance, requested와 resolved safe output 구분 | 농부는 탱크가 비었다고 주장하지 않고 signal과 다음 행동을 명시. 엔지니어는 뒷받침하는 input과 constraint에 도달 |
| 명령 실패 또는 feedback 부재 조사 | 농부, 소프트웨어 엔지니어, 설치자 | 명령은 발행됐으나 driver 적용 실패 또는 feedback 부재 | 가설: 명령, 장치 실패, 물리 결과가 혼동됨 | 엔지니어/설치자가 이용 가능한 증거를 식별하고 없는 관측 요청 | “명령을 요청했으나 적용에 실패했습니다.” 또는 “명령 결과 불명: feedback이 없습니다.” 마지막으로 알려진 identity와 gap 표시 | Integration run gate, 이용 가능할 때 device observation. 물리 증거는 별도 유지 | 진단 노력과 증거 탐색 노력 감소. 근거 없는 물리 성공 주장 없음 |

### 측정 sheet

같은 fixture를 사용하는 다섯 시나리오의 scripted walkthrough로 수집한 뒤 농부, 동작
작성자, 설치자와 진행자가 있는 session을 수행한다. timestamp, actor, scenario, source
revision, installation revision과 각 답변이 휴리스틱 walkthrough에서 왔는지 실제
참여자에게서 왔는지 기록한다. 이 증거 종류를 합쳐 집계하지 않는다.

| 측정 | 수집 방법 | Baseline 상태 | 바라는 해석 |
|---|---|---|---|
| 설정 단계 | 동작 선택부터 적용/거부 결과까지 순서 있는 행동 수 집계 | 미측정. 첫 휴리스틱 walkthrough에서 집계 | 필요한 농장 결정을 숨기지 않으면서 단계 감소 |
| 기술적 결정 | type, port, dependency, ownership, revision 지식이 필요한 결정 수 집계 | 미측정. 휴리스틱 집계부터 수행 | 농부는 필요한 선택만 보고 엔지니어는 정확한 선택 유지 |
| 정정 | 유효한 결과 전 잘못되거나 변경된 binding, settings, 선택 수 집계 | 미측정 | 구체적인 조기 feedback으로 재작업 감소 |
| 도움 요청 | 엔지니어/설치자 도움 요청 수와 이유 집계 | 미측정 | 요청 범위가 좁아지고 증거에 연결됨 |
| 설명 정확성 | 참여자가 blocker, 영향, 다음 행동을 자기 말로 설명하도록 요청. 뒷받침하는 증거를 기준으로 채점 | 참여자 증거 없음. 휴리스틱 정답 기준만 있음 | signal을 넘는 추론 없음. 저수위 답변은 탱크가 비었다고 말해서는 안 됨 |
| 증거 탐색 노력 | source, input, constraint, run, binding, 이용 가능한 feedback에 도달하는 화면/기록 수와 경과 시간 집계 | 미측정. 수작업 경로만 있음 | 같은 incident가 농부와 엔지니어 view에 사용됨 |
| 미해결 사례 | unknown/missing/stale 증거 사례와 소유자 명시 여부 집계 | 미측정 | unknown이 pass나 성공이 되지 않고 계속 드러남 |

### 서면 walkthrough와 자동화 경계

1. **관수 적용:** descriptor와 binding 검사를 자동화한다. 농장/현장 적합성과 수원 확인에는
   농장 지식이 필요하다.
2. **환기 추가:** composition 계약이 생기면 type/capacity와 보존 검사를 자동화한다.
   팬 배치와 물리 용량에는 설치자 지식이 필요하다. 현재 4팬 결과는 제안된 fixture이며
   테스트 결과가 아니다.
3. **소유권 충돌:** 배타적 logical 소유자 두 개의 탐지와 거부를 자동화한다. 원하는 소유자
   선택은 사람의 결정이다.
4. **저수위:** 완료된 scan과 input, constraint, requested output, safe output, run의 join을
   자동화한다. 탱크 확인과 운영 대응 결정에는 농장 지식이 필요하다. 불변 답변은
   **“저수위 신호가 관수를 차단했습니다. 탱크를 확인하세요.”**다. 이 signal은 탱크가
   비었다는 증거가 아니다.
5. **명령 실패/feedback 부재:** 증거가 있을 때 identity join과 requested, applied, observed
   상태 구분을 자동화한다. 배선 확인, 재시도 또는 설치자 호출 중 무엇을 할지는
   사람/설치 지식이다. feedback 부재는 unknown으로 남는다.

이후 참여자 검증을 위한 미답 질문이며 인터뷰 결과가 아니다.

1. 농부가 compiler 용어를 이해하지 않고 적합성을 결정하게 하는 최소 요구사항 표현은
   무엇인가? 소유자: frontend/product. 농부 session으로 검증.
2. 소프트웨어 엔지니어와 설치자가 이해하면서 가장 빨리 탐색할 수 있는 증거 순서는
   무엇인가? 소유자: frontend/API. usability와 진단 session으로 검증.
3. 실제 설치에서 이용 가능한 명령 적용/물리 feedback 상태는 무엇이며 누가 각각을
   기록하는가? 소유자: API/Device. commissioning 증거 검토로 검증.

## 권고

다섯 시나리오의 journey와 측정 sheet를 composition 연구의 acceptance protocol로 채택한다.
참여자 표현을 기존 계약이 표현하는 정확한 source/module/instance/run과 installation
identity에 연결하는 작은 결과 기록을 우선한다. interaction과 integration identity 규칙을
재사용한다. 이 이슈에서는 graph editor, telemetry pipeline이나 새 저장 시스템을 추가하지
않는다.

구현을 향한 첫 요구사항은 구체적인 blocker 또는 승인 결과를 가진 농부용 읽기 쉬운 결과와
같은 event의 엔지니어 view여야 한다. explanation과 event 의미는 #88/#74에 남는다.
물리 관측은 Device 소유로 남는다. 없는 command/explanation descriptor는 미해결 계약
작업이며 현재 존재한다는 증거가 아니다.

## 미해결 질문과 소유자

- #70 / interaction 소유자: 정확한 join을 유지하면서 command, input, event, explanation
  descriptor가 interaction-v0를 확장하는지와 그 방법.
- #88 / explanation 소유자와 #74 / event 소유자: requested output, safe output, 적용 결과,
  feedback 부재의 canonical incident field.
- API/Device 소유자: installation/application/physical 증거의 retention과 transport.
  언어 저장소가 이를 조용히 선택해서는 안 된다.

## 검증

- 다섯 행을 acceptance 기준과 대조했다. 각 행에 참여자, 부담, 표시 결과, 증거 출처가
  있다. 어느 행도 import나 graph를 요구하지 않는다.
- 측정 sheet를 점검했다. 모든 baseline은 명시적으로 미측정이거나 휴리스틱이다.
  성공 비율, 인터뷰 결과 또는 runtime/물리 테스트를 주장하지 않는다.
- 서면 walkthrough를 점검했다. 자동화와 농장/설치 지식을 구분한다. 이후 검증 질문은
  정확히 세 개다. 모든 capability는 노력, 설명 또는 추적 가능성에 대응한다.
- Commit `ffdbc96461eca67908252507fb851fa4dabd9a2c`를 조사했다. Runtime 테스트는
  실행하지 않았다. 이 문서는 권고와 수작업 분석이며 실행 증거가 아니다.
- 이 파일이 공유 worktree에 나타난 뒤 `git diff --check`와 상대 link 검토는 coordinator의
  필수 인계 검사다.
