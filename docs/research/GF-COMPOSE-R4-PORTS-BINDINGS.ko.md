<!-- translation-source: docs/research/GF-COMPOSE-R4-PORTS-BINDINGS.md -->
[영어 원문](GF-COMPOSE-R4-PORTS-BINDINGS.md)

# GF-COMPOSE R4: port와 binding

## 사용자 문제

농부는 채널 allocation을 계산하지 않고 준비된 동작을 적용할 수 있어야 한다. 다른 동작을
추가할 때 기존 배선을 조용히 옮겨서는 안 된다. 따라서 composition 경계에는 typed logical
port, 명시적 binding revision, capacity accounting, 제안과 설치 사실을 구분하는 진단이
필요하다. 이 문서는 범위가 한정된 연구/설계다. discovery, 배선, deployment 또는 새 wire
schema를 승인하지 않는다.

## 조사한 revision의 증거

증거는 요청된 baseline인 언어 commit `ffdbc96461eca67908252507fb851fa4dabd9a2c`에서 조사했다.
integration README는 direction, semantic type, driver, address, active level, safe level을
가진 board endpoint를 정의한다. binding은 명시적인 logical-name-to-endpoint-ID dictionary다.
manifest input/output 이름은 direction/type이 맞는 정확한 binding을 요구한다. 선언 순서는
영향이 없고 v1은 하나의 endpoint를 여러 logical name으로 alias하는 것을 거부한다.

같은 계약은 software input endpoint를 명시적으로 허용한다. `software-input` driver/address는
logical input을 식별한다. 물리 DI를 소비하지 않는다. runtime adapter가 그 입력을 공급한다.
이는 계약 증거이며 특정 설치에 해당 endpoint가 있다는 주장이 아니다.

`tools/integration-contract.mjs`는 unknown endpoint, 중복 endpoint driver/address 쌍,
중복 binding, binding 부재, direction 불일치, type 불일치를 검사한다. 제공된 board profile과
installation mapping을 hash하고 고정된 release identity와 비교한다. 순수 checker는 device에
접속하거나 전기/물리 사실을 확립하지 않는다.

`docs/PORTABLE-PACKAGE.md`는 capability 일치를 요구하고 정확한 `bindingRevision`을 포함한다.
API/Device 소유자가 실제 DI/RO map을 검증해야 한다고 명시한다. `docs/IMPLEMENTATION.md`는
installation record가 이름, capability, binding, 현장 사실을 제공하지만 binding record가
program 의미를 override할 수 없다고 명시한다. startup, fail-safe 동작, output 적용,
driver-disconnect 동작은 consumer 정책으로 남는다.

Driver Source/Intent 분리는 기존 경계다. Driver 기반은 software, 특수 hardware 또는 둘
다일 수 있다. 정밀 측정, protocol 처리, raw ISR/scan 포착 선택, 물리 포착은 그 경계에
남는다. 의미 있는 typed event/측정은 core에 노출된다. driver에 농장 정책을 숨겨서는 안 된다.
포착 시각, 수신/평가 시각, 품질은 구분된다. command acknowledgement는 물리 효과의 증거가
아니다. [`LANGUAGE.md`](../LANGUAGE.md) 2절 “프로그램 모델”과
[`IMPLEMENTATION.md`](../IMPLEMENTATION.md)의 “Executable path” 절 참조.

R2 의존성은 source/instance 구분을 확정하고 installation binding이 실행 control source 외부에
남는다고 명시한다. #62 설치 constraint 경계는 미해결이다. 이 문서는 constraint가 별도
artifact인지 명시적 프로젝트 간 경계 revision인지 결정하지 않는다. 그 결정은 #62 시스템
소유자와 language/API 소유자 책임으로 남는다.

갱신된 R2는 시스템/API 이슈 #68도 기록한다. 대화 memory는 provenance/작성 문맥이며 실행
source, 자동 실행 규칙 권한, physical binding 권한이 아니다. 기억된 설비 사실이나 예외는
확인된 결정, 설치 계약, 현재 device 증거 없이 binding 변경을 승인할 수 없다. lineage,
retention/tombstone, memory-to-decision 연결은 #68 소유자의 열린 질문으로 남는다.
이 port/capacity 분석을 바꾸지 않는다.

