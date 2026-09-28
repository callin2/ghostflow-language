<!-- translation-source: docs/research/GF-COMPOSE-R6-OVERRIDES.md -->
[영어 원문](GF-COMPOSE-R6-OVERRIDES.md)

# GF-COMPOSE R6: override와 lifecycle identity

## 사용자 문제

관수 시간을 바꾸는 농부가 실수로 배선이나 program 논리를 바꿔서는 안 된다. 엔지니어는
run에 영향을 준 정확한 source, settings, installation, deployment 문맥을 식별해야 한다.
이 문서는 범위가 한정된 identity/검증 설계를 정의한다. overlay, live mutation 또는 새
deployment format을 구현하지 않는다.

## 조사한 revision의 증거

증거는 working-tree `HEAD`인 `ffdbc96461eca67908252507fb851fa4dabd9a2c`에서 조사했다.
갱신된 R2 의존성 초안도 읽었다. source revision과 동작 instance의 확정된 구분을 여기서
보존한다. 대화 memory는 provenance/작성 문맥이며 자동 실행 규칙이나 physical binding
권한이 아니다. R2의 미해결 installation constraint 경계를 이 문서가 선택하거나 해결하지 않는다.

`tools/compile-source.mjs`는 하나의 canonical `.ghost.md` source를 받고 source UTF-8
SHA-256을 기록한다. compiler output은 manifest/module provenance를 포함한다. 현재
compiler는 일반 composition/override identity를 노출하지 않는다. `tools/control.mjs`는
config literal, operator metadata, range, `apply: stopped`를 검증하고 descriptor를 lowering한다.
settings overlay protocol을 구현하지 않는다.

