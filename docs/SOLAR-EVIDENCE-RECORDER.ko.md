<!-- translation-source: docs/SOLAR-EVIDENCE-RECORDER.md -->
[영문 원문](SOLAR-EVIDENCE-RECORDER.md)

# 수용된 Solar 스캔의 증거

`runtimes/wasm/solar-evidence-runtime.mjs`의 `SolarEvidenceRuntime`은
REF-03-028을 위한 제한된 참조 호스트 기록기입니다. 런타임이 수용(accept)한 스캔에
대한 증거를 기록합니다.

- 기존 공유 Solar/config framed Rust WASM 런타임을 인스턴스화합니다.
- 그 owner를 만들기 전에 정본 소스, 바이트코드, manifest, trace 메타데이터를
  검증합니다.
- admission(수용) 의미를 바꾸지 않으며, 하드웨어를 조작하지 않습니다.

**입력과 identity.** 호출자는 다음을 공급합니다.

- 컴파일된 정본 산출물;
- WASM 바이트;
- context 활성화;
- 명시적인 `runId`.

소스 문서 SHA256은 정의 revision입니다. 산출물 SHA256은 실행 바이트를
식별합니다. 기록기는 설치, 소스, 실행(run) identity를 발급하지 않습니다.

지원하는 프로필은 기존 GFB16 공유 Solar pulse/config 프로필입니다. 호출자는
유한한 공급자 사실과 명시적인 시계 증거를 공급합니다. 기록기는 천문학적 진위를
보증하지 않습니다.

**수용된 각 단계가 보관하는 것.** 수용된 각 `step(frame)`은 다음을 보관합니다.

- 확정된 결과 전체와 실제 context checkpoint;
- 소스 및 산출물 해시;
- 실행, 스캔, 논리 시간 identity;
- 시계 revision.

원래 코어 trace 행은 자신의 판단을 그대로 유지합니다.

**admission 영수증.**

- 실제로 수용된 `Due` 영수증은 그 공개 발생 identity에 대한 admission을 확립합니다.
- 같은 identity를 가진 이후의 공급자 행은 추가로 `AlreadyAdmitted`, source day,
  현재 계획 시각, 공급자/context revision, 가용성과 범위(coverage), 그리고 원래
  admission 영수증의 사본을 기록합니다.
- 원래 admission 메타데이터와 수정된 예측 메타데이터는 따로 보관됩니다.
- 부팅 중 놓친(boot-missed) 종료 키는 절대 admission으로 표시되지 않습니다.

**`booleanProjection`.** 이 값은 예약의 현재 수용된 스캔을 설명합니다.

- 보관된 과거 발생은 다른 새 발생 때문에 그 스캔의 예약 Bool이 참이 되더라도
  `occurrenceDue: false`를 가집니다.
- 원시 `coreDecision`은 그대로 보입니다. 현재의 이식 가능한 종료 키 checkpoint만으로는
  수용된 발생과 놓친 발생을 구별할 수 없습니다. 호스트 기록기는 실제 수용 영수증을
  근거로 그 분류를 제공하며, 코어의 판단에 라벨을 다시 붙이지 않습니다.

**거부, 제한, 수명.**

- 거부된 프레임은 증거를 추가하지 않으며 실제 context checkpoint를 유지합니다.
- `observe()`는 독립된 사본을 반환합니다.
- owner는 영수증을 최대 256개, JSON 프레임 예산을 1 MiB까지 허용합니다.
- 사용 후에는 dispose하세요.
- 물리적 sink, 영속 writer, context checkpoint 복원 API는 없습니다.
- 새 활성화에서 기록된 프레임을 재생하면 증거를 재현할 수 있습니다. checkpoint를
  복원하는 것만으로는 이 호스트의 admission 이력이 복원되지 **않습니다**.
- 영속 저장과 크래시 복구는 여전히 외부 호스트의 책임입니다.

**테스트.** 집중 테스트는 다음을 수행합니다.

- native Rust와 WASM의 결과 전체와 checkpoint를 비교합니다;
- 실제 admission과 due-false 재관측을 실행합니다;
- 같은 발생 identity 아래에서 수정된 사실을 보관합니다;
- 새 활성화를 재생합니다;
- 과거 발생과 새 발생 기록이 동시에 있는 경우를 확인합니다;
- 위조된 소스 메타데이터를 활성화 전에 거부합니다;
- 누락, 무효, stale(오래된 값) 증거를 수용된 이력과 구별합니다.

이는 소프트웨어 참조 호스트의 결과이며, Device 동작이나 물리적 구동의 증명이
아닙니다.
