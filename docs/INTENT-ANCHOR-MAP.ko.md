<!-- translation-source: docs/INTENT-ANCHOR-MAP.md -->
[영어 원문](INTENT-ANCHOR-MAP.md)

# Literate intent anchor map

상태: LS-1c 주요 구현 계약, 2026-09-15. 추적:
language 이슈 #60 / integration 이슈 #17 / local TASK-112.

이는 의도적으로 작고 추가적인 source-provenance 계층이다. 실행 GhostFlow construct를
추가하거나 GFB1 byte/strict control manifest를 바꾸거나 metadata가 runtime output에
영향을 주게 하지 않는다. 작성 `.ghost.md` 문서가 유일한 canonical 제품 source로 남는다.
생성 map은 편집 가능한 두 번째 source가 아니다.

## 존재 이유

정확한 literate 문서/compiler node 위치는 이미 보존된다. 이는 “이 output은 어디서
계산되는가?”에 답하지만 “어떤 명시 intent/premise가 이 계산을 이끌었는가?”에는 답하지
못한다. LS-1c는 명시적 연결을 추가한다. compiler는 작성자가 제공한 것만 검증한다.
intent 추론, tacit knowledge 발견, AI 가정 승인을 하지 않는다.

## 최소 작성 형식

anchor는 독립된 top-level Markdown HTML comment이며 바로 뒤에 top-level paragraph 또는
block quote 하나가 온다.

```markdown
<!-- ghostflow:anchor id=GF-INT-PUMP-001 kind=intent status=confirmed origin=user -->
> 급수 요청 스위치를 켜면 펌프를 켜 주세요.
```

comment는 렌더링되지 않는 metadata다. 다음 block이 anchor의 원문이다. CommonMark가
둘을 top-level block으로 분리하므로 comment/block 사이 빈 줄을 허용한다. heading, list,
nested block, code fence, 다른 anchor, 문서 끝은 anchor body가 아니다. block 하나는 source
범위/검토 단위를 명확히 한다. 긴 설명은 여러 anchor나 일반 unanchored prose를 사용한다.

v1의 field와 순서는 정확히 다음과 같다.

- `id`: `[A-Za-z][A-Za-z0-9._:-]{0,127}`. 한 문서에서 고유하며 같은 intent가 유지되는
  문구 revision에 걸쳐 안정적이다.
- `kind`: `intent`, `premise`, `assumption`.
- `status`: `confirmed`, `unconfirmed`, `superseded`.
- `origin`: `user`, `operator`, `engineer`, `ai`, `imported`.

`assumption`은 `unconfirmed`/`superseded`일 수 있지만 `confirmed`일 수 없다. 사람이 확인하면
canonical source는 `intent`/`premise`로 재분류한다. 이전 assumption은 현재 실행 link 없이
`superseded` prose로 남을 수 있다. `superseded` anchor는 현재 node에 link할 수 없다.
이 검사는 AI 추측이 조용히 confirmed intent가 되는 것을 막는다. 제품 승인 workflow를
정의하지 않는다.

link는 실행 `ghost` fence 안의 정확한 whole-line comment다.

```ghost
// ghostflow:link id=GF-INT-PUMP-001 relation=implements
pump <- request;
```

field/순서는 정확하다. `relation`은 다음 중 하나다.

- `implements`: node가 명시 동작을 구현한다.
- `constrains`: node가 intent/premise를 위해 동작을 제한한다.
- `fallback`: node가 명시적인 degraded-time/data 정책을 구현한다.
- `assumes`: 후보 node가 현재 unconfirmed assumption에 의존한다.

연속 link 행 하나 이상이 같은 statement를 target으로 할 수 있다. target은 바로 다음
추적 가능한 top-level 선언/statement다. 빈 줄, 일반 comment, nested expression, control
header, fence 끝은 orphan link를 만들며 error다. 지원 v1 target kind는 parser의 top-level
선언/statement인 `input`, `output`, `state`, `config`, `let`, `enum`, `function`, `sensor`,
`signal`, `schedule`, `timer`, `require`, `mutex`, `next`, `connection`이다.

Relation/classification 검사는 의도적으로 좁다.

- `assumes`는 `status=unconfirmed`인 `assumption`을 참조해야 한다.
- 다른 relation은 `assumption`을 참조할 수 없다.
- 모든 relation은 `superseded` anchor를 참조할 수 없다.

