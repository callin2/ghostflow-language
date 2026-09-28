<!-- translation-source: tasks/temporal-adapter-replay-design.md -->

[영문 원본](temporal-adapter-replay-design.md)

# WASM adapter를 통한 temporal replay

상태: 구현 완료; 집중 Rust 및 실제 WASM replay 수용 통과.
Batch14에는 이 테스트들이 포함되며 새 회귀는 없다. 무관한 Reference 실패
27건과 TODO 164건은 여전히 전체 목표 완료를 막는다.

기준: Reference §6.8은 별도 ghost instance, 원래 입력과 논리 시간의 replay,
live timeline과 effect sink 보존을 요구한다. Measured nested-window 수용도
두 WASM adapter에서 journal rollover 이후 replay를 요구한다.
`rewind`로 live runtime을 변경하는 것은 그 계약을 충족하지 않는다.

## API와 소유권

- `Runtime::replay_current_with_temporal(count, activation, max_peak_temporal_bytes)`는
  설치된 module과 capability를 분기한다. 호출자는 temporal activation profile과
  원본+ghost 결합 temporal peak 예산을 공급한다.
- `ScanDriver`는 생성 시 첫 underlying runtime tick을 기록한다.
  해당 framed run의 journal 기록만 적격이다. 보존된 기록의 scan ID는
  `tick - first_scan_tick`이며 논리 시각은 기록된 clock 입력에서 얻는다.
  이미 tick을 실행한 runtime을 감싸도 scan ID는 0부터 시작해야 한다.
- Count는 양수이며 적격 보존 기록 수를 넘을 수 없다. Replay는 가장 오래된
  prefix를 선택하고 그 직전 checkpoint에서 시작한다.
  조용히 count를 줄이거나 누락 입력을 지어내서는 안 된다.
- WASM export `gf_replay_temporal`, `gf_frame_replay_temporal`은 변경하지 않은
  GFTA activation packet, count, temporal peak 예산, JSON 예산을 받는다.
  별도 `gf_replay_ptr/len`, `gf_frame_replay_ptr/len`은 마지막 성공 replay를
  공개한다. Live trace나 framed outcome을 덮어쓰지 않는다.
- 두 JavaScript adapter는
  `replayTemporal({ count, profile, maxPeakTemporalBytes, maxJsonBytes })`를 공개한다.
  Count와 예산은 양의 u32 정수여야 한다. 기존 profile encoder가 profile 필드를
  검증한다. 메서드는 파싱된 replay JSON을 반환한다.

Envelope:

```text
{ format: "GhostFlow/temporal-replay-v1",
  mode: "legacy" | "framed",
  checkpointTick,
  records: [TickRecord | { format: "GhostFlow/scan-outcome-v1",
                          scanId, logicalTimeMs, trace: TickRecord }] }
```

## 원자성과 메모리

Ghost는 자체 상태와 근거를 소유한다. Actuator effect를 dispatch하거나
live 대기 입력, 상태, journal, intent, frame 순서, clock, 마지막 outcome을
바꾸지 않는다. 성공한 replay는 자체 별도 결과 buffer만 대체한다.
거부된 요청은 이전 replay와 live 실행 모두를 보존한다. 오류 진단은 바뀔 수 있다.

`maxPeakTemporalBytes`는 core의 명시적 temporal arena/checkpoint/proof 및
trace 집계를 유지한다. Scalar/module 복제와 allocator metadata는 그 temporal
예산 밖이다. 이를 전체 process 메모리 상한으로 설명해서는 안 된다.

`maxJsonBytes`는 이전에 보존한 replay buffer와 후보 buffer의 합을 별도로
제한한다. 직렬화는 무제한 중간 record 문자열을 만들지 않고 빌린 기록을 stream해야 한다.
할당 전에 escape된 UTF-8 byte를 세고 기하급수적 증가 없이 후보를 쓴다.
JavaScript가 복사한 텍스트와 파싱된 객체는 호출자 소유이며 이 상한 밖이다.

## 필수 테스트

1. Nested measured replay는 journal rollover를 포함하여 두 adapter에서
   aggregate 값, 소유 proof 식별자, 원래 논리 tick을 보존한다.
2. Legacy tick 이후 생성한 framed driver는 올바른 scan ID를 보고한다.
3. 거부된 뒤늦은 평가와 재시도는 중복 admission을 만들지 않는다.
4. Replay는 live 대기 입력, trace/outcome, 상태, intent, frame ID, clock을
   바꾸지 않는다. 이후 live step은 원래 timeline을 따른다.
5. 잘못된 count, profile, temporal/JSON 예산은 이전 replay와 live 상태를
   모두 보존한다. 크기 경계는 독립적으로 테스트한다.
6. 실제 rebuild된 WASM으로 JavaScript 사례를 실행한다. Mock만으로는 부족하다.

## 남은 Reference 범위

이 설치 프로그램 adapter 연산은 실행 근거를 제공한다. 그 자체로 §6.8의
영속 Program/source-closure/settings/binding/run 및 branch 식별자,
candidate-program what-if replay, 외부 checkpoint restore,
환경 simulation을 완료하지는 않는다. 이들은 전체 목표의 명시적 작업으로 남는다.
이 slice는 언어 기대값이나 기존 Reference 테스트를 약화하지 않는다.

## 집중 근거

- `build/temporal-replay-rust-final.log`: core 139, WASM ABI 8 테스트 통과.
- `build/temporal-replay-wasm-build.log`: release WASM build 성공.
- `build/temporal-replay-wasm.log`: 27/27 통과. 정확한 live/replay 기록 동등성,
  nested 20/3, 실패 tick 재시도, 대기 입력 보존, 마지막 성공 replay 보존,
  두 adapter의 기록 1024개 rollover를 포함한다.
- `build/scan-frame-wasm-temporal-replay.log`: 기존 framed suite 17/17 통과.
- `build/temporal-replay-catalog.log`: 변경되지 않은 Rust output-atomicity 테스트
  본문 위치 이동 뒤 5/5 통과. 기록된 digest는 변경되지 않았다.

빌린 core JSON writer 하나를 일반 trace와 replay가 공유한다.
Escape된 UTF-8, 거부된 sink write, 정확한 JSON N/N-1 경계,
보존 buffer 용량을 테스트한다. Framed 결과 변환은 ghost를 만들기 전에
출력 vector 비용을 반영하며 core가 반환한 trace 저장소와의 중첩도 포함한다.

전체 gate 근거: `build/compiler-runtime-batch14-full.log`,
`build/compiler-runtime-batch14-verification.json`.
Node: 1900 pass, 기존 Reference 실패 27, 164 TODO.
Gate 끝에 verification source hash가 일치했다.
정확한 전체 temporal-byte N/N-1 집계는 native core 테스트가 증명한다.
두 실제 WASM 경로는 현재 부족한 peak 예산을 거부하고 rollover를 검증하지만
정확한 전체 byte threshold를 독립적으로 측정하지는 않는다.
대상별 자원 보고와 경계 근거는 집중 temporal-plan 근거로 해결된다.
영속 외부 restore, hot-swap, 전체 §6.8 식별자는 미결이다.
