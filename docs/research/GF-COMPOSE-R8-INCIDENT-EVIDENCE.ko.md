<!-- translation-source: docs/research/GF-COMPOSE-R8-INCIDENT-EVIDENCE.md -->
[영어 원문](GF-COMPOSE-R8-INCIDENT-EVIDENCE.md)

# GF-COMPOSE R8: incident 증거 조합

상위 항목: [#99](https://github.com/callin2/ghostflow-language/issues/99)\
이슈: [#107](https://github.com/callin2/ghostflow-language/issues/107)\
상태: 범위가 한정된 연구/설계. 구현 또는 물리 device 테스트를 주장하지 않는다.

## 사용자 문제

농부가 “왜 관수가 이뤄지지 않았나요?”라고 물을 때 답변은 엔지니어와 설치자가 조사하는
것과 같은 occurrence를 식별해야 한다. requested output, 언어 runtime이 선택한 safe output,
host/driver 적용 결과, 물리 관측을 구분해야 한다. 값 부재는 false가 아니다. 이전 run이나
binding을 현재 incident에 join해서는 안 된다.

composition에 특유한 목표는 작고 정확한 증거 인계다. 두 번째 실행 source, 새 event 저장소,
전체 raw scan logging 또는 재구성된 crash 사실을 만들지 않는다. 제안된 join에는
input-event-to-rule-to-intent 설명과 각 평가를 지배하는 settings revision/effective position이
포함된다. 설계 join이며 현재 telemetry 주장이 아니다.

## 조사한 revision의 증거

조사한 언어 revision은 `ffdbc96461eca67908252507fb851fa4dabd9a2c`다. interaction 계약은
정확한 schema, module, source, `runId` join을 요구한다. `scanId`는 run 안에서만 순서가
있다. 완료 observation은 `ready`, `unavailable`, `error`를 명시적으로 사용한다.
`stale`은 검증 consumer가 도출하고 producer가 주장하지 않는다.
[`contracts/interaction-v0/README.md`](../../contracts/interaction-v0/README.md)와
[`tools/interaction-runtime-snapshot.mjs`](../../tools/interaction-runtime-snapshot.mjs) 참조.

source-safety 계약은 compiler provenance, requested/safe output, constraint observation,
source/document digest를 기록한다. 전기/기계 동작을 추론하지 않는다고 명시한다.
[`docs/SOURCE-SAFETY-TRACE.md`](../SOURCE-SAFETY-TRACE.md) 참조.

framed host는 완전한 input frame을 포착하고 한 번 dispatch하며 마지막 승인 결과를 게시한다.
conditioning/dispatch 실패 후 fault를 latch한다. 그 fault 이후 새 host instance가 필요하다.
[`docs/FRAMED-CONTROL-HOST.md`](../FRAMED-CONTROL-HOST.md) 참조.

R1은 농부가 읽을 수 있는 blocker 하나와 같은 source/module/instance/run 및 installation
identity의 엔지니어 view를 권고한다. R2는 canonical `.ghost.md`가 실행 권한으로 남고 memory
#68은 provenance/작성 문맥이며 직접 실행 규칙이나 binding 권한이 아님을 확립한다. R3는
재시작이 새 `runId`를 만든다는 것과 정확한 composed fault fan-out이 미해결임을 확립한다.
별도로 사용자 합의 설계 수정은 재시작이 GhostFlow 논리가 반응을 작성하는 일반 event라는
것이다. 전역 resume/manual 정책을 정의하지 않는다. runtime 이전 전기적 startup,
disconnect, failure 의무는 Device/Driver 책임으로 남는다. 이 event 반응 규칙은 설계이며
현재 runtime 증거가 아니다.

Device 이슈 [#28](https://github.com/callin2/farm-device/issues/28)은 약 7일을 목표로 하는
device-local bounded append-oriented flash journal을 RAM recent history와 별도로 제안한다.
제안은 reboot/power-loss 복구, monotonic event identity(`deviceId`, `eventSequence`, `bootId`,
선택적 `runId`/`scanId`), time quality, program/settings/runtime identity, pagination,
명시적 복구/data-loss 알림을 명시한다. output request/safe/applied 변경, command, fault,
safety trip, program/settings 변경, reboot의 event 종류도 제안한다. 이슈/설계 증거이며
구현된 언어 또는 Device runtime 증거가 아니다. 정확한 versioned event schema, physical-feedback
field, 최종 boot/event-to-run join은 미정이다. 필요한 join 또는 unknown 증거로 표시하며
이용 불가능한 source 자료로 표시하지 않는다. input occurrence/value 관측 coalescing은
영속 incident-retention 약속이 아니다.

## 표와 예

### 필수 incident join

| 증거 경계 | Producer | 필수 join | 가용성 / 불일치 처리 |
|---|---|---|---|
| Definition revision | API/source 저장소와 language compiler | `documentId`, `revisionId`, source SHA, module fingerprint/bytecode SHA | Source 설명에 필수. identity 부재/차이는 stale/error이며 최선 노력 label join이 아님. |
| 동작 instance | API composition/deployment | Definition revision에 join된 제안 opaque `instanceId` | 현재 v0에 instance field 없음. 없으면 composition 범위 미해결. 같은 정의의 instance를 합치지 않음. |
| Program/settings | 실행 default는 canonical source. settings event는 API/runtime | Program revision과 settings revision/digest, effective event position, scope | Live property event는 program/run identity 보존. 각 평가/intent를 effective settings revision에 join. settings 부재는 unknown이며 source default를 조용히 대입하지 않음. |
| Installation/binding | API installation 문맥과 Device profile | Installation/binding revision, logical port, physical endpoint/profile identity | 대상 설비 주장에 필수. 잘못되거나 이전 binding은 join 거부. physical endpoint는 logical port identity가 아님. |
| Run / scan | Framed host/runtime | `runId`, 완료 `scanId`, logical time, schema/module/source identity | `scanId` 단독은 invalid. 실제 재시작은 새 run을 만들고 이전 scan 0에 join하면 안 됨. live property event는 새 run을 만들지 않음. 완료 부재는 완료 scan 주장 불가. |
| Device boot/event sequence | #28의 Device persistent historian 제안. 최종 producer/schema 미해결 | 제안된 monotonic device event identity, boot identity, event sequence, 같은 run/binding 연결 | 제안은 reboot 복구/명시적 data-loss 알림을 지원하지만 정확한 field/physical feedback 미해결. 마지막 기록 event와 gap 보고. 최종 scan 합성 금지. 모든 runtime input 관측의 durable retention 추론 금지. |
| Logical time | Host/runtime 완료. 별도 기록할 때만 Device clock | 정확한 `logicalTimeMs`와 device timestamp/clock identity | Host logical time은 wall-clock/physical occurrence 증거가 아님. clock 불일치는 표시할 불확실성이며 추론으로 복구하지 않음. |
| Source/constraint 참조 | Compiler source map/safety trace. 설치 constraint는 constraint 소유자 | Source node/intent anchor, constraint index/kind, first violation/final result, 정확한 incident 문맥 | Static dependency 읽기는 executed-cause 증거가 아님. 미해결 installation constraint artifact/경계는 소유자 결정으로 유지. |

정확한 참여자 문맥은 definition/module, instance, 같은 run의 settings revision/effective
event position, installation/binding, run/scan, logical time의 tuple이다. 제안된 인과 증거는
input event/관측 → 평가된 rule → intent → requested/safe output → driver 결과/물리 관측이며
평가 시 effective settings에 join한다. 모든 참여자 view는 그 tuple을 사용해야 한다.
consumer는 이전 run, 잘못된 schema/module/source 또는 binding을 stale/unavailable로 거부해야
하며 관련 기록을 조용히 제시해서는 안 된다.

### 단계 분리와 소유권/빈틈

| 단계 / 증거 | 소유자 | 현재 지원 | Composition 빈틈 |
|---|---|---|---|
| Requested output | Rust core trace, language source map | 기존 `requested` map/provenance | instance와 정확한 완료 scan에 join. |
| Safe output | Rust safety resolution | 기존 `safe` map/bounded safety trace | request와 구분하고 constraint 참조 노출. |
| Host/driver 적용 | API/host와 Device integration | interaction-v0가 정의하지 않음. host fault는 물리 failure가 아님 | #74/#88이 application-result event/부재 의미 정의 필요. Driver source/intent는 정밀 측정, protocol, raw ISR/scan mechanism을 처리하고 농장 정책을 숨기지 않으며 의미 있는 typed event/측정 노출. 포착/수신/평가 시각과 품질 구분. command acknowledgement는 물리 증거가 아님. |
| 물리 관측 | Device/installation 소유자 | #28은 persistent event history를 제안하고 HIL physical-relay 증거를 참조하지만 최종 feedback schema를 결정하지 않음 | #28이 가용 feedback, boot/history identity, retention 정의 필요. 기록된 applied event도 물리 동작 증명이 아님. |
| Memory/작성 문맥 | API/system #68 | Provenance 문맥만 해당 | 승인 decision/source 경로 없이 execution/binding join이 되어서는 안 됨. |
| Input occurrence/value 관측 | 여기서 미구현. 합의된 설계. interrupt/scan 기반 포착 가능 | 구분된 포착/수신/평가 시각과 품질을 가진 occurrence identity 또는 관측값 | Ingress record/event-to-tick 대응 정의. 지원 용량 안에서 기본 보존. 입력별 명시 opt-in에만 latest-pending-value 교체. overflow/loss 보고 필수. 순서/대응 미정. 무제한 durable history 아님. |

### 짝지은 walkthrough (수작업이며 실행 증거 아님)

#### 1. 저수위로 관수 차단

농부 답변과 다음 행동: “저수위 신호가 관수를 차단했습니다. 탱크나 설치 센서를 확인하세요.”
탱크가 비었다고 말해서는 안 된다. 소프트웨어 증거는 같은 완료 run/scan, 입력
`low_water=true`, requested pump `ON`, safe pump `OFF`, 위반 constraint, source/anchor 참조를
보여준다. hardware 증거는 이용 가능한 sensor/installation record뿐이다. 남은 불확실성:
signal은 물리 탱크 수위나 sensor 정확성을 증명하지 않는다.

#### 2. Driver 적용 실패 또는 feedback 부재

농부 답변과 다음 행동: 실패가 기록됐다면 “시스템이 관수를 요청했지만 장치 적용에
실패했습니다.” 그렇지 않으면 “물리 feedback이 없어 명령 결과를 알 수 없습니다.”
다음 행동은 installation/driver 경로 검사 또는 설치자 연락이다. software 증거는 같은
run/scan, requested output, safe output, 존재할 때 host/driver 결과를 보여준다. hardware
증거는 Device가 기록했을 때만 binding, driver event, physical feedback을 보여준다.
남은 불확실성: `requested=ON`이나 `safe=ON`은 pump 운전의 증거가 아니다.

#### 3. Journal gap을 동반한 crash/reboot

농부 답변과 다음 행동: “마지막 기록된 관수 event는 [event]입니다. 다음 결과가 기록되기
전에 시스템이 재부팅됐습니다.” 다음 행동은 device를 검사하고 기존 운영 절차 아래에서만
재시도하는 것이다. software 증거는 마지막 완료 run/scan, logical time, 마지막
requested/safe 결과, host fault/new-run 경계를 보여준다. hardware 증거는 Device history가
제공할 때 마지막 boot/event record와 명시적 missing interval을 보여준다. 남은 불확실성:
없는 최종 scan/physical state는 unknown으로 남아야 한다. crash 원인이나 output을 재구성하지 않는다.

## 권고

농부, software, hardware view에서 변경 없이 재사용하는 하나의 incident 문맥을 채택한다.
최소 composition 추가는 새 저장소 대신 identity join/projection 규칙으로 한다.
definition/module + instance + settings revision/effective event position + installation/binding
+ run/scan + logical time과 source/constraint 연결이다. requested output, safe output,
application result, physical observation을 별도로 명명한 네 단계로 유지한다. 검증에서 stale을
도출하고 run/module/source/schema/binding identity 불일치를 거부한다.

저수위 불변조건에는 requested `ON`, safe `OFF`, `low_water=true`, constraint 참조를 보여준다.
적용 실패/feedback 부재에는 기록된 application 상태 또는 명시적 unknown을 보여준다.
reboot에서는 재시작을 일반 event로 취급하고 GhostFlow 작성 반응을 새 run에 join한다.
전역 resume/manual 정책을 강요하지 않는다. Device/Driver는 runtime 이전 전기적 startup,
disconnect, failure 의무를 별도로 소유한다. 마지막 기록 event와 journal gap을 보여준다.
전체 scan retention을 요구하거나 #28이 기록하지 않은 사실을 만들어 내지 않는다.

## 미해결 질문과 소유자

- **#74/#88 event/explanation 소유자:** canonical application result, physical-feedback 부재,
  incident 문맥, 농부 문구 field 정의. command/application/observation을 하나의 status로
  합치지 않는다.
- **Device #28 소유자:** persistent-history identity/retention 계약 확정. boot/session ID,
  event sequence, binding 연결, physical feedback, journal-gap 표현 포함. #28은 이를
  제안하지만 정확한 versioned event schema/최종 프로젝트 간 join은 열린 결정으로 남긴다.
- **API/deployment/runtime 소유자:** live event, 재시작, redeployment에 걸친 `instanceId`,
  settings revision/digest/effective-position join, installation/binding revision lifecycle 정의.
  정확한 전달/순서/durability mechanism은 설계 빈틈으로 남는다.
- **Language/runtime 계약 소유자:** v0 `runId`/`scanId` 의미를 보존하며 향후 instance 한정
  incident 표현 정의.
- **Installation/system 소유자와 language/API 소유자:** R2의 미해결 installation constraint
  경계 선택. memory #68은 확인된 결정에 provenance를 제공할 수 있지만 execution/binding을
  직접 승인할 수 없다.

## 검증

- [x] Join 표가 definition revision, instance, program/settings, installation/binding,
  run/scan, device sequence, logical time, source/constraint 참조를 다룸.
  producer, 필수 상태, 불일치 처리 포함.
- [x] 세 walkthrough가 농부 답변/다음 행동, software 증거, hardware 증거, 남은 불확실성을
  제공. command는 물리 결과가 아니며 없는 값은 false가 아님.
- [x] Requested/safe/application/physical 단계 분리 유지. 이전 run/binding 및 journal-gap
  사례 명시.
- [x] 조사한 code/계약의 주장과 제안, 미해결 소유자 결정, 수작업 예를 구분.
  runtime/physical 테스트 실행/주장 없음. native/WASM 적합성은 제안 acceptance만 해당.
- [x] 조사한 revision 기록: `ffdbc96461eca67908252507fb851fa4dabd9a2c`.
  R1–R3 및 #89/#90 이슈 기록은 설계 증거로 검토. Device #28은 제안 증거이며 구현 증거
  아님. 정확한 event schema는 미해결 유지.

Runtime/physical 검증을 수행하지 않았다. native/WASM 적합성, diff 위생, 상대 link 검사는
구현/설계 소유자의 acceptance 책임으로 남는다. 여기서 완료했다고 주장하지 않는다.