unconfirmed 후보를 simulation, 검토, 승인, 배포할 수 있는지는 host/제품 정책이다.
언어 artifact는 사실을 보존하며 release를 조용히 허용하거나 금지하지 않는다.

## 파생 metadata

anchor/link를 포함한 literate source의 기존 `GhostFlow/source-trace-v1` companion에는
선택적 array 두 개가 추가된다. 이 기능이 없는 source는 기존 형태/동작을 유지한다.

`intentAnchors[]`는 다음을 포함한다.

- 작성 그대로의 `id`, `kind`, `status`, `origin`.
- `directiveSource`: anchor directive의 원본 Markdown 위치.
- `source`: 다음 paragraph/block quote의 원본 Markdown 범위.

`intentLinks[]`는 다음을 포함한다.

- 작성 그대로의 `anchorId`, `relation`.
- 권위 compiler AST의 `nodeId`, `nodeKind`.
- `directiveSource`: link comment의 원본 Markdown 위치.
- `source`: 권위 target node 위치.
- literate compilation에만 있는 `extractedDirectiveSource`, `extractedSource`.
  기존 trace처럼 code-fence 좌표계를 유지한다.

array는 anchored prose를 복사/정규화하지 않는다. consumer는 이미 검증된
`sourceDocument.text`의 기록 범위를 slice해 정확한 text를 얻는다. 별도로 유지할 두 번째
text 복사본을 만들지 않는다.

companion은 계속 `sourceDocumentSha256`/`bytecodeSha256`을 포함한다. strict recovery는
두 revision identity, 모든 anchor/link 형태, 고유 ID, relation/classification 호환성,
target node ID/kind/location, 선택 문서 안 directive/source 위치를 검증한다. unknown
field/enum 값, 중복 anchor/동일 link 중복, anchor 부재, orphan link, 제공 source map과
불일치하는 metadata node/location, 혼합 revision, 범위 밖 위치를 거부한다. verifier는
없는 link를 재구성하거나 추측하지 않는다.

이 local recovery API는 내부 일관성을 증명하며 authenticity를 증명하지 않는다. source map
전체를 교체할 수 있는 공격자는 node와 일치 metadata를 함께 교체할 수 있다.
authenticity에는 signed payload가 source-map digest를 포함하는 기존 portable package
verifier 또는 검증 source document에서 수행한 trusted deterministic compiler replay가 필요하다.
LS-1c는 unsigned standalone map이 동시 교체를 탐지한다고 주장해서는 안 된다.

## 가져온 의도의 provenance

고정된 composition은 인스턴스화된 각 정의의 작성 의도를 보존한다. Root의
`intentAnchors`와 `intentLinks`는 root 문서 범위를 유지한다. 가져온 인스턴스에
anchor나 link가 있으면 compiler는 `traceMetadata.compositionIntent`를 추가한다.
이 container의 필드는 다음과 같다.

- `format`은 `GhostFlow/composition-intent-v1`이다.
- `sourceClosureSha256`은 `canonicalJson(sourceClosure)`의 SHA-256이다.
- `instances`는 결정적인 순회 순서의 group이다. 각 group에는 `east` 또는
  `outer.inside`처럼 작성된 `instance` 경로와, 고정된 `filename`, `revision`,
  정확한 문서 `sha256`을 담은 `definition`이 있다.
- 각 group의 `anchors`는 원본 anchor 필드를 보존한다. `links`는 원본 link 필드를
  보존하며 조합된 `nodeId`와 원본 `definitionNodeId`를 담는다.

Anchor ID의 범위는 해당 문서다. Root, 서로 다른 두 정의, 같은 정의의 여러
인스턴스가 같은 ID를 사용할 수 있다. Group이 namespace를 제공하며 compiler는
ID를 다시 쓰거나 생성된 변수 이름에서 인스턴스 identity를 추론하지 않는다.
가져온 AI assumption은 `origin=ai`, `kind=assumption`, `status=unconfirmed`를
유지한다. Import는 이를 확인된 의도로 바꾸거나 origin을 변경하지 않는다.

Compiler는 각 정의의 원본 AST로 link를 검증한 뒤 조합된 node에 연결한다.
원본 Markdown 위치와 추출된 code 위치는 구분해 보존한다. Composition이 실행 선언을
제거해도 input과 output 선언의 link는 남는다. 사용하지 않는 import 문서는 검증된
closure에 남지만 instance group을 만들지 않는다. Root revision identity는 필요한
곳에서 호출자가 제공하며 composition이 만들어내지 않는다.

