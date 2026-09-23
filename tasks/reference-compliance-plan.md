# GhostFlow Reference compliance implementation plan

## 목표와 완료 기준

### 최신 사용자 정책 확정

아래 과거 진행 기록에서 미결로 표시한 세 질문은 모두 답변되었다.
`true_for`는 Driver가 실제 관측을 보증한 연속 구간만 인정하며 측정값 사이를
추정하지 않는다. `after_event`는 각 시작 사건을 독립적으로 추적하고 결과를
구분한다. 같은 schedule의 여러 occurrence가 한 관측 구간에서 지나간 경우
모두 missed로 기록하고 실행하지 않는다. `temporal-policy-decisions.md`와
Reference §3.5/§4.4를 기준으로 TDD를 진행한다. 정책 확정은 구현 완료가 아니다.

목표는 compiler와 runtime이 Language Reference의 전체 계약을 구현하고 관찰 가능한 증거를 남기는 것이다. 현재 기준선은 아래 마지막 전체 gate다. `tests/reference/BASELINE.md`에는 이전 실행 이력을 보존한다.

사용자가 runtime도 완료 범위에 포함한다고 명시했다. 실제 Rust/native/WASM 실행 의미와 repository host adapter 계약을 함께 검증한다.

- 마지막 batch16 gate: Node 2,139건 중 1,947 pass, 28 fail, 164 TODO, 0 skip; Reference executable 204건 중 177 pass, 27 fail이며 실패 ID는 batch15와 같다. Rust core 160건, native package 28건과 WASM ABI 10건은 통과했고 native/WASM 산출물을 재생성했다. Tutorial은 Node gate 실패로 실행하지 않았다. 근거: `build/compiler-runtime-batch16-reference-results.json`, `build/compiler-runtime-batch16-full.log`, `build/compiler-runtime-batch16-verification.json`. Gate 종료 시 source hashes가 일치했으나 이후 version fixture와 Reference policy가 변경되어 현재 hash 일치 주장은 하지 않는다. GFB5 structural slice evidence: core 160, native 12, encoder 8 + affected 44, browser 3, cross-language native 4, catalog 5; logs `build/schedule-core-green.log`, `build/gfb5-encoder-affected.log`, `build/gfb5-browser-green.log`, `build/gfb5-native-green.log`, `build/gfb5-catalog.log`. Current diagnostic catalog is 687 cases; canonical lowering, schedule execution, providers/resources and replay remain pending.

