<!-- translation-source: tasks/issue-135-daily-slots-plan.md -->
[영문 원문](issue-135-daily-slots-plan.md)

# Issue 135: literal DailySlots 실행

추적: https://github.com/callin2/ghostflow-language/issues/135

**상태:** 네 단계가 모두 완료되었습니다.

## 범위

- **목표:** 변경하지 않은 `REF-03-032`를 공유 Rust schedule 런타임으로
  실행합니다.
- **지원:** `pulse`, `trusted_only`, `baseline`, `skip`을 갖춘 literal
  `DailySlots<15min>` 선택.
- **아직 실행 불가:** config로 선택하는 `REF-03-057`은 key가 있는 설정 편집과
  영속성이 생길 때까지 실행할 수 없는 descriptor로 남습니다.

## 단계

1. [x] Literal DailySlots descriptor와 안정된 literal slot key를 위한
   GFB9/control-v8을 추가합니다.
2. [x] Rust schedule fact와 admission identity를 source day, slot key,
   DST fold로 확장합니다. 술어, crossing, terminal ledger, 트랜잭션의 소유권은
   Rust가 유지합니다.
3. [x] 명시적인 provider fact를 갖춘 GFSF v3, 공개 WASM, ghostsim 통합을
   추가합니다. 누락되었거나, 오래되었거나(stale), 형식이 잘못되었거나, 호출자가
   계산한 결과는 거부합니다.
4. [x] 제한된 용량과 원자적 rollback을 포함해 native, WASM, simulator
   테스트로 변경하지 않은 Reference 소스를 증명합니다.

범위 밖: Device revision, 물리 출력에 대한 주장, Reference 소스나 기대값의
변경.
