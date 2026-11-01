<!-- translation-source: docs/TEMPORAL-DESCRIPTOR-ARTIFACT.md -->
[영문 원문](TEMPORAL-DESCRIPTOR-ARTIFACT.md)

# 보류된 temporal artifact

이 페이지는 temporal(시간 및 자연 현상에 의존하는) 선언에 대해 컴파일러가 무엇을
생성하는지, 그리고 그 결과물이 언제 실행 가능하지 **않은지** 설명합니다.

**실행 가능한 자연 조건.** `tide_is`, `moon_is` 같은 자연 조건에 대해 정본
`.ghost.md` 컴파일러는 실행 가능한 GFB11을 생성합니다. 함께 생성되는
`GhostFlow/control-v10` manifest는 이들의 타입이 지정된 provider descriptor를
유지합니다. 컴파일만으로는 이들을 실행할 수 없습니다.

- 런타임 활성화에는 선언된 provider 바인딩을 포함하는 명시적 context profile이
  필요합니다.
- provider 관측에는 classification, coverage, expiry, uncertainty,
  location/timezone, revision 증거가 포함되어야 합니다.
- 호출자는 보호된 Result projection을 직접 공급할 수 없습니다.

**보류된 `after_event` 선언.** 사용되지 않고 명시적 projection도 없는
`after_event` 선언은 실행 계약을 사용할 수 없을 때 검사된
`GhostFlow/temporal-descriptor-artifact-v1`로 남습니다. 이 JSON artifact는
**GFB 바이트코드가 아닙니다**. payload와 함께 생성되는 manifest 모두
`executable: false`를 선언합니다.

**artifact가 유지하는 것.** artifact는 추출된 전체 control 소스와 타입이 지정된
descriptor를 유지합니다. 일반 소스 문서 envelope는 정확한 literate 텍스트, 그
SHA-256, 소스 위치를 유지합니다. 검증은 그 정본 소스를 재컴파일합니다. 변경된
바이트, 변경된 descriptor manifest, 변경된 소스 identity는 거부됩니다.

보류된 descriptor의 `requiredRuntimeContracts`는 누락된 실행 경계를 나타냅니다.

- `identified-event-delivery`와 `per-identity-result-projection`: 실행 가능한
  projection이 없는 미사용 `after_event` 선언임을 식별합니다.

`ControlRuntime`은 보류된 descriptor manifest를 거부합니다. 필요한 context
활성화나 provider 바인딩이 없는 실행 가능한 자연 조건 artifact도 거부합니다.
컴파일만으로 런타임 적합성이나 장치 배포가 증명되지는 않습니다.

**실행 가능한 `after_event` projection.**
[after_event WASM ABI](AFTER-EVENT-WASM-ABI.ko.md)는 하나의 control 트랜잭션 안에서
식별된 전달, native identity별 결과, 명시적인 `after_event_any`와
`after_event_all` projection을 실행합니다. 두 projection 중 하나를 사용하는 소스는
실행 가능한 GFB로 컴파일됩니다. 컴파일러는 단독으로 쓰였거나 사용되지 않은
signal에 대해 projection을 추론하지 않습니다.