- 마지막 batch15 gate: Node 2,114건 중 1,923 pass, 27 fail, 164 TODO, 0 skip; Reference executable 204건 중 177 pass, 27 fail. 실패 ID 27건은 batch14와 같으며 새 회귀는 없다. Rust core 142건, native package 28건과 WASM ABI 10건은 통과했고 native/WASM 산출물을 재생성했다. Tutorial은 Node gate 실패로 실행하지 않았다. 근거: `build/compiler-runtime-batch15-reference-results.json`, `build/compiler-runtime-batch15-full.log`, `build/compiler-runtime-batch15-verification.json`. 종료 후 전체 verification source hash가 현재 소스와 일치했다.
- specified 164건은 CLI 실행 테스트가 아니다. 일부 기존 실행 증거는 `reference-evidence.md`에 연결했으며 전체 매핑과 검증은 미완료다.
- batch13은 native package/프레임 CLI와 측정 기반 중첩 window를 포함한다. 중첩 compiler/encoder, 원본 시각·독립 집계 가중치·소유된 proof·상류 전체 highwater·epoch 무효화·메모리 상한·Rust replay를 구현했다. 두 WASM host의 절대값/만료/지연/변환 출처 6건도 통과했다. 이 증거는 전체 temporal 연산이나 durable migration 완료를 뜻하지 않는다.
- batch14에는 원본을 보존하는 별도 temporal ghost replay와 두 WASM adapter API가 포함된다. 현재 프로그램의 기록·checkpoint·중첩 proof·프레임 ID를 재현하며, 1,024 retained record rollover 및 재시도 검증이 통과했다. Batch15는 activation 전 정적 resource plan과 독립 wasm32 oracle의 C/C−1 및 N/N−1 activation/replay 경계 검증을 추가했다. 긴 tick 간격의 state/timer native·WASM 검증도 통과했다. 다음은 나머지 schedule/control/composition 계약이다. `true_for`와 `after_event` 정책은 `temporal-policy-decisions.md`에 확정되었지만 구현 증거가 남았다. Estimated evidence, durable migration 및 전체 §6.8 branch identity/what-if도 남았다.
- batch13 이후 추가한 catalog 위치 수정과 두 WASM의 늦은 오류/동일 sample 재시도 테스트는 후속 batch14·15 전체 gate에 포함됐다. 이전 focused 근거는 `build/window-derived-catalog-fix.log`, `build/window-derived-host-retry.log`에 보존한다.
- 진단 테스트 6건 추가 통과: parser callsite 4건, nested window byte limit 2건. 진단·경계값 catalog는 687건이다. [Temporal adapter replay](temporal-adapter-replay-design.md)는 Astra core/ABI, Sol JS adapter/실제 WASM 테스트, Luna 문서, root 통합·검증으로 진행했으며 focused 및 batch14 gate에서 통과했다.
- batch15 이후: DailySlots 중복 `timezone`/`selected` 허용 결함을 수정했다. Luna RED 4건 → 정확한 오류 종류·메시지·원문 위치와 valid control GREEN 5건, root 관련 회귀 231건 통과. 진단 catalog는 683건이다. 근거: `build/compiler-schedule-duplicates-red.log`, `build/compiler-schedule-duplicates.log`, `build/schedule-duplicates-regression.log`. 전체 gate는 재실행하지 않았고 batch15 hash는 이번 변경 이전 소스에 대한 증거다.
- 다음 구현은 Rust가 소유하는 Solar pulse admission이다. Sol/Astra audit에서 현재 native/WASM parity가 JS에서 만든 due bit를 재생할 뿐 Rust schedule 판단·rollback을 입증하지 않는 점을 확인했다. 명시적 clock/gap/recovery, compiled `when`, provider facts, owned observation과 replay를 실제 Runtime transaction에 연결한다. 여러 occurrence 처리 정책은 `temporal-policy-decisions.md`에 확정되었고 구현 증거가 남았다.
- Clock 구성요소: Sol의 trusted-only `ScheduleClockGate` 집중 6건 및 root의 core 전체 148건 통과. Luna가 이동한 동일 core 테스트의 catalog locator만 수정했고 catalog 5건도 통과했다. `tasks/schedule-clock-design.md`에 범위와 근거를 기록했다. 아직 source schedule, VM transaction, WASM ABI와 연결하지 않았으므로 Reference 실패 감소나 전체 schedule 완료로 계산하지 않는다. Wire 초안의 source SHA 삽입은 주석 변경 시 GFB 불변 계약과 충돌해 제거했다. Source identity는 검증된 외부 activation metadata로 유지한다.

완료는 다음 세 조건을 모두 만족할 때만 선언한다.

1. 모든 executable 사례가 실제 `ghostc --check`와 build 경로에서 통과한다.
2. 내부 구현 대상 specified 141건이 compiler, core, WASM runtime 또는 repository host adapter의 독립 실행 테스트와 연결된다.
3. 외부 경계 23건은 Driver, renderer, deployment/provider 책임을 언어 실행 성공과 분리하고, 입력·출력·identity·quality·revision 증거 계약을 감사한다.

남은 CLI 실패만 green이 되어도 전체 Reference 준수로 판정하지 않는다. 컴파일 성공은 runtime 의미, 물리 적용, UI 표현을 증명하지 않는다.

## 구현 원칙

