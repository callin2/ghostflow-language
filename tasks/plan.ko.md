<!-- translation-source: tasks/plan.md -->

[영문 원본](plan.md)

# GF-COMPOSE 연구와 설계 계획

전달 상태(2026-09-20): GitHub 게시와 정확한 본문 readback이 완료됐다.
상위 #99는 OPEN이다. Issue #100–#108은 연구 완료로 CLOSED다.
Issue #101–#108에는 수정된 지침과 전체 문서/hash가 있다. #100과 R1은 변경하지 않았다.
게시된 수정 집합은 로컬 문서 10개, 즉 이 계획, 요약, R2–R9를 다룬다.
Runtime 코드, 테스트, 규범 언어 명세는 변경하지 않았다.
Runtime 테스트, commit, push는 없었다. 수정 게시와 readback은 검증됐지만
구현, Device 검증, 물리 수용을 주장하지 않는다.

사용자는 architecture 연구, 요약 문서, GitHub 하위 issue를 요청했다.
합의된 결과는 농민, 소프트웨어 엔지니어, 하드웨어 엔지니어의 노력 감소,
설명 가능성 증가, 추적 가능성 증가다.

상세 계획, 발견 사항, 결정 상태, 의존 순서, 수용 시나리오,
검토 checkpoint는 [동작 합성 연구](../docs/BEHAVIOR-COMPOSITION-RESEARCH.md)에 있다.

작업은 [ghostflow-language #99](https://github.com/callin2/ghostflow-language/issues/99)의
연구/설계 하위 issue로 추적한다. 요약의 순서 있는 issue 색인을 사용한다.
두 번째 로컬 작업 목록을 유지하지 않는다.

각 하위 작업은 범위가 제한된 연구 문서 하나를 만든다. 설명에는 낮은 등급 모델
실행자를 위한 정확한 입력, 단계, 예제, 완료 검사가 포함된다.
여러 영역에 걸친 architecture 결정은 명시적 검토 checkpoint로 남는다.
구현, runtime 변경, deployment, 물리 검증은 이 연구/문서 전달 범위 밖이다.

## 위임 실행

사용자는 모든 연구 issue를 저비용 작업자가 실행하도록 요청했다.
Main agent는 의존성, 문서 간 결정, 수용만 조정한다.
작업자는 `gpt-5.6-luna`, 낮은 reasoning effort를 사용하며 대화 이력을 상속하지 않는다.
Issue마다 전용 출력 파일 하나를 갖는다. GitHub나 git 상태를 변경하지 않는다.
독립 작업자는 쓰기 범위가 겹치지 않도록 checkout을 공유한다.

| 차수 | Issue | 시작 조건 |
| --- | --- | --- |
| 1 | #100 사용자 결과; #101 권한/식별자 | 준비 완료 |
| 2 | #102 실행; #103 binding; #105 override | #101 연구 인계 |
| 3 | #104 계약; #106 package; #107 incident 근거 | 명시적 의존성이 준비됨 |
| 4 | #108 수용/인계 | #100–#107 연구 출력 검토 완료 |

수정은 담당 작업자에게 전달한다. 별도의 저비용 검토가 문서 간 일관성을 확인한다.
미결 architecture 결정은 명시적인 구현 차단 요인으로 보존한다.
연구 완료는 구현된 합성, runtime 검증, 참가자/물리 근거를 주장하지 않는다.

## 완료된 위임 연구

연구 출력 9개가 모두 완료됐다. 각 작성자는 `gpt-5.6-luna`를 낮은 effort로
사용했고 독립적인 Luna 검토도 수행했다. 출력은 연구 근거와 제안된 인계다.
구현된 합성이나 측정된 사용자/물리 수용이 아니다.

- [R1](../docs/research/GF-COMPOSE-R1-USER-OUTCOMES.md)
- [R2](../docs/research/GF-COMPOSE-R2-AUTHORITY-IDENTITY.md)
- [R3](../docs/research/GF-COMPOSE-R3-EXECUTION.md)
- [R4](../docs/research/GF-COMPOSE-R4-PORTS-BINDINGS.md)
- [R5](../docs/research/GF-COMPOSE-R5-CONTRACTS.md)
- [R6](../docs/research/GF-COMPOSE-R6-OVERRIDES.md)
- [R7](../docs/research/GF-COMPOSE-R7-PACKAGES.md)
- [R8](../docs/research/GF-COMPOSE-R8-INCIDENT-EVIDENCE.md)
- [R9](../docs/research/GF-COMPOSE-R9-ACCEPTANCE.md)

R9의 남은 architecture 결정은 요약에서 추적한다. 각각 그 결정이 필요한
의존 slice만 차단한다. 합의된 live-property event 동작은 설계 수정이다.
#89 mechanism/ABI/spec-alignment 작업은 무관한 합성 slice의 포괄적 선행 조건이 아니다.
닫힌 연구 issue가 설계 구현을 뜻하지 않는다.