## 표와 예

### 제안 계약

다음은 composition 검토를 위한 제안이다. 의도적으로 개념적 field만 명시한다.
최종 wire schema가 아니다.

| 필요한 logical role/type | 필요한 physical/software capability | 제공된 profile/binding revision | Suitability 증거 | 결과 | 진단 대상 |
| --- | --- | --- | --- | --- | --- |
| `irrigation.pump` / `Bool` output | 미사용 compatible RO endpoint | 고정 board profile과 installation `bindingRevision` | Direction/type 일치. profile 검토와 physical acceptance 별도 필요 | Capacity-compatible. binding 제안 후 설치 확인 | Pump role, 후보 endpoint, profile/binding revision |
| `irrigation.low_water` / `Bool` input | Compatible DI capability 또는 명시적 software-input capability | 같은 고정 profile/mapping 문맥 | Direction/type 일치. DI/software driver 구분 명시 | Capability kind를 알아야 capacity-compatible | 저수위 role, input kind, endpoint/driver |
| `irrigation.manual_start` / `Bool` input | Compatible DI 또는 명시적 software input | 같은 고정 profile/mapping 문맥 | Software input은 DI 미소비. 암묵 대체 없음 | 제공된 kind가 명시적일 때만 binding 제안 | Manual-start role과 부재한 input-kind 증거 |
| `ventilation.fan_1..4` / `Bool` output | 서로 다른 미사용 compatible RO endpoint 네 개 | 고정 profile과 새/확장 mapping revision | Direction/type 일치. 고유 endpoint 소유권 | 안정적 순서로 제안. 설치 증거 후에만 확인 | Fan role, endpoint, ownership, capacity |
| 모든 필수 role / 선언 type | Direction/type이 잘못된 endpoint | 제공 revision 자체는 내부적으로 고정돼 있을 수 있음 | Validator 불일치는 incompatibility의 구체적 증거 | 거부. coercion/retyping 금지 | Logical role, endpoint, expected/actual direction/type |

“Capacity-compatible”은 필요한 direction/semantic type의 서로 다른 endpoint가 제공된
profile에서 이용 가능해 보인다는 뜻일 뿐이다. 배선, polarity, fail-safe suitability,
load 호환성, 물리 동작을 증명하지 않는다. “Suitability-unknown”은 그 사실이 없다는 뜻이다.
“Proposed binding”은 allocation 결과다. “Confirmed installation”은 기존 소유자의 binding
확인과 물리 증거를 요구한다. host validator 통과에서 추론하지 않는다.

### 자원 ledger

이는 수작업 ledger이며 실행 증거가 아니다. fixture는 TwoZoneIrrigation에 pump output 하나,
valve output 두 개, low-water input 하나, manual-start input 하나가 있다고 가정한다.
FourFanVentilation에는 fan output 네 개가 있다. 상위 예는 합산 물리 수량을 DI 2, RO 7로 고정한다.

| Composition fixture와 input 가정 | 소비되는 physical DI | Software input | 소비되는 physical RO | 총 요청 role |
| --- | ---: | ---: | ---: | ---: |
| 관수 + 환기. 관수 입력 둘 다 유선 디지털 입력 | 2 | 0 | 7 (3 + 4) | 9 (입력 2 + 출력 7) |
| 관수 + 환기. manual-start는 명시적 software input. low-water만 유선 DI | 1 | 1 | 7 (3 + 4) | 9 (입력 2 + 출력 7) |

두 번째 행은 의도적으로 “DI 두 개”가 아니다. `Bool` 선언은 semantic type을 설명하며 전기
소비를 설명하지 않는다. software input도 명시적인 logical endpoint/binding이 필요하다.
input kind가 선언되지 않거나 profile이 대응 capability를 제공하지 않으면 suitability는
unknown이다. 그 role의 allocation을 멈춰야 한다.

### 안정적인 allocation 결정