- 정본은 `docs/reference/*.md`와 `tests/reference/cases/*.json`이다. 현재 구현에 맞춰 기대값을 낮추지 않는다.
- 한 slice는 가능한 한 3~5개 파일의 vertical path로 제한한다. parser/typecheck, manifest, runtime, 실제 관찰 테스트를 함께 끝낸다.
- 기존 구현을 우선 재사용한다: `tools/control.mjs`, `tools/gfb1.mjs`, `tools/source-trace.mjs`, `runtimes/wasm/control-runtime.mjs`, `crates/ghostflow-core`의 signal, scan, station, solar 모듈.
- fault tick은 state, intent, timer, controller/resource state와 journal position을 원자적으로 보존해야 한다.
- native와 WASM이 같은 오답을 내는 parity만으로 통과시키지 않는다. 각 backend를 Reference의 절대 기대값과 비교한다.
- source document/revision, bytecode digest, node/dependency provenance는 최적화·lowering·restore 뒤에도 검증한다.
- 진행 중인 agent 변경이 합쳐진 뒤 기준선을 한 번 갱신한다. 오래된 44개 목록을 그대로 작업 큐로 사용하지 않는다.

## 의존 구조

```text
Reference grammar and semantic types
    -> parser/type checker and bounded resource report
        -> manifest and source-trace contracts
            -> GFB verifier/lowering
                -> Rust core state machines
                    -> native/WASM adapters
                        -> host settings/provider/binding contracts
                            -> Driver/UI boundary evidence
```

공유 파일 충돌 규칙:

- `tools/control.mjs`의 한 선언 family는 한 agent만 수정한다.
- `tools/gfb1.mjs`, `crates/ghostflow-core/src/lib.rs`, WASM artifact rebuild는 GFB format owner가 직렬화한다. scan 변경이 필요하면 함께 조정한다.
- `runtimes/wasm/control-runtime.mjs` manifest schema 변경은 compiler manifest producer와 같은 slice에서 수행한다.
- native와 WASM release artifact는 core 변경 묶음 뒤 한 번만 재생성한다.

## 현재 진행 상태

| Slice | 상태 | 소유/난이도 | 충돌 경계 |
|---|---|---|---|
| GFB short circuit과 `MIN % -1` | compact constant encoding과 PC10 실행 포함 batch3 통과 | Astra / 높음 | `tools/gfb1.mjs`, `lib.rs`, GFB format과 artifact rebuild 독점 |
| Duration 경계와 sensor recovery fault 상태 | batch3 통과 | Luna / 중간 | Duration lexer/type block과 `signals.rs` 결과를 재사용 |
| `moving_average` compiler→manifest→actual WASM | host 14건 및 관련 Reference 2건 focused 통과; batch3 evidence 보존 | Luna / 중하 | 완료된 sensor 변경을 EMA slice가 이어받음 |
| EMA compiler→manifest→actual WASM | Number/Percent 및 극값 회귀 batch3 evidence; Temperature 연결은 quantity slice | Sol / 중간 | sensor filter와 host sensor validation |
| Dynamic Int conversions | native/WASM 변환·fault·rollback 포함 batch3 통과 | Astra / 높음 | GFB3 opcodes 48–53, stable fault와 atomic rollback |
| Dynamic Duration arithmetic | source와 guard 연결 완료; batch3 통과 | Astra core + Sol source | source typed arithmetic과 GFB3 guard를 함께 연결 |
| Quantity catalog/type/runtime | slice 완료; batch3 evidence 보존 | Sol / 높음; Astra numerical review | source/unit metadata와 모든 public consumer의 일치 |
| Tagged time literals | compiler/runtime 연결 및 batch4 통과 | Sol source + Astra package + Luna helper tests | 전체 Reference 완료와 별도 |
| Result 값과 변환 | batch6/7 focused compiler/runtime/provenance evidence; native Rust package canonical replay caveat remains | Sol compiler/host + Astra core | [실행 기록 계약](result-provenance-design.md), source metadata와 GFB3 opcode56 |
| Debounce Bool/finite enum/Result | batch7 통과; sensor별 중복 방지, actual native/WASM, replay와 artifact 검증 | Sol compiler/host, Astra Rust/code size, Luna diagnostics, root provenance | [계약과 남은 경계](debounce-design.md), [scan transaction](sensor-atomicity-design.md); durable reboot와 native package canonical source caveat remain |
| Measured hold_last | batch9 compiler/native/두 WASM, Held provenance, TTL, future/dedup/epoch/rollback/replay 및 signed artifact 검사 통과 | Sol compiler/tests, Astra package/code size, Luna provenance, root integration | [검증과 남은 경계](hold-last-design.md); estimated quality와 durable continuity restore는 남음 |
| Int operating settings | batch10 compiler/manifest/interaction descriptor와 signed32 boundary evidence 통과; atomic LIVE §5.2는 미구현 | Sol compiler/host + root integration | native package source/default correspondence remains unproved |
| Temporal Rust foundation | Rust 7 unit + 6 oracle tests 통과; compiler/GFB/WASM ABI integration remains unfinished | Astra core | [window evidence design](window-evidence-design.md) |

