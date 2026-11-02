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

다음 바이트 소비 의무는 생산 `Reader::u8` 및 고정 폭 정수 reader의 실제 Rust 추출과 경계/커서 정리다. 이들은 `take`와 오류 문자열 생성에 의존하므로 이미 발견한 표준 라이브러리 추출 한계를 먼저 해결해야 한다. 같은 실패를 반복하거나 Rust를 단순화한 복사본으로 대신 증명하지 않는다. 독립적인 원본→artifact 인증서 확장과 실제 owner 경로의 반례 검증은 이 의존성과 별개로 진행할 수 있다.

### 검토 수정 후 통합 근거

위 개별 보고서의 초기 실행 기록 이후에도 검증을 진행했다. 통합 결과의 기준은
[연속 작업 기록](2026-10-29-unattended-correctness-590.md)의 build170·173·176 절이다.
Bool 원본 reader는 build170 소스에서 Lean173회와 별도 JS admission11개가 통과했고,
센서 원본 reader는 Lean125회, 센서·상태 이력은 build173 소스에서 Lean80회가 통과했다.
각 실행에서 기록한 소스 해시와 통합본을 대조했다. 해당 receipt SHA-256은 순서대로
`ee18d623320137b611291b0c2a66f74ae657d3b6541c06b4fab736d66b7f0a51`,
`c80cded0cc4a0899fe156c866e2e29b902e8bfc73475174ce3ca5b90e7c09832`,
`9940c5325ab03e18dec0b26950fd458bbbda8817408decbd1b93eaab48c28f5c`다.
그러므로 원본 reader의 검토 전183개 기록을 최신 결과로 쓰거나, 이미 완료한 통합 검사를
새로운 미완료 작업으로 세지 않는다. Rust reader의 `1bcb177` 통합 실행도7개 정리와3개
거절을 통과했으며 receipt는 `d8a2a82d1f213cdd702d5d6dcc76f764775c5f38a95f6fd9a5558f4aee079437`다.

## 기준 파일 지문

후속 build182·183의 증거는 [연속 작업 기록](2026-10-29-unattended-correctness-590.md)에
추가했다. 생성 Bool16개는 원본 reader와 전체 module의 all-tick 정리를 적용한 유한
사례군이며, signed i32 코덱은 모든 허용 정수에 대한 수학적 왕복·정규성 정리다.
실제 compiler54개 payload와 재사용 native/WASM6개 trace는 별도 관측이다.
생산 Rust 정수 reader 또는 전체 compiler 대응 증명을 완료한 것으로 바꾸지 않는다.
공통 Lean process 판정 보완에 따른 기존 로그 재판정도 신규 커널 증명과 구분했다.

build187은 실제 Rust checked 정수 연산의 세 추출 시도와 거절 사유를 보존했다.
외부 진입 함수의 Lean 출력 유지 및 미지원 intrinsic이 남아 있어 새 Rust 의미 정리는 없다.
감사기 회귀8개와 공식15 gate 통과는 도구의 실패 판정 근거이며, 위 Rust 대응 의무의
완료로 세지 않는다. 두 센서의 출처 연결 및 elapsed 시작 시각 전이는 별도 후속 단위다.

build190은 두 Bool sensor의 실제 전체 GFB와 독립 출처를 인증했다. 같은 여섯 rail을
사용하는 두 식 각각에 대한 모든 Reading 조합의 정리다. JS AST 투영은 신뢰 경계에
남으며 독립 원본 reader의 두 센서 문법 증명은 추가하지 않았다. 실제 전체 scan의2개
event 수집은500회 native/WASM 관측으로 구분한다. 타이머 시작 시각 전이는 진행 중이다.

`shasum -a 256`으로 이 checkout에서 관측한 별도 판본이다. 앞선 `4861a78`의 역사적 목록과 해시는 그대로 보존한다.

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