제안: 모든 명시적 기존 binding을 먼저 보존한다. 각 unbound role에 대해 direction/semantic
type이 맞고 아직 소유되지 않은 endpoint만 고려한다. 후보는 profile의 안정적 endpoint ID를
사전 순서로 정렬하고 role은 canonical logical role 이름으로 정렬한다. 이 안정적 순서는
권고이며 기존 validator 동작이 아니다. allocator는 명시적 binding을 옮기지 말고 충돌을
내보내야 한다. logical output 권한은 physical endpoint/resource accounting과 별개다.
각 출력 채널에는 권위 있는 정의가 하나만 있고 중복 직접 작성자는 compile error다.
명시적 station resource arbitration은 유지된다. station 요청은 경쟁하는 직접 채널 쓰기가
아니다. endpoint alias 검사는 별도 binding 검증으로 남는다.

| 단계 | 기존/요청 role | 결정 | 증거/진단 |
| ---: | --- | --- | --- |
| 1 | `pump -> RO3` | 명시적 binding 보존 | 기존 mapping이 권위 있는 입력. reallocation 없음 |
| 2 | `valve_a -> RO1`, `valve_b -> RO2` | 명시적 binding 둘 다 보존 | 기존 mapping의 소유권과 서로 다른 endpoint 유지 |
| 3 | `fan_1..fan_4` | 안정적인 endpoint-ID 순서로 미사용 compatible RO 네 개 선택 | 각 제안에 role, endpoint, revision, suitability 상태 기록 |
| 4 | `pump -> RO4`를 요구하는 모든 요청 | 명시적 충돌/변경 제안 보고 | 기존 `pump -> RO3`를 조용히 옮길 수 없음 |

변경 전/후 풀이 예(수작업 분석이며 실행 증거 아님):

```text
관수 변경 전: pump -> RO3, valve_a -> RO1, valve_b -> RO2
환기 추가 후: pump -> RO3, valve_a -> RO1, valve_b -> RO2,
  fan_1..fan_4 -> 안정적인 endpoint-ID 순서의 미사용 compatible RO 네 개
```

불변조건은 정확하다. 환기 추가 후 관수 allocation 세 개는 모두 그대로다. compatible
미사용 RO가 네 개 미만이면 capacity 소진 결과다. 요청 fan이 RO3에만 compatible이면
충돌/변경 제안이지 자동 재배치가 아니다.

### 실패와 unknown 사례

| 사례 | 영향 role | 없거나 충돌하는 증거 | 필요한 결과와 소유자 |
| --- | --- | --- | --- |
| 잘못된 direction/semantic type | 그 endpoint에 bind된 role | Profile endpoint가 manifest direction/type에 맞지 않음. checker가 불일치 보고 | Binding 거부. Profile/integration 소유자가 profile 또는 제공 role 정정. coercion 없음 |
| Capacity 소진 | 소진된 direction/type이 필요한 모든 unbound role | 명시적 binding 보존 후 compatible 미사용 endpoint가 남지 않음 | 보존된 소유자와 후보 집합을 포함해 capacity 충돌 보고. API/composition 소유자가 수정 설치 선택 또는 composition 거부 |
| Polarity/fail-safe 증거 불명 | 해당 digital input/output role | `activeLevel`/`safeLevel`은 metadata일 수 있지만 이 checker가 suitability/physical acceptance를 확립하지 않음 | Suitability unknown 표시. Board/profile 소유자가 profile 증거 제공. Device/physical 소유자가 acceptance 제공. 안전 운전 주장 금지 |
| 중복 output 소유권 | 두 logical output role과 공유 endpoint | v1은 한 endpoint의 중복 binding 거부. endpoint driver/address 중복도 invalid | 거부하고 두 role과 endpoint 식별. Site/installation 소유자가 mapping 해결. Device가 applied binding 확인 |

System #62는 installation constraint 경계 결정을 소유한다. System #74는 Device Query를 소유하며
따라서 device-side query/observation 경로도 소유한다. 이 언어 계약은 고정 profile/mapping
identity와 검증 결과를 보고할 수 있지만 어느 소유자의 physical acceptance/discovery 책임도
배정할 수 없다.