## 남은 CLI 27건의 feature 그룹

| 그룹 | 사례 수와 ID | 필요한 구현 | 기존 재사용 | 관찰 가능한 acceptance | 의존 / 난이도 |
|---|---|---|---|---|---|
| Schedule·provider·accounting 문법 | 11: `REF-03-024`, `032`, `036`, `038`, `042`, `045`, `050`, `057`, `059`, `060`, `062` | 공통 schedule policy, DailySlots/Periodic/Cron/Solar/Tide, TimeSlots, WorkCalendar, resource/event/account 문법과 typed 조건 | schedule/solar host adapters, station ledger, occurrence trace, source trace | manifest가 모든 필수 policy와 provider identity를 보존하고 실제 crossing/gap/DST/provider vectors가 절대 결과와 일치 | date/time, settings, provider 계약 / 높음 |
| Bounded signal과 temporal evidence | 2: `REF-04-025`, `026` | true-for/after-event; window aggregate/rate의 replay와 bounded state 증거 보완 | Rust signals, continuous timer, source dependencies, ControlRuntime conditioner | half-open boundary, sparse/missed scan, fault reset, checkpoint, memory upper bound을 실제 WASM에서 확인 | Duration/quantity/Result / 중간~높음 |
| Capability·constraint·resource·control | 7: `REF-04-035`, `044`, `045`, `050`, `058`, `061`, `063` | Option capability match, constraint phase, finite set aggregation, arbitration policy, objective/degraded/adaptation descriptors | constraint fixpoint, station resource manager, operating settings, interaction schema | requested/safe/applied 분리, unique winner, atomic reservation, global constraint 우회 금지, proposal-only adaptation | quantity, Result, settings / 높음 |
| Import·composition·macro | 7: `REF-06-010`, `023`, `101`, `102`, `103`, `105`, `106` | pinned document closure, digest verification, instance/typed port graph, typed quote/splice expansion limits | literate extractor, toolchain digest binding, portable package verifier | digest/revision tamper reject, duplicate provider reject, typed expansion 후 일반 checker 적용, recursion/limit reject | source identity contract / 높음 |

합계는 27건이다. `REF-04-020`은 batch7, `REF-04-031`은 batch9, window `REF-04-027`/`028`/`029`는 batch13까지 통과하여 CLI 실패 큐에서 제거했다. CLI 통과와 남은 runtime acceptance는 구분한다.

## specified 164건의 구현 경계 audit

### 분류 결과

| 분류 | 수 | 처리 |
|---|---:|---|
| compiler/tooling | 22 | compiler, source trace, package/restore test로 실행 증거화 |
| core/runtime | 93 | Rust/native/WASM의 절대 결과, state 및 journal 관찰로 실행 증거화 |
| repository host adapter | 26 | schedule/settings/capability/provider adapter의 deterministic contract test로 실행 증거화 |
| 외부 Driver | 7 | 적용·확인·배선 증거 계약 audit. 언어 runtime 성공으로 대체 금지 |
| 외부 renderer | 3 | descriptor 기반 read/write 권한과 동일 validation 의미 audit |
| design boundary | 7 | 새 keyword/graph/effect 범위가 섞이지 않는지 architecture audit |
| 외부 host/deployment/provider | 6 | OS, durable storage, provider coverage, installation binding 증거 audit |
| **합계** | **164** | 내부 구현 141, 외부 경계 audit 23 |

