# GhostFlow Reference compliance tasks

상세 범위와 ID 매핑은 [plan.md](plan.md)를 따른다.

## 진행 중

- [x] GFB short circuit과 `MIN % -1` exact runtime semantics 완료 (기존 eager 기대값/식 크기 fixture도 교체)
- [x] Duration/sensor recovery focused 수정의 통합 gate 확인 (batch2)
- [x] `moving_average` compiler→manifest→actual WASM vertical slice 완료 (batch3 evidence)

## Phase 0 — 통합 기준선

- [x] 전체 gate 실행 및 잔여 ID 갱신 (batch15: 177 Reference pass / 27 Reference fail; 1,923 total pass / 27 total fail / 164 TODO. 실패 ID는 batch14와 같고 신규 회귀 없음. Rust core 142, package 28, ABI 10 통과. Tutorial 미실행. 종료 시 source hashes 일치)
- [x] leaf failure와 독립 root cause를 분리 (batch3: Reference 38, 통합 회귀 0)
- [x] 164 specified의 ID→test/evidence index 골격 생성 (`reference-evidence.md`; 실제 매핑은 미완료)

## Phase 1 — scalar semantics

- [x] Dynamic Int conversions: native/WASM exact rounding, stable faults와 rollback
- [x] Dynamic Duration arithmetic: intermediate range checks와 rollback
- [x] Signed integer division identity: 87 native/WASM boundary pairs
- [x] DateTime backend guard: epoch 범위, malformed loader와 atomic fault (public source 연결은 아래 항목)
- [x] Date, TimeOfDay, DateTime tagged literal과 exact representation (targeted and batch4 evidence)
- [x] Quantity unit normalization과 nominal/affine/derived type table (batch3 evidence)
- [x] Result parameter/result type과 bounded transform chain (batch5 focused compiler/runtime/provenance boundaries; canonical package replay caveat remains)
  - 함수·constructor·case와 pipeline compiler/runtime focused 검사 12건 및 Result Reference 4건 통과.
  - Source provenance focused 검사 4건과 trace runtime 검사 3건 통과. Batch6 full gate에도 포함됐다.
  - Batch10 focused evidence: signed native tamper 43, JS tamper 27 plus parent 28, compiler 21, artifact 22.
  - Native Rust package의 canonical source replay는 별도 caveat로 남고, 전체 목표는 미완료다.
- [ ] native/WASM verifier, atomic fault, source dependency acceptance

## Current priority

- [x] Sensor/filter/hysteresis scan atomicity: Rust-owned checkpoints, both host modes, exact native commit status and retry tests. See `sensor-atomicity-design.md`; these checks passed in batch8 and batch9. The latest full gate has 30 Reference failures, and global REF-04-065 remains partial.
- [x] Current canonical-source/CLI diagnostic families audited and tested across lexer/parser/literate/semantic/GFB/interaction paths; see `compiler-diagnostics-current-audit.md` for the current 687 independent cases and exclusions. Batch15 passed the then-registered diagnostic suites. After batch15, four DailySlots duplicate-field cases exposed and verified a parser fix; the focused suite passes 5/5 including its positive control and affected regressions pass 231/231. Four bare-CR newline cases were added; the affected suite passes 233/233 (`build/compiler-newline-affected.log`, RED retained in `build/compiler-newline-diagnostics-red.log`). This is not overall Reference/compiler/runtime completion or a branch-coverage percentage.
- [x] REF-05-108: valid Int operating settings compiler/manifest/interaction descriptor slice passed in batch10. Atomic LIVE §5.2 setting application remains unimplemented; native package source/default correspondence is not proved. See `compiler-int-settings-gap.md`.
- [x] Temporal Rust foundation: 7 unit + 6 oracle tests passed; compiler/GFB/WASM ABI integration remains unfinished. See `window-evidence-design.md`.
- [x] User chose Driver-certified actually observed continuous intervals for `true_for`; no interpolation between point samples. Rust prerequisite `TrueFor` is implemented with 5 focused tests (`build/true-for-interval-green5.log`); compiler/GFB/WASM/provenance/checkpoint integration remains pending.
- [x] User chose independently tracked, distinguishable `after_event` results for every start event; Rust prerequisite `AfterEvent<N>` now has 5 focused tests. Compiler/event ABI/result projection/checkpoint integration remains pending.
- [x] User chose all missed/no execution when one observation interval crosses multiple occurrences of the same schedule. See `temporal-policy-decisions.md`.
- [x] Measured hold-last signal slice: compiler/Rust/native/dual-WASM, Held provenance, TTL, future/dedup/epoch/rollback/replay, and signed artifact checks. Estimated quality and durable continuity restore remain open; see `hold-last-design.md`.

