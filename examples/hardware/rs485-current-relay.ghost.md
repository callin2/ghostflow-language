---
profile: ess3h32@1

devices:
  meter1:
    profile: jsy-mk-333@1
  meter2:
    profile: jsy-mk-333@1
    params: { address: 2 }
  relay:
    profile: ryr408b@1
    params: { address: 3 }

bindings:
  motor1Current: meter1.currentA
  motor2Current: meter2.currentA
  motor1Run: relay.RO1
  motor2Run: relay.RO2
  auxiliary3: relay.RO3
  auxiliary4: relay.RO4
  auxiliary5: relay.RO5
  auxiliary6: relay.RO6
  auxiliary7: relay.RO7
  auxiliary8: relay.RO8
---

# RS485 전류 입력과 RYR408B 8채널 릴레이 출력

[English](rs485-current-relay.ghost.en.md) · [설계 목적](../../docs/PROFILE-FRONT-MATTER.md)

앞의 전류계 두 개 설계 예제에 출력 장치를 추가한 정본 예제다. 논리 입출력이 같은
RS485 연결을 공유하는 서로 다른 드라이버에 연결될 수 있음을 보여 준다.
두 전류계의 물리 설치를 확인했다는 뜻은 아니다.

릴레이 모델은 사용자가 확인한 **RYR408B**이며 8채널, 주소 3, 9600bps 설정을 반영한다. 첨부 자료에는
9600 8 N 1이 표시되어 있다. 보드의 기본 RS485 연결과 장치 profile이 같은 9600/8N1
조건을 제공하므로 고객 YAML에 `bus`와 통신 조건을 반복하지 않는다. 속도가 맞지 않으면
해석 단계에서 오류를 낸다. 주소 1·2는 전류계, 주소 3은 릴레이에 할당한다.

RYR408B의 주소와 baudrate는 보드의 DIP 스위치에서 물리적으로 설정한다. YAML의
`address: 3`과 profile의 `9600bps`는 그 DIP 설정에 맞춘 통신 구성이다. 실제 DIP 값과
선언이 일치해야 하며, 컴파일 검사는 공급된 계약 사이의 일치를 확인한다.

여기 나온 profile ID와 `RO1`~`RO8`은 **설계·검증용 계약 이름**이며 아직 배포된 제품
profile을 뜻하지 않는다. 릴레이 fixture는 RS485/Modbus RTU 계약으로 검사한다.
`ryr408b@1`은 확인된 모델을 위한 제안 profile ID다. 프로토콜 명세, 채널별 레지스터,
ON/OFF 값, 응답과 출력 실패 처리
확인은 driver/profile 발행 전에 필요하다. 사진의 주소 1 초기 사용 예시는 현재 주소 3을
바꾸라는 지시로 사용하지 않는다. 이 문서는 실제 장치에 명령을 보내지 않는다.

<!-- ghostflow:anchor id=CURRENT-RELAY kind=assumption status=unconfirmed origin=ai -->
이 제어 예제에서는 각 모터의 A채널 전류가 0.1A 이상이면 대응하는 릴레이 출력 1·2를
ON 요청하고, 미만이거나 입력 오류이면 OFF 요청한다. 이는 연결을 보여 주는 예시 동작이다.

<!-- ghostflow:anchor id=UNUSED-RELAYS kind=assumption status=unconfirmed origin=ai -->
사용하지 않는 릴레이 출력 3~8은 항상 OFF 요청한다. 출력 요청은 실제 접점 확인과 구분한다.

```ghost
control CurrentRelayExample {
  // ghostflow:link id=CURRENT-RELAY relation=assumes
  input motor1Current, motor2Current: ElectricalCurrent;
  // ghostflow:link id=CURRENT-RELAY relation=assumes
  output motor1Run, motor2Run: Bool;
  // ghostflow:link id=UNUSED-RELAYS relation=assumes
  output auxiliary3, auxiliary4, auxiliary5, auxiliary6, auxiliary7, auxiliary8: Bool;

  // ghostflow:link id=CURRENT-RELAY relation=assumes
  motor1Run <- (motor1Current |> recover(0A)) >= 0.1A;
  // ghostflow:link id=CURRENT-RELAY relation=assumes
  motor2Run <- (motor2Current |> recover(0A)) >= 0.1A;
  // ghostflow:link id=UNUSED-RELAYS relation=assumes
  auxiliary3 <- false;
  // ghostflow:link id=UNUSED-RELAYS relation=assumes
  auxiliary4 <- false;
  // ghostflow:link id=UNUSED-RELAYS relation=assumes
  auxiliary5 <- false;
  // ghostflow:link id=UNUSED-RELAYS relation=assumes
  auxiliary6 <- false;
  // ghostflow:link id=UNUSED-RELAYS relation=assumes
  auxiliary7 <- false;
  // ghostflow:link id=UNUSED-RELAYS relation=assumes
  auxiliary8 <- false;
}
```