외부 경계 23건의 정확한 목록은 다음과 같다. 나머지 specified 141건은 repository 내부 실행 증거 대상이다.

- Driver 7: `REF-00-002`, `REF-04-010`, `REF-04-043`, `REF-04-053`, `REF-06-005`, `REF-06-006`, `REF-08-010`
- Renderer 3: `REF-00-009`, `REF-05-019`, `REF-05-020`
- Design 7: `REF-01-003`, `REF-01-055`, `REF-03-018`, `REF-06-001`, `REF-06-024`, `REF-08-001`, `REF-08-006`
- External host/deployment/provider 6: `REF-06-018`, `REF-08-003`, `REF-08-004`, `REF-08-008`, `REF-08-013`, `REF-08-016`

### 내부 구현 feature 묶음

| 묶음 | specified 근거 | 구현 위치와 acceptance | 난이도 |
|---|---|---|---|
| source/provenance/toolchain | `REF-00-001`; `REF-01-004,017,018`; `REF-04-067`; `REF-05-028`; tooling 범위 `REF-06-003,007,011,015,025`, `REF-07-001,002,006-010`, `REF-08-002,005,011,017` | 문서와 artifact digest, node identity, dependency reads, explanation link를 tamper test로 검증 | 중간 |
| exact arithmetic와 tick semantics | `REF-01-062-064,067,079,080,086,093,094,098,099,102-105`; `REF-07-003-005` | native/WASM 절대값, short circuit, old snapshot, rejected tick state/intent/tick/journal 원자성 | 높음 |
| sensor Result와 bounded filtering | `REF-00-007`; `REF-01-074,075,077`; `REF-04-003,005,011,012,016,019,023,024,030,032,065`; `REF-08-012` | actual WASM sample identity, N-1/N, exact stale boundary, recovery NotReady, quality provenance, instance isolation | 중간 |
| timer·rolling·schedule semantics | `REF-00-006`; `REF-03-009,013,014,016,017,019-023,026,027,029,030,035,039,040,048,049`; internal host `REF-03-010,025,028,031,037,041,047` | monotonic snapshot, half-open occurrence, gap/rollback/DST, stable event ID, ledger split/reservation을 trace로 관찰 | 높음 |
| capability·constraints·resources·modes | `REF-00-008`; `REF-04-034,036,038,039,042,046-052,055-057,060,062`; internal host `REF-04-054,064,066` | unique strategy, false-only fixpoint, single final writer, stop sequence, accounting stage, atomic settings/adaptation | 높음 |
| settings·observation | `REF-05-012-018,021-028,103-107`; `REF-08-009,014,015` | revision/effective position, atomic batch, overlay expiry, reboot/run boundary, snapshot/event/alarm/explanation identity | 중간 |
| composition·replay·replacement | `REF-00-004,010`; `REF-06-002,004,008,009,012-017,019-022`; `REF-08-007` | instance isolation, graph writer validation, same-core replay, no invented input, atomic hot swap and state migration | 높음 |

각 묶음은 catalog ID를 실제 test 이름 또는 evidence manifest에 1:1로 연결한다. 기존 테스트가 의미를 이미 증명하면 새 중복 테스트 대신 해당 ID 링크만 추가한다.

## 구현 단계

### Phase 0: 진행 작업 통합과 rebaseline

**설명:** short circuit/Int, Duration/sensor recovery, moving average가 합쳐진 같은 revision에서 실제 잔여 목록을 다시 계산한다.

**Acceptance:**

- Reference 결과의 pass/fail ID와 non-Reference test failure를 분리한다.
- focused 결과를 전체 gate 결과로 승격하지 않는다.
- 새 실패가 생기면 최초 원인별로 묶고 leaf failure 수와 구분한다.

**Verification:** `npm test` 한 번. 실패 분석 뒤 변경이 있으면 영향을 받은 focused test만 실행하고 마지막 통합 gate를 예약한다.

