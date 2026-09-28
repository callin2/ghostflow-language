<!-- translation-source: docs/TEMPORAL-REPLAY.md -->
[영어 원문](TEMPORAL-REPLAY.md)

# WASM adapter를 통한 temporal replay

정적 temporal resource 계획은 [TEMPORAL-RESOURCES.md](TEMPORAL-RESOURCES.md)에 명세돼 있다.

`GhostFlowRuntime`/`FramedGhostFlowRuntime`은 low-level adapter 연산을 동기적으로 노출한다.

```js
const replay = runtime.replayTemporal({
  count,
  profile,
  maxPeakTemporalBytes,
  maxJsonBytes,
});
const lastSuccessfulReplay = runtime.replay;
```

profile과 두 budget은 명시 caller 입력이다. adapter는 양의 safe u32 count/budget 값을
검증한다. replay envelope는 기록 input, logical tick, sample identity, temporal epoch를
보존한다. 초기 replay getter는 `null`이다.

envelope 형태는 다음과 같다.

```text
{ format: "GhostFlow/temporal-replay-v1",
  mode: "legacy" | "framed",
  checkpointTick,
  records: [TickRecord | { format: "GhostFlow/scan-outcome-v1",
                          scanId, logicalTimeMs, trace: TickRecord }] }
```

legacy adapter는 runtime의 기록 tick history를 사용한다. framed adapter는 자신을 생성한
`ScanDriver` run의 record를 사용한다. 감싼 runtime이 이미 tick을 실행했어도 첫 기록 tick의
scan ID는 0이다. 이후 각 record는 `scanId = tick - firstScanTick`을 사용한다. logical time은
기록 clock input에서 온다. replay는 가장 오래된 적격 prefix를 선택하고 바로 전 checkpoint에서
시작한다. count를 clamp하지 않는다.

replay는 별도 ghost instance에서 실행한다. effect를 dispatch하거나 live pending input,
state, journal, intent, trace/outcome, frame sequence, clock, 마지막 결과를 변경하지 않는다.
거부 요청은 이전 replay/live 실행을 보존한다. 성공 replay는 별도 replay 결과만 교체한다.

`maxPeakTemporalBytes`는 core temporal arena, checkpoint, proof, trace accounting을 다룬다.
scalar/module clone과 allocator metadata는 temporal budget 밖이다. `maxJsonBytes`는
보존 replay/후보 JSON buffer를 다룬다. adapter는 allocation 전에 escaped UTF-8 byte를
세고 무제한 중간 문자열을 피해야 한다. JavaScript parsed object/복사 text는 caller 소유
allocation으로 남는다.

low-level WASM export는 `gf_replay_temporal`/`gf_frame_replay_temporal`이다. 성공 결과는
`gf_replay_ptr/len`/`gf_frame_replay_ptr/len`으로 노출한다. live trace/framed outcome data를
덮어쓰지 않는다.

이 연산은 설치 program 실행 증거를 제공한다. 그 자체로 Reference §6.8의 durable
Program/source-closure/settings/binding/run identity, candidate-program what-if replay,
foreign checkpoint restore, 환경 simulation, durable continuity를 확립하지 않는다.
전체 durable/what-if replay는 이 API 밖이다. hardware/physical I/O 증거도 이 문서 밖이다.
