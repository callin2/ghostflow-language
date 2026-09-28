<!-- translation-source: docs/plans/2026-09-28-semantic-kernel.md -->
[영어 원문](2026-09-28-semantic-kernel.md)

# Semantic Kernel 0.1 검토 계획

상위 항목: [#166 Semantic Kernel 0.1](https://github.com/callin2/ghostflow-language/issues/166)

이 계획은 동결된 semantic-kernel 검토 milestone의 순서를 정한다. milestone은 새 언어 기능을 허용하지 않는다. 실제 빈틈은 빈틈으로 기록한다. 이름을 바꿔 사라지게 만들지 않는다.

## 의존 순서

1. **#167 — 정확한 dev push 검증**은 compiler 작업과 독립적이다. 기존 Verified WASM push trigger에 `dev`를 추가하고 source 결속/전체 gate 순서를 regression 검사한다. acceptance에는 여전히 정확한 현재 `dev` commit에서 성공한 전체 CI 실행이 필요하다.
2. **#168 — tick 계약 정정**은 Reference §2.8을 기준으로 활성 catalog 충돌을 해결하고 이미 테스트된 runtime 동작을 보존한다. 문서/catalog 작업이며 compiler, GFB, VM, physical output 변경이 없다.
3. **#169 — 증거에 따른 기능 상태**는 분쟁 행에 대해 #168을 따른다. 주요 Reference family 목록을 만들고 소유자와 성숙도를 분리한다. green 결과를 강제하려고 구현됐지만 테스트가 부족한 core 기능을 `DESIGN`으로 낮춰서는 안 된다.
4. **#170 — 유한 core와 증거 matrix**는 #168/#169에 의존한다. construct와 positive/negative/boundary/target-parity/replay 증거를 동결한다. 명시적으로 동결된 core 밖 TODO는 정직하게 식별한다.
5. **#171 — expression Core IR**은 #168과 #170에 선언된 동결 construct 범위 이후, #170 증거 matrix 전체 구현 전에 실행할 수 있다. 통합은 여전히 #170 증거 gate를 따른다. GFB instruction emission 전에 내부 typed expression lowering 단계를 도입한다. 공개 source compiler API/기존 output byte를 유지한다.
6. **#172 — module Core IR**은 #171과 #170의 선언된 동결 construct 범위에 의존한다. #170 증거 matrix는 최종 acceptance 전에 그 증거를 사용할 수 있다. 생성 S-expression text round trip을 정규화 typed module record/GFB emitter 하나로 교체한다. 서로 다른 extension descriptor를 보존한다.
7. **#173 — canonical 관수 증명**은 선언된 #170 범위/증거 schema에 의존한다. #170 matrix는 최종 acceptance 전에 그 증거를 사용할 수 있다. PC-02를 전체가 core인 관수 program으로 사용한다. PC-09 timer/sequential replay는 extension regression으로 유지하며 core 증명으로 쓰지 않는다. 기존 source/trace와 #88 explanation 작업을 재사용한다.

8. **#178 — retained-core replay**는 열린 REF-06-017 증명을 소유한다. 해당 사례의 정확한 oracle을 만족하지 않는 replay regression/host-local replay를 retained-checkpoint core 증거로 세지 않는다.
9. **#179 — stale coverage gate**는 오래된 coverage test oracle 7개와 build precondition/threshold 부채를 수리한다. 동결 core 사례 accounting은 #170 소유다. 명세된 사례 text/status는 보존한다.

통합에는 dev 검토와 정확한 HEAD 검증 후 기존 dev-to-main PR #175를 재사용한다. 별도 main-only MIT backport로 대체하지 않는다.

#170의 동결 construct는 canonical literate source/intent identity, literal/unit/range 의미를 가진 Bool/Int/Number/Percent/Duration source 값, typed input/bounded config, 순수 식, state/동시 `next`, 명시적 비감소 logical scan time, requested intent, Boolean constraint, atomic tick 동작, source 연결 trace, retained-checkpoint 결정적 core replay다. source type을 runtime 표현과 별도로 문서화한다. 검사된 source type을 Number로 lowering해도 unit/range/exactness 규칙을 면제하지 않는다.

`LANGUAGE-MVP-0.1.md`의 현재 MVP 문구 충돌은 정확하다. 모든 intent가 committed next state를 읽는다고 명시한다. 반면 현재 Reference §2.8, `docs/LANGUAGE.md` §7, GFB 실행, `GF-TEST-snapshot-commit`은 unprimed 읽기가 이전 상태를 읽고 명시적 primed 읽기가 후보 상태를 읽는다는 것을 확립한다. 평가/검증 성공 시 후보 상태와 requested/safe 결과는 atomic하게 commit한다. Boolean constraint는 requested output을 유효하게 억제하고 safe output을 만들 수 있다. requested intent를 safe intent로 바꾸는 constraint 자체는 scan 실패가 아니다. 평가/검증 실패만 rollback한다. MVP 문서는 활성 요구사항에서 계속 인용된다. 충돌하는 주장만 대체하고 이전 문장과 content-derived ID를 증거로 유지하며 대체 요구사항을 연결한다. runtime 동작을 바꾸지 않는다.

## 실행 규칙과 표현 경계

각 accepted scan에서 하나의 immutable input/old-state snapshot으로부터 후보 상태로 transition을 동시 평가한다. output intent의 unprimed state 참조는 old state를 읽고 명시 primed 참조는 후보 값을 읽는다. requested intent를 평가하고 Boolean constraint를 적용해 safe intent를 도출한다. 유효 constraint는 scan 실패 없이 output을 safe로 강제할 수 있다. 평가/검증 완료 후 후보 상태와 결과 requested/safe scan record를 atomic하게 commit한다. 평가/검증 실패 시 이전 committed state를 유지하고 부분 후보를 노출하지 않는다.

compiler는 새 public AST/API를 약속하지 않으면서 내부 semantic 경계를 노출해야 한다.

- **Typed expression IR (#171):** semantic node와 해소된 identity/type. old-state/candidate-next 읽기, conditional/logical 동작, arithmetic/conversion, time guard, context projection, trace marker 포함. opcode, byte, GFB format 선택, encoded offset은 포함하지 않는다. emitter만 VM instruction으로 lowering한다.
- **Typed module IR (#172):** 해소된 input, state default, strategy/query, transition, requested intent, Boolean constraint, expression IR. temporal window, schedule, `true_for`, configuration stream, natural/accounting result, PID objective는 자체 validation/provenance/quality/time/resource 규칙을 가진 명시 typed extension descriptor로 남는다. 순수 core expression으로 조용히 취급하지 않는다.
- **GFB 경계:** 기존 source AST/compiler 진입점은 유지한다. emitter 하나만 기존 GFB format을 선택하고 확립된 envelope, instruction stream, extension record를 쓴다. 정확한 byte, manifest/source-map/trace identity, 진단, 상한, browser-safe import, native/WASM 동작, 역사적 expected hash를 보존한다. 새 wire version, 병렬 compiler, fallback, extension 의미, Rust runtime 변경은 범위 밖이다.

## Acceptance 기준 열 가지

1. 이 milestone의 core semantic construct가 고정돼 있다.
2. Surface-to-typed lowering, CoreIR, GFB 경계를 정직하게 문서화한다.
3. 모든 core construct에 실행 가능한 positive/negative/boundary 테스트가 있다.
4. Native/WASM은 core conformance vector에서 동일 결과를 만든다.
5. 동결 Reference core 범위 안 TODO 사례가 0개다.
6. 알려진 core semantic 불일치가 0개다.
7. 정확한 현재 `dev` HEAD에 green full Verified WASM CI 실행이 있다.
8. 실제 관수 program 하나가 선언된 core 안에서 완전히 실행된다.
9. 결정적 replay가 동일 결과를 재현한다.
10. Source-to-trace-to-decision 원인 추적 가능성이 확립됐다.

전체 causal explanation DAG는 별개다. 승인 core 경로의 source-to-trace-to-decision provenance가 #88 전체 evaluated-path explanation graph 완료를 증명하지 않는다. #70/#74/#88/#115는 더 넓은 Interaction IR, stream, explanation, event-order 계약을 계속 정의하거나 추적한다. 이 milestone core 증명에서 그 기능 완료를 주장하지 않는다.

## 검증과 한계

각 구현 작업에서는 이슈의 focused command를 실행한다. source/test가 바뀌면 저장소 `npm test` integration gate를 실행한다. 전체 gate는 명시 나열 테스트와 verifier의 Rust formatting/workspace, native/debug/release, WASM, replay/tutorial, artifact provenance 검사를 사용한다. artifact가 정확한 테스트 source SHA를 식별하는지 검증한다. merge 후 정확한 결과 `dev` commit의 `Verify WASM (current)`와 `Verify WASM (frontend-pin)`이 모두 성공해야 한다. PR 검사, frontend-pin 통과, source hash 일치, Rust-only suite는 불충분하다.

이 계획은 Device flash, physical output, farmer acceptance, 완전한 explanation-DAG 검증을 주장하지 않는다.

검토된 `dev` 작업을 `main`에 통합한 뒤 공개 MIT 게시 전에 정확한 통합 revision/gate를 검증한다. dev-to-main 통합 대신 별도 main-only MIT backport를 merge하지 않는다.
