<!-- translation-source: docs/SOLAR-EVIDENCE-RECORDER.md -->
[English original](SOLAR-EVIDENCE-RECORDER.md)

# 수용된 Solar scan의 실행 증거

`runtimes/wasm/solar-evidence-runtime.mjs`의 `SolarEvidenceRuntime`은
REF-03-028을 위한 유한한 참조 host 기록기다. 기존 공유 Solar/config
framed Rust WASM runtime을 생성하며, owner 생성 전에 정본 source, bytecode,
manifest와 trace metadata를 검증한다. admission 의미를 바꾸거나 하드웨어를
조작하지 않는다.

호출자는 컴파일된 정본 artifact, WASM bytes, context activation과 명시적
`runId`를 공급한다. source-document SHA256이 definition revision이며,
artifact SHA256이 실행 bytes를 식별한다. 기록기는 installation, source 또는
run identity를 발급하지 않는다. 지원 범위는 기존 GFB16 공유 Solar
pulse/config profile이며 유한한 provider facts와 명시적 clock evidence를
호출자가 제공한다. 천문 자료의 진위를 보증하지 않는다.

수용된 각 `step(frame)`은 전체 committed outcome과 실제 context checkpoint,
source/artifact hash, run/scan/logical-time identity 및 clock revision을
보존한다. 원래 core trace row의 decision을 유지한다. 실제 수용된 `Due`
receipt가 공개 occurrence identity의 admission을 증명한다. 같은 identity의
provider row를 나중에 다시 관측하면 `AlreadyAdmitted`, source day, 현재
planned instant, provider/context revision, availability와 coverage 및 원래
admission receipt의 복사본을 추가로 기록한다. 원래 admission metadata와
수정된 prediction metadata는 구분한다. boot에서 missed로 끝난 terminal key를
admission으로 표시하지 않는다.

`booleanProjection`은 현재 수용된 scan의 schedule 값을 나타낸다. 다른 새
occurrence 때문에 해당 scan의 schedule Bool이 true여도 보존된 옛 occurrence의
`occurrenceDue`는 false다. 원래 `coreDecision`도 보존한다. 현재 portable
terminal-key checkpoint만으로는 admitted와 missed를 구분할 수 없으므로,
host 기록기는 실제 수용된 receipt로 분류하며 core 결과를 바꿔 부르지 않는다.

거절된 frame은 증거를 추가하지 않으며 실제 context checkpoint를 유지한다.
`observe()`는 독립적인 복사본을 반환한다. owner는 최대 256개의 receipt와
frame당 1 MiB JSON 예산을 허용한다. 사용 후 dispose해야 한다. 물리 sink,
durable writer 또는 context-checkpoint restore API는 없다. 기록된 frame을
새 activation에서 재실행하여 증거를 재현할 수 있다. checkpoint만 복원해서는
host admission history가 복원되지 않는다. durable storage와 crash recovery는
외부 host의 책임이다.

집중 테스트는 전체 native Rust/WASM outcome과 checkpoint를 비교하고, 실제
admission과 due-false 재관측, 같은 occurrence의 수정된 facts, 새 activation의
재실행, 옛 occurrence와 새 occurrence의 동시 기록을 검증한다. 위조 source
metadata는 activation 전에 거절하며, missing/invalid/stale evidence와 admitted
history를 구분한다. 이는 소프트웨어 참조 host 검증이며 Device 또는 물리
작동의 증거가 아니다.