## 권고

Capacity-compatible, suitability-unknown, proposed binding, confirmed installation이라는
명시적 상태 네 개를 가진 composition planner를 채택한다. 미사용 endpoint 고려 전에 명시적
binding을 보존한다. 제안에는 문서화된 안정적인 role/endpoint 순서를 사용한다. logical name과
semantic type을 physical endpoint ID와 분리한다. software input을 명시적 logical capability로
모델링해 DI 용량을 소비하지 않게 한다.

R4 allocation/resource accounting은 Driver 포착 의미와 별개다. 이 문서는 Device가 이 경계를
구현하거나 물리 검증했다고 주장하지 않는다.

모든 제안에 제공된 profile identity/binding revision, 영향 role, 후보 endpoint, 진단 상태를
포함하도록 요구한다. 확인에는 기존 설치 소유자의 증거를 포함하도록 요구한다. 명시적
binding을 조용히 다시 쓰거나 polarity/fail-safe suitability를 추론하거나 validator 통과를
physical acceptance로 바꾸지 않는다.

## 미해결 질문과 소유자

- API/composition 소유자: 최종 proposal/confirmation 기록과 수정 installation mapping 승인
  방법 정의. 이 문서는 의도적으로 wire schema를 선언하지 않는다.
- Board/profile 소유자: 권위 있는 안정적 endpoint 순서를 정의하고 검토된 capacity,
  polarity, safe-level, driver, address 증거 제공.
- Site/installation 소유자: 설치에 실제로 선택한 logical-name-to-endpoint mapping과
  binding revision 확인.
- Device 소유자와 Device Query 담당 system #74: applied binding을 확인할 수 있는 관측과
  physical acceptance 증거로 남는 항목 정의.
- Device/Driver 소유자: capture-to-core event/measurement 표현과 증거 정의. 포착 시각,
  수신/평가 시각, 품질 구분. binding/resource accounting과 별개 유지.
- System #62 소유자와 language/API 소유자: R2가 식별한 설치 constraint 경계 해결.
  이 문서는 열린 결정을 보존하며 constraint를 binding planner에 넣지 않는다.
- System/API #68 소유자: memory lineage, retention/tombstone 동작, memory-to-decision 연결
  정의. 이 planner는 memory 검색을 binding 증거나 자동 binding 권한으로 취급해서는 안 된다.
- Composition 소유자: profile이 하나의 logical role에 여러 후보 capability kind를 노출할 수
  있는지 결정. 결정 전까지 명시적인 compatible capability kind 하나를 요구하며 ambiguity를
  suitability-unknown으로 보고.

## 검증

- [x] 조사한 commit 기록: `ffdbc96461eca67908252507fb851fa4dabd9a2c`.
- [x] `contracts/integration-v1/README.md`, `docs/PORTABLE-PACKAGE.md`,
  `docs/IMPLEMENTATION.md`, `tools/integration-contract.mjs`의 필요한 절과 의존성 초안 R2를 읽음.
- [x] 두 ledger에 정확한 DI 2 / RO 7, DI 1 / RO 7과 software input 하나의 합계가 있고
  input-kind 가정을 명시.
- [x] 전/후 예가 pump -> RO3, valve_a -> RO1, valve_b -> RO2를 보존하고 안정 순서 및
  override/충돌 동작을 설명.
- [x] 잘못된 type, capacity 소진, polarity/fail-safe 증거 불명, 중복 output 소유권이 영향
  role과 부재/충돌 증거를 명시. Profile, binding 확인, physical acceptance 소유자 배정.
- [x] 계약/code의 주장, 제안, 미해결 결정, 수작업 예를 구분해 표시. Runtime/physical
  테스트를 실행하거나 주장하지 않음.
- [x] 갱신된 R2 경계 보존. memory는 provenance/작성 문맥이며 실행 규칙/physical binding
  권한이 아님. lineage, retention/tombstone, decision 연결은 #68의 미해결 사항으로 유지.
