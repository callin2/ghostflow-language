<!-- translation-source: docs/TARGET-QUERY.md -->
[영어 원문](TARGET-QUERY.md)

# Target contract query

이 순수 호스트 API는 호출자가 제공한 GhostFlow target을 설명한다. Device에 접속하거나 설치된 하드웨어를 검색하지 않고, 보고를 인증하거나 향후 사용 가능성을 약속하지도 않는다. 이 문서는 [#562](https://github.com/callin2/ghostflow-language/issues/562)에서 추적하며, 공통 계약 작업인 [#565](https://github.com/callin2/ghostflow-language/issues/565)을 사용한다.

`queryTarget(request)`는 `tools/target-query.mjs`에서 내보낸다. `node tools/ghostdescribe.mjs --request request.json --format json`은 JSON 또는 TOON 요청을 읽고 JSON 또는 TOON 결과를 쓴다. CLI의 기본 형식은 TOON이다. 형식이 잘못된 입력을 API에 전달하면 `TargetQueryError`가 발생하고, CLI는 크기가 제한된 `rejected` 결과를 출력한 뒤 종료 코드 1로 끝난다. 조회 자체에서는 두 경로 모두 시계, 파일시스템, 네트워크, 컴파일러 또는 기기를 사용하지 않는다. CLI는 요청 파일만 읽는다. `asOf`와 `maxAgeMs`는 필수이므로 같은 요청은 같은 답을 낸다.

## 요청

최상위 객체에는 `schema`, `asOf`, `maxAgeMs`, `target`이 정확히 있어야 하며, `installed`, `observations`, `filter`는 선택 항목이다.

| 필드 | 형태와 의미 |
| --- | --- |
| `schema` | 정확한 문자열 `GhostFlow/target-query-v1`. |
| `asOf` | 밀리초를 포함하는 정규 UTC ISO timestamp. 예: `2000-01-01T00:00:10.000Z`. |
| `maxAgeMs` | 정수 0–31,536,000,000. `asOf - observedAt > maxAgeMs`이면 보고는 오래된(stale) 상태이고, `asOf`보다 뒤의 시각이면 미래(future) 보고다. |
| `target` | 아래에 정의한 선언 객체. |
| `installed` | 아래 설치 보고 객체(선택). 이 필드가 있다는 사실만으로 현재 상태이거나 target과 일치한다고 볼 수 없다. |
| `observations` | 관측 스냅샷 배열(선택). 생략하면 관측이 없는 것으로 본다. |
| `filter` | 아래에 정의한 명시적 필터(선택). 생략하면 선언된 모든 채널을 선택하고 예시는 선택하지 않는다. |

`target`에는 `id`, `release`, `boardProfile`, `installation`, `drivers`, `channels`가 필요하며 `examples`를 포함할 수 있다. `release`, `boardProfile`, `installation`은 기존의 `integration-release-v1`, `board-profile-v1`, `installation-mapping-v1` 객체다. `validateReleaseIdentity`가 고정된 정확한 identity와 SHA-256 hash를 검사한다. profile과 mapping은 예정된 논리 바인딩을 포함한 **선언** 계획이며 설치 증거가 아니다. `id`는 명시적인 target 식별자다. release runtime semantics, protocol, firmware SHA, profile 및 mapping 참조는 선언된 사실로 결과에 나타난다.

`drivers`는 고유한 `{ id, version, sha256 }` 객체의 배열이다. board profile의 모든 endpoint에는 버전이 지정된 `driver` 참조가 있어야 한다. `channels`에는 각 profile endpoint마다 정확히 하나의 record가 있어야 하며, 고유한 `id`는 endpoint 이름과 같아야 한다. 각 record에는 `id`가 필요하고, `unit`(문자열), `updatePeriodMs`(양의 정수), `features`(고유한 문자열 배열), `resources`(고유한 문자열 배열)는 선택 사항이다. 방향과 type은 고정된 profile에서, 논리 이름은 고정된 mapping에서 가져온다. 단위, 갱신률, feature, resource 또는 하드웨어 기본값을 추론하지 않는다. Resource ID는 호출자가 정의한 제약 조건을 가리킨다. 이 조회는 resource의 물리적 의미를 정의하거나 검색하지 않는다. `resources`를 생략하면 제약 조건은 알 수 없는 상태이며 `available` 판정을 막는다. `resources: []`를 명시하면 이 선언에는 resource 제약 조건이 없다는 뜻이다.

선택 예시는 각각 `{ id, ref, tags, channels }` 형태다. `id`는 고유해야 한다. `tags`와 `channels`는 비어 있지 않은 고유 문자열 배열이어야 하며, 각 channel은 선언에 존재해야 한다. `ref`는 불투명한 참조다. 조회는 그 내용을 읽거나 검증하지 않는다.

`installed`에는 `{ targetId, bootId, releaseSha256, drivers, observedAt, evidenceRef }`가 필요하다. `releaseSha256`은 `tools/integration-contract.mjs`의 `jsonSha256(target.release)`이며, `drivers`에는 정확히 선언된 ID, version, SHA-256 digest가 나열되어야 한다. identity가 일치하고 시각이 최신일 때만 보고 상태는 `installed_reported`다. 이 값은 여전히 제공된 보고이며, 독립적으로 검증한 설치 결과가 아니다.

각 관측에는 같은 identity 필드와 `channels`, `resources`가 필요하며, 각각 고유한 `{ id, state }` 항목 배열이다. state는 `available`, `busy`, `reserved` 중 하나다. 관측은 target, 설치 boot ID, release SHA 및 전체 driver 참조와 일치해야 하며, 설치 보고 자체도 최신이고 일치해야 한다. 설치 보고와 연결되지 않은 관측은 `unlinked_installation`이다. 모든 관측에는 명시적인 `evidenceRef`와 정규 `observedAt`이 있어야 한다. 이는 호출자가 제공한 출처 표시이지 인증된 증거가 아니다.

`filter`는 `channels`, `directions`, `types`, `features`, `contractVersions`, `exampleTags`를 지원한다. 필드가 있으면 비어 있지 않은 고유 문자열 배열이어야 한다. `channels`, `directions`, `types`, `contractVersions` 안의 값은 OR로 결합하고, 서로 다른 필드는 AND로 결합한다. 요청한 모든 feature는 channel에 선언되어 있어야 한다. `contractVersions`는 channel driver의 정확한 `version`을 뜻하며 release protocol, bytecode, runtime 또는 firmware version을 뜻하지 않는다. 알 수 없는 값은 채널 0개를 반환한다. `directions`에는 `input`과 `output`만 허용된다. `exampleTags`가 제공되고 요청 tag 중 하나 이상이 일치하며 example이 선택된 channel을 하나 이상 지정할 때만 예시가 결과에 포함된다. 의미상 유사성이나 추정한 관련성은 사용하지 않는다.

## 결과와 한도

결과 schema는 `GhostFlow/target-query-result-v1`이다. 결과에는 `asOf`, `targetId`, `requestSha256`, `targetSha256`, `declared`, `installation`, `channels`, `examples`, `diagnostics`, `suppliedEvidence`가 포함된다. 두 SHA-256 필드는 제공된 전체 request와 target 선언을 정규 JSON으로 직렬화해 계산한 digest이므로 결과를 정확한 입력에 연결할 수 있다. 선택된 각 channel에는 선언 identity, driver, 논리 이름, 제공된 선택 메타데이터, `installation`, `observation`, `availability`가 포함된다. 빠진 메타데이터는 계속 생략된 상태로 둔다. 설치 상태는 `unknown` 또는 `installed_reported`이며, 관측 상태는 `unknown` 또는 **해당 channel에 대해** `observed`다. 가용성은 `unknown`, `available`, `busy`, `reserved`, `conflict` 중 하나다. 해당 channel에 연결된 최신 state가 하나 이상 있고, resource 제약 조건을 명시적으로 선언했으며, 선언된 모든 resource state가 존재하고 모두 available일 때에만 available이다. 최신 연결 state끼리 하나라도 다르면 보고 순서나 최신성에 상관없이 `conflict`가 된다. 이미 conflict가 있지 않은 한 state 누락은 unknown이다. `diagnostics`에는 잘못된 보고의 source/index/evidence 참조, 관측 시각, target 및 boot ID, 그리고 `target_mismatch`, `boot_mismatch`, `release_mismatch`, `driver_mismatch`, `stale`, `future`, `unlinked_installation` 같은 code가 기록된다. 유효하지 않은 보고는 가용성 판정에 사용되지 않는다. `suppliedEvidence`에는 제공된 설치 및 관측 보고의 분리된 복사본과 정확한 참조, 시각, target, boot, release/driver identity, channel/resource state, `linked_fresh` 또는 `excluded` 상태가 보존된다. 이는 계속 호출자가 제공한 주장이다.

순수 API는 입력을 복사해 스냅샷을 만들며 호출자 객체와 별칭을 공유하지 않는 데이터를 반환한다. 입력은 순환이 없는 JSON 데이터여야 하며, 직렬화한 UTF-8 기준 최대 262,144 bytes, 깊이 16, 방문 노드 12,000개, 일반 컨테이너당 요소 또는 key 1,024개, 일반 문자열 4,096자로 제한된다. 계약별 목록의 한도는 더 작다. channel 최대 256개, observation/driver/example 최대 128개, record당 feature/resource/tag 최대 32개다. 식별자와 참조는 최대 256자다. 중복 ID 또는 filter 값, 비어 있는 제공 filter 배열, 예상하지 않은 필드, 희소 배열, 정규 형식이 아닌 timestamp는 거부한다. CLI도 parsing 전에 입력 파일을 262,144 bytes로 제한한다. 완전한 결과는 UTF-8 기준 65,536 bytes를 넘을 수 없다. 확장된 결과가 이 한도를 넘으면 API는 `outcome: "incomplete"` envelope를 반환하며, 여기에 `output_limit`, 정확한 입력 digest가 포함되고 일부 channel 답변은 포함되지 않는다. CLI는 종료 코드 1로 끝난다. 제공된 보고나 필터 범위를 좁혀 다시 시도한다.

## 허구의 실행 가능한 예시

이 예시는 저장소의 [허구 integration fixture](../contracts/integration-v1/examples/fictional-fixture.json)를 사용한다. label, identity 및 증거는 만들어낸 값이며 기기 결과나 배포 가능한 프로그램이 아니다. 저장소 root에서 실행한다.

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { queryTarget, TARGET_QUERY_SCHEMA } from './tools/target-query.mjs';
const f = JSON.parse(readFileSync('contracts/integration-v1/examples/fictional-fixture.json', 'utf8'));
const result = queryTarget({
  schema: TARGET_QUERY_SCHEMA,
  asOf: '2000-01-01T00:00:10.000Z',
  maxAgeMs: 5000,
  target: {
    id: 'fictional-target', release: f.release,
    boardProfile: f.boardProfile, installation: f.installation,
    drivers: [
      { id: 'fixture-relay-expander', version: 'fictional-v1', sha256: '3'.repeat(64) },
      { id: 'fixture-input-driver', version: 'fictional-v1', sha256: '4'.repeat(64) },
    ],
    channels: [{ id: 'relay.1' }, { id: 'relay.2' }, { id: 'input.1' }],
  },
  filter: { channels: ['relay.1'] },
});
console.log(result.channels[0].availability); // unknown
JS
```

호출자가 제공하는 설치 및 관측 보고에 따라 조회 결과를 현재 보고된 상태로 바꿀 수 있다. 그 상태는 `asOf`와 제공된 증거에만 연결된다. 예약, 권한 검사 또는 물리적 작동 결과를 뜻하지 않는다.
