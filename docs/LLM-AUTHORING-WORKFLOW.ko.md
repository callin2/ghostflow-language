<!-- translation-source: docs/LLM-AUTHORING-WORKFLOW.md -->
[영문 원문](LLM-AUTHORING-WORKFLOW.md)

# 모델과 무관한 저작 작업 흐름

이 예제의 아티팩트, 시나리오, 런타임, 콘솔, 장치 경계는 [도구 체인 아키텍처](LLM-TOOLCHAIN-ARCHITECTURE.md)를 참조하세요.

이 오프라인 예제는 가상의 사용자 요청으로 시작합니다. “시작은 펌프를 요청한다. 정지는 요청을 취소한다. 허가가 없으면 펌프를 막는다.” 사용자는 최대 실행 시간이나 재시작 규칙을 제공하지 않았습니다. 작성자는 이 미결 질문을 **확인되지 않은 가정**으로 기록하고 타이머나 지속 시간 정책을 추가하기 전에 사용자에게 묻습니다. 확인된 요청은 독립적으로 검사하고 시뮬레이션할 수 있습니다. 모델 공급자나 장치 드라이버는 관여하지 않습니다.

이번 실행에서 편집 가능한 프로그램은 `build/authoring/pump.ghost.md` 하나뿐입니다. `examples/authoring/` 아래 두 파일은 동일한 완전한 리터레이트 문서의 변경 불가 과거 리비전입니다. 둘 다 산문과 의도 앵커를 포함합니다. 별도의 원시 코드 프로그램은 없습니다.

## 정확한 규칙 조회

저장소 루트에서 TOON 요청을 사용해 [§1.2, 소스와 의도 연결](reference/01-source-and-syntax.md#12-원문-위치와-의도-연결), [§1.5, 선언 뼈대](reference/01-source-and-syntax.md#15-대표-선언-골격), [§4.7, 요청 및 안전 의도](reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)를 가져옵니다. 반환된 `citation` 및 `digest`는 해당 결정에 사용한 정확한 참조 발췌를 식별합니다.

```sh
node tools/reference-query.mjs --toon-request examples/authoring/intent-reference-request.toon
node tools/reference-query.mjs --toon-request examples/authoring/syntax-reference-request.toon
node tools/reference-query.mjs --toon-request examples/authoring/reference-request.toon
```

## 문서 하나를 검사하고 수정한 뒤 컴파일

```sh
mkdir -p build/authoring
cp examples/authoring/pump-rev-1.ghost.md build/authoring/pump.ghost.md
node tools/ghostc.mjs --request examples/authoring/check-rev-1.toon
```

첫 검사는 0이 아닌 상태로 종료됩니다. TOON 결과를 디코딩하고 `diagnostics[0].span`을 사용해 원본 `.ghost.md`의 불완전한 `pump <- start && ;` 표현식을 찾습니다. `source.sha256`, `documentId: GF-EXAMPLE-PUMP`, `revisionId: rev-1`은 실패한 리비전을 식별합니다. [§1.5, 선언 뼈대](reference/01-source-and-syntax.md#15-대표-선언-골격)와 진단은 해당 표현식을 `pump <- start && !stop;`으로 수정할 근거가 됩니다. 작성자는 **동일한** `build/authoring/pump.ghost.md`를 편집합니다. 다음 복사 명령은 검토된 리비전 2 픽스처에서 해당 수정을 재현합니다.

```sh
cp examples/authoring/pump-rev-2.ghost.md build/authoring/pump.ghost.md
node tools/ghostc.mjs --request examples/authoring/check-rev-2.toon
node tools/ghostc.mjs --request examples/authoring/compile-rev-2.toon
```

성공한 검사는 같은 문서 ID, 리비전 `rev-2`, 전체 Markdown 문서의 새 SHA-256을 보고합니다. 컴파일은 GFB와 검증된 소스 맵을 기록합니다. 소스 맵은 정확한 산문, 앵커, 문서/리비전 ID, GFB 다이제스트를 보존합니다. 실패한 리비전은 과거 증거로 남고 리비전 2는 후보 아티팩트가 됩니다.

## 가상 출력 검사

```sh
cargo build --locked --offline --release -p ghostflow-core --example scenario_scan
node tools/ghostsim.mjs build/authoring/pump.gfb examples/authoring/pump-scenario.toon --format toon
```

시나리오는 0, 1, 2 ms에 스캔합니다. 0 ms에는 `pump`가 요청되었지만 `permit`이 false이므로 안전한 펌프 의도는 false입니다. 1 ms에는 허가가 true가 되어 안전한 펌프 의도도 true가 됩니다. 2 ms에는 정지가 true가 되어 두 의도 모두 false입니다. 이는 가상 의도이며 적용 또는 확인된 릴레이 상태가 아닙니다. 결과는 정확한 컴파일 소스 리비전을 식별합니다.

동일 아티팩트를 위한 선택형 ASCII 콘솔은 `node tools/ghostsim-console.mjs build/authoring/pump.gfb --bind DI1=start --bind DI2=stop --bind DI3=permit_ok --bind RO1=pump --bind RO2=permit`입니다. 프로파일을 지정하지 않으면 콘솔은 가상 Waveshare 8DI/8RO 라벨을 사용합니다. 명시적 바인딩은 해당 라벨을 이 문서의 논리 포트에 연결할 뿐 물리 핀을 주장하지 않습니다.

## 사용자에게 물을 미결 질문

> 펌프는 최대 실행 시간 뒤에 정지해야 하나요? 그렇다면 지속 시간과 재시작 규칙은 무엇인가요?

답변을 받기 전까지 작성자는 해당 동작을 미결 상태로 둡니다. 타이머, 추측한 기본값, 꾸며낸 문법은 문서에 추가하지 않습니다. 호스트는 사용자에게 물을 때 질문과 문서 식별 정보를 보존합니다. 언어 패키지는 모델을 호출하거나 대화를 기록하지 않습니다.

`scenario_scan`을 빌드한 뒤 `node --test tests/authoring-workflow.test.mjs`로 전체 오프라인 픽스처 검사를 실행하세요. 공개 참조, 컴파일러, 시뮬레이터 CLI를 사용하며 동일 문서의 리비전 변경, 진단 위치, 아티팩트 출처, 가상 의도를 확인합니다.
