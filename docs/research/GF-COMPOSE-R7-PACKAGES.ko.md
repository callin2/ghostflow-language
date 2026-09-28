<!-- translation-source: docs/research/GF-COMPOSE-R7-PACKAGES.md -->
[영어 원문](GF-COMPOSE-R7-PACKAGES.md)

# GF-COMPOSE R7: package와 import closure

## 사용자 문제

재사용 가능한 동작은 deployment artifact 생성에 사용된 정확한 source, settings, compiler
identity, trust 증거를 잃지 않고 여러 농장에 설치할 수 있어야 한다. catalog 이름이나
대화 memory가 새 실행 revision을 조용히 선택해서는 안 된다. memory는 provenance/작성
문맥이며 실행 규칙이나 binding 권한이 아니다(R2, system-memory #68에서 확인).

이 연구는 composition의 packaging 선택지 두 개를 비교한다. registry, downloader,
key service, wire-format 변경 또는 ABI를 정의하지 않는다.

## 조사한 revision의 증거

증거는 working-tree `HEAD`인 `ffdbc96461eca67908252507fb851fa4dabd9a2c`에서 조사했다.
현재 v1 package는 정확한 canonical `.ghost.md` source 하나, GFB1 bytes, manifest, source map,
execution identity, `bindingRevision`을 signed payload 아래에 포함한다. source는 byte 단위로
보존되고 SHA-256은 source map으로 연결된다([PORTABLE-PACKAGE](../PORTABLE-PACKAGE.md),
[SOURCE-MAP](../SOURCE-MAP.md)).

`buildPortablePackage`는 source text/compiler revision을 사용하는 새 `compileSource` replay를
요구한다. replay한 GFB/manifest/source map과 제공된 compilation 사이의 모든 불일치를
거부한다([portable-package.mjs](../../tools/portable-package.mjs)). `verifyPortablePackage`는
schema/version, payload digest, active trusted signature, compiler/runtime identity, binding
revision, capability, artifact digest, source-map cross-link를 검사한 뒤 필수 native/WASM
bytecode verifier를 실행한다. native verifier는 target loader 경계다. 물리 작동을 확립하지 않는다.

현재 증거는 단일 source/단일 artifact다. 현재 package field에는 import edge, 완전한 source
closure, definition revision, instance ID, 재사용 가능한 binding-free definition을 표현하는
것이 없다. R2는 불투명 instance identity와 격리된 state/provenance를 제안한다. R3는
composition scheduling/instance 조정을 미정으로 남긴다. R6는 사용자 승인 live property-event
설계를 기록한다. program/run identity가 안정적으로 유지되는 동안 settings revision/effective
position이 바뀐다. 이 event는 binary를 다시 package하거나 redeploy하지 않는다.
settings-to-signature 연결은 미해결이다. package authenticity 약화를 뜻하지 않는다.
이는 설계 결과이며 구현된 package field나 runtime 동작이 아니다.

## 표와 예

### 정확히 두 packaging 선택지

| 선택지 | 정확한 source closure | 불변 import | Compiler replay | Contract/map identity | Binding lifecycle | Signature | Native verifier 영향 |
|---|---|---|---|---|---|---|---|
| Composed compilation을 위한 source bundle 확장 *(제안)* | Root `.ghost.md`와 모든 transitive imported exact source/revision ID/digest 묶음 | Import edge가 definition revision/digest 고정. floating name은 거부하거나 lock 생성 전 해소 | compiler revision으로 전체 locked closure replay. composed GFB/manifest/source map 비교 | 새 composition/closure identity가 각 source revision과 composed artifact 연결 필요. source-map format/ABI 확장 미해결 | 재사용 definition은 site binding 제외. installation package가 binding revision/instance ID를 별도로 join | Ed25519 payload signing/기존 trust snapshot 재사용. closure, edge, artifact, join 서명 | schema/cross-link 검사 및 가능하면 native 상한 확장. 최종 GFB1 bytes/ABI가 호환되면 기존 target loading 유지 가능. 미해결 |
| 기존 artifact를 참조하는 composition envelope 추가 *(제안)* | Envelope가 정확한 기존 package/artifact identity/source digest 나열. 참조를 재귀 해소해야 closure 완전 | 참조가 package/artifact digest/definition revision 고정. catalog alias는 고정된 결과 필요 | 필요한 대로 각 참조 source/artifact replay 후 composition 계약 검증. composed artifact replay 필수 여부 미해결 | 각 package의 기존 source map/identity와 새 envelope/edge identity 보존. cross-artifact map/ABI 미해결 | 기존 package가 binding lifecycle 유지. 재사용 참조가 site binding을 우연히 상속해서는 안 됨 | 각 artifact signature 재사용 및 envelope 서명. trust 순서/envelope signing 필수 여부 미해결 | Native verifier가 참조 package를 개별 검증할 수 있으나 composition-level 검증에는 새 caller 계약/상한 필요 |

첫 선택지는 하나의 결정적 compiler 입력과 composed artifact를 제공한다. 두 번째는
artifact 경계를 보존하지만 resolution, cross-artifact capability identity, 합산 검증을
더 어렵게 만든다. 어느 선택지도 아키텍처 승인되지 않았다.

### 개념적 import lock (예시이며 승인된 schema 아님)

```text
root 조합: farm-irrigation@composition-rev-17
root source: sha256:ROOT...17
instance: east-zone-01 -> definition irrigation-controller@rev-42 / sha256:DEF...42
instance: west-zone-02 -> definition irrigation-controller@rev-42 / sha256:DEF...42
imports:
  irrigation-controller@rev-42
    -> rain-policy@rev-8 / sha256:RAIN...08
transitive closure: ROOT...17, DEF...42, RAIN...08
```

instance ID 두 개는 서로 다르면서 같은 definition digest를 고정한다. definition revision과
transitive dependency는 공유된다. state, timer, logical-port 한정, settings join,
installation binding, runtime provenance는 instance별로 생성된다. catalog entry 이름 변경은
어느 lock도 바꾸지 않는다. 배포 가능한 package의 `bindingRevision`은 installation join에
속하며 보편적으로 재사용할 definition에 속하지 않는다.

### 해소와 거부

| 조건 | 필요한 결정적 동작 | 기존 범위 | 필요한 확장 |
|---|---|---|---|
| Import 부재 | compilation/package 승인 전에 거부. 없는 고정 edge 식별 | 현재 package에 import resolution 없음 | Closure resolver와 안정적 error/owner 계약 |
| 순환 import | lowering 전에 실행 import cycle 거부. display graph에서 순서 추론 금지. same-scan dependency cycle에는 명시적 거부/정의 정책 결정 필요. prior-scan state edge는 별개 | Composition cycle 검사 없음 | Resolver cycle 탐지/명시적 same-scan 정책. prior-scan state 의미는 R3 실행 결정으로 유지 |
| 고정 결과 없는 mutable/floating 참조 | 거부. name/latest tag/memory 주장은 revision이 아님 | 현재 package는 정확한 embedded source 요구 | Lock 생성은 불변 revision/digest 요구 필요 |
| Digest 불일치 | compiler/target load 전에 거부. edge/artifact 불일치 보고 | 기존 source/bytecode/manifest/map/payload/replay digest 검사 | 같은 검사를 재귀적으로 및 closure identity에 적용 |
| 미지원 version/capability | target load 전에 package/composition 거부 | 기존 package/runtime/ABI/manifest/version/required-capability 검사 | Imported capability와 composition 계약 합산. 명시적 소유자 경계 보존 |
| 수용할 수 없는 signature | Active trusted non-revoked signature가 없으면 거부 | 기존 Ed25519/trust snapshot/rotation/revocation 검사 | Envelope signature 필수 여부와 trust 조합 방법 정의 |

## 권고

검토를 조건으로 **composed compilation을 위한 source bundle 확장**을 권고한다. 가장 작은
의미 확장을 제공한다. locked source closure 하나, 결정적 replay 하나, composed artifact
하나와 현재 payload digest, Ed25519 trust, capability 검증, source-map 연결, native/WASM
target 검증을 재사용한다. 또한 correctness를 coordinator에 미루는 대신 부재/mutable
dependency를 deployment 전에 실패시킨다.

불변 import-closure lock을 deployment/runtime 문맥과 분리한다. lock은 source/definition
revision, import edge, 정확한 digest를 고정한다. deployment/runtime 문맥은 instance ID,
installation/binding revision, program/compiler/runtime identity, settings revision/effective
position, run identity를 별도로 join한다. live property event는 program bytes, 재package,
redeployment, run identity 변경 없이 settings identity를 바꾼다. 두 instance는 definition
digest를 공유할 수 있지만 암묵 state를 공유하거나 binding을 조용히 상속해서는 안 된다.
재사용 export에서 제외되는 현장 data는 farm/site identity, physical endpoint/channel mapping,
device profile/firmware 증거, installation binding revision, credential, operator/farmer record,
비공개 대화/memory 내용, runtime state, timer, run history, instance settings다. instance
settings는 불변 import parameter로 명시적으로 선언된 경우만 예외다. API는 revision/deployment
orchestration을 소유한다. Device는 physical profile/applied-binding 증거를 소유한다.

### Definition upgrade walkthrough

API는 새 source digest/locked dependency closure를 가진 `irrigation-controller@rev-43`을 만든다.
upgrade에 명시적으로 선택된 instance만 새 instance-to-definition provenance edge를 받는다.
각 영향 instance는 선택한 방식으로 재컴파일/재검증된다. bytes가 바뀌면 새 module, manifest,
source-map, composed-artifact digest를 만든다. settings/installation join은 호환성 검사를
받는다. API가 새 package를 선택할 때까지 이전 instance/package는 설명 가능한 이전 deployment로
남는다. 이 program/firmware 갱신은 해당 ESP 전체 controller maintenance stop을 사용한다.
일반 property event는 그렇지 않다. deployment package는 새 정확한 closure를 서명하고
compiler/runtime identity/installation binding join을 기록한다. 여기의 어느 주장도 device가
활성화했거나 pump가 움직였다는 뜻이 아니다.

여러 source document의 source-map 표현, composed ABI identity, 합산 capability 이름,
native 검증이 최종 GFB1 하나를 받는지 envelope를 검증하는지는 미해결이다. 이 빈틈의
호환성 동작을 조용히 선택하지 않는다.

## 미해결 질문과 소유자

- Language + API 소유자: lock/closure record, definition revision, import edge identity,
  canonical 순서, missing/cycle error 계약 정의.
- Compiler/runtime 소유자: composition이 호환되는 GFB1 module 하나를 내보내는지
  ABI/runtime 확장이 필요한지 결정. R3 실행 constraint 적용.
- Source-map/계약 소유자: 현재 source-document cross-link를 깨뜨리지 않고 multi-source
  좌표/composed map identity 정의.
- Package/native verifier 소유자: recursive artifact 검증과 하나의 signed composition
  envelope 선택, 상한, trust 순서, 안정적인 error 결정.
- API/deployment 소유자: instance upgrade 선택, live settings-event join과 미해결
  authenticity 연결, binding lifecycle, deployment-package lineage 정의.
  property event는 재package를 뜻하지 않는다.
- Device 소유자: applied binding 증거 정의. package 검증은 hardware 검증이 아니다.
- System/API 소유자: memory를 provenance/작성 문맥으로 보존하고 retention/deletion 연결
  정의. memory가 단독으로 실행을 고정할 수 없다.

## 검증

- [x] 조사한 commit 기록. package/compiler/source-map/portable-package 테스트의 필요한 절 읽음.
- [x] 요구된 모든 column에서 정확히 두 packaging 선택지 비교.
- [x] Lock 예에 root composition revision, instance ID 두 개, 공유 definition digest,
  정확한 dependency revision/digest, transitive dependency 포함.
- [x] 여섯 거부 종류 모두 현재 범위와 필요한 composition 확장 구분.
- [x] Upgrade walkthrough가 source/artifact/provenance/deployment 영향을 분리하고 현장 data 제외.
- [x] 구현 주장, 제안, 수작업 예를 구분해 표시. runtime 테스트 실행/주장 없음.
Coordinator acceptance 검사는 `git diff --check`, 상대 link 검토, 관련 없는 문서 불변 확인이다.
Runtime 테스트를 실행하거나 주장하지 않았다.
