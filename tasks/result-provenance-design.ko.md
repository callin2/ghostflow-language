<!-- translation-source: tasks/result-provenance-design.md -->

[영문 원본](result-provenance-design.md)

# Result lowering과 실행된 recovery 근거

상태: 구현 결정; 수용은 미완료다.

규범 근거: Reference §2.5는 원래 fault와 fallback 선택을 보존한다.
§2.6은 지연 평가를 보존한다. §2.8은 실패한 tick을 원자적으로 거부한다.
§7.4는 lowering을 거쳐도 관측 가능한 의미를 보존한다.

## 표현 방식

Result는 타입이 지정된 `ok`, `value`, `faultCode`, `originTag` 식을 갖춘
임시 컴파일러 값이다. 새 VM 값이나 저장 가능한 input/output/state 타입이 아니다.
Result 타입 동등성은 payload와 error 타입 모두를 포함한다. 내장 fault member는
기대 error 타입으로 해석한다. 모호하면 소스 오류다.

Fault code와 origin tag는 기존 유한 enum의 Number 표현을 사용한다.
Sensor 품질 code는 선언된 SensorFault member로 명시적으로 매핑한다.
숫자 순서가 같다고 가정하지 않는다. Source metadata는 origin tag를
sensor 식별자 또는 명시적 fault 생성 source node와 연결한다.

## 실제 recovery 선택

GFB3 opcode 56인 `trace-result <u32 site>`는
`[payload: T, choice: Number, origin: Number]`를 소비하고 동일한 payload를 남긴다.
내부 식은 `['trace-result', String(site), payload, choice, origin]`이다.

Rust tick 기록은 `{site, choice, origin}` 사건의 전용 `resultTrace` 배열을
공개한다. 진단 이름을 requested 또는 safe actuator intent에 넣지 않는다.
기존 native/WASM trace JSON이 이 필드를 전달한다. 새 C ABI 진입점은 필요 없다.

- `site`는 컴파일된 source node 식별자에 연결된 양의 u32다. 같은 함수 본문의
  반복 확장은 동일한 site를 낼 수 있다. 고유 runtime 호출 ID가 아니다.
- `choice = 0`은 평가된 Ok 분기다. 양의 choice는 fault member 순번 + 1이다
  (최대 65535).
- `origin = 0`은 fault 출처가 없다는 뜻이다. 양의 u32 tag는 source metadata를
  통해 sensor 또는 명시적 fault 생성 node로 해석된다.
- 사건은 평가 순서와 반복을 보존한다. Site가 없다고 Ok라는 뜻은 아니다.
  해당 tick에 그 site의 완료된 평가가 기록되지 않은 것이다.
- Payload 식이 성공한 뒤 사건을 추가한다. 선택되지 않은 분기는 사건을 내지 않는다.
  상수 접기는 실행된 marker를 보존해야 한다.

모든 사건 metadata는 정확한 정수 범위로 검사한다. Buffer는 후보 tick에 속하며
state/intent와 함께 commit된다. 이후 fault가 생기면 해당 사건을 폐기한다.
Journaling과 replay는 같은 commit된 기록을 사용한다. 별도의 가변
recovery 이력 checkpoint는 없다.

## 상한과 근거

앞으로만 진행하는 식과 기존 module/expression 바이트 예산이 marker 실행의
상한을 정한다. Strategy 상한은 반복 생성된 식을 포함하여 모든
transition/intent 발생을 센다. 별도로 임의의 marker 256개 한계를 도입하지 않는다.

정적 소스 의존성은 가능한 읽기를 설명한다. 어느 fallback이 실행되었는지는
증명할 수 없다. Host는 core가 생성한 사건을 검증된 source metadata와
sensor 품질에 결합한다. JavaScript로 언어 식을 평가하지 않는다.

Source metadata는 각 recovery site와 허용된 출처를 기록한다. 정본 소스 replay는
복원/package 검증에 기대 site 표를 공급한다. 정확한 비교가 필요하다.
Site나 출처를 삭제했을 때 남은 metadata가 구조적으로 유효하다는 이유만으로
통과해서는 안 된다. 표는 문서와 bytecode 식별자에 계속 결속된다.

필수 수용 기준에는 잘못된 instruction/profile/stack 거부, 구조적 Result 타입 검사,
실행하지 않은 callback fault, 정확한 fault 식별자, 실제 native/WASM 사건,
fault tick rollback, 소스 복원/변조, journal/replay 동작이 포함된다.
집중 검증 성공이 전체 Reference 지원을 뜻하지 않는다.

## 최종 audit가 여전히 필요한 소비자 경계

정본 소스 replay와 정확한 recovery-site metadata 비교는 Node 복원 API와
JavaScript 서명 package 검증기가 수행한다. Rust package 검증기는 서명,
산출물 digest, envelope 식별자, manifest 계약을 검사한다. 소스 컴파일러를
실행하거나 동일한 Result-site lowering을 독립적으로 증명하지는 않는다.
Native 실행 테스트는 VM 사건을 증명하며, 그보다 강한 소스 replay 주장을
증명하지 않는다. 최종 package/deployment 수용은 이 구분을 보존하고
필요한 신뢰 경계에 맞춰 확인해야 한다.
