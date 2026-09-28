<!-- translation-source: docs/research/GF-COMPOSE-R5-CONTRACTS.md -->
[영어 원문](GF-COMPOSE-R5-CONTRACTS.md)

# GF-COMPOSE R5: 조합 계약과 진단

## 사용자 문제

농부는 여러 동작이 공존할 수 없을 때 명확한 이유가 필요하다. 엔지니어는 근거 없는
포괄적 “안전” 결과 대신 충돌하는 요구사항, 영향받는 identity, 증거가 필요하다.
이 문서는 composition의 첫 계약 profile을 제안한다. 연구/설계이며 구현이 아니다.

profile은 type, dependency, parameter 상한, 배타적 output 소유권, installation constraint
호환성을 다룬다. 더 넓은 공유 actuator 자원 arbitration은 #95에 남는다. canonical
`.ghost.md` source가 실행 규칙을 소유한다. Rust core가 실행을 소유한다. 설치 문맥과
deployment는 외부 권한 경계로 남는다.

## 조사한 revision의 증거

증거는 `ffdbc96461eca67908252507fb851fa4dabd9a2c`에서 조사했다. runtime test suite는
실행하지 않았다. R3/R4 의존 문서는 제안과 증거 요약으로 읽었다. 그 미해결 선택은 여기서도
미해결로 남는다.

현재 증거는 다음을 확립한다.

- `compileConstraints`는 `exclusive`, 상한이 있는 `require` 형식, standalone
  `allow(enter/apply)` 형식, `limit on_time`, `once`, 비차단 `check pump_capacity`를 받는다.
  미지원 식은 컴파일에 실패한다([`tools/constraints.mjs`](../../tools/constraints.mjs)).
