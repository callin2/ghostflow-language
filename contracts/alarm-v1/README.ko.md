<!-- translation-source: contracts/alarm-v1/README.md -->
# 알람 관측 v1

[English](README.md)

[#287](https://github.com/callin2/ghostflow-language/issues/287)의 REF-05-027을 위해
채택한 제한된 알람 생산자다. Rust `ScanDriver`가 작성된 Bool 상태의 소프트웨어
관측을 기록한다. 향후 command 생명주기나 전체
[interaction 스트림 설계](../../docs/INTERACTION-STREAM-CONTRACT.ko.md)는 구현하지 않는다.

## 소스와 descriptor

[정규 예제](examples/temperature.ghost.md)는 품질을 가진 입력으로 Bool 상태를
계산한다. 명시적인 fault 분기는 이전 조건을 유지한다. 외부 descriptor는
`state.hot`을 알람에 연결하고 발생/해제 의미 및 정의가 포함된 severity 코드를
제공한다. 상태 이름이나 Bool 값만으로 알람 의미가 생기지 않는다. 새 언어
키워드나 실행 가능한 descriptor 수식은 없다. 이 프로파일은 단일 scalar GFB
모듈(버전 1–4), interaction schema 0.3, `activeWhen: true`인 서로 다른 작성된
Bool 상태 1–16개를 수용한다. 다른 프로파일은 명시적으로 거절한다.

닫힌 필드의 [descriptor schema](descriptor.schema.json)는
`GhostFlow/alarm-descriptor-v1`, 숫자 `version: 1`이다.
`interactionSourceIdentity`를 지정한 정규 컴파일 후
`tools/alarm-observation.mjs`의 `prepareAlarmObservation(compilation, descriptor)`를
사용한다. 정규 소스를 재컴파일하고 기존 interaction schema/provenance 검증기를
사용한다. schema, source, module은 정확히 일치해야 하며, node ID와 순서 있는
intent anchor도 선택한 상태와 일치해야 한다. 의미 텍스트는 UTF-8 1–512바이트이며
상태마다 anchor 1–32개를 가진다. `parseAlarmDescriptor`는 엄격한 정규 JSON만
수용하여 중복 키와 정규화되지 않은 표현을 거절한다. 객체 입력에도 같은 정규
JSON 규칙과 정확한 필드 집합을 적용한다. 준비 결과는 중첩 provenance까지
불변 복사본으로 소유한다.

`bind({runId, streamId})`는 GFAL 버전 1 바이트와 SHA-256을 만든다.
컴파일러가 검증한 패킷과 기대 digest가 신뢰하는 활성화 경계를 함께 통과한다.
Rust는 digest, 실제로 로드한 원본 GFB 바이트의 SHA-256/FNV/모듈 이름,
각 상태 슬롯의 존재와 Bool 타입을 확인한다. Rust는 Markdown을 파싱하거나
실행 바이트만으로 소스 anchor를 증명하지 않는다. 호출자가 패킷과 기대 digest를
모두 바꾸면 컴파일러 신뢰 경계를 우회한다. digest는 무결성 연결이며 인증
서명이 아니다. wrapper나 새 GFB 버전으로 실행 모듈 식별자를 바꾸지 않는다.

## 런타임과 레코드

코어 내부 배치 두 가지를 비교했다. `Runtime::tick_at`은 수락된 상태를 알지만
framed scan/run 식별자가 없다. `ScanDriver`는 이미 완전한 frame, 스캔 순서와
거절을 소유한다. 따라서 후자가 관측자를 소유하여 이벤트와 현재 snapshot이
정확히 같은 완료 스캔 경계를 사용한다.

`AlarmObservationRuntime.instantiate(wasmBytes, compilation, descriptor, identity)`는
원본 프로그램을 로드하고 첫 스캔 전에 관측자를 한 번 활성화한다. native API는
`ScanDriver::activate_alarms(packet, expected_sha256)`와 `query_alarms(packet)`다.
잘못된 관측자 활성화는 런타임을 바꾸지 않으며 일반 제어 스캔을 허용한다.
framed ABI는 `gf_frame_alarm_activate`, `gf_frame_alarm_query`와 report
pointer/length export를 추가한다. GFAQ 버전 1 조회는 binding/run/stream
식별자와 선택적인 배타적 sequence cursor를 전달한다. 조회는 이벤트를 주입하거나
스캔을 진행하지 못한다. 기존 framed API와 v0 snapshot 형식은 유지한다.

Rust는 각 scalar 스캔이 성공한 뒤 결과를 소비자에게 반환하기 전에 조건을
기록한다. 평가 실패, 오래된 scan ID와 역행하는 논리 시각은 현재 상태, 순서,
이력을 바꾸지 않는다. 첫 성공 스캔 전에는 모든 조건이 `unobserved`이고
scan/time은 null이다. 첫 확정 true는 episode 하나를 발생시키고 반복 true는
추가하지 않는다. false는 같은 episode를 해제하고 이후 true는 새 episode를
만든다. 같은 timestamp에서도 sequence는 구별된다. episode 식별자는 binding,
run, stream, alarm ID와 발생 sequence인 `episodeSequence`의 조합이다.

닫힌 필드의 [report schema](report.schema.json)는
`GhostFlow/alarm-report-v1`, 숫자 `version: 1`이다. 정확한 source/module/schema/
descriptor digest, 마지막 완료 스캔의 현재 상태, 순서 있는 이벤트,
binding/run/stream cursor와 보존 범위를 담는다. 현재 상태와 이벤트 이력은
별도다. 반환된 JS 레코드는 복사본이다. false→true→false 뒤에만 조회해도 현재
inactive 상태와 발생/해제 이벤트 둘을 받는다. report의 descriptor digest로
명시적 severity와 의미 메타데이터를 연결하며 레코드 값에서 의미를 추론하지 않는다.

보존은 이벤트 1–1024개와 모든 선언된 알람의 고정 상태를 유지한다. 넘치면
오래된 이벤트를 제거하며 스캔을 막거나 sequence를 다시 매기지 않는다. 조회가
보존 범위 밖 이력을 요구하면 양끝을 포함하는 정확한 `retention-overflow` gap을
반환한다. 현재 상태와 최신 sequence는 계속 제공한다. cursor 조회는 해당
sequence 다음 이벤트만 반환한다. 잘못된 binding/run/stream과 미래 cursor는
거절한다. sequence의 안전한 정수 한계는 평가 전에 확인하며 소진되면 새 run이
필요하다. 이 facade에는 reset, reload나 영속 복원 API가 없다. 소유자나 프로세스를
다시 만들 때 호스트가 새 run/stream 식별자를 발급해야 한다. 독립 프로세스 사이의
유일성은 호스트 책임이다. 같은 살아 있는 소유자에 다시 연결하면 상태와 이력을
보존한다.

이 레코드는 소프트웨어 조건 전이를 증명한다. 물리 구동을 증명하지 않는다.
requested, safe, applied와 피드백으로 confirmed된 출력 증거는 계속 구별한다.
명령의 수락, 시작, 완료, 취소와 물리적 확인은 이 알람 전용 형식 밖의 범위다.

## 집중 검증

이 checkout에서 실제 native와 WASM 소유자를 빌드한 뒤 실행한다.

```sh
cargo build --offline --release -p ghostflow-core --example alarm_tape
cargo build --offline --release -p ghostflow-wasm --target wasm32-unknown-unknown
node --test tests/alarm-observation.test.mjs
```

선택자는 `GF-TEST-alarm-provenance`, `GF-TEST-alarm-short-episode`,
`GF-TEST-alarm-history`, `GF-TEST-alarm-atomicity`,
`GF-TEST-alarm-initial-condition`, `GF-TEST-alarm-activation`,
`GF-TEST-alarm-consumer`, `GF-TEST-alarm-schema`다. 같은 소스/descriptor/frame에서
native와 WASM의 전체 결과와 report를 비교한다. 짧은 episode, 반복 true,
새 episode, 같은 timestamp, 첫/후속 스캔 실패, 보존 gap, cursor 식별자,
반환값 불변성, 변조된 provenance, 잘못된 모듈/타입, 관측자 활성화 거절 뒤의
정상 제어 실행을 검증한다.
