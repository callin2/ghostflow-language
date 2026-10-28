# GhostFlow 컴파일러 정확성 증명 의무 현행화 (#590)

기준 소스는 `1bcb1771f69d78ca1c1d78f391ef67eea232163d`이다. 이 문서는 [#590](https://github.com/callin2/ghostflow-language/issues/590)의 작업 범위와 현재 증거를 연결한다. 과거 `4861a78a72f0f1078cafe99bf26b93d541e1b82c`의 `experiments/compiler-correctness/obligations.json` 및 `semantics-inventory.md`를 출발점으로 삼고, 이후 추가된 증명 단위를 반영했다. 과거 Percent 결함은 [#592](https://github.com/callin2/ghostflow-language/pull/592)에서 고쳐졌으므로 현행 미해결 결함으로 세지 않는다. 이 보고서는 새 증명을 실행한 기록이 아니다.

## 실제 제품 경로와 의무

제품 진입점은 정본 `.ghost.md`를 받는 `tools/toolchain.mjs:23`의 `compileSource`와 `tools/compile-source.mjs:86-112`의 `compileSourceSync`이다. 하드웨어 front matter와 레거시 입력 검사를 거친 뒤, `extractLiterate`가 실행 fence를 추출한다. `compileLiterateCore`는 `parseControl`로 분기를 선택하지만, 각 선택된 컴파일 함수는 다시 파싱한다. 따라서 첫 AST와 실제 바이트 생산자의 AST가 같다는 주장도 증명 의무이다.

| 단계 | 현재 코드 | 전체 정확성에 필요한 관계 | 현재 근거 |
| --- | --- | --- | --- |
| 정본 입력과 추출 | `tools/compile-source.mjs:94-142`, `tools/literate.mjs` | 원본 UTF-8, 허용된 fence, 실행 코드, 위치와 import closure가 정확히 대응하고 잘못된 입력은 거부됨 | Bool 및 sensor의 **제한된 문법**에 대한 독립 원본 바이트 reader 증명. 전체 CommonMark/제품 추출기는 미증명 |
| 파싱과 분기 | `tools/compile-source.mjs:149-164`, `tools/control.mjs`의 `ControlParser` | 문법·우선순위·노드 ID·분기 선택이 실제 생산자 AST와 일치하고 모든 실패가 거부됨 | 제한된 reader의 원본 바이트 admission. 전체 파서와 재파싱 일치성은 미증명 |
| 타입 검사와 lowering | `tools/control.mjs`의 `Lowerer`, `tools/core-ir.mjs` | 타입·단위·범위·스코프·상태 스냅샷·fault·시간·제약·실패 동작이 언어 의미와 일치 | Bool 식·동시 상태 갱신, Bool sensor 회복, 한 상태의 입력 이력 단위 증명. 나머지 구성요소는 테스트 근거 |
| 직렬화와 메타데이터 | `tools/gfb1.mjs:725-839`, `tools/compile-source.mjs:227-330`, `tools/source-trace.mjs` | 실제 전체 바이트, profile/길이/offset, manifest·source map·trace·해시가 동일한 원본과 실행 의미를 지칭 | 제한된 Bool 전체 module equality, raw loader, serializer 양방향 정리 및 sensor metadata binding. 전체 profile과 JS 투영은 미증명 |
| Rust 로더와 실행 | `crates/ghostflow-core/src/lib.rs:212`의 `Module::load`, tick/식 실행기 및 `runtimes/wasm` | 실제 Rust의 바이트 거부·수용, 입력/이전 상태→다음 상태/요청 출력/이벤트의 모든 실행 이력이 모델과 같음 | Lean raw-PC 모델 증명과 유한 native/WASM 관측. 실제 Rust `Reader::new`/`finished`만 추출 기반 기초 증명; 로더/VM refinement 미증명 |

출력 인수는 요청 값 이후의 안전 값, 적용, 확인 및 물리 장비 동작과 별도이다. 컴파일러 증명만으로 Device 설치나 물리 출력은 입증되지 않는다.

### 현재 진입 분기

`tools/compile-source.mjs:149-164`의 우선순위는 다음과 같다. 선택 순서가 바뀌면 같은 소스가 다른 산출물을 낼 수 있으므로 각 분기 및 분기 간 배타성/우선순위가 의무이다.

| 선택 조건 | 생산 함수와 결과 | 남은 핵심 의무 |
| --- | --- | --- |
| `sourceClosure`와 import | `compileComposition` → `compileComposedControl`, GFB | pinned closure, 캡처 없는 치환, 포트 타입/단일 공급자, 합성 실행 의미 |
| standalone resource policy | `compileResourcePolicyArtifact`, 비실행 JSON | 검사된 policy와 정확한 JSON/manifest 동일성, 실행 불가 성질 |
| shared constraints 또는 continuous policy | `compileControlPolicyDescriptorArtifact`, 비실행 JSON | 검사된 contract와 descriptor 동일성. 이후 바인딩 경로의 GFB17/25는 별도 의무 |
| account/account constraints | `compileAccountingControl`, 실행 GFB (`manifest`의 `control-v10` 표기는 실제 바이트 버전과 별도) | 적용 기록·local-day/rolling 예산·fault 전제와 Rust accounting 의미 |
| 실행 불가능한 명시 schedule policy | `compileScheduleDescriptorArtifact`, 비실행 JSON | 검사된 schedule과 descriptor 동일성, GFB로 오인되지 않음 |
| temporal descriptor call | `compileTemporalDescriptorArtifact`, 결과에 따라 GFB 또는 비실행 JSON | 실제 `after_event`/natural site와 projection 유무에 따라 산출물 종류 및 의미가 맞음 (`tools/control.mjs:4711-4724`) |
| 그 밖의 control | `compileControl`, GFB; lifecycle이면 GFB22 wrapper | 일반 lowering·바이트·Rust scan 의미와 lifecycle 재시작 입력/trace 일치 |

바인딩은 별도 진입 경로이다. `tools/bound-resource-control.mjs:58`은 검사된 descriptor와 설치 binding으로 GFB17을 만들고, `tools/continuous-resource-control.mjs:36`은 GFB25를 만든다. `tools/control.mjs:4658-4683`은 GFB17 안쪽을 Bool GFB1/3으로 제한한다. `tools/control.mjs:4643-4654`와 Rust `Module::load:283-302`는 GFB25 안쪽을 scalar GFB1–4로 제한한다. wrapper, 설치 binding, 제약 적용과 선택 결과의 정확성은 Bool 단위 정리 밖이다.

### 바이트 profile 범위

`tools/gfb1.mjs:768`은 보통 module의 형식을 고른다. 형식 1–9, 11–16, 18–21은 과거 목록의 scalar/Int/시간·schedule·PID·calendar·range 경로이다. 형식 10은 Rust 로더가 받지만 현재 `emitGfb`의 형식 선택 목록에는 없다. `tools/control.mjs:1706`의 `manifest.format = control-v10`은 바이트 헤더 10의 증거가 아니다. 17은 bound resource wrapper, 22는 lifecycle wrapper, 25는 continuous resource wrapper이다. 추가된 23은 `at-window`, 24는 weekday Solar/Tide profile이며, 실제 Rust 로더는 23/24를 본체 형식으로 받는다 (`crates/ghostflow-core/src/lib.rs:326-350,789-845`). 25는 본체가 아닌 wrapper다. 관련 유한 테스트에는 `tests/reference-foundations-temporal.test.mjs`, `tests/natural-weekday-runtime.test.mjs`, `tests/continuous-resource-control.test.mjs`가 있다. 파일 존재와 테스트 통과는 해당 profile의 전칭 증명이 아니다.

## 현재 형식 증거의 정확한 경계

| 증명 단위 | 실제 정리/입력 | 입증된 부분과 남은 연결 |
| --- | --- | --- |
| Bool 식과 동시 갱신 | `experiments/bool-translation-validation/BoolTranslation.lean`의 `check_run`, `simultaneous_tick`; `ByteMachine.lean`의 `accepted_steps` | 받아들인 Bool 식의 모든 valuation 및 구조화된 바이트/PC **모델** 실행. 생산 Rust VM과 동일성은 미증명 |
| 직렬화와 전체 module | `Serializer.lean`, `DecoderSoundness.lean`의 `decode_iff_serialized`, `ModuleEnvelope.lean`, `ModuleLoader.lean` | 제한된 Bool GFB1/3의 정규 바이트와 전체 module equality, raw module admission, 상태 초기화/trace 모델. 전체 profile과 Rust 로더는 미증명 |
| 정본 원본 바이트 | `SourceReader.lean`의 `initialized_trace` | 제한된 Markdown/Bool 문법의 원본 바이트→raw module→모든 tick 수; 제품 CommonMark·전체 파서는 미증명 |
| Bool sensor | `SensorSourceReader.lean`의 `loaded_observation`, `SensorProfile.lean`의 `loaded_observation` | 원본 바이트, raw module, Result/trace metadata가 맞는 제한된 `recover(false)` 한 센서. `SmallNumberLaws`를 전제로 하며 생산 f64는 미증명 |
| Bool sensor와 상태 | `SensorStateSource.lean`의 `original_source_input_trace`, `SensorStateMachine.lean`의 `input_trace` | 한 센서·한 상태·한 출력의 토글 문법에서 모든 유한 입력 이력, 초기 Bool 양쪽, fault와 stale payload. 실제 Rust/호스트 adapter refinement는 미증명 |
| 생산 Rust reader 기초 | `ReaderFoundationProof.lean`의 7개 정리, 원본 `Reader::new`/`finished` Aeneas 추출 | bytes 보존, 초기 cursor 0, 범위 불변식, `finished`와 잔여 리스트 공백의 관계. `take`, 정수 해독, 전체 `Module::load`는 아직 미증명 |

과거 `CompilerSafety.check_run`은 인접한 정확히 같은 Bool constraint 중복 제거만의 정리다. 전체 compiler나 제약 일반 의미의 증명이 아니다. 위 단위의 브리지 fixture, mutation, native/WASM 관측은 각각 범위를 제한한 실행 증거이며 전칭 Rust refinement를 대신하지 않는다. 특히 `SourceReader`는 일부 문법을 독립적으로 읽지만 제품 파서 구현 전체를 증명하지 않는다.

기록된 실행 증거: Bool 전체 module의 92/92 기대 결과(`module-envelope-report.md`, source identity `ff5e81aaa3f9b1df352e1531035f0009d29821dc9bac37237401c616f290fe99`, receipt SHA-256 `f0e6c9fdb9f36c4d649124c9fe52f6c34a72f8fd003a0d49e1fd21a7303336db`); Bool raw loader의 130/130 기대 결과(`module-loader-report.md`, source identity `f14eae533d798aba6240a0e0e05ff8a38a3536a59b4a80893503c7c01483a0ad`, receipt SHA-256 `928cb1527bcd9271d6462abdb4577881e18f5c2305d266cb6cd04bbcad3a4958`); 원본 Bool reader의 183 기대 결과는 **리뷰 수정 전** 실행(`source-reader-report.md`, source identity `3f6e9d3b2347a66cf414b000190381fbb0b2d30e864ef97d60755e1ac129e2ea`, receipt SHA-256 `bf411a9b09da43da90ff2d7b93d6647a1019ab3a5573b4138d981eace8ade402`). Sensor의 44 Lean invocation은 `experiments/bool-sensor-validation/proof-report.md`에 source identity `f5ba08fa475683f1a27927bc9c65c858ab86233bd3d52cefc6985efc5cbee6c6`로 기록되어 있다. 상태 단위의 168 native/WASM 관측과 통합 build 169 출처는 `experiments/bool-sensor-state-validation/proof-report.md`에 기록되어 있다. 이 수치는 이 기준 checkout에서 새로 돌린 결과가 아니다.

Rust reader의 보관된 검증 영수증 SHA-256은 `c4594a73839230601e7a05e98cbee0ac9dfe092c94e98da1056599423af578c6` (`experiments/rust-reader-validation/proof-report.md`)이다. 추출 기준 Rust 파일은 `645b6899f325b0d1d24a1398f2f70af8d9f44787`의 SHA-256 `9115f4a05d7e55be9674473796f6be214bada56fa1bb8177845ea495f1314bf4`이며 이 checkout의 해당 파일 해시와 같다. `Value::value_type`은 실제 추출됐지만 pinned Aeneas Lean backend의 `F64` 미지원으로 생성 Lean이 컴파일되지 않았다 (`experiments/rust-reader-validation/ValueType-extraction-diagnosis.md`, 실패 기록 SHA-256 `66e56ee8220738c427edcce9ceb97bf27d9d82929b158a6f4de10277910db213`). `Reader::take`/정수 디코더는 Option/String ownership과 UTF-8 관련 표준 라이브러리 모델 의존성이 남아 있다. 이 시도들을 통과한 증명으로 세지 않는다.

## 남은 의무와 다음 독립 단위

전체 주장을 위해서는 (1) 제품 추출/파서/재파싱/타입·lowering의 모든 허용 소스에 대한 의미 보존과 거부, (2) 모든 산출물 분기 및 GFB profile·wrapper의 실제 바이트와 동반 metadata 정합성, (3) 실제 Rust 로더/VM 및 WASM 경계와 Lean 모델의 refinement, (4) 시간·수치/f64·fault·제약·accounting·composition·lifecycle의 상태 이력 의미가 필요하다. 현재 어느 것도 전체 범위에서 닫히지 않았다.

다음 작은 독립 단위로는 생산 `Reader::u8` 및 고정 폭 정수 reader의 실제 Rust 추출과 경계/커서 정리를 권한다. `Reader::new`/`finished`의 바로 다음 바이트 소비 의무이며 원본 `Module::load`로 이어지는 관찰 가능한 거부·수용 경계를 좁힌다. 먼저 현행 Aeneas의 Option/String 의존성이 없는 함수 하나가 추출되는지 확인하고, 실패하면 정확한 생성 출력/의존성으로 기록한다. 별도로 제한된 Bool source reader의 **리뷰 수정 후** 통합 checkout에서 기존 verifier를 재실행해 source identity를 갱신하는 것은 새 정리보다 작은 검증 작업이다. 어느 작업도 Rust 전체 로더/VM 증명을 완료했다고 표현하지 않는다.

## 기준 파일 지문

`shasum -a 256`으로 이 checkout에서 관측한 값이다. 앞선 `4861a78` 목록의 해시를 현재 해시로 대체해 사용한다.

| 파일 | SHA-256 |
| --- | --- |
| `tools/compile-source.mjs` | `d830393506de42403d5a3dc860ea9d52e720c1645cd0e82184ef965f54df40fa` |
| `tools/toolchain.mjs` | `9339a37b439d4b6faa886eeb99c56c6e3fdc72eb8b973a4fd6a9fe39a5d103ae` |
| `tools/control.mjs` | `11a06e9ee3d1234f509d87552c79f6b08c76903ebe95c87c3d06ff85789d8d48` |
| `tools/literate.mjs` | `1b077cb32b12fd42bcd047336b6565c76d4b454945ece681f3146204054b86ef` |
| `tools/composition.mjs` | `5e852a2987b523cef6e24b92e2dca6a62462ef140decced59bb23fa228eecfe8` |
| `tools/gfb1.mjs` | `092a17141c3f6f890ecf4cb863ef904259d8cf126964d95e794eda99e68cc420` |
| `tools/core-ir.mjs` | `9e0f21b960ce3d2986399b214e5a678d335c0bd95e0f4c3f87769c019755a013` |
| `crates/ghostflow-core/src/lib.rs` | `9115f4a05d7e55be9674473796f6be214bada56fa1bb8177845ea495f1314bf4` |