`tools/operating-settings.mjs`의 `createOperatingSettingsCandidate`는 기대 source hash를
검사하고 선언된 config literal span만 편집한 뒤 후보를 재컴파일한다. 따라서 현재 동작은
source/compiled identity를 바꾼다. 별도 source-edit workflow이며 live settings 경로가 아니다.
사용자 승인 설계 수정은 operator property 변경이 같은 program/run의 live event라는 것이다.
하나의 다중 property 동작은 하나의 atomic event다. 모든 값을 검증하고 하나라도 invalid이면
변경 없이 전체 event를 거부한다. 그렇지 않으면 effective event position에 적용한다.
활성 논리는 기존 규칙에 따라 반응할 수 있다. program/source/bytecode/run identity는 바뀌지
않고 settings revision/effective position이 바뀐다. 실제 ESP 재시작 후에도 승인 settings는
유지되지만 재시작은 새 run identity를 만든다. 정확한 durability/failure 순서는 미해결이다.
소유자 제안은 2026-09-20에 조사한 [#89 Runtime Settings Overlay](https://github.com/callin2/ghostflow-language/issues/89)와
[#90 Periodic Schedule](https://github.com/callin2/ghostflow-language/issues/90)이다.
제안 증거이며 구현 증거가 아니다.

이 승인된 live-event 계약은 [CONSTRAINTS](../CONSTRAINTS.md) 179–204행,
[LANGUAGE-SURFACE](../LANGUAGE-SURFACE.md) 66–69행,
[LANGUAGE](../LANGUAGE.md) 460–461행과 이전 #89 제안에 문서화된 `apply: stopped` 동작과
충돌한다. 해당 문서는 이전 계약으로 남아 정합성 조정이 필요하다. 현재 live runtime 지원을
확립하지 않는다. property 갱신은 재package/재컴파일하거나 program/firmware 갱신에 필요한
전체 controller maintenance stop을 발생시키지 않는다.

portable package는 source, 생성 manifest, 실행 호환성, `bindingRevision`을 payload digest와
signature로 결속한다. interaction v0 계약은 schema, source document/revision/SHA, module
identity, `runId`를 join한다. `scanId`는 run 내부에서만 순서가 있다. stale join은 validator가
도출하며 snapshot이 자체 선언하지 않는다.

## 표와 예

### 변경 matrix

| 변경 | Source/composition revision | Compiled program bytes/hash | Settings revision | Installation revision | Deployment package | Run identity | 검증/적용 시점 |
|---|---|---|---|---|---|---|---|
| Import parameter | 실행 specialization이 바뀌면 새 source/composition revision | 재컴파일. bytes/hash 변경 가능 | runtime setting 아님 | 호환될 때만 기존 설치 사용 | 새 package/signature 결정. format 불변 | deployment 후 새 run | Compile/import 검증. package 선택/deployment 때 적용 |
| Operator setting event | 같은 source/composition revision | program bytes/hash 불변. source-edit helper는 별개 유지 | 새 settings revision/digest와 effective event position | host 정책이 달리 정하지 않으면 installation revision 불변 | 자동 재package 없음. authenticity 보존. settings/signature 연결 미해결 | 같은 program/run. event 처리 시 live 영향 | 전체 event atomic 검증. invalid event는 변경 없음. durability 순서 미해결 |
| Dependency 교체 | 정확한 dependency revision으로 고정된 새 composition revision | 보통 재컴파일. hash 기록 필수 | default/settings가 다르면 새 settings join | Capability/binding 재검증 | 새 package/signature 결정 | 새 run | deployment 전 import closure/호환성 검증 |
| Physical binding RO3→RO8 | Source/composition revision 불변 | bytes/hash 불변 | settings revision 불변 | 새 binding revision/digest | 새 package/application record. signature format 불변 | 새 run 또는 명시적 deployment epoch | Device/API가 logical capability 검증 후 binding 적용. 물리 증거 소유자는 Device 유지 |

상태: 위 source 컴파일, literal 후보 검사, package identity, interaction join만 현재 증거다.
same-program overlay, dependency 교체 lifecycle, binding 적용 결과는 제안 또는 미해결 소유자
계약이다.

### 풀이 예

이는 수작업 identity 예이며 실행 증거가 아니다.

1. **관수 10m → 5m.** source default 편집은 source revision/source SHA 변경이며 compiled
bytes/hash도 바꿀 수 있다. operator settings event가 아니다. 대신 유효한 live property event는
Program P bytes, program identity, 현재 run identity를 보존한다. 새 settings revision/effective
position을 만든다. 예를 들어 규칙으로 제어되는 관수 구간이 활성인 동안 `duration`을
`10min`에서 `5min`으로 바꾸는 atomic event가 처리 시 적용된다. 기존 규칙은 그 effective
setting으로 평가하고 새로 계산된 시각에 OFF를 요청할 수 있다. source rewrite, 재컴파일,
새 package, 새 run은 발생하지 않는다. 같은 동작이 invalid property도 제공하면 전체 batch를
거부하고 이전 effective 값을 모두 유지한다. 정확한 durable acknowledgement 순서와
settings/authenticity 연결은 미정이다.

2. **Optional RainSensor가 존재하게 됨.** 부재 dependency를 고정 RainSensor definition으로
교체하면 composition/dependency revision과 보통 compiled program bytes/hash가 바뀐다.
capability/binding 검증, 새 deployment package 결정, 새 run이 필요하다. 부재가 유효한
compiled branch인지 source variant 두 개가 필요한지는 미해결이며 composition/API 소유자
책임이다. 이 문서는 추론하지 않는다.

3. **Pump binding RO3 → RO8.** logical output identity/program bytes/hash는 불변이다.
installation binding revision/digest가 바뀌고 package/application record는 그 변경을 인정해야
한다. 새 run은 새 binding revision에 join해야 한다. Device 증거가 applied endpoint를
입증해야 한다. 이 언어 저장소는 RO8이 물리적으로 작동했다고 주장할 수 없다.

### 거부와 stale join 예

- 문자열로 제공된 Duration, nonfinite 값, 선언 min/max/step 밖의 값은 변경 전에 전체
  property event를 invalid로 만든다. 현재 helper 증거는 source 후보 검사를 다룬다.
  live event 검증은 제안된 acceptance 요구사항이며 구현 증거가 아니다.
- 이전 source/program identity를 가진 settings는 stale로 거부한다. settings revision은 다른
  source revision, module fingerprint, bytecode digest에 붙일 수 없다. 정확한 settings wire
  record는 미해결이다.
- 이전 run의 snapshot은 `scanId`가 새 run의 `scanId=0`과 같아도 interaction join이 거부한다.
  schema/source/module/run identity는 기대 값과 일치해야 한다. `stale`은 validator output이다.

## 조정이 필요한 현재 명세 충돌

승인된 live-event 설계는 현재 [CONSTRAINTS](../CONSTRAINTS.md)의 “Stopped settings apply
behavior” 절, [LANGUAGE-SURFACE](../LANGUAGE-SURFACE.md) 66–69행,
[LANGUAGE](../LANGUAGE.md) 460–461행에 문서화된 이전 stopped-Configure 동작을 대체한다.
그렇다고 해당 규범 문서가 변경된 것은 아니며 현재 runtime 지원을 주장하지 않는다.
이전 [#89 제안](https://github.com/callin2/ghostflow-language/issues/89)도 stopped/new-run
적용을 명세한다. 그 계약/규범 문서를 승인 수정과 조정한다. 이 설계 기록을 live mechanism
존재의 증거로 취급하지 않는다.

live runtime settings는 사용자 승인 설계이며 구현된 capability가 아니다. 이전
stopped-Configure 계약과 #89 stopped/new-run 제안을 조정해야 한다. mechanism/ABI,
durability 순서, 검증, 규범 명세 정합성은 미정이다. #90 parameterized schedule은 소유자
제안으로 남는다. dependency 교체/physical 적용은 그 이슈나 이 연구로 확립되지 않는다.
memory 유래 변경은 확인된 결정과 source/settings/installation revision을 거쳐 연결돼야 한다.
stale 또는 superseded memory가 활성 settings를 조용히 갱신해서는 안 된다.

## 권고

source/composition revision, compiled program identity, settings revision/effective position,
installation/binding revision, deployment package identity, run identity를 분리한 typed
settings-event record를 사용한다. import specialization은 새 program 생성으로 취급한다.
승인된 operator property 변경은 같은 program/run의 atomic live event로 취급한다.
source 편집/재컴파일과 전체 controller program/firmware maintenance stop을 property event
적용과 분리한다. 해당 경계에서 join을 검증하고 검증 중 stale 상태를 도출한다.

여기서 새 package format, ABI, runtime, 저장 engine, canonical 권한을 선택하지 않는다.
R2의 미해결 installation constraint 경계를 보존한다.

## 미해결 질문과 소유자

- [#89](https://github.com/callin2/ghostflow-language/issues/89) API/runtime 소유자: settings
  event record, digest/revision/effective position, mechanism/ABI, package-authenticity join,
  정확한 persistence/acknowledgement failure 순서 정의. live same-run 동작은 승인됐다.
  사용자 선택 질문으로 다시 열지 않는다.
- [#90](https://github.com/callin2/ghostflow-language/issues/90) 소유자: parameterized schedule
  identity와 schedule parameter가 source specialization인지 runtime settings인지 정의.
- Composition/API 소유자: 부재/존재 RainSensor 동작을 포함한 dependency 교체/optional
  dependency 의미 정의.
- Device/API 소유자: binding 적용 증거/deployment epoch 정의. package digest에서 물리 성공을
  추론하지 않는다.
- System/installation 소유자와 language/API 소유자: R2의 별도 constraint artifact와 명시적
  프로젝트 간 경계 revision 선택 해결. 미해결이며 여기서 선택한 override mechanism이 아니다.
- API/시스템 운영 memory 소유자: memory 유래 변경의 lineage/decision 연결,
  retention/export/delete 동작, 삭제가 provenance tombstone/digest를 남기는지 정의.
  R2 질문으로 남으며 memory에 권한 부여나 R6 settings 구현이 아니다.
- 계약 소유자: 기존 `runId` 대체나 `scanId` 재정의 없이 instance/settings/binding join을 위해
  interaction identity 확장.

## 검증

- [x] 조사한 revision 기록: `ffdbc96461eca67908252507fb851fa4dabd9a2c`.
- [x] Compiler, control, operating-settings, package, interaction의 필요한 절과 완료된 R2
  의존성 초안을 읽음.
- [x] 네 행 matrix에 요구된 모든 identity/적용 시점 포함. current/proposed/unresolved 상태 명시.
- [x] 예에서 source default, runtime settings, dependency, binding 구분. format 선택 없이
  package signature 영향 인정.
- [x] 거부 예에 invalid 값, stale program settings, 이전 run snapshot 포함. runtime test suite
  실행/주장 없음.

Coordinator acceptance 검사는 `git diff --check`, 상대 link 검토, source 파일 불변 확인이다.
이 문서는 실행/물리 결과 주장을 포함하지 않는다.