- 이는 역사적 standalone compiler 증거다. 언어 reference는 `ghostrules` parser의
  `allow enter(...)`를 유지한다. 이전 `allow apply(settings) ... Configure` 규칙은 승인된
  live property event 결정으로 대체됐다고 명시한다.
  [Reference §4.10](../reference/04-sensors-constraints-control.md#410-mode와-live-settings) 참조.
- Constraint phase는 중요하다. output 관계는 final output 후보에 적용된다. enter/apply
  규칙은 요청 진입 때 적용된다. capacity 검사는 새 작업 승인 경로에 적용된다
  ([`docs/CONSTRAINTS.md`](../CONSTRAINTS.md)).
- `prepare_start_batch`는 하나의 same-tick snapshot에서 가장 작은 request ID를 선택한다.
  범용 composition arbitration을 확립하지 않는다
  ([`station.rs`](../../crates/ghostflow-core/src/station.rs)).
- `authorize_output`은 active session을 요구하고 valve 소유권, valve 수, pump-with-valve
  safety를 검증한다. station은 물리 pump 하나를 소유한다. 범위가 한정된 station 정책이며
  일반 동작 조합 증명이 아니다.
- Integration v1은 direction/semantic type이 맞는 정확한 logical-name binding을 요구한다.
  독립적인 host/hardware/physical gate는 증거로 결과를 확립할 수 없을 때 `unknown`을 쓴다.
  validator 통과는 physical acceptance가 아니다
  ([`contracts/integration-v1/README.md`](../../contracts/integration-v1/README.md)).
- Source trace는 source identity, binding, constraint index, runtime observation을 join한다.
  없는 field는 미관측으로 남는다. trace는 전기/기계 동작을 추론하지 않는다
  ([`docs/SOURCE-SAFETY-TRACE.md`](../SOURCE-SAFETY-TRACE.md)).
- R2 system-memory #68은 이 문서의 고정 경계다. 대화 memory는 provenance/작성 문맥이며
  실행 규칙 또는 binding 권한이 아니다
  ([R2: 권한과 identity](GF-COMPOSE-R2-AUTHORITY-IDENTITY.md)). system #62의 installation
  constraint 권한은 열린 결정이다. 관련 실행 제안과 한계는
  [R3: 조합 실행](GF-COMPOSE-R3-EXECUTION.md)도 참조한다.

### 증거 종류

| 종류 | 이 profile의 의미 | 예 |
|---|---|---|
| 선언된 가정 | 계획에 제공된 입력. 독립적으로 확립되지 않음 | 제안된 binding이 `MainPump`를 명시 |
| 테스트된 성질 | 테스트나 기록된 gate가 명시된 범위의 결과 확립 | 통합 host gate가 참조와 함께 `pass` |
| 정적으로 확립된 성질 | Compiler/validator가 상한이 있는 구조적 사실 증명 | 필수 output의 direction/semantic type 일치 |
| Runtime 강제 constraint | 실행 경로가 invalid 요청/output 거부 또는 차단 | `authorize_output`이 pump-on/no-valve output 거부 |

profile은 네 종류를 모두 보고할 수 있다. 가정이나 구조적 일치를 물리 안전으로 승격해서는
안 된다. installation gate 부재는 `unknown`이며 `pass`가 아니다. source trace identity는
추적 가능성을 높이지만 device가 명령을 적용했다는 증거는 아니다.

## 표와 예

### 제안된 첫 계약 profile

| 성질 | 필요한 입력 | 검사 phase | 뒷받침되는 주장 | 미지원/unknown 사례 |
|---|---|---|---|---|
| Type | Canonical manifest role/type, profile endpoint direction/type, 명시적 binding | 정적 binding 검증 | Logical role이 제공 endpoint와 구조적으로 호환됨 | Coercion, analog 의미, 미문서화 driver 동작은 증명되지 않음 |
| Dependency | 선언 dependency 이름/source trace node, 완전한 composed input map | Compile/lowering 및 activation 전 검증 | 기존 불변조건이 순간 expression cycle 거부. 없는 target 거부 | Cross-module same-scan lowering 미해결. 기존 phase/next 참조 제한은 확정 유지 |
| Parameter 상한 | 선언 integer/duration 값, profile/station 상한 | Compile 검증 후 request/start 승인 | 값이 선언 compiler/station 상한에 맞음. 유한 quota/budget 검사가 요청 거부 가능 | 물리 용량, pressure, flow, 미모델링 parameter 의미는 unknown 유지 |
| 배타적 소유자 | Logical output ID, 명시적 endpoint binding, owner/claim ID | Compile 시 logical 권한 검사. 별도 binding 검증. 해당되는 station 승인 | output 채널당 권위 정의 하나. 중복 직접 작성자는 컴파일 실패하며 배포 불가 | 자동 resolver 없음. 기존 선언 station resource arbitration은 별개 유지 |
| Installation constraint 호환성 | 고정 board/profile/installation revision, 독립 gate 증거, constraint artifact 또는 권한 결정 | Activation 전 호환성 gate. 실제 lowering/enforcement된 constraint에만 runtime 적용 | 일치 identity와 명시적 compatible constraint 보고 가능 | #62는 artifact/overlay/enforcement 권한을 선택하지 않음. 증거 부재는 unknown |

“Compatible”은 의도적으로 범위가 한정돼 있다. 검사한 요구사항이 명시된 입력/phase로
뒷받침된다는 뜻이다. 전체 설치가 안전하다는 뜻이 아니다. constraint/source identity는
만들어 낸 identity 대신 source/bytecode digest를 포함한 기존 source trace field를 사용해야
한다. 순간 expression cycle은 거부된다. 기존 불변조건이며 열린 정책 선택이 아니다.
state feedback은 이전/다음 상태 경계를 건넌다. 모든 transition은 하나의 입력/이전 상태
snapshot을 사용한다. next 참조는 output expression에만 허용되고 다른 next transition이나
let에는 허용되지 않는다. logical commit은 동시다. composition은 이 규칙을 보존해야 한다.

### 정확히 네 가지 진단 예

1. **배타적 pump 소유자 두 개.**

   - Reason code: `GF-COMPOSE-EXCLUSIVE-OUTPUT`.
   - 농부 메시지: “이 두 동작은 같은 펌프를 요구합니다. 한 동작을 선택하거나 두 동작을
     함께 적용하기 전에 별도 펌프를 설치하세요.”
   - 영향 ID: `irrigation.pump`, `fertigation.pump`, endpoint `MainPump`.
   - 증거: 선언된 exclusive-owner 요구사항, binding revision/endpoint identity,
     두 output intent의 source-trace node.
   - 필요한 결과: 중복 권위 output 정의 때문에 컴파일 실패. 두 정의와 영향 output 명시.
     후보는 배포할 수 없다. source 정의를 해결한다. endpoint가 서로 다르다는 사실만으로
     하나의 logical 채널에 작성자 둘이 합법이 되지는 않는다. station resource 요청은
     별도로 중재된다.

2. **호환되지 않는 port.**

   - Reason code: `GF-COMPOSE-PORT-INCOMPATIBLE`.
   - 농부 메시지: “요청한 펌프는 동작이 요구하는 출력 타입과 맞지 않는 포트에 연결돼
     있습니다. 호환되는 포트를 선택하거나 설치 기록을 정정하세요.”
   - 영향 ID: logical role `irrigation.pump`, endpoint `DI-2`, 기대 `output/Bool`,
     제공 `input/Bool`.
   - 증거: 고정 board-profile revision, installation `bindingRevision`, validator의
     direction/type 불일치.
   - 정정 선택: role을 미사용 일치 output에 bind하거나 profile/installation 소유자가
     mapping을 정정한다. coercion을 뜻하지 않는다.

3. **Dependency 부재.**

   - Reason code: `GF-COMPOSE-DEPENDENCY-MISSING`.
   - 농부 메시지: “이 동작에는 `water_ok`가 필요하지만 제공된 동작이나 입력 중 그것을
     제공하는 것이 없습니다. 해당 입력을 추가하거나 의존성을 제거하세요.”
   - 영향 ID: consumer `irrigation.start`, 필수 dependency `water_ok`. compiled source map에
     있을 때만 canonical source span/node를 인용한다. composed dependency-map node는
     제안이며 현재 계약으로 확립되지 않았다.
   - 증거: 이용 가능한 canonical source 선언/span과 composed input map. 이용 불가능한
     source-map/trace target을 absent/unresolved로 명시한다. node/provenance record를
     만들어 내지 않는다.
   - 정정 선택: 명시적으로 bind된 `water_ok` input/result를 제공하거나 source를 수정한다.
     same-scan result 시점을 추론하지 않는다.

4. **필수 설치 증거 불명.**

   - Reason code: `GF-COMPOSE-INSTALL-EVIDENCE-UNKNOWN`.
   - 농부 메시지: “동작 요구사항은 기록된 프로필에 맞지만 이 구성을 확인하는 데 필요한
     설치 증거가 없습니다. 시작 전에 설치자에게 검증을 요청하세요.”
   - 영향 ID: constraint `SharedPump`, installation `site-a/rev-7`, endpoint 집합
     `MainPump`, `ValveA`.
   - 증거: 고정 profile/binding identity는 존재. 필수 hardware/physical gate는 적격 참조 없이
     `unknown` 또는 `not_run`.
   - 정정 선택: 소유자의 현재 hardware/physical 증거를 얻거나 결과를 unknown으로 두고
     confirmed installation을 주장하지 않는다.

### Valve 전환 반례와 station 경계

반례(수작업 분석이며 실행 증거 아님): 동작 A가 pump session을 소유하고 `ValveA`에서
`ValveB`로 전환하는 동안 pump를 잠시 OFF한다. 동작 B가 `pump=false`를 보고 같은 물리
pump를 요청한다. “pump가 꺼졌으므로 B가 시작할 수 있다” 같은 local 규칙은 session 소유권
불변조건을 깨뜨린다. 기존 station 정책은 valve cleanup 동안 session을 명시적으로 유지하고
비활성 control이 소유자를 멈출 수 없다고 명시한다. 따라서 host가 station request/session
state를 공급할 때 `prepare_start_batch`와 `authorize_output`은 이 한정된 station 주장을
뒷받침한다. 임의 composed 동작이 자원을 올바르게 공유한다는 증거는 아니다.

#95는 추가 shared-actuator arbitration/fallback을 정의할 수 있다. output 채널의 단일
권위 정의 규칙을 다시 열지는 않는다. 이 문서는 arbiter나 temporal/정리 증명 engine을
추가하지 않는다. R2/#62는 installation constraint의 권한 위치와 증거 공급 방법을
결정해야 한다. 두 결정이 모두 검토될 때까지 profile은 지원 입력/phase에 대한 호환성만
보고한다.

## 권고

이를 검토 가설로 채택한다. 지원 type/dependency/bound/exclusive-owner 검사가 실패하면
activation 전에 composition을 거부한다. 진단에 정확한 요구사항/증거 참조를 보존한다.
installation 증거 부재에는 `unknown`을 사용한다. 범위가 맞을 때 기존 source-trace
identity/station enforcement를 재사용한다. local 검사에서 전역 안전 결과, physical
acceptance, priority, arbitration을 주장하지 않는다.

## 미해결 질문과 소유자

- **Language/compiler 소유자:** 기존 cycle 규칙을 보존하는 composed dependency 표현과
  안정적인 reason-code registry 정의. 이전/다음 및 단일 작성자 규칙 보존.
  cross-module same-scan lowering은 미해결 유지.
- **Language/runtime ABI 소유자:** 현재 ABI를 암묵 변경하지 않고 instance ID, endpoint ID,
  source node, constraint index, evidence reference가 join하는 방법과 diagnostic envelope 정의.
- **System #62와 API/language 소유자:** installation constraint 권한, artifact 형식,
  enforcement phase 결정. 이 문서는 의도적으로 선택하지 않는다.
- **#95/station 소유자:** 추가 shared-resource arbitration/fallback 정의. 기존 station 정책은
  하나의 물리 pump station으로 한정되며 일반화하지 말고 감사해야 한다. 하나의 output
  채널에 직접 작성자 여러 개를 승인하지 않는다.
- **API/integration 소유자:** 없거나 stale인 profile/binding/gate 증거 갱신/승인 방법 정의.
  memory #68은 승인할 수 없다.
- **Device/installation 소유자:** physical acceptance/applied-binding 증거 제공.
  host 검증은 그 사실을 확립할 수 없다.

## 검증

- [x] 조사한 revision 기록: `ffdbc96461eca67908252507fb851fa4dabd9a2c`.
- [x] `docs/CONSTRAINTS.md`, `station.rs`, `tools/constraints.mjs`,
  `docs/SOURCE-SAFETY-TRACE.md`, `contracts/integration-v1/README.md`의 필요한 절 점검.
- [x] R3/R4 의존 연구 결과를 읽음. 미해결 결정을 아키텍처 승인으로 취급하지 않고 보존.
- [x] 표가 검사 phase와 증거 강도를 분리하고 unknown 증거는 뒷받침되지 않은 상태 유지.
- [x] 정확히 네 진단 포함. 각각 안정적 제안 code, 농부 메시지, 영향 ID, 증거 참조,
  정정 선택을 포함.
- [x] Valve 전환 반례가 local 보장의 한계를 식별하고 policy engine 추가 없이 후속 작업을
  #95와 R2/#62에 배정.
- [x] 해당 예에 수작업 표시. Runtime/physical 실행 주장 없음. runtime suite 미실행.