## Phase 2 — bounded signals

- [x] EMA Number/Percent compiler→manifest→actual WASM vertical slice (Temperature 연결은 quantity slice)
- [x] debounce Bool signal vertical slice (focused compiler/runtime/native replay and 18 diagnostics; bounded temporal and atomicity caveats remain)
- [x] Measured physical/nested window aggregate/rate compiler·Rust·dual-WASM·owned proof·signed package path (batch13, 자세한 남은 범위는 `window-derived-design.md`)
- [x] Nested temporal read-only rollover replay through both WASM adapters, including framed replay exposure (core 139 + ABI 8, actual WASM replay 27 + framed regression 17 pass; `temporal-adapter-replay-design.md`). Durable foreign restore and full §6.8 branch identities remain open.
- [ ] true-for, after-event and estimated-evidence temporal operators
- [ ] signal memory/resource upper-bound report와 checkpoint tests
  - [x] Actual dual-WASM exact temporal-byte N/N-1 threshold evidence (`build/temporal-resource-plan-wasm-green.log`, `build/scan-frame-wasm-temporal-plan.log`; native/core oracle retained)

## Phase 3 — schedules와 accounting

- [x] GFB5 schedule prelude structural slice: core 160, native 12, encoder 8 plus affected 44, browser 3, cross-language native 4, and catalog 5 passed. Evidence: `build/schedule-core-green.log`, `build/gfb5-encoder-affected.log`, `build/gfb5-browser-green.log`, `build/gfb5-native-green.log`, `build/gfb5-catalog.log`. Canonical lowering, execution, providers/resources, and replay remain pending.
- [x] Trusted-only native clock component: explicit gap, baseline/recovery, separate prior/updated high-water, opaque provenance, numeric boundaries and atomic validation; six focused and 148 core regression tests pass (`schedule-clock-design.md`). This does not complete source/VM/WASM schedule integration.
- [x] Bounded native Solar admission prerequisite: staged clock/terminal ledger, single crossing predicate admission, false/gap/correction terminalization, multi-crossing missed/no-execution, malformed/incomplete facts, rollback and stale-stage rejection; 9 focused tests pass (`build/solar-admission-green7.log`). Provider coverage, source lowering, GFB/WASM binding, resource proof and durable replay remain pending.
- [ ] 공통 schedule policy descriptor
- [ ] DailySlots/TimeSlots와 live update
- [ ] Periodic과 Cron
- [ ] Solar/calendar/tide provider integration
- [ ] resource/event/account와 rolling/local-day ledger

## Phase 4 — control contracts

- [ ] optional capability와 strategy selection
- [ ] constraint phase와 finite set aggregation
- [ ] resource arbitration과 mode transition
- [ ] continuous objective, degraded fallback, bounded adaptation

## Phase 5 — composition

- [ ] pinned import closure와 digest verification
- [ ] instance/typed port graph와 duplicate writer/provider validation
- [ ] bounded typed quote/splice expansion
- [ ] replay, state migration과 atomic Program replacement

## Phase 6 — settings와 observation

- [ ] atomic settings revision과 temporary overlay lifecycle
- [ ] snapshot/event/alarm/explanation identity
- [ ] source/settings/binding/run mismatch rejection

## Phase 7 — 외부 경계 audit

- [ ] Driver 7건 evidence contract audit
- [ ] Renderer 3건 descriptor/authority audit
- [ ] Design 7건 graph/effect/language boundary audit
- [ ] External host/provider/deployment 6건 revision/coverage/offline/durability audit

## Final acceptance

- [ ] executable 전체 통과
- [ ] 내부 specified 141건 실행 evidence 연결
- [ ] 외부 23건 boundary audit 완료
- [ ] catalog locator와 digest 최신화
- [ ] native/WASM artifact 재생성 후 전체 `npm test` 통과
