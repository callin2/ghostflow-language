<!-- translation-source: docs/TEMPORAL-DESCRIPTOR-ARTIFACT.md -->
[영어 원문](TEMPORAL-DESCRIPTOR-ARTIFACT.md)

# 보류된 temporal artifact

canonical `.ghost.md` compiler는 `tide_is`, `moon_is` 같은 natural condition에 실행 가능한
GFB11을 내보낸다. companion `GhostFlow/control-v10` manifest는 typed provider descriptor를
유지한다. runtime activation에는 선언 provider binding을 가진 명시 context profile이 필요하다.
provider 관측은 classification, coverage, expiry, uncertainty, location/timezone, revision
증거를 포함해야 한다. caller는 보호 Result projection을 직접 공급할 수 없다.

명시 projection 없는 미사용 `after_event` 선언은 실행 계약을 이용할 수 없을 때 검사된
`GhostFlow/temporal-descriptor-artifact-v1`로 남는다. 이 JSON artifact는 **GFB bytecode가
아니다**. payload/companion manifest 모두 `executable: false`를 선언한다.

artifact는 완전한 추출 control source/typed descriptor를 유지한다. 일반 source document
envelope는 정확한 literate text, SHA-256, source 위치를 유지한다. 검증은 canonical source를
재컴파일하고 변경 byte, descriptor manifest, source identity를 거부한다.

보류 descriptor의 `requiredRuntimeContracts`는 없는 실행 경계를 식별한다.

- `identified-event-delivery`, `per-identity-result-projection`: 실행 projection 없는 미사용
  `after_event` 선언 식별.
`ControlRuntime`은 보류 descriptor manifest를 거부한다. 필요한 context activation/provider
binding 없는 실행 natural-condition artifact도 거부한다. 컴파일만으로 runtime 적합성이나
device deployment를 증명하지 않는다.

[after_event WASM ABI](AFTER-EVENT-WASM-ABI.md)는 하나의 control transaction에서 식별된
전달, native identity별 결과, 명시적 `after_event_any`/`after_event_all` projection을 실행한다.
두 projection 중 하나를 쓰는 source는 실행 GFB로 컴파일된다. compiler는 bare/미사용
signal의 projection을 추론하지 않는다.