### Phase 1: scalar semantics와 GFB 실행 기반

**설명:** short circuit, exact Int, Date/Time, quantity constant와 Result value representation을 먼저 고정한다.

**Acceptance:**

- native/WASM이 Reference 절대값과 fault를 각각 만족한다.
- verifier가 잘못된 opcode/type/stack shape를 load 전에 거부한다.
- lowering과 restore가 source dependency 전체를 보존한다.

**의존:** Phase 0. **난이도:** 높음. **모델:** Astra 중심, bounded parser slice는 Sol.

### Phase 2: bounded signal vertical slices

**설명:** moving average, EMA, debounce, Result transform, temporal evidence를 하나씩 compiler→manifest→actual WASM으로 연결한다.

**Acceptance:**

- 각 stateful 연산은 memory upper bound와 private state ownership을 manifest/resource report에 드러낸다.
- fault, duplicate sample, repeated tick, rejected tick에서 상태 전이가 Reference와 일치한다.
- compiler acceptance와 runtime semantics가 같은 test slice에서 관찰된다.

**의존:** Phase 1의 Duration/Result type. **난이도:** 중간~높음. **모델:** Luna는 기존 engine 연결, Sol은 debounce/Result 통합.

### Phase 3: schedules와 accounting

**설명:** 공통 schedule policy를 하나의 descriptor contract로 만든 뒤 DailySlots, Periodic, Cron, Solar, calendar, tide 순으로 확장한다.

**Acceptance:**

- 모든 schedule이 stable schedule/occurrence/provider revision identity를 낸다.
- crossing, gap, rollback, DST, fallback, live update 결과가 native/WASM/host에서 동일한 절대 trace를 낸다.
- resource/event/accounting은 requested/safe/applied/confirmed stage를 혼동하지 않는다.

**의존:** Date/Time, settings event, ledger. **난이도:** 높음. **모델:** Astra.

### Phase 4: constraints, resources와 continuous control

**설명:** capability match, constraint phases, arbitration, mode transition, objective/fallback/adaptation을 기존 station core와 interaction schema에 연결한다.

**Acceptance:**

- same-tick request가 한 snapshot에서 예약되고 unique final writer만 safe target을 확정한다.
- controller/resource/settings state가 rejected tick에서 모두 원자적이다.
- explanation이 request, clamp, arbitration, applied/confirmed evidence를 분리한다.

**의존:** quantity, Result, settings, accounting. **난이도:** 높음. **모델:** Astra.

### Phase 5: imports, composition과 macro

**설명:** pinned closure와 typed graph를 먼저 구현하고, bounded quote/splice를 일반 checker 앞에서 확장한다.

**Acceptance:**

- exact revision/digest mismatch와 duplicate writer/provider를 deterministic diagnostic으로 거부한다.
- instance마다 state/timer/settings/binding/provenance가 격리된다.
- macro expansion은 typecheck, recursion bound, AST/resource bound를 우회하지 않는다.

**의존:** stable type/manifest/source identity. **난이도:** 높음. **모델:** Astra.

### Phase 6: settings, observation, replay와 hot replacement

**설명:** 기존 operating settings, temporary overlay, interaction snapshot, replay와 hot swap 코드를 Reference identity 모델로 통합한다.

**Acceptance:**

- batch settings/expiry/revert는 atomic revision event이고 stale expiry가 새 값을 덮지 않는다.
- replay는 기록에 없는 값이나 물리 effect를 만들지 않는다.
- hot replacement 실패는 이전 Program을 유지하고 성공은 새 artifact identity와 run boundary를 만든다.

**의존:** Phases 1~5 descriptor 안정화. **난이도:** 중간~높음. **모델:** Sol, migration core는 Astra review.

### Phase 7: 외부 경계 audit

**설명:** 외부 23건에 대해 repository가 요구하는 evidence schema와 책임 경계를 검증한다. 실제 장치 작동이나 UI renderer를 compiler 성공으로 인증하지 않는다.

**Acceptance:**

