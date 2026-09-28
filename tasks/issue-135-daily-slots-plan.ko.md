<!-- translation-source: tasks/issue-135-daily-slots-plan.md -->

[영문 원본](issue-135-daily-slots-plan.md)

# Issue 135: literal DailySlots 실행

추적: https://github.com/callin2/ghostflow-language/issues/135

## 범위

변경하지 않은 `REF-03-032`를 공유 Rust schedule runtime으로 실행한다.
이 slice는 `pulse`, `trusted_only`, `baseline`, `skip`을 갖춘
literal `DailySlots<15min>` 선택을 지원한다. Config로 선택하는 `REF-03-057`은
key가 있는 settings 편집과 영속성이 생길 때까지 실행 불가능한 descriptor로 남는다.

## 단계

1. [x] Literal DailySlots descriptor와 안정된 literal slot key를 위한
   GFB9/control-v8을 추가한다.
2. [x] Rust schedule fact와 admission 식별자를 source day, slot key,
   DST fold로 확장한다. Rust는 술어, crossing, terminal ledger, 트랜잭션 소유권을 유지한다.
3. [x] 명시적 provider fact를 갖춘 GFSF v3, 공개 WASM, ghostsim 통합을 추가한다.
   누락, 오래됨, 잘못된 형태, 호출자가 계산한 결과를 거부한다.
4. [x] 제한된 용량과 원자적 rollback을 포함한 native/WASM/simulator 테스트로
   변경하지 않은 Reference 소스를 증명한다.

Device revision, 물리 출력 주장, Reference 소스나 기대값 변경은 범위에 없다.
