<!-- translation-source: .github/pull_request_template.md -->
[영문 원문](pull_request_template.md)
## 문제와 변경 후 동작

Issue / 계약 ID와 필요한 문서 경로:
정확한 base SHA / candidate SHA / source 및 fixture 경로:
허용된 수정 범위와 선행 조건:

## 독립 oracle과 검증

기대 결과와 그 권위 있는 출처(이 구현으로 생성하지 않은 값):
Before / after 명령, exit code, 결과, 정확한 artifact/report identity:
경계 / 실패 사례, 그리고 보호 조건을 의도적으로 약화했을 때의 결과:
회귀 검사와 남은 한계(host / Device / physical):

## 바뀐 근거를 별도로 검토

- [ ] 보호 규칙의 제거나 약화를 기대값 수정과 별도로 검토했습니다.
- [ ] oracle 변경, 사라진 assertion, 삭제/skip/todo 처리된 test, runner-list 변경을 검토했습니다.
- [ ] 요구사항 status, testIds, locator digest, pendingReason 변경을 검토했습니다.
- [ ] 구현과 그 test가 같은 오해를 공유할 위험을 설명했습니다. native/WASM 일치는 이식성 근거일 뿐입니다.
- [ ] 정당한 명세 변경에는 권위 있는 근거와 별도의 의미 검토를 인용했습니다.
- [ ] 관련 양언어 문서/changelog와 필수 저장소 gate를 그대로 유지했습니다.

참조: [범위를 제한한 기여 패키지](../docs/AI-CONTRIBUTION-PACKAGE.ko.md).
