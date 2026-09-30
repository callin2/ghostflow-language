<!-- translation-source: docs/INTERACTION-STREAM-CONTRACT.md -->
# Interaction 스트림 계약 설계

[English](INTERACTION-STREAM-CONTRACT.md)

[#74](https://github.com/callin2/ghostflow-language/issues/74)의 설계다.
이 문서는 향후 채택할 호스트/코어 관측 계약의 규범을 정의한다.
생산자, 전송, 보존, 렌더링이나 새 소스 문법을 구현하지 않는다.
[Reference §5.3](reference/05-settings-and-observation.md)은 언어 경계를
유지한다. 그 생명주기 표기는 기존 레코드 enum이 아니다.
#70의 설정은 구현되었지만 command와 alarm descriptor는 아직 구현되지 않았다.
기존 [v0 계약](../contracts/interaction-v0/README.ko.md)은 그대로 유지한다.

## 의미와 책임

| 레코드 | 답하는 질문 | 식별자 |
| --- | --- | --- |
| 완료 스냅샷 | 지금 무엇을 관측할 수 있는가? | 정확한 schema/module/source, run과 완료 scan |
| 순서 있는 이벤트 | 이 실행에서 무엇이 발생했는가? | 정확한 contract/module/source, run, stream, sequence |
| 명령 결과 | 이 요청을 어떻게 처리했는가? | 이벤트 식별자와 command ID 및 request digest |
| 알람 이벤트 | 선언된 어떤 조건이 발생하거나 해제되었는가? | 이벤트 식별자와 descriptor 및 episode ID |

Rust 코어는 공통 생명주기와 실행 식별자를 소유하고 관측 hook을 호출하기
전에 사실을 기록한다. 작성된 프로그램은 도메인 의미를 소유한다.
호스트는 레코드를 내보내고 장기 이력을 소유하며 렌더러는 증거를 소비한다.
이는 승인된 프런트엔드 [ADR-002, revision `8f95786`](https://github.com/callin2/farm_studio_frontend/blob/8f95786/docs/adr-002-runtime-command-lifecycle-and-host-hooks.md)을
따른다. 구현은 별도의 채택 작업이다. 명령 완료는 실행 결과이지 물리적
확인이 아니다. [§4.7](reference/04-sensors-constraints-control.md)은 requested,
safe, applied와 피드백으로 confirmed된 증거를 구별한다.

명시적이고 별도로 버전 관리되는 외부 descriptor 계약은 typed 요청 입력,
요청 형태/권한, 도메인 시작과 완료 증거, 알람 조건/발생/해제 의미를
정확한 소스와 모듈에 연결해야 한다. 각 command/alarm 정의는 공개 `id`,
`kind`, 소스 노드 provenance와 intent anchor를 가진다.
알람 severity는 그 계약에서 선언하는 메타데이터이며 어휘와 의미도 그곳에서
정의한다. 공통 제품 severity를 강제하지 않는다. 이름, Bool 값, callback
이름과 출력 intent로 의미를 추론하지 않는다. 새 `command`, `alarm`이나
severity 소스 키워드는 없다. descriptor 계약은 메타데이터이지 별도의
실행 가능한 제어 프로그램이 아니다.

## 별도의 향후 형식

제안하는 형식은 `GhostFlow/interaction-descriptor-contract-v1`과
`GhostFlow/interaction-stream-v1`이며 각각 `version: 1`이다.
이는 설계용 이름이며 현재 수용하는 형식이 아니다.
`descriptorContract`는 정확한 외부 정의를 연결하고 `schema`는 기존 정적
스냅샷 schema를 별도로 연결한다. 한 digest가 다른 digest를 대신하지 않는다.
digest는 v0 README의 정확하고 엄격한 canonical JSON UTF-8 규칙을 사용한다.
배열 순서 유지, 객체 키 정렬, 잘못된 Unicode 거부, safe integer,
유한 숫자, sparse array 거부와 최대 깊이 64를 포함한다.
descriptor digest는 자체 digest 필드가 없는 전체 descriptor 문서를 대상으로
한다. 요청 digest는 전체 typed 요청 객체를 대상으로 한다.

아래 JSON은 가상의 예다. 0으로 된 digest와 소스 노드는 자리 표시자이며
컴파일된 artifact나 검증된 소스 증거가 아니다.

```json
{
  "format": "GhostFlow/interaction-stream-v1", "version": 1,
  "context": {
    "schema": {"format":"GhostFlow/interaction-schema-v0","version":"0.1","sha256":"0000000000000000000000000000000000000000000000000000000000000000"},
    "descriptorContract": {"format":"GhostFlow/interaction-descriptor-contract-v1","version":1,"sha256":"0000000000000000000000000000000000000000000000000000000000000000"},
    "module": {"id":"example.control","moduleFingerprint":"0000000000000000","bytecodeSha256":"0000000000000000000000000000000000000000000000000000000000000000"},
    "source": {"documentId":"example.document","revisionId":"example.revision","format":"GhostFlow/source-document-v1","kind":"literate","sha256":"0000000000000000000000000000000000000000000000000000000000000000"},
    "runId":"example.run", "streamId":"example.stream"
  },
  "sequence": 21, "logicalTimeMs": 1000,
  "position": {"kind":"completed-scan","scanId":10},
  "descriptorId":"alarm.example",
  "provenance": {"sourceNodeId":7,"intentAnchorIds":["example.intent"]},
  "payload": {"kind":"alarm","transition":"raised","episodeId":"episode.1"}
}
```

채택할 때는 컴파일된 정규 소스 식별자가 제공하는 정확한 format 값을
사용해야 한다. 참조하는 각 형식은 고유한 version 타입을 유지한다.
모든 객체의 필드 집합은 닫혀 있다. 알 수 없는 필드, 중복 JSON 키,
지원하지 않는 format/version, 필수 필드 누락과 잘못된 타입을 거부한다.
확장을 조용히 무시하지 않는다. 생산자가 이 형식을 지원한다고 주장하기
전에 기계 판독 가능한 schema와 적합성 테스트를 공개해야 한다.

## 정규 필드 계약

| 필드 | 필수 의미와 검증 |
| --- | --- |
| `context.schema` | 기존 schema format/version/SHA-256. 제공된 정적 schema와 검증한다. |
| `context.descriptorContract` | 지원하는 format/version/SHA-256. 제공된 정의 및 정확한 module/source 연결과 검증한다. |
| `context.module` | 정확한 공개 ID, 소문자 hex 16자리 fingerprint, 소문자 hex 64자리 bytecode digest. v0 의미를 유지한다. |
| `context.source` | 정확한 document/revision/format/kind/SHA-256. 정규 literate 소스와 v0 의미를 유지한다. |
| `runId`, `streamId` | 비어 있지 않은 불투명 공개 식별자. 함께 하나의 순서 있는 실행 스트림을 식별한다. |
| `sequence` | 음이 아닌 safe integer. 0부터 시작하여 보존 여부와 관계없이 원래 생산된 각 발생마다 1 증가한다. 보존 시 번호를 다시 매기거나 wrap 또는 재사용하지 않는다. |
| `logicalTimeMs` | 음이 아닌 safe integer. 스트림 안에서 감소하지 않는다. 같은 시각이 같은 발생을 뜻하지 않는다. |
| `position` | 정확히 `{"kind":"completed-scan","scanId":N}` 또는 `{"kind":"execution-boundary","boundaryId":"opaque.id"}`. scan ID는 음이 아닌 safe integer이며 boundary ID는 비어 있지 않은 run 내부 식별자다. |
| `descriptorId` | 정확한 descriptor 계약에 있고 payload kind가 일치하는 공개 ID. |
| `provenance` | 정확히 양의 safe integer `sourceNodeId`와 비어 있지 않고 중복 없는 공개 `intentAnchorIds`. 정확한 소스 revision 및 descriptor와 검증한다. |
| `payload` | 아래의 닫힌 command/alarm variant 중 정확히 하나. |

execution-boundary 발생은 요청 거부처럼 scan 완료 전에 일어날 수 있다.
완료 scan을 만들어 내거나 진행 중인 scan을 완료 증거로 사용하면 안 된다.
completed-scan 발생은 실제 commit된 scan을 참조하며 논리 시각도 그 완료와
일치한다. 공개 ID는 예약된 `__gf_` 이름을 거부한다.
소비자의 예상 식별자와 불일치하면 stale이다. 내부 식별자/provenance
모순은 검증 오류다. 표시 이름으로 다른 revision을 연결하지 않는다.

## 명령 생명주기

가상의 received 레코드도 동일한 전체 envelope를 사용한다.

```json
{"format":"GhostFlow/interaction-stream-v1","version":1,
 "context":{
  "schema":{"format":"GhostFlow/interaction-schema-v0","version":"0.1","sha256":"0000000000000000000000000000000000000000000000000000000000000000"},
  "descriptorContract":{"format":"GhostFlow/interaction-descriptor-contract-v1","version":1,"sha256":"0000000000000000000000000000000000000000000000000000000000000000"},
  "module":{"id":"example.control","moduleFingerprint":"0000000000000000","bytecodeSha256":"0000000000000000000000000000000000000000000000000000000000000000"},
  "source":{"documentId":"example.document","revisionId":"example.revision","format":"GhostFlow/source-document-v1","kind":"literate","sha256":"0000000000000000000000000000000000000000000000000000000000000000"},
  "runId":"example.run","streamId":"example.stream"},
 "sequence":23,"logicalTimeMs":1100,
 "position":{"kind":"execution-boundary","boundaryId":"request.1"},
 "descriptorId":"command.example","provenance":{"sourceNodeId":8,"intentAnchorIds":["example.intent"]},
 "payload":{"kind":"command","commandId":"command.1","requestSha256":"0000000000000000000000000000000000000000000000000000000000000000","state":"received"}}
```

command payload는 정확히 `kind: "command"`, `commandId`, `requestSha256`,
`state`와 허용되는 경우 `reason`을 가진다. ID는 비어 있지 않은 run 내부
식별자다. digest는 descriptor에 연결된 정규 typed 요청의 소문자 SHA-256이다.
`reason`은 정확히 `{"code":"public.code","message":"human-readable detail"}`이고
두 문자열은 비어 있지 않아야 한다. reason code는 descriptor 계약에서 선언한다.

```text
received -> rejected
received -> started -> completed | cancelled | failed
```

이 전이는 제안한 관측 레코드 계약의 규범이며 승인된 소스 언어 변경이 아니다.
모든 결과에 앞서 `received`가 있다. `rejected`는 실행이 시작되지 않았음을
뜻한다. `started`는 descriptor가 선언한 도메인 시작 증거를 기록하고
`completed`는 선언한 완료 증거를 기록한다. `cancelled`와 `failed`는 시작
이후의 서로 다른 terminal 결과다. 거부와 실패에는 `reason`이 필수이고
취소에는 명시적 reason을 넣을 수 있다. 시작 전 실행 경계의 실패는 이
그래프에 따라 명시적 reason과 함께 `rejected`로 기록하며 `started`를
만들어 내면 안 된다. received, started와 completed에는 reason을 금지한다.
terminal 상태에는 후속 상태가 없다. 하나의 command ID를 다른 요청이나
descriptor에 재사용할 수 없다. 같은 ID/digest의 재시도는 같은 실행을
식별하며 다시 시작하면 안 된다. 현재 명령 상태는 마지막 유효 생명주기
상태와 원래 sequence/provenance를 보존하며 새로운 발생이 아니다.
생산자는 received부터 시작하는 전체 경로를 기록해야 한다. 명시적 gap 뒤에
소비자가 started나 terminal 결과를 관측하면 이력 불완전 상태로 그 결과를
보존하고 누락 단계를 만들어 내지 않는다. 전이 거부는 검증된 coverage가
관련 이력의 완전성을 입증하는 경우에 적용한다. 명령 중복 방지와 현재
상태는 run 범위에 속하며 같은 run의 재연결이나 수집 스트림 재생성에서도
유지해야 한다. 이를 복구할 수 없으면 호스트는 단순히 stream ID만 바꾸지
말고 새 run 정책에 따라 새로운 run ID를 시작해야 한다.

## 알람 episode와 놓친 갱신

alarm payload는 정확히 `kind: "alarm"`, `transition: "raised" | "cleared"`와
비어 있지 않은 run 내부 `episodeId`를 가진다. 한 descriptor의 inactive에서
active로 가는 새 전이는 새 episode ID를 만든다. 해제는 같은 ID를 사용하며
다른 episode를 해제할 수 없다. active 상태의 반복 관측은 새 raise가 아니다.
선언된 알람 현재 상태와 순서 있는 전이는 서로 다른 관측이다.

| 관측 | 알람 상태 또는 레코드 |
| --- | --- |
| 스냅샷, 완료 scan 9 | Inactive |
| 이벤트, sequence 21, 완료 scan 10 | `raised`, descriptor `alarm.example`, episode `episode.1` |
| 이벤트, sequence 22, 완료 scan 11 | `cleared`, 같은 descriptor와 episode |
| 스냅샷, 완료 scan 12 | Inactive |

scan 9/12 스냅샷은 그 episode를 드러낼 수 없다. 보존된 이벤트는 두 전이를
모두 드러내야 하며 손실되면 명시적 gap을 내보낸다. timestamp나 inactive
스냅샷으로 누락 이력을 복원하지 않는다. 이 표는 향후 알람을 지원하는
관측의 예이며 v0에 alarm descriptor를 넣지 않는다.

## 순서, 보존과 재연결

cursor는 정확히 `(runId, streamId, sequence)`다. 순서는 도착 순서나
timestamp가 아닌 sequence로 정한다. 동일한 sequence에서 정규 레코드 바이트가
같으면 멱등 전달이며 바이트가 다르면 오류다. 소비자는 재정렬된 전달을
buffer할 수 있지만 발생이나 명시적 손실 증거를 받기 전에는 누락 sequence가
완전하다고 선언할 수 없다.

향후 코어 보존은 크기가 제한된 ring, 현재 명령 상태와 명령 class별 최신
결과를 사용한다. class는 외부 descriptor 계약에서 식별한다.
현재 상태 slot과 요청 중복 방지 저장소도 선언된 유한 예산을 가진다.
무제한 요청별 map은 허용하지 않는다. 안전한 식별자 중복 방지나 보호 상태를
그 예산에 넣을 수 없으면 admission을 명시적으로 실패시켜야 한다.
호스트는 회수 전에 레코드를 내보낸다. 유한한 선언 정책은 레코드/바이트
예산, 보호할 critical fault와 latest failed result의 우선순위, 제거 순서와
admission 동작을 명시한다. 보호가 무제한 이력을 약속하지는 않는다.
약속한 보장을 지킬 수 없으면 admission을 거부하거나 선언된 정책에 따라
명시적 손실을 보고한다. 내보낸 장기 이력은 호스트 책임이다.
class별 보호된 현재/최신 실패 상태는 별도 예산 안에서 유지해야 한다.
이를 보존할 수 없으면 조용히 제거하지 말고 admission을 실패시킨다.
우선순위가 있는 critical 이력도 제거하면 항상 gap을 보고한다.
최신/현재 레코드는 현재 상태에 답하지만 발생 이력을 대신하지 않는다.

손실 보고는 sequence가 붙은 도메인 발생이 아닌 별도의 전송 메타데이터다.
보존 범위는 닫힌 보고 `kind: "coverage"`, `runId`, `streamId`,
`latestSequence`, `availableRanges`로 알린다. 생산된 발생이 없으면
`latestSequence`는 null이고 그 외에는 음이 아닌 safe integer다.
각 구간은 정확히 `{fromSequence,toSequence}`이며 양 끝을 포함한다.
경계는 음이 아닌 safe integer이고 `from <= to <= latestSequence`다.
구간은 정렬되어 서로 겹치지 않으며 null이면 배열은 비어 있어야 한다.
생산된 이력은 `0..latestSequence`이고 사용할 수 없는 모든 빈 구간에는
정확한 gap 보고가 필수다. 스트림이 지금 조용해도 마찬가지다.
이는 중간에 보존된 critical 레코드를 포함한 exporter의 제공 범위이지,
생산된 모든 이력을 계속 제공한다는 주장이 아니다.
닫힌 필드는 `kind: "gap"`, `runId`, `streamId`, `fromSequence`,
`toSequence`, `reason`이다. 경계는 음이 아닌 safe integer이고 `from <= to`다.
구간은 양 끝을 포함하며 정확해야 한다. 그 안의 모든 sequence는 이 exporter에서
사용할 수 없다. 인접한 알려진 구간은 합칠 수 있지만 보존된 레코드를 가로질러
합치면 안 된다. 내보내기 전 폐기에는 이 보고가 필수다. 정책의 보존 범위는
내부의 빈 구간도 드러내야 하며 연속적으로 전부 보존되었다고 암시하면 안 된다.

손실 범위를 모르면 별도의 닫힌 보고를 사용한다.
`{"kind":"discontinuity","previousRunId":"old.run","previousStreamId":"old.stream","runId":"new.run","streamId":"new.stream","reason":"history-unavailable"}`.
모든 식별자/reason은 비어 있지 않은 문자열이다. 숫자 경계를 만들어 내지 않는다.
같은 run/stream으로 재연결하면 마지막 수용 cursor부터 재개하고 정확히 알려진
gap을 내보낸다. reset/restart는 run ID를 바꾸고 순서를 복구할 수 없는 재생성은
stream ID를 바꾼다. 어느 쪽이 바뀌어도 새 cursor를 시작하며 명시적
discontinuity가 필수다. 새 epoch의 sequence/scan 0은 이어지는 발생이 아니다.
이 경계를 가로질러 명령이나 알람 episode를 조용히 연결하지 않는다.

## 거부와 채택 gate

| 경우 | 필수 결과 |
| --- | --- |
| 알 수 없는 필드/version, unsafe integer, 잘못된 digest | 레코드 거부. |
| v0 schema/snapshot에 새 command/alarm kind 삽입 | 기존 v0 validator가 거부하며 호환성 규칙을 완화하지 않는다. |
| descriptor/module/source 불일치나 잘못된 anchor | 검증 오류. 이름 기반 fallback 금지. |
| 유효 레코드와 예상 run/source가 다름 | stale 식별자 결과. 필요할 때 명시적 새 cursor 시작. |
| 다른 바이트의 중복 sequence 또는 바뀐 요청의 command ID 재사용 | 식별자 충돌로 거부. |
| 완전한 coverage가 입증된 `received -> completed` 또는 terminal 후속 상태; reason 없는 실패 | 생명주기 위반으로 거부. |
| 명시적 이력 gap 뒤에 관측한 started나 terminal 명령 | 관측 결과를 이력 불완전 상태로 보존하며 누락 단계를 만들어 내지 않는다. |
| 명시적 gap 뒤에 알려진 raise 없는 clear | clear 증거를 보존하고 episode 이력 불완전 표시. raise를 만들어 내지 않는다. |
| 완전히 검증된 이력에서 raise 없는 clear | episode 전이 거부. |
| 재연결/restart에서 범위를 모르는 이력 손실 | 명시적 discontinuity. 정확한 gap을 만들어 내지 않는다. |

향후 채택은 외부 descriptor 직렬화와 검증, 코어 기록과 제한된 보존,
호스트 export/recovery 및 위 gate 모두의 적합성 사례를 정의해야 한다.
모든 terminal 명령 경로, 짧은 알람 episode와 restart도 포함한다.
기존 완료 스냅샷/브라우저 증거는 기존 경로만 입증하며 새 생산자나 물리 동작을
입증하지 않는다. 프런트엔드 [#161 수용 증거](https://github.com/callin2/farm_studio_frontend/issues/161#issuecomment-5679111790)도
기존 Worker/WASM 경로에만 해당한다.
이 설계는 런타임 스트림 생산자나 보존 구현을 제공하지 않는다.