- Driver 계약은 requested, applied, confirmed, quality, stop proof와 physical endpoint evidence를 분리한다.
- renderer 계약은 descriptor type/authority/validation을 바꾸지 않고 write 권한을 생성하지 않는다.
- provider/deployment 계약은 revision, coverage, failure, durable identity, offline 운전 가능성을 명시한다.

**의존:** 내부 manifest와 observation schema 안정화. **난이도:** 중간. **모델:** Sol audit, 실제 hardware acceptance는 사용자 환경.

### Phase 8: 최종 acceptance

**Acceptance:**

- executable 전체 통과.
- 내부 specified 141건 모두 실행 test/evidence 링크 보유.
- 외부 23건 모두 boundary audit 결과와 미실행 이유 또는 실제 환경 증거 보유.
- catalog ID 중 누락, 중복, stale locator 없음.
- native/WASM artifact가 같은 source revision에서 재생성되고 전체 `npm test`가 통과.

## 첫 세 bounded implementation scope

### Slice A — moving average vertical path (진행 중)

**파일 소유:**

- `tools/control.mjs`: sensor filter parser/type/range와 manifest producer
- `runtimes/wasm/control-runtime.mjs`: manifest validator와 conditioner config 전달
- 기존 sensor host test 1개: 실제 ControlRuntime WASM의 N-1/N/N+1 및 0/even/out-of-range

**Acceptance:** `REF-04-021`, `REF-04-068`; compiler accept/reject와 actual WASM sliding average를 함께 확인한다. Rust `Filter::MovingAverage`를 그대로 재사용한다.

### Slice B — EMA vertical path (Slice A 직후 Sol 후보)

**파일 소유:**

- `tools/control.mjs`: `ema(alpha:)` constant/range typing과 manifest field
- `runtimes/wasm/control-runtime.mjs`: EMA manifest validation과 alpha 전달
- 기존 sensor host test 1개: first-sample seed, alpha 경계, recovery 전 NotReady

**Acceptance:** `REF-04-022`; alpha `0`, `>1`, nonfinite reject와 actual WASM recurrence를 절대값으로 확인한다. Slice A와 공유 파일이므로 병렬 수행하지 않는다.

### Slice C — debounce Bool/finite enum/Result (batch7 완료)

**파일 소유:**

- `tools/control.mjs`: 선언 typing, 양의 Duration, generated private state/clock descriptor
- 기존 GFB 연산으로 lowering한다. 새 opcode나 상한 확대 없이 common 5개와 physical root별 2개 상태를 사용한다.
- actual native/두 WASM ABI, legacy/framed host, provenance, signed package와 diagnostics를 검증했다.

**Acceptance:** `REF-04-020`과 debounce 전용 테스트가 batch7에서 통과했다. 근거는 `build/compiler-runtime-batch7-full.log`다. Scan transaction evidence is documented in [sensor-atomicity-design.md](sensor-atomicity-design.md). Durable reboot and native package canonical source replay remain incomplete.

Result 통합은 batch6/7 근거를 유지한다. 남은 temporal 및 composition 기능은 위 구현 큐를 따른다.

## 위험과 완화

| 위험 | 영향 | 완화 |
|---|---|---|
| baseline 44가 후속 focused 변경으로 stale | 중복 구현 또는 잘못된 완료 수 | Phase 0에서 같은 revision 전체 결과 재생성 |
| parser만 green이고 runtime 의미 미구현 | 허위 compliance | 모든 stateful accept에 actual native/WASM trace acceptance 요구 |
| shared manifest가 feature마다 확장 | validator/restore drift | producer, validator, source trace, test를 한 vertical slice로 묶음 |
| GFB format 변경 동시 진행 | artifact와 verifier 불일치 | format owner 1명, rebuild 1회, byte header/version 검사 |
| 164 specified를 TODO 수로만 유지 | 전체 목표 미달 | ID→test/evidence index를 final gate 필수 산출물로 지정 |
| 외부 물리/UI 요구를 내부 runtime이 주장 | 책임 경계 위반 | 외부 23건을 별도 audit하며 physical confirmation을 별도 증거로 유지 |
