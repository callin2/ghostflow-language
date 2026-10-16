<!-- translation-source: docs/OBSERVATION-EVENT-HISTORY.md -->
[English original](OBSERVATION-EVENT-HISTORY.md)

# 보존 범위가 있는 관찰 event 이력

`tools/observation-event-history.mjs`의 `prepareObservationEventHistory`는 Reference §5.3에서 채택한 event 보존 경계를 소스에 결합된 참조 Host로 구현한다. 명시적 producer event와 마지막 completed snapshot을 분리해서 보존한다. snapshot으로 producer가 제공하지 않은 event를 재구성하지 않는다.

이 helper는 Interaction snapshot v0 및 실행 환경의 최종 event, command-result, alarm 직렬화·전송과 분리된 참조 API이다. source 키워드나 command/alarm 상태 기계를 추가하지 않는다. 신뢰하는 producer가 명시적 `{kind, payload}` event 사실과 이미 완료된 공통 Rust core trace를 제공한다. journal은 control을 평가하거나 물리적 주장을 인증하지 않는다.

## 활성화와 발행

`{compilation, schema?, runId, capacity?, maxEventsPerScan?}`으로 활성화한다. 기존 completed-snapshot owner가 정확한 compiled literate source, emitted schema, module 및 source identity를 복사하고 검증한 뒤 활성화한다. capacity와 batch limit은 1부터 4096까지의 명시적 정수이며 기본값은 256이다. 이 값은 참조 Host의 경계이지 모든 설비에 적용할 운영 정책이 아니다.

`publish({completion, trace, settingsState?, events})`는 먼저 전체 명시적 event batch와 completed trace를 검증한다. 발행마다 completed scan ID가 증가해야 하고 logical time은 후퇴할 수 없다. producer의 snapshot 검사는 source/Program identity, 선언된 관찰 타입 및 settings Result 의미를 유지한다. 잘못된 metadata, 다른 trace, sparse/noncanonical JSON, 중복 scan, 과도한 batch 또는 payload는 journal 변경 전에 거부한다. 거부 뒤 같은 completion으로 유효하게 재시도할 수 있다.

수락한 각 event는 Run 안에서 엄격히 증가하는 sequence, 전체 schema/module/source/run identity 및 실제 completed-scan identity를 받는다. event identity는 실행 identity와 sequence의 조합이다. 한 scan에 여러 명시적 event가 있을 수 있다. event 없는 scan도 마지막 snapshot을 갱신하지만 event sequence를 증가시키지 않는다. 공개 kind text는 길이가 제한되고 비어 있지 않으며 제어 문자와 예약된 private 이름을 제외한다. payload는 safe integer 및 sparse-array 검사를 적용한 소유 canonical JSON이며 event당 UTF-8 16 KiB로 제한한다. 반환하는 record와 snapshot은 깊이 동결한 복사본이다.

## 보존과 cursor

`read({cursor?})`는 cursor 이후의 보존 event, 명시적 `gaps`, 마지막 `snapshot`, 보존 sequence 범위 및 `nextCursor`를 반환한다. cursor는 정확한 실행 identity와 `afterSequence`를 포함한다. 새 Run 또는 다른 source, Program, schema에 재사용할 수 없다. 소비자가 반환한 cursor를 저장할 때까지 읽기 결과는 반복 가능하므로 중복 record의 원래 identity를 보존한다.

소비자가 sequence 10을 저장했고 현재 보존 범위가 14부터 시작하면 다음을 전달한다.

```text
gaps: [{from: 11, to: 13, reason: "retention"}]
events: [sequence 14인 원래 event]
snapshot: 분리해서 유지하는 마지막 completed observation
```

journal은 11–13의 가상 event를 만들지 않는다. 11–14가 보존되어 있으면 네 event를 모두 전달하고 gap은 보고하지 않는다. 정확한 보존 경계에서도 실제로 사용할 수 없는 sequence만 보고한다. 빈 이력의 snapshot은 null이고 gap은 없다. 명시적 event 없는 후속 scan도 snapshot 변화를 event로 만들지 않는다. 연결은 저장한 cursor로 재개할 수 있다. 보존 범위 밖에서 사라진 record는 재구성하지 않고 보고한다. 다른 Run은 일반 sequence gap이 아니라 identity mismatch이다.

## 검증과 한계

REF-05-022는 정확히 같은 source를 production native Rust와 framed WASM에서 실행하고 모든 outcome을 비교한다. 두 trace를 같은 실제 Host journal에 전달한다. 전체 batch, gap, snapshot, identity, cursor가 새 replay에서 일치한다. 음성 테스트는 journal을 보존하며 유효한 재시도, cursor identity 검사 및 호출자 변경 격리를 증명한다.

journal은 JavaScript 참조 Host의 보존 구현이지 native Rust journal, 영속 network storage, 최종 제품 protocol, event 인증 서비스 또는 Device 배포가 아니다. producer event payload는 명시적 외부 사실이다. 완료된 core scan이나 호출자의 `kind`로 output intent를 applied 또는 confirmed 물리 증거로 승격할 수 없다. requested/safe/applied/confirmed의 독립 경계와 최종 전송 소유권은 채택한 대로 유지한다.
