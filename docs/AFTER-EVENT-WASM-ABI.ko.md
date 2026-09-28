<!-- translation-source: docs/AFTER-EVENT-WASM-ABI.md -->
[English original](AFTER-EVENT-WASM-ABI.md)

# after_event 실행 ABI 식별 정보

`runtimes/wasm/after-event-runtime.mjs`는 기존 Rust `AfterEvent<32>` 엔진을 WASM으로
노출한다. JavaScript는 사실을 전달하고 네이티브 결과를 읽는다. 이벤트 창을 직접
평가하지 않는다. `after_event_any`와 `after_event_all`은 보존된 네이티브 결과 집합을
명시적으로 스칼라 투영한다.

## 정본 소스에서 사이트 바인딩

브라우저 안전 `instantiateSource` 진입점은 공개 도구체인으로 완전한 `.ghost.md`
문서 하나를 컴파일하고 이름이 지정된 `after_event` 선언을 선택한다. 창과 이벤트/
조건자 소스 태그는 해당 선언에서 가져온다. 호스트는 이 값을 다시 입력하거나 원시
제어 문자열을 추출하지 않는다.

```js
const runtime = await AfterEventRuntime.instantiateSource(wasmBytes, document, {
  filename: 'pump.ghost.md', signal: 'opened',
});
const { eventSourceTag, predicateSourceTag } = runtime.binding;
runtime.stage({
  time: { epoch: 7, nowMs: 100 },
  starts: [{ sourceTag: eventSourceTag, sourceEpoch: 2, id: 1,
    timeEpoch: 7, atMs: 100 }],
  predicate: { sourceTag: predicateSourceTag, atMs: 100,
    value: true, quality: 'measured' },
  acknowledgements: [],
});
runtime.commit();
console.log(runtime.results); // Each item retains its complete event identity.
runtime.dispose();
```

`binding`은 변경 불가다. `source`는 전체 변경 불가 소스 문서, 파일명, SHA-256,
설명자 SHA-256, 선택된 signal/site, 논리 이벤트 및 조건자 이름을 보존한다.
존재하지 않는 이름이나 다른 선언 종류를 선택하면 WASM 활성화 전에 실패한다.
여러 사이트가 있으면 명시적으로 선택해야 한다. 기본 첫 번째 또는 최신 사이트는
없다. 이 어댑터는 선택된 증거 사이트만 평가한다. 문서의 출력, 상태 표현식 또는 다른
사이트를 실행하지 않으며 문서가 장치 배포에 적합하다고 인증하지 않는다.

네이티브 결과는 식별자별로 `pending`, `satisfied`, `expired` 상태를 유지한다.
단계 실행 후 롤백하면 이전 결과가 보존된다. `any()`와 `all()`은 커밋된 상태를 읽는다.
`stagedAny()`와 `stagedAll()`은 커밋 없이 제어 트랜잭션에 단계화된 네이티브 집계를
노출한다.

## 저수준 바인딩

```js
const runtime = await AfterEventRuntime.instantiate(wasmBytes, {
  windowMs: 10_000, eventSourceTag: 11, predicateSourceTag: 22,
});
runtime.stage({
  time: { epoch: 7, nowMs: 100 },
  starts: [{ sourceTag: 11, sourceEpoch: 2, id: 1, timeEpoch: 7, atMs: 100 }],
  predicate: { sourceTag: 22, atMs: 100, value: true, quality: 'measured' },
  acknowledgements: [],
});
runtime.commit(); // Or rollback() before committing.
console.log(runtime.results); // [{ event: {...}, status: 'satisfied', satisfiedAtMs: 100 }]
runtime.dispose();
```

각 인스턴스는 선언된 Event 소스 하나와 Bool 조건자 소스 하나에 정확히 바인딩된다.
태그는 바인딩과 일치해야 한다. 한 묶음 처리에서 Rust가 오래된 창 만료, 종료 결과
확인, 시작 추가 및 조건자 적용을 원자적으로 수행한다. 커밋 전 `results`에는 커밋된
상태만 노출된다. 디코딩 또는 네이티브 단계화가 실패하면 식별자, 만료, 확인 또는
시계 진행을 소비하지 않는다. 두 번째 단계화가 실패해도 이미 단계화된 트랜잭션은
커밋 또는 롤백할 수 있다.

엔진은 명시적으로 확인될 때까지 완료된 결과를 포함해 최대 32개 식별자를 보존한다.
초과하면 묶음 전체를 거부한다. 이는 WASM 어댑터 용량이며 Rust 엔진은 호출자가
선택한 const 용량을 사용한다. 보류 중 결과는 종료 경계 전에 확인할 수 없다.
출력 상태는 `pending`, `satisfied`, `expired`이며 `satisfiedAtMs`는 `satisfied`에만
포함된다. 식별자는 출력 슬롯 인덱스가 아니라 `(sourceTag, sourceEpoch, id)`다.
새 ID는 바인딩된 소스 epoch 내에서 증가한다. 시계 epoch가 바뀌면 새 엔진 인스턴스가
필요하다. 숨겨진 초기화로 결과를 버리지 않는다.