Artifact 복원과 서명된 portable-package 검증은 정확한 closure를 다시 컴파일해
모든 provenance를 비교한다. 누락되거나 변경된 group, 정의 identity, closure digest,
node ID, 위치, 분류, relation을 거부한다. 독립 문서 trace validator는 composition
container를 거부한다. 정의의 설명만 바꾸면 provenance와 pin은 바뀌며, 실행 token이
같으면 bytecode는 유지된다.

Root의 `intentEvidence`는 root anchor와 root에 link된 node만 참조할 수 있다.
같은 anchor ID로 가져온 node를 주장할 수 없다. 현재 Interaction schema는 가져온
의도 group을 표현할 수 없어 해당 projection 요청을 명시적으로 거부한다.
일반 컴파일과 실행은 해당 group을 허용한다. 공개 profile과 host 설명 연결은
[#290](https://github.com/callin2/ghostflow-language/issues/290) 및
[#302](https://github.com/callin2/ghostflow-language/issues/302)의 별도 작업이다.

## 추출과 호환성

- CommonMark가 top-level Markdown block을 결정한다. fenced/inline code, multi-line/enclosing
  HTML block, nested block, front matter의 text처럼 보이는 directive는 Markdown anchor가 아니다.
- 이전처럼 top-level `ghost` fence만 실행한다. link comment는 GhostFlow lexer에 일반 `//`
  comment로 남아 opcode를 만들지 않는다.
- Plain `.ghost`는 역사적 증거일 뿐이며 제품 compiler가 거부한다. anchor namespace나
  실행 fallback을 제공할 수 없다.
- anchor/link directive가 없는 문서는 이전과 같은 code, GFB bytes, node ID, 진단,
  manifest, runtime 동작을 만든다.
- prose/comment만 바꿔도 `sourceDocument.sha256`은 바뀐다. 실행 token 구조가 불변이면
  GFB bytes/compiler node ID는 불변이다. 원본 문서 위치는 이동할 수 있으며 revision에 결속된다.

## 진단과 acceptance vector

### 기본 동작 범위 경고 (#553)

compiler, CLI 및 package 생성은 기본적으로 intent-link 범위 경고를 보고한다.
`GF_INTENT_LINK_MISSING`은 link되지 않은 top-level `connection`, `next`,
`require`, `mutex`, `let`, `function`, `signal`, `schedule`, `timer` 문장마다
적용된다. link는 자신의 target 문장만 포함한다. 선언에 link를 달아도 뒤의 동작까지
포함하지 않는다. 단독 `input`,
`output`, `state`, `config`, `parameter`, `enum` 선언은 집계하지 않는다. 이 검사는
구조와 문장 단위만 확인하며 전이 동작을 추론하거나 assertion을 증명하거나 의도가
옳거나 확인되었는지 판정하지 않는다. 명시된 활성 link는 미확인 assumption을
설명하는 경우에도 이 검사를 충족하지만, 해당 상태는 계속 미확인이다.

현재 계약에 link target이 없는 동작 소유자는 `GF_INTENT_LINK_COVERAGE_UNSUPPORTED`로
보고한다. 대상은 top-level `adapt`, `objective`, `account`, `account-constraints`,
`local-constraints`, `shared-constraints`, `adapt-setting`, `degraded`와 nested
`connection`, `connect`, `next`, `require`, `mutex` 문장이다. 다른 문장에 link가
있어도 이 경고는 발생한다. 안내문은 orphan link를 추가하지 말라고 하며, 복사 가능한
예시는 독립 구문 예시일 뿐 즉시 적용할 수정이 아니라고 설명한다. 이 대상 지원에는
별도의 계약 변경이 필요하다. 독립된 non-executable resource-policy descriptor는
검사에서 제외된다.

경고에는 원본 source 범위, 복사해 쓸 수 있는 anchor/link 예시, 실행 가능한 안내가
포함된다. 예시는 정책을 미확인 AI assumption으로 표시하고 `recover(false)`를 명시적인
예시 fault 정책으로 사용한다. 최대 20개 경고 record를 반환한다. 20개를 초과하면
collection에 `limit: 20`, `truncated: true`를 표시한다. 정확히 20개이면 잘림을 뜻하지
않는다. 가져온 정의는 인스턴스화될 때 원본 문장마다 한 번 경고하며, 사용하지 않는
import는 이 경고를 만들지 않는다. 가져온 link는 그 정의의 해당 문장만 포함한다.
안내문은 원본 정의 문서에서 작성하도록 안내한다. Root link는 가져온 문장을
포함할 수 없다.

이 경고는 지원되는 link 대상 top-level 동작과 link 지원이 없는 알려진 동작 소유자를
다루며 의미의 완전성을 주장하지 않는다. 기존 malformed, orphan, missing-anchor 및
interaction-schema 진단 동작은 유지된다. 이 경고는 실행 구문, GFB 바이트 또는 runtime
동작을 추가하지 않는다.

진단은 원본 filename/line/column을 식별하며 다음을 다룬다.

1. 유효 confirmed intent→output, premise→constraint, fallback→schedule,
   unconfirmed assumption→candidate-node link.
2. 잘못되거나 unknown인 field, 중복 ID, 부재/invalid body block.
3. unknown, superseded, classification 비호환 anchor 참조.
4. orphan directive, nested target, 동일 link 중복.
5. 저장 source/bytecode revision 불일치, metadata/node 비일관성, source-range tampering,
   signed-package source-map 교체.
6. 동일 GFB bytes/node ID를 유지하는 prose/comment만의 revision 변경.
7. 기존 literate, plain-source, source-map, package, native, WASM 동작 불변.

acceptance는 compiler/source-map 증거일 뿐이다. frontend navigation, firmware 통합,
GPIO output, relay 움직임, physical load 증거가 아니다.

## Compiler constraint derivation (#31, 한정 acceptance)

compiler는 작성된 모든 `require`에 선택적 `traceMetadata.derivations`를 추가한다.
이 record는 현재 constraint lowering을 설명한다. source, manifest, bytecode, runtime
동작을 바꾸지 않는다. 작성 `mutex`에는 derivation record가 없다.

각 record는 다음을 포함한다.

- `id`: `require:<nodeId>`. 이 revision의 작성 require 식별.
- `nodeId`와 정렬된 `originNodeIds`: require와 모든 원본 expression node. lowering에서
  제거/평탄화된 operator/output 참조 포함. 불변 source map/intent link에 join한다.
  source text/anchor classification이 권위를 유지한다. assumption은 unconfirmed로 남는다.
- `target`: compiled constraint `index`, `kind`, 순서 있는 `names`.
- `rule`: `require-implication-to-requires-v1`,
  `require-disjunction-to-requires-any-v1`, `require-negated-conjunction-to-mutex-v1`.
- `scope`: `same-module-bool-output-constraint`; `relation`: `lowered-as`;
  `status`: `compiler-derived`; `semanticVerification`: `not-proven`.

기존 document SHA-256/bytecode SHA-256이 record를 정확한 source/compiled revision에 결속한다.
source-map recovery/portable-package 검증은 canonical compiler replay로 완전한 record를
재도출/비교한다. missing/extra/altered record와 미지원 proof/status 주장은 거부된다.
replay는 compiler 일관성을 확립하며 semantic equivalence, runtime 평가, 추론된 충족,
output 차단, physical 증거를 확립하지 않는다.

특히 `require !(a && b && c)`는 현재 `mutex(a,b,c)`로 lowering된다. 정확히 두 output이
true일 때 일반 Boolean not-all과 at-most-one은 다르다. 따라서 replay 성공 후에도 record는
`not-proven`으로 남아야 한다. 두 output 사례와 평탄화 disjunction은 provenance 보존을
검사한다. 이 변경은 세 output 언어 동작을 결정하거나 바꾸지 않는다.

#31의 기존 anchor acceptance와 현재 lowering provenance는 다뤄진다. 추가 eliminated-check/
replacement-guarantee 및 merged-node proof acceptance는 #42의 열린 작업으로 남는다.
향후 pass는 verified replacement relation 주장 전에 독립 검증 semantic 증거를 공급해야 한다.
이 metadata는 CSE engine, SMT solver, proof framework가 아니다.

## 의도적인 비목표

- 자연어 해석, tacit premise 발견, 확인 UI, 권한, deployment 승인.
- 식별 실행 경로 causality 또는 모든 static read가 output 원인이었다는 주장.
- SMT/BDD 최적화/proof 생성. #42는 나중에 같은 안정적 anchor/node identity에 compiler 생성
  origin/proof record를 붙일 수 있지만 작성 intent를 다시 쓰거나 미검증 relation을 증명됐다고
  표시해서는 안 된다.
- 일반 annotation 언어, 임의 key/value 확장, 새 source format.
