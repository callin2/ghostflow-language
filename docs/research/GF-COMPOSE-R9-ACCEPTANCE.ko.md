<!-- translation-source: docs/research/GF-COMPOSE-R9-ACCEPTANCE.md -->
[영어 원문](GF-COMPOSE-R9-ACCEPTANCE.md)

# GF-COMPOSE R9: acceptance와 구현 인계

상위 항목: [#99](https://github.com/callin2/ghostflow-language/issues/99)
이슈: [#108](https://github.com/callin2/ghostflow-language/issues/108)
상태: 범위가 한정된 연구/설계. composition 실행, device commissioning, 참여자 연구를
주장하지 않는다.
연구 완료는 구현을 승인하지 않는다. 권고와 milestone 인계는 의존 작업 시작 전에
아키텍처 소유자 검토가 필요하다.

## 사용자 문제

첫 composition 작업은 준비된 동작 적용에 필요한 결정을 줄이고 차단/실패 결과를 설명하며
그 설명을 엔지니어 증거에 연결해야 한다. 농부 journey는 적용, 추가, 조사다. 엔지니어
journey는 같은 incident를 정확한 source, instance, binding, run, 가용 device 증거로 보는
것이다. 이는 acceptance 명세이며 측정 결과가 아니다.

## 조사한 revision의 증거

조사한 언어 revision은 `ffdbc96461eca67908252507fb851fa4dabd9a2c`다. R1–R8을 의존성 집합으로
읽었다. 현재 증거에는 하나의 canonical `.ghost.md` compiler 입력,
[`tools/verify-language.mjs`](../../tools/verify-language.mjs)의 명시적 host 테스트 등록,
[`SCAN-TAPE-PARITY.md`](../SCAN-TAPE-PARITY.md)의 native/WASM scan-tape 계약,
[`integration-v1`](../../contracts/integration-v1/README.md)의 독립 host/hardware/physical
증거 규칙이 있다. 기존 검사는 host/conformance 증거일 뿐이다. 아래 테스트/사용자 연구
결과 중 실행됐다고 제시하는 것은 없다.

R1은 노력/설명 측정을 제공한다. R2는 canonical source, definition revision, instance,
logical port, physical binding, settings, run/scan identity를 분리한다. R3는 검토 대상으로
정적 조합을 선호하지만 lowering/ABI 결정을 미정으로 남긴다. 확립된 이전/다음 상태 의미를
보존하며 순서 독립 snapshot을 요구한다. 의미 규칙은 확정됐다. composition lowering이
보존하는 mechanism은 미정이다. R4는 기존 binding을 유지하고 physical DI/명시적 software
input을 구분한다. R5는 첫 profile을 type/dependency/parameter/exclusive-owner 검사로
한정한다. R6는 import parameter, operator settings, dependency 변경, binding 변경을 분리한다.
R7은 고정 source closure를 권고하지만 package 검증 선택은 열린 결정이다. R8은 하나의
incident 문맥을 요구하고 requested/safe/application/physical 단계를 분리한다.

## 표와 예

### Acceptance matrix

예상 결과와 측정은 제안 명세이며 실행 결과나 승인 구현 범위가 아니다. prerequisite는
연구 입력을 식별한다. 아래 decision gate는 의존 구현 작업에 적용한다. “수작업”은 검토된
계약에 따른 추론이며 실행 증거가 아니다.

| 시나리오 | 입력 가정 | 예상 결과/거부 | 증거 연결 | 노력 / 설명 가능성 / 추적 가능성 측정 | 검증 계층 | 책임 소유자 | Prerequisite |
|---|---|---|---|---|---|---|---|
| 유선 관수 + 4팬 환기 | 관수 입력은 유선 DI. compatible RO 7개 존재 | Capacity 제안 승인. 관수 binding 보존. 서로 다른 fan binding 4개 추가 | logical role → profile/binding revision → 제안 | 설정 단계, 불변 binding 설명 가능, role/endpoint 추적 가능 | host fixture 후 API/Device/physical 각각 별도 | language/API, Device가 applied mapping 확인 | R2, R4, R5 |
| Software manual-start composition | Manual start는 명시적 software input. 저수위는 유선 DI | DI 수 1로 승인. software input을 physical DI로 세지 않음 | input kind → capability/profile identity | 잘못된 구성 결정 감소, input kind 표시, binding revision 연결 | host + integration 계약 | language/API, Device가 adapter 소유 | R4, R5 |
| 관수 instance 중복 생성 | 같은 고정 definition. 서로 다른 instance ID | 격리된 state/timer/settings/binding/provenance일 때만 승인 | definition revision → instance → run/scan | 중복 설정 ambiguity 없음, 결과마다 instance 명시, trace 병합 없음 | host composition 적합성 | compiler/runtime + API | R2, R3 |
| 선언 순서 변경 | 같은 instance ID와 input/time tape | 같은 output/binding/trace identity | instance ID + 순서 있는 frame → 결과 | 순서 변경 정정 없음, 설명 안정, replay 결정적 | native/WASM parity 확장 | compiler/runtime | R3, R4 |
| 경쟁하는 직접 output 작성자 | 두 정의가 한 output 채널 대상 | Compile 거부, 배포 가능한 artifact 없음. 기존 단일 작성자 manager가 중재하는 명시 station 요청은 유효 유지 | output 채널 → 정의 → 진단 | deployment 전 거부, 두 정의 식별 | compiler 적합성 제안 | compiler/runtime | 기존 output 고유성/station 계약 |
| 배타적 pump 소유권 | logical 소유자 둘이 하나의 exclusive endpoint 대상 | activation 전 거부. 두 instance/port 주장과 이유 명시 | 주장 → endpoint/binding revision → 진단 | 조기 정정, 농부에게 blocker 하나 표시, 충돌 감사 가능 | host 계약 검증 | language/compiler + API/Device | R4, R5 |
| Invalid/unknown 요구사항 | 잘못된 type, dependency 부재, suitability 불명 | 구체적 불일치 거부. 그 외 unknown 보고. compatible/pass 금지 | manifest/dependency/profile 증거 → 결과 | 뒤늦은 정정 감소, 근거 없는 사실 명시, 불확실성 출처 명명 | host + integration 계약 | compiler/API, suitability는 profile/Device | R2, R4, R5 |
| 저수위 설명 | `low_water=true`, pump ON 요청 | safe output OFF. 농부에게 signal/다음 행동 표시. “탱크가 빔” 아님 | input → source/constraint → requested/safe output → run | 자기 말 설명 정확성, 엔지니어 input/constraint 도달, 정확한 run join | host trace, usability는 이후 | language/runtime + #88/#74 | R1, R3, R8 |
| Application/feedback 실패 | command 발행, 적용 실패 또는 feedback 없음 | 실패 application/명시적 unknown 표시. 물리 성공 주장 금지 | requested/safe → host/driver → 가용 관측 | 진단 탐색, 단계 구분, 없는 증거 표시 | host record, Device/physical 별도 | #74/#88 + Device | R8 |
| Crash, 재시작, journal gap | Runtime 재시작 또는 history interval 부재 | 새 `runId`. 마지막 증거/gap 보존. scan/result 창작 없음 | module/instance/binding → run/scan → boot/event 증거 | 재구성 단계 감소, 재시작 경계 명확, gap 추적 가능 | host 의미 + Device history | runtime/API + Device #28 | R2, R3, R8 |
| Override identity | import parameter, operator setting, dependency, binding 변경 | R6 matrix 적용, stale join 거부, 서로 다른 revision 보존 | source/artifact/settings/binding/package/run identity | 정정 노력, identity 변경 이유 설명 가능, lineage 완전 | host/package/integration gate | API/deployment + compiler/Device | R6 |
| 운전 중 live property event | 하나의 유효 동작이 선언된 runtime 조정 property 여러 개 변경 | 하나의 event로 검증. 처리 시 모든 값 적용. 기존 논리가 다음 cycle 대기 없이 운전 중 output 변경 가능. source revision/hash, program bytes/hash, run identity 불변. settings revision/effective event position 전진 | event → 검증된 전체 property 집합 → settings revision/effective position → 같은 source/program/run → 결과 논리/output | 운전 중 영향 입증, occurrence에 적용된 settings revision 설명 | 제안 native/WASM 적합성, 미실행 | runtime/API 계약 | 사용자 합의 수정, R6/#89 mechanism/ABI |
| Invalid 다중 property event | 한 동작에 유효 값 여러 개와 invalid type/range/step 값 하나 | 전체 event 거부. property 변경 없음. 이전 settings revision/effective position/활성 동작 불변 | 거부 event + 검증 이유, 이전 settings는 같은 program/run에 join 유지 | 전부 거부 입증, invalid 항목 식별 | 제안 native/WASM 적합성, 미실행 | runtime/API 계약 | 사용자 합의 수정, R6/#89 검증 record |
| Live property identity/증거 join | 활성 run 중 유효 event 승인 | 이후 영향 실행 증거가 새 settings revision/effective event position 및 같은 program/run에 join. stale record 재해석/source/bytecode 변경 암시 금지 | source/program hash + `runId` 불변, settings revision/effective position 전진 후 이후 결과 join | replay/설명이 각 event position에 적용된 settings 정확히 식별 | 제안 native/WASM/adapter 적합성, 미실행 | runtime/API 계약 | R6, settings join mechanism 미정 |
| 승인 settings 이후 실제 재시작 | 승인 property 저장, 실제 ESP 재시작, GhostFlow restart event 전달 | property 유지. 새 `runId` 시작. 재시작 반응은 작성 GhostFlow 논리가 결정. 전역 resume/manual 강요 금지. runtime 이전 전기 startup/failure 의무는 Device/Driver 유지 | 이전 settings revision → 재시작 후 저장 settings, 이전 run → 새 run, restart event → 작성 transition/output | 물리 작동 주장 없이 persistence/run 경계/실제 작성 재시작 반응 표시 | 제안 host 적합성, Device 별도, 미실행 | runtime/API, Device/Driver startup 경계 | 사용자 합의 수정, persistence/recovery 순서 미정 |
| Input occurrence/값 전달 | 평가 사이 여러 occurrence와 변화하는 값 관측 도착 | 지원 용량 안에서 각 occurrence/관측 기본 보존. 입력별 명시 opt-in만 latest-pending-value 교체 허용. overflow/loss 거부 또는 보고. 조용한 성공 금지. 무제한 durable history 뜻하지 않음 | input identity + 포착 시각 + 수신/평가 시각 + 품질 + 전달/loss 결과 | occurrence 보존, opt-in coalescing, 표시 overflow/loss | 제안 native/WASM 적합성, 순서/대응/상한 미정, 미실행 | runtime/Driver 계약 | 사용자 합의 input 전달 수정 |
| Imported definition upgrade | 정확한 고정 import revision 변경 | 영향 instance 명시 선택, closure/join 재검증, floating 갱신 없음 | import edge → closure/artifact → instance/deployment | upgrade 범위 표시, provenance 유지, 이전 deployment 설명 가능 | package/replay 검증 | language/API/package 소유자 | R2, R6, R7 |
| Native/WASM parity | 같은 고정 artifact/settings/초기 state/input tape/logical time | 같은 승인 결과/지원 trace identity. invalid frame 의미적 일치 | artifact/module → frame → 완전 결과 | replay 경로 하나, 동일 설명 증거, hash/identity 기록 | 명시 scan-tape host gate | language/runtime | R3와 기존 parity 계약 |

DI 2 / RO 7 사례는 유선 입력 가정의 한 capacity 결과다. physical commissioning이나 농부의
동작 적용 가능성을 증명하지 않는다. 저수위 부정 사례는 같은 첫 milestone에 속한다.

### 제안된 milestone 인계 세 가지

다음 순서/최소 범위는 아키텍처 소유자 검토를 조건으로 하는 제안이다. 각 의존 작업에는
아래의 관련 결정이 필요하다.

1. **준비된 동작 적용.** 최소 언어 변경: typed 요구사항, 명시 input kind, exclusive
   ownership, 안정적 logical-port identity, 추적 가능한 승인/거부 결과에 필요한 한정
   contract descriptor 노출. Consumer 인계: API는 제안/확인 installation/binding revision
   제시. Device는 profile/applied 증거 공급. frontend는 농부 blocker/저수위 부정 설명 제시.
   physical acceptance는 별개 유지.

2. **기존 동작/binding을 보존하며 다른 동작 추가.** 최소 언어 변경: 격리된 state/timer,
   결정적 input snapshot, 안정적 identity 순서, 첫 profile의 공유 exclusive output 거부를
   가진 instance 한정 composition. Consumer 인계: API는 instance/binding join 기록.
   Device는 불변 mapping/새 mapping 확인. host replay는 유선/software 자원 사례 검사.
   제안 composition 작업은 경쟁하는 직접 작성자를 거부한다. M2의 일부로 runtime-settings
   overlay를 구현하지 않는다. 이 범위 제한은 별도로 승인된 live property event 동작을
   거부하거나 controller 정지/새 run을 요구하지 않는다. 작업이 live property event를 쓰면
   acceptance matrix의 불변 source/program hash/run identity, settings/effective-position
   join, 운전 중 영향, atomic 거부, 재시작 persistence 동작을 유지한다.

3. **농부 설명에서 엔지니어 증거까지 예상 밖 결과 조사.** 최소 언어 변경: requested/safe
   output을 구분하며 instance 한정 source/constraint trace를 기존 run/scan 문맥에 join.
   Consumer 인계: #88/#74는 문구/application-result event 정의. API는 settings/binding
   revision join. Device #28은 boot/history/gap 증거 정의. 없는 physical observation은
   unknown 유지.

## 권고

위 세 인계를 아키텍처 소유자 검토에 제안한다. 선호 연구 방향은 고정 source bundle,
명시 instance ID, 안정적 작성 port, 보존 binding, exclusive-owner 거부를 가진 정적 조합이다.
실행/package 대안은 소유자가 아래 gate를 해결할 때까지 미정이다. 제안 결과는 R8 identity
연결을 포함한다. host/API/Device/physical/usability acceptance는 별개 유지한다. capacity,
일치 replay, 유효 integration record는 명시된 범위만 확립한다. 이 연구 문서 승인은
아키텍처나 구현을 승인하지 않는다.

## 미해결 질문과 소유자

이는 명시 작업의 구현 blocker이며 외부 이슈 전체 완료에 대한 범용 의존성이 아니다.
M1–M3는 위 제안 인계를 가리킨다. 인용된 R1–R8 결과는 이 열린 결정의 증거다.

| 결정과 연구 입력 | 의존 작업 전에 필요한 소유자 결정 | 의존 작업 |
|---|---|---|
| Compiler/runtime/진단 계약 (R2, R3, R5) | Compiler/runtime 소유자가 M1 descriptor/diagnostic identity 정의. static lowering/coordinated VM, input/time, GFB1/ABI 호환성, fault fan-out, 조합 실행의 기존 이전/다음 상태 의미 보존 mechanism 선택. control 내부 이전/다음 snapshot/cycle 거부 규칙은 확정. 해당 참조를 선택할 때 import/cross-instance 참조 encoding/검증만 미정 | M1 descriptor 변경은 descriptor 결정 필요. M2 실행/replay는 composed 실행 결정 필요. M1이 composed code를 생성하면 동일 적용 |
| Package/import 계약 (R2, R6, R7) | Language/API/package 소유자가 source bundle/envelope, closure/lock schema, 순서, multi-source map identity, replay/signature 검증 규칙 선택 | M1 reusable-import package 확장, M2 imported composition/upgrade. 기존 single-source package 사용은 새 format 불필요 |
| Installation constraint 권한 (R2, R4, R5) | System #62와 language/API 소유자가 canonical constraint 표현, enforcement 경계, 호환성 증거 선택 | Installation constraint 호환성/enforcement를 주장하는 M1/M2, 해당 constraint의 M3 설명. 결정 없으면 suitability unknown, 성공 deployment 주장 없음 |
| Instance/deployment identity (R2, R6, R8) | API/deployment/language 계약 소유자가 instance lifecycle, binding/settings join, upgrade continuity, stale-join 거부 정의. Live property event는 source/program hash/run identity 보존하며 settings revision/effective event position 전진. 이후 결과는 effective settings join. 재시작은 승인 settings 저장 유지 및 새 run 생성 | M1 binding/result join, M2 instance 생성/upgrade, M3 정확한 incident 문맥. #89 mechanism/ABI/spec 정합성 작업은 live settings 사용 작업만 gate. 무관한 작업은 비의존 |
| Binding 증거 (R4, R8) | API/Device/profile 소유자가 proposal/confirmation record, 안정 endpoint 순서, 관측 applied-binding identity 정의. physical 소유자가 commissioning 증거 정의 | M1 설치 적용, M2 allocation/보존, M3 대상 설비 주장. host capacity 검사는 별도 범위 유지 |
| Incident 증거 계약 (R1, R3, R8) | Language/runtime/#74/#88 소유자가 instance 한정 trace join, 농부 설명, application-result field/부재 의미 정의. Device #28 소유자가 boot/event-to-run/binding join, 가용 feedback, gap 표현 정의 | M1 저수위/blocker projection, M3 해당 logical/application/restart/history 작업. Device journal field는 device-history 작업에만 필요 |

#95는 기존 station manager를 넘는 arbitration을 선택할 때만 의존성이다. 첫 profile은
경쟁하는 직접 작성자를 거부하면서 기존 단일 작성자 manager의 명시 station-request
arbitration을 보존한다. #89/#90은 live-property mechanism/ABI/검증과 이전 stopped-Configure
문서 조정을 소유한다. live property 사용자 결정은 확정됐다. #89는 live settings 사용
작업만 gate하며 무관한 R1–R8 구현 작업은 gate하지 않는다. import 시 specialization은 별개다.
memory/retention은 기존 API/system/Device 소유자에게 남는다. 이 인계는 storage/retention
작업을 추가하지 않는다. 증거 부재는 명시적으로 남는다.

## 검증

- [x] Acceptance 기준 1: 모든 요약 scenario가 가정, 예상 결과, 증거, 측정, 계층, 소유자,
  prerequisite 유지. matrix는 제안 명세 유지. 실행/참여자 결과 주장 없음.
- [x] Acceptance 기준 2: 제안 인계 세 개가 완전한 사용자 journey/최소 범위 설명.
  각 의존 작업에 소유자 결정 명시. #89/#95/Device history 의존성은 해당 capability 사용 시만 적용.
- [x] Acceptance 기준 3: 권한/identity/scan/binding/package/증거 계약 결정이 명시 blocker 유지.
  Host/API/Device/physical/usability acceptance 별개 유지. 향후 실행 테스트는
  `tools/verify-language.mjs` 명시 등록 필수. 기존 검사를 약화하면 안 됨.
  연구 완료는 구현 권한 부여 아님.
- [x] 조사한 revision 기록. `VERIFICATION.md`, parity, integration, explicit-test-registration의
  필요한 절 조사.
- [ ] Coordinator 검증 대기: 정정 R1–R8와 이 matrix 재독, 상대 link 검증, 정정 연구 게시 승인.
  Local `git diff --check` 통과. runtime 테스트/물리 검사 미실행.
