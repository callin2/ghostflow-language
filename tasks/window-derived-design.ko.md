<!-- translation-source: tasks/window-derived-design.md -->

[영문 원본](window-derived-design.md)

# Derived window 근거 제안

상태: measured nested-window compiler/core/proof/package 경로가 구현되어
batch13에 포함됐다. 전체 temporal/adapter replay 수용은 미완료다.
아래 실행 근거를 참조한다. Nested window는 필수 언어 동작이다.

## 기준과 승인된 의미 결정

[Reference §4.4](../docs/reference/04-sensors-constraints-control.md#44-temporal-evidence)는
원래 관측 식별자, 재전송/재평가의 기여 금지, 구분되는 aggregate 결과 provenance,
변환/분기를 통한 보존, aggregate 식별자와 물리 관측을 구분하는 하류 window를
요구한다. Open-left window, 엄격한 `max_age`, fault 보존, source epoch 무효화도
확정한다. 기존 [근거 계획](window-evidence-design.md)은 명시적 물리 density fact를
공급한다. 기대 수집 주기는 상한을 공급하지 않는다.

Reference는 상류의 expiry-only 값 변경이 새 하류 관측인지,
어떤 타임스탬프가 derived 관측을 식별하는지, 겹치는 aggregate 입력마다
가중치 하나를 줄지를 정하지 **않는다**. 이 선택은 수치 결과를 바꾼다.
Root는 다음의 비운영 언어 결정을 승인했다.
Device 주기, density, installation 기본값은 도입하지 않는다.

승인된 해석:

1. **새 상류 admission**의 성공 결과는 derived event를 만든다.
   단순 평가, contributor 만료, selector/fault/state 변경은 새 관측을 만들지 않는다.
   기존 `admissionRevision` 의미를 유지하며 조용히 scan counter로 바꾸지 않는다.
2. Derived event의 관측 타임스탬프는 상류 결과의 가장 최근 contributor 관측
   타임스탬프이며 실제 근거에서 재귀적으로 상속한다.
   Commit된 평가 시각은 `evaluatedAt`으로 별도 유지한다.
   지연 관측 재계산이 측정 freshness를 갱신해서는 안 된다.
   어느 시각도 꾸며낸 물리 식별자가 아니다.
3. 서로 다른 derived event마다 하류 average의 가중치 하나를 준다.
   그 계층에서 aggregate 식별자를 중복 제거한다. 산술 계산에서 nested average를
   평탄화하거나 공유 물리 leaf를 중복 제거하지 않는다.
   공유 leaf는 provenance이며 추가 하류 입력 point가 아니다.
4. 물리 source epoch 무효화는 proof가 그 이전 epoch에 의존하는 보존 derived
   event를 무효화한다. 혼합 A+B aggregate는 A를 조용히 제거하면서
   이전 scalar 값을 유지할 수 없다. 의존 event를 버리고 독립 B-only event를
   보존한다. 이는 전이적 의존성 무효화다.

평가 시각을 관측 시각으로 쓰는 것도 실제 대안이다. 이는 최신 측정이 아니라
aggregate 게시의 freshness를 측정한다. 더 짧은 하류 max_age에서도
늦은 결과를 fresh하게 유지한다. Reference는 평가 시각과 원래 관측을 모두
명명하지만 이 하류 타임스탬프를 확정하지는 않는다.
Root는 위 관측 시각 규칙을 선택했다.

Expiry event 생성도 대안이지만 새 result-generation counter,
모든 깊이에서 expiry로 발생하는 event 상한, 타임스탬프 정의가 필요하다.
매 scan 생성은 물리 density로 상한을 정할 수 없고 cached 근거에 과도한 가중치를 준다.
원래 leaf 평탄화는 함수 합성의 의미를 바꾼다. 어느 것도 제안 기본값이 아니다.

## 실행 가능한 admission과 품질

서로 겹치지 않는 식별자 namespace 두 개를 사용한다.

- Physical: `(sourceTag, sourceEpoch, sampleId)`와 원래 타임스탬프.
- Derived: 설치 module, 선택 strategy, live 실행 session 범위의
  `(site, admissionRevision)`. 관측 타임스탬프, 평가 시각,
  제한된 입력 proof는 별도다.

Live Runtime/arena가 이 범위를 공급한다. 고정 time epoch는 연속성 검증에
참여하지만 전역적으로 고유한 session ID는 아니다. 현재 core trace module
fingerprint는 암호학적 artifact 식별자가 아니다. 영속/외부 기록은 기존의
권위 있는 artifact/source envelope에 담아야 한다. 소비 경계는 local
site/revision key를 해석하기 전에 식별자를 검증한다.
중첩을 위해 전역 ID나 새 hash infrastructure를 지어내지 않는다.
독립적으로 얻은 envelope의 영속 restore는 별도 미완료 작업이다.
Revision을 포함한 모든 expression-facing 정수는 정확히 표현 가능해야 한다.
Slot index는 물리 source tag가 아니다.

Scan마다 이전 작성 상태에 대해 prelude를 의존 순서로 한 번 평가한다.
근거가 오래되어도 성공 source payload는 즉시 평가한다.
선택된 산술 fault는 여전히 scan을 거부해야 한다.
Source가 실패했을 때만 fault/origin을 평가한다.
현재 원자적 prelude 트랜잭션을 보존한다.

모든 소비자는 선택되지 않거나 실패한 소스를 포함하여 commit된 scan마다
**선언된 모든 상류 window**의 highwater revision을 기록한다.
최대 선택된 새 성공 event 하나만 admit한다.
Cached window로 돌아가도 이전 결과를 다시 도입할 수 없다.
Rollback은 highwater를 복원하므로 실패 scan 재시도에서 event를 잃지 않는다.
물리 입력은 기존 all-root highwater 처리를 유지한다.
NotReady를 내는 새 admission(예: rate의 첫 point)은 관측 이력을
전진시키지만 성공 event를 공급하지 않는다.

새 activation에서 모든 상류 highwater는 revision0으로 시작한다.
Revision0 window는 근거를 admit한 적 없으므로 성공 derived event를 공급할 수 없다.
저장 highwater보다 큰 상류 후보 revision은 fresh하다.
소비자는 선택되지 않았거나 어느 Result든 실패했어도 후보 revision을 준비한다.
완전히 성공한 scan만 highwater를 commit한다.
Source-expression, density, 산술, 이후 intent 오류는 모든 window 후보와 함께
이를 폐기한다. 재시도는 실패한 시도와 정확히 같은 freshness를 본다.
Checkpoint replay는 저장 highwater를 복원한다.
이력을 유지하면서 0으로 재초기화하지 않는다.

Revision 순서가 derived 관측 타임스탬프의 단조 증가를 뜻하지는 않는다.
예를 들어 이전 최신 root 무효화는 더 오래된 유효 근거를 드러낼 수 있다.
Derived 항목을 관측 시각과 식별자로 정렬한다.
물리 단일 소스의 역행 타임스탬프 guard를 derived revision 순서에 적용하지 않는다.

상류 현재 값은 admission revision을 바꾸지 않고 만료로 바뀔 수 있다.
일반 식은 여전히 읽을 수 있지만 새 하류 point는 생성하지 않는다.
하류의 기존 이력은 상류 NotReady 동안 성공으로 남을 수 있다.
Trace에 그 상류 fault를 보존한다.

`quality: measured`는 물리 Measured 근거와 leaf가 허용 가능한 Measured 근거인
검증된 derived proof를 받는다. 결과는 Derived (3)이며 Measured (1)이 되지 않는다.
Held (2), Constructed (0)는 window/map/case/recover/constructor를 통과해도
허용 가능해지지 않는다. Pure map/and_then은 들어온 evidence 참조를 보존한다.
Result 분기는 참조 하나를 선택한다. Recover 뒤 새 constructor는 measurement proof가 없다.
기존 physical-expression 경로처럼 변환은 event 식별자를 유지하면서 payload를 바꿀 수 있다.

## 명시적 evidence marker가 있으면 기존 GFB4 wire로 충분하다

기존 source 식 6개, ok, payload, fault, origin, quality, evidence 참조를 유지한다.
Quality로 여섯째 필드의 의미를 일반화한다.

- quality 1: 현재처럼 양의 물리 root tag;
- quality 3: 별도 namespace의 이전 window site;
- quality 0/2: 허용 가능한 근거 없음.

Derived 계보의 각 leaf마다 컴파일러는 다섯째 blob에
`(window-read U quality)`, 여섯째 blob에 U의 site를 생성한다.
분기는 이를 병렬로 선택한다. 상수 pure map도 quality projection을 유지한다.
따라서 quality blob의 기존 opcode57 field7이 명시적 의존 marker 역할을 한다.

Decoder는 그 field7 참조를 정렬된 중복 없는 내부 의존 목록으로 수집한다.
이미 식 검증이 강제하듯 앞선 slot이어야 한다.
분기 조건의 일반 window value/ok 읽기는 evidence marker가 아니다.
기존 rootRefs는 완전한 전이적 물리 root 집합이 된다.
각 evidence 의존성의 root가 포함됐는지 검증한다.
Quality3에서 Runtime은 선택된 site가 그 목록에 속하고 상류의 실제 성공 후보
proof가 있어야 한다고 요구한다. 상수 quality3만으로 선언되지 않은 상류를
명명할 수 없다. 동적 물리 source tag는 변경 없이 계속 동작한다.

모든 opcode57 읽기를 무차별 수집하면 control 의존성과 evidence를 혼동한다.
추가 descriptor 표도 같은 선언을 표현할 수 있으나 새 layout/profile이 필요하다.
Quality projection marker는 기존 blob 6개로 필요한 정적 상한을 제공한다.
Root는 이 GFB4 계약을 승인했다. 새 opcode나 wire 필드는 없다.
Manifest/source metadata는 대응하는 이전 window evidence binding을 기록하고
정본 replay는 정확한 선택을 검사한다.
정적 state/window 수, module, expression, stack 상한은 변경하지 않는다.

## 유한 용량과 소유 proof 저장소

위상 순서의 각 window W에 보수적 누적 horizon을 정의한다.

`H(W) = over(W) + max({0} ∪ {H(U): U is an evidence dependency of W})`.

명시적 root 상한 `(M_r, I_r)`에서 논리 입력 용량을 예약한다.

`C(W) = sum over transitive roots r of M_r * ceil(H(W) / I_r)`.

이유: 새로 보존된 각 derived point에는 선택된 chain을 통해 admit된 fresh 물리
조상이 있다. 조상은 point의 최신 관측 타임스탬프 뒤 누적 lookback 안에 있다.
각 window는 commit된 scan마다 최대 event 하나를 생성한다.
All-source highwater는 같은 원인 admission을 이후 selector/clock-only scan에서
다시 생성하는 것을 막는다. 따라서 proof 보존에는 평가 타임스탬프에 대한
추정 density 상한이 아니라 누적 lookback이 필요하다.
한 scan의 여러 root 갱신은 이 용량을 과대평가할 뿐이다.
Source epoch 교체는 admission 전에 이전 의존 proof를 제거한다.
Proof나 검사된 상한이 실패할 때 보존 event를 조용히 제거해서는 안 된다.
전체 scan/activation을 거부한다.

여러 admission은 동일한 최신 타임스탬프를 공유할 수 있다.
타임스탬프100의 anchor는 지연된 서로 다른 sample90/95가 상류 revision을 각각
전진시켜도 최신으로 남을 수 있다. 그 revision을 타임스탬프로 중복 제거하거나
derived 타임스탬프에 물리 density를 직접 적용하지 않는다.
서로 다른 원인 sample은 anchor 뒤의 상류 lookback을 포함한 H(W)로 제한된다.

보존 payload만으로는 부족하다. 각 derived point는 상류 항목 만료 뒤에도
admission 당시 상류 aggregate의 완전한 proof를 보존해야 한다.
단순한 첫 구현은 미리 할당된 arena에 평탄한 소유 tree로 proof를 저장한다.
겹치는 subtree 복사를 허용하고 비용에 모두 반영한다.
무제한 Arc graph, hash 식별자, interning subsystem은 필요 없다.

물리 leaf 비용1로 완전한 W 출력 proof의 node 수를 P(W)로 제한한다.

`P(W) = 1 + C(W) * max({1} ∪ {P(U): U is an evidence dependency of W})`.

각 tree node는 kind, evidence 식별자, 타임스탬프, payload,
제한된 child 범위를 담는다. Derived node는 declaration/operation/evaluation
식별자를, 물리 leaf는 원래 식별자를 보존한다.
Edge payload는 변환을 보존해야 한다. JavaScript에서 변환 숫자를 재구성하지 않는다.
분기 graph에서 이 점화식은 빠르게 커질 수 있으나 유한하고 검증된다.
DAG-sharing 최적화는 이후 선택 사항이다.
집계되지 않은 저장소보다 대상 예산 거부가 낫다.

Activation은 모든 합/곱과 allocation을 검사한다.
`maxRetainedSamples`는 논리 C(W)의 합으로 유지한다.
MaxBytes는 proof 복사, 상류 highwater, candidate/committed bank 두 개,
J+1 checkpoint, J+1 독립 trace tree, 제한된 복사 scratch,
replay의 live+scratch peak를 포함한다.
충분히 큰 예산 상한은 호환된다. Topology, profile, allocation 구성이
checkpoint 식별자다. 새 물리 density 설정이나 scan-frequency 기본값은 없다.

## 트랜잭션, trace, replay

Derived 데이터를 `Observation {source_tag, Identity}`로 바꾸지 않고
Rust 내부 evidence enum을 추가한다. 물리 source engine은 현재 표현을
유지할 수 있다. 일반화된 보존 항목은 physical/derived 식별자와 proof 범위를 담는다.
Admission, epoch 무효화, source highwater를 window payload와 함께 준비한다.
이후 source/intent 실패는 준비된 모든 변경을 rollback한다.

Checkpoint/rewind는 proof arena, derived highwater, event 관측 타임스탬프,
평가 시각을 포함한다. Replay에는 일치하는 input/state layout,
descriptor topology, source binding, 고정 time epoch, density proof가 필요하다.
Trace 기록은 Runtime 수명과 독립적으로 proof tree를 소유한다.
Source observer는 average를 계산하지 않고 fact를 검증/매핑한다.
직접 contributor와 물리 leaf를 분리한다.
Leaf 수를 하류 sample 수로 보고하는 것은 잘못이다.
Session 대체와 temporal hot-swap 이관은 명시적 작업으로 남는다.

## 구분 가능한 수용 시나리오 6개

1. **합성과 겹치는 leaf.** Inner average over2ms, outer over10ms;
   물리 `(t,value)=(0,0),(1,10),(2,20)`.
   Inner 결과는0,5,15, outer는 derived contributor3개로20/3이다.
   고유 물리 leaf 집합에는 식별자3개가 있다.
   평탄화한 집합의 average는 잘못된10을 낸다.
   Density는 실제 sample을 허용해야 한다. Replay는 같은 식별자와 숫자를 낸다.
2. **Scan/expiry 생성 금지.** 시나리오1을 새 sample 없이 t3에서 계속한다.
   Inner는 만료로20이 되지만 새 event를 생성하지 않는다.
   Outer는20/3, count3이다. 중복 sample 전달과 선택 식 재평가도
   count/revision을 바꾸지 않는다. Root의 event 주기 결정을 구분한다.
3. **관측 시각과 평가 시각.** 관측 타임스탬프0인 inner가 evaluation9에서
   처음 admit된다. Inner over/maxAge10, outer over10/maxAge2다.
   제안된 derived 관측 타임스탬프0은 outer를 즉시 NotReady로 만든다.
   Inner 결과는 성공이며 evaluatedAt9다. 대안 게시 시각 규칙은 outer를11까지
   fresh하게 유지한다. 근거 갱신 없이 평가 시각 기록과 freshness 갱신을 구분한다.
4. **반복 최신 타임스탬프, selector, 품질.** Inner over20ms는 now100에서
   A(ts100,value100),101에서 B(ts90,value0),102에서 B(ts95,value20)를 admit한다.
   Derived 값100,50,40은 모두 관측 타임스탬프100이다.
   Outer over/maxAge5ms는3개를 모두 보존해190/3을 낸다.
   Profile A=1/1000ms, B=1/5ms는 이 순서를 허용한다.
   직접 outer-horizon 용량2는 실패하지만 누적 horizon25ms 용량6은 충분하다.
   별도로 같은 scan에서 상류 window 두 개가 A=2, B=8을 생성하고 outer는 A를 선택한다.
   새 관측 없이 cached B로 전환해도8을 더해서는 안 된다.
   이후 실제 새 B admission은 그 결과를 한 번 더할 수 있다.
   Held 값 map이나 ok 생성은 measured leaf를 만들지 않는다.
5. **Epoch 무효화와 rate 동률.** A+B-derived point 하나와 별도 B-only point를
   유지한다. A epoch 변경은 의존 mixed point만 제거한다.
   같은 관측 타임스탬프의 서로 다른 derived 식별자 rate는 NotReady다.
   t1000의 값5, t3000의 값9이면 정본 값은2/second다.
6. **Proof 예산, rollback, rollover.** 계산된 정확한 byte/논리 용량 상한으로
   활성화하고 하나 적으면 거부한다. 새 nested event 뒤 나중 division fault는
   scalar/window/proof/highwater/journal 상태를 바꾸지 않는다.
   동일 재시도는 한 번 admit한다. J2에서 rollover 뒤 replay는 inner 원래 leaf가
   이미 만료됐어도 가장 오래된 보존 scan 전 proof를 복원한다.
   같은 테스트를 native와 두 WASM adapter에서 실행해야 한다.

Root는 의미 결정, 전이적 mixed-proof 무효화, quality-projection marker 계약을
승인했다. 사용자별 운영 숫자는 필요 없다.

## 실행 근거와 남은 수용

- Native Rust core: `tests/temporal_derived.rs`의 독립 테스트 11건은
  시나리오6개, marker/root 검증, 압축된 끝점 index, eager payload/lazy fault
  평가를 다룬다. Unit allocation 테스트는 transaction/checkpoint/restore cycle
  200회를 allocation 없이 실행한다. 전체 core: 136 pass,
  `build/temporal-derived-core-final.log`; batch13도 통과했다.
- Compiler/encoder: `tests/window-derived-control.test.mjs`;
  물리 window/GFB suite와 결합한 집중 실행38 pass, 그 뒤 batch13 통과.
- 두 실제 WASM host 경로: `tests/window-derived-host.test.mjs`는 batch13에서
  처음6 pass. Source 관측을 포함한20/3 합성, expiry admission 금지,
  원래 freshness, 변환된 aggregate proof 값을 다룬다.
  Gate 뒤 late-fault/same-ID-retry 테스트2개를 추가했다.
  `build/window-derived-host-retry.log`에서 host8/8 pass.
  실패 시 commit된 공개 trace는 바뀌지 않고 재시도에서 revision3을 정확히 한 번 admit한다.
- Source metadata/proof 검증: `tests/window-derived-provenance.test.mjs`,5 pass.
  잘못된 소유 tree/식별자와 정본 의존성 대체 사례가 실제 WASM 관측을 보완한다.
- 서명 JS package: `tests/window-derived-package.test.mjs`의 leaf11건
  (상위 포함12건) 통과. Native package verifier: 테스트28건 통과.
  Target loader 전 nested 의존성 누락/재연결/type/index 거부를 포함한다.
  Native verifier는 JavaScript 소스를 재컴파일하지 않는다.

시나리오6의 native checkpoint/rewind와 J2 rollover 테스트는 통과한다.
Batch14는 실제 J1024 journal을 사용하는 두 WASM adapter의 읽기 전용
checkpoint replay를 추가한다. 정확한 원래 기록 동등성, nested20/3,
소유 proof 식별자, late-fault/retry, retained-prefix rollover, live 상태 보존이다.
`tests/temporal-replay-wasm.test.mjs`와 `temporal-adapter-replay-design.md`를 참조한다.
실제 WASM 테스트와 temporal resource-plan suite는 이제 정확한 대상별 경계
oracle을 증명한다. `build/temporal-resource-plan-wasm-green.log`,
`build/scan-frame-wasm-temporal-plan.log`,
`tasks/temporal-resource-plan-design.md`의 oracle 값을 참조한다.
이 근거를 다른 temporal 연산자나 영속 restore로 일반화하지 않는다.
영속 외부 checkpoint restore, temporal hot-swap, estimated evidence는
이 measured live-session 증분 밖이며 미완료다.