조건자 품질은 `measured`, `held`, `constructed`다. 측정된 참 관측만 창을 만족시킨다.
`null`은 관측 없음이다. 새 시작과 조건자 관측은 현재 묶음 시각을 가져야 한다.
유지된 이벤트 전달의 중복은 원래 식별자와 시각을 보존한다. 만족 여부는
`[event.atMs, event.atMs + windowMs)`의 정확한 끝 시각을 제외한다.

## GFAE 버전 1 패킷

다중 바이트 정수는 부호 없는 리틀엔디안이다. 모든 u64 값은 최대 `2^53 - 1`이어야
한다. 디코더는 최대 2,048바이트를 허용하고 후행 바이트, 알 수 없는 버전/플래그,
유효하지 않은 불리언 바이트, 알 수 없는 품질 값을 거부한다.

| 필드 | 인코딩 |
|---|---|
| Magic, 버전, 예약 플래그 | `GFAE`, u16 = 1, u16 = 0 |
| 시각 epoch, 현재 시각 | u64, u64 |
| 시작 수, 확인 수 | u16, u16; 각각 최대 32 |
| 조건자 존재 여부 | u8 = 0 또는 1 |
| 각 시작 | source tag u32; source epoch, ID, time epoch, atMs는 u64 |
| 각 확인 | source tag u32; source epoch, ID는 u64 |
| 선택적 조건자 | source tag u32; atMs u64; value u8; quality u8 |

품질 바이트는 0 = measured, 1 = held, 2 = constructed다. 태그는 0이 아닌 u32다.
create/stage/commit/rollback/destroy export는 불투명한 인스턴스 핸들을 사용한다.
결과와 오류는 포인터/길이 getter로 노출되는 UTF-8 문자열이다. 소비자는 이후 변경이나
해제 전에 해당 뷰를 복사해야 한다.

## 제어 및 시뮬레이터 통합

실행 가능한 제어는 `after_event_any(signal)` 또는 `after_event_all(signal)`을 사용해야
한다. 각 시작은 Rust가 소유하는 독립 결과로 유지된다. 집계는 현재 스캔의 만료, 시작,
확인 및 측정 조건자 관측이 단계화된 뒤에만 계산된다. VM 스캔 성공 시 양쪽 상태를
커밋한다. VM 스캔 거부 시 추적기, VM과 논리 시간을 함께 롤백한다.

`ControlRuntime`은 컴파일된 매니페스트에서 이벤트 및 조건자 태그를 가져온다.
시나리오 호출자는 source epoch, ID, 타임스탬프, 확인과 활성화 시간 epoch만 제공한다.
비공개 생성 Result 입력은 일반 입력으로 제공할 수 없다. 타임스탬프가 스캔 시각과
같은 새로 승인된 측정 샘플만 관측이다. 중복, 유지 또는 오래된 샘플은 재사용하거나
보간하지 않는다. 종료 네이티브 결과가 생기기 전까지 투영은 `Err(NotReady)`이며
프로그램이 명시한 Result 처리를 따른다.

사이트당 용량은 32다. WASM 제어 및 `ghostsim` 경로는 이 계약을 지원한다. 일반
네이티브 복합 시나리오 실행기는 확인된 Event 전송이 없으며 이 ABI는 장치 배포나
물리 I/O 지원을 주장하지 않는다. 사용하지 않는 `after_event` 선언은 검사되지만
실행되지 않는 설명자로 남는다.

## Natural 공급자 차단 요인

`tide_is`와 `moon_is`에는 별도의 형식 관측 프로토콜과 네이티브 Result 평가기가
필요하다. 참조 §3은 분류를 제공하고 공급자 분류 기준, 위치/시간대, 개정, 커버리지,
만료와 불확실성을 요구한다. 현재 시간 설명자는 이 중 어느 것도 전송하지 않는다.

실행 가능한 lowering 전에 다음을 정의하고 검증해야 한다.

1. 관측 및 소스 질의별 공급자 식별 정보, 위치/시간대, 분류 기준과 개정 바인딩.
2. 민간 시계 신뢰, 커버리지/만료 경계, 불확실성이 분류 유효성에 미치는 영향. 특히 이 ABI는 암묵적 불확실성 허용치를 선택하지 않는다.
3. `TemporalContextFault`로의 고장 매핑. 명시적 `case` 및 Schedule Unknown/fallback 경로를 통해 사용 불가/오래된 증거를 보존한다.
4. 네이티브 검증과 평가, 생성 Result 투영, 원자적 제어 틱/재생 처리. 호스트 불리언만으로 이 계약을 충족할 수 없다.

이는 아직 결정하고 구현해야 하는 인터페이스 사항이다. 설명자 컴파일 성공이 런타임
적합성 주장을 뒷받침하지는 않는다. 이 경계가 구현될 때까지 Natural 조건 테스트는
실행 거부를 유지한다.
