<!-- translation-source: docs/ESTIMATE-EVIDENCE.md -->
[영어 원문](ESTIMATE-EVIDENCE.md)

# 유한한 추정 근거 admission

이 API는 [#385](https://github.com/callin2/ghostflow-language/issues/385)의 근거 기반인
[#398](https://github.com/callin2/ghostflow-language/issues/398)을 구현한다.
[Reference §4.4](reference/04-sensors-constraints-control.md#추정값의-출처와-연속성)가 의미를 소유한다.
portable core는 선언된 basis를 승인하며 수치 추정, 움직임 모델, 측정, 출력 명령,
temporal 사용 권한을 만들지 않는다. GhostFlow 선언, Result 상태, sensor Quality,
GFB encoding은 바뀌지 않는다. compiler가 인식하는 추정 선언과 보정 기간 예제는 #385에 남는다.

## 공개 계약

`ghostflow_core::estimate_evidence::Session::new(reference, basis, capacity)`는
하나의 session을 명시적으로 설정한다. capacity는 필수이며 record 1–64개다.
자동 퇴출은 없다. 지원하지 않는 capacity나 잘못된 uncertainty는 생성을 거부한다.
`reference: None`은 reference 부재를 나타내며 위치 0을 뜻하지 않는다.

`Reference`는 설정 monotonic 시간, 초기 sequence watermark, uncertainty를 보존한다.
`bound: None`은 명시적으로 알 수 없음을 뜻한다. 알려진 bound는 유한한 0 이상의 값이어야 한다.
uncertainty `meaning` digest는 선언된 모델/단위 의미를 식별한다. API는 단위나 기본 bound를 만들지 않는다.

`Context.identities`에는 host가 제공한 정확하고 불투명한 32-byte 정체성 7개가 순서대로 있다.

1. host boot identity.
2. 모델과 모델 revision record.
3. 보정 parameter/revision record.
4. runtime reference identity record.
5. 누가 어떤 출처로 설정했는지 포함한 reference assertion record.
6. canonical authored program/source revision record.
7. canonical installation binding/revision record.

run, monotonic time epoch, source epoch는 정확한 `u64`다. host는 소유자가 정한 canonical
정체성을 제공한다. digest는 assertion을 인증하지 않는다. 새 canonical hash 알고리즘은 없다.
없거나 검증되지 않은 record를 유효한 reference로 표시하면 안 된다. 보정 parameter의
영속성만으로 runtime reference를 복원하지 않는다.

`Basis::Requested`는 request record를 요구한다. `AcknowledgedWrites`는 실제 write 결과인
Acknowledged, WriteFailed, Unknown record를 요구한다. ACK는 Driver 수락만 뜻한다.
`target`은 불투명한 byte/digital-mask 값이며 임의 단위의 actuator 수치가 아니다.
각 record는 원래 실행 출처인 boot/program/binding 정체성과 run/time/source epoch를 보존한다.
모델, 보정, runtime reference는 write receipt를 생성하지 않는다. 이전 receipt는 동일한
실행 출처와 완전한 선언 coverage 안에서 명시적으로 다시 설정한 reference의 seed가 될 수 있다.
다른 run/boot의 receipt는 unavailable이며 정체성을 새로 붙이지 않는다.

## 평가, 완전성, transaction 경계

`evaluate(context, now_ms, history, source_fault)`는 `Verdict` 또는 잘못된 입력의
`Rejection`을 반환한다. 순서 있는 history는 초기/현재 sequence watermark, monotonic
observed-from/through 시간, 완전한 coverage 여부를 선언한다. reference 순간 이전 또는
그 순간의 원본 seed request/receipt를 포함한다. observed-from은 seed 원래 시간과 같다.
seed sequence는 초기 watermark 다음이다. 이후 sequence는 연속이며 최종 sequence는
현재 watermark와 같다. observed-through는 평가 시간에 도달해야 한다. 마지막 write 뒤의
tail을 포함한 완전성은 host 선언이다. Device의 retained snapshot에서 추론할 수 없다.

전체 prefix는 명시적인 capacity 안에서 보존한다. 같은 cached receipt를 반복 읽어도
연속 coverage 선언이 있어야 이후 평가를 지원한다. 정체성, 원본 시간, target, 결과는
바뀌지 않는다. 재작성/중복 정체성, 역행 sequence/시간, 미래 timestamp, 잘못된 basis,
잘못된 packet, overflow는 committed 상태를 바꾸지 않고 거부한다.

형식상 유효한 gap, 불완전 coverage, history/reference 부재, context 변경, 실패하거나
불확실한 write는 원인을 포함한 unavailable이며 연속성을 무효화한다. 원본 typed
`SensorFault`는 fault로 남는다. 명시적인 입력 fault가 우선한다. context 변경을 clock 비교
전에 확인한다. 같은 context 안의 monotonic 역행은 ClockBackward다. 이후 정상처럼 보이는
history는 무효 연속성을 reset하지 않는다. 새 session/reference를 명시적으로 생성해야 한다.

실패/불확실 record는 보존된다. 뒤의 실패를 생략하여 이전 cached ACK로 숨길 수 없다.
짧은 history는 보존된 prefix를 지우지 않는다. reference와 마지막 평가 context는 별도로
공개한다. 알 수 없는 uncertainty는 metadata로 남는다. 승인된 basis도
`temporalAdmission: false`다. measured-only `hold_last`, window, `true_for`는 그대로다.

## Native/WASM transport와 검증

`runtimes/wasm/estimate-evidence.mjs`는 encoding/decoding만 한다.
`EstimateEvidenceRuntime`은 Rust가 소유하는 session을 생성, 평가, 폐기한다.
GFEE v1 binary packet adapter는 native `estimate_evidence` conformance 예제와 같은 파일을
사용한다. 생성 packet kind는 0, 평가 kind는 1이다. 미지원 header, flag/enum, 남은 byte는
거부한다. 최대 평가 packet은 정확한 layout에서 계산한 `298 + 64 * 146 = 9642` byte다.
core는 capacity 개수의 record만 보존한다. transport scratch와 snapshot 직렬화도 이 ceiling에
따라 유한하다. MCU task-stack acceptance는 아니다.

host field는 전체 `u64` 범위의 정확한 decimal string 또는 BigInt를 받는다. 안전한 정수
Number도 가능하며 부정확한 Number는 거부한다. JSON snapshot은 `u64`를 decimal string으로
낸다. native/WASM conformance는 전체 snapshot과 명시적인 예상 verdict, 원인, coverage,
receipt provenance를 비교하며 full capacity와 +1을 포함한다. Rust regression은
`crates/ghostflow-core/tests/estimate_evidence.rs`에 있다. `tests/estimate-evidence.test.mjs`는
`tools/verify-language.mjs`와 기존 coverage gate에 등록된다. 이 검증은 소프트웨어 선언과
admission을 검증하며 물리 위치나 완전한 Device history를 인증하지 않는다. sensor-ingestion
fallback은 없다.
