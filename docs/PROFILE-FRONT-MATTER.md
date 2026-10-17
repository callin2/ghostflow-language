# Profile 기반 front matter 설계

[English](PROFILE-FRONT-MATTER.en.md) · [이슈 #555](https://github.com/callin2/ghostflow-language/issues/555)

## 목적

GhostFlow의 상위 목적은 사람이 자연어로 표현한 제어 의도를 AI가 제어 프로그램으로
옮기고, 실제 장비에서 의도와 이상 상태까지 예측 가능한 방식으로 실행하게 하여
자동화의 진입 장벽을 낮추는 것이다. 장비가 동식물과 사람에게 영향을 줄 수 있으므로
간결함은 검증에 필요한 사실과 실패 상태를 보존해야 한다.

**Front matter의 직접 목적은 제어 본문의 논리 입출력을 실제 설치한 장치에 연결하면서,
고객이 보드·드라이버가 이미 아는 하드웨어 사실을 반복해서 작성하지 않게 하는 것이다.**
고객은 사용하는 구성, 실제 설치에서 달라진 값, 논리 연결만 작성한다. 제어 본문은 핀,
통신 구현, 드라이버 초기화, warm-up, 최소 읽기 간격을 알 필요가 없다. 읽기 실패와
복구 상태는 기존 railway-oriented 데이터 경로로 전달한다.

메타데이터를 본문과 분리하는 이유도 이 책임 분리에 있다. 설치가 바뀌어도 제어 의도를
그대로 사용할 수 있고, 같은 설치 지식을 여러 프로그램이 재사용할 수 있어야 한다.
필드를 삭제한 뒤 펌웨어의 숨은 상수로 옮기는 것은 이 목적을 달성하지 못한다.

## 고객이 작성하는 내용

```yaml
---
profile: ess3h32@1

devices:
  meter1:
    profile: jsy-mk-333@1
  meter2:
    profile: jsy-mk-333@1
    params: { address: 2 }

bindings:
  motor1Current: meter1.currentA
  motor2Current: meter2.currentA
  motor1Run: board.RO1
  motor2Run: board.RO2
---
```

이 이름들은 설계 예제이며 배포된 profile ID를 뜻하지 않는다. `profile`과 `bindings`는
필수이고 추가 장치가 없으면 `devices`를 생략한다. 장치에는 `profile`, 선택적 `params`,
선택적 `bus`만 둔다. `board`는 보드가 공개하는 채널의 예약 이름이다.
다른 통신 연결을 선택할 때만 `bus: board.rs485Aux`처럼 명시한다.
이 compact 형식의 최상위 필드는 위 세 개로 제한하며 모든 본문 논리 입출력에 바인딩이
필요하다. 작성된 YAML이 평범한 메타데이터로 무시되지 않도록 이 필드들을 예약한다.

`meter1`의 주소 1, 통신 조건, 채널 이름·물리량·단위는 장치 profile에서 온다.
`meter2`의 주소 2는 실제 설치 차이다. 주소 기본값을 상속하는 것은 장치의 물리 주소를
자동으로 변경한다는 뜻이 아니다. 논리 이름은 고객이 정하고 `currentA`는 드라이버가
동봉한 채널 명세에서 선택한다. `ElectricalCurrent`의 기준 단위 `A`는 계약으로 전달되며
본문의 `mA` 같은 호환 단위 리터럴은 기존 언어의 단위 변환 규칙을 따른다.

## RS485 입력과 8채널 릴레이 출력

앞의 전류계 두 개 구성에 주소 **3**, **9600bps**, **8채널 RYR408B** 릴레이 확장 보드를 추가하면
다음과 같다. [전체 GhostFlow 예제](../examples/hardware/rs485-current-relay.ghost.md)는
의도 링크, 전류에 따른 출력 1·2 제어, 미사용 출력 3~8의 OFF 요청까지 포함한다.

```yaml
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
```

입력 전류계와 출력 릴레이는 같은 기본 RS485 연결을 사용한다. 보드·장치 profile이
9600/8N1을 제공하므로 이를 고객 문서에서 반복하지 않는다. 주소는 1·2·3으로 구분한다.
`relay.RO1`~`relay.RO8`은 릴레이 driver/profile의 Bool 출력 채널이며 보드 내장 `board.RO1`
등과 구별된다. 다른 드라이버여도 같은 물리 버스에서 주소가 겹치면 오류여야 한다.

릴레이 모델 **RYR408B**와 주소·속도·채널 수는 사용자 확인값이고, 8N1은 첨부 자료에 표시된 값이다.
`ryr408b@1`과 채널 이름은 확인된 모델을 위한 설계용 계약이며 아직 배포된 profile이 아니다.
정적 예제는 RS485/Modbus RTU 계약을 가정한다. 프로토콜 명세·채널별 레지스터·ON/OFF 값은
driver 발행 전에 확인한다. 예제 추가를 실제 릴레이 작동 검증으로 기록하지 않는다.

## 전체 구조와 실행 컨텍스트

| 실행 위치 / 소유자 | 책임 | 산출물 / 저장 위치 |
| --- | --- | --- |
| 고객·AI 작성 도구 | 의도, 제어 본문, 설치 차이와 논리 연결 작성 | 정본 `.ghost.md` |
| 보드 / 설치 profile 공급자 (Device) | 고정 핀, 연결 자원, 명시적 기본 연결, 내장 채널·모듈 | 버전 고정 profile |
| 드라이버 공급자 (Drivers) | ELF, 초기화 명세·기본값, 통신 요구, 채널·단위, 장치 동작 제약 | 하나의 버전으로 배포하는 패키지 |
| 컴파일 호스트 / Worker (Language) | 공급받은 profile 집합의 결정적 해석과 진단 | 소스·profile 해시에 묶인 파생 연결 계획 |
| 패키징 호스트 (Device) | 실제 모듈·자원·호스트 ABI 검증, 초기화 레코드 생성 | 배포 bundle와 provenance |
| MCU 공유 통신 서비스 | 물리 버스 소유, 요청 직렬화, 시간 제한 | 런타임 자원과 통신 결과 |
| MCU 드라이버 인스턴스 | 각 장치 프로토콜, warm-up·읽기 간격·변환, 독립 상태 | 값과 품질/오류 |
| MCU GhostFlow runtime | 물리 연결과 독립적으로 제어와 오류 처리 실행 | 출력 요청과 실행 근거 |

컴파일 해석기는 네트워크·파일·GPIO에 접근하지 않는다. 호출자가 검증할 profile closure를
제공한다. 다운로드·배포 신뢰 정책과 캐시는 공급자/배포 도구의 책임이다. SHA-256은
바이트 동일성을 확인하며 신뢰성이나 악성 코드 부재를 증명하지 않는다.

## Profile 해석 계약

공급자 데이터는 고객 YAML과 별개인 배포 계약이다. 1차 구현의 `hardwareProfiles` 배열은
각 원소에 `ref`, `sha256`, `definition`을 둔다. `ref`는 `id@revision`이며 `latest`는
거부한다. `sha256`은 저장소의 `canonicalJson(definition)` UTF-8 값의 SHA-256이다.
배포된 실제 파일/ELF의 digest는 각각 별도로 보존한다.

`definition.kind`는 `board` 또는 `device`다. 선택적 `extends`는 동일 종류의 고정 ref를
가리킨다. 객체의 누락 필드는 부모에서 가져오고 명시한 값은 덮어쓴다. 배열은 통째로
교체한다. 순환, 종류 변경, 없는 부모는 오류다. 고객의 `params`는 각 매개변수 단위로
기본값을 덮어쓴다. 물리 핀을 고객 문서에서 임의로 덮어쓰는 경로는 제공하지 않는다.

Board profile은 `connections`, `defaults`, `channels`를 가진다. Connection은
`resource`(물리 자원 ID), `transport`, `protocol`, `settings`를 명시한다. 기본 연결은
`defaults`에서 protocol 이름을 `board.<connection>`에 연결한다. 연결이 하나뿐이어도
명시적 기본값이 없으면 생략을 허용하지 않는다. 같은 물리 자원의 alias는 동일한 통신
계약이어야 한다. RS485 트랜시버가 없는 보드는 RS485 capability를 제공할 수 없다.

Device profile은 고정 `module: { id, revision, sha256 }`, `requires`, `parameters`,
`channels`를 가진다. `requires`는 `transport`, `protocol`, `settings`를 요구한다.
요구 setting 값은 상수 또는 `{ param: baudRate }` 같은 매개변수 참조다. Parameter
명세는 `type`, 선택적 `default`, `minimum`, `maximum`, `enum`을 가진다. 1차 구현은
`integer`, `number`, `boolean`, `string`을 지원하며 정의된 모든 parameter는 기본값이나
명시값이 필요하다. 구조화된 초기화 값의 schema는 후속 범위다. 알 수 없는 설정을
드라이버로 통과시키지 않는다. 선택적 `addressParameter`는 공유 연결의 주소 충돌 검사에
사용한다. Channel은 `role`(`input`/`output`), `type`, 선택적 `unit`을 가진다.

해석 결과는 선택한 profile 및 부모의 digest, 실제 적용한 params, 연결과 채널 계약,
원본 위치를 보존한다. 동일한 연결을 참조하는 장치마다 UART를 새로 만드는 의미가 아니다.
내장 SPI의 hardware/software 구현, relay 확장 칩, multiplexer, 내장 RS485와 GPIO 매핑은
보드/설치 profile에 한 번 정의한다. 외부 트랜시버나 확장 칩을 새로 붙이면 그 설치의
profile이 실제 추가 배선과 자원을 선언한다. 장치가 연결 자원을 생성하는 일반 조합은
후속 단계이며, 그때도 기존 보드 정보를 고객에게 반복시키지 않는다.

## 검증과 사용 사례

| 목적에 따른 요구 | 검증해야 하는 결과 |
| --- | --- |
| 내장 기능만 사용하는 고객 | `profile` + `bindings`만으로 채널 해석 |
| 같은 모델의 전류계 두 개 | 기본 주소 1과 명시 주소 2, 별도 인스턴스, 같은 물리 버스 |
| 전류 입력과 8채널 릴레이 출력 | 전류계 주소 1·2와 릴레이 주소 3, 9600bps 공유, RO1~RO8 Bool 출력 연결 |
| RS485 사용 확인 | 장치 요구와 보드 capability·통신 조건이 일치하는 명시적 경로 |
| 다른 장치 / 다른 통신 구현 | 제어 본문 변경 없이 공급자 계약으로 연결 판단 |
| 오타·정보 누락 | 원본 YAML 위치와 누락/충돌 이유를 포함하는 오류 |
| 오류도 제어 데이터 | 드라이버 읽기 실패가 기존 품질·오류 경로로 전달 |

없는 profile, 부동 revision, 잘못된 digest, 상속 순환, 매개변수 타입·범위·이름 오류,
없는 기본 연결, transport/protocol/settings 불일치, 같은 물리 버스의 중복 주소,
없는 채널, 중복 채널 연결, 본문과 role/type/기준 단위 불일치는 거부한다.
두 전류계 예제에서 주소를 둘 다 생략하면 주소 1 충돌로 실패해야 한다.

정적 검증은 공급한 계약이 RS485 경로를 구성한다는 것을 확인한다. 실제 배선, 장치 응답,
전류 측정, 접점/부하 작동은 해당 실행 근거로 확인한다. 기존 ESS3 사용자 확인은 기록으로
유지하며 같은 확인을 문서 작업의 조건으로 다시 요구하지 않는다.

## 구현 순서와 완료 기준

1. **Language / #555:** compact YAML, 제한된 profile closure 해석, 상속·명시적 기본값,
   통신·주소·채널·본문 타입 검증과 원본 진단을 구현한다. Public compile API에서
   `hardwareProfiles`를 전달하며, 없는 closure를 자동 추정하지 않는다. Node/browser
   결과와 원본 보존, 기존 GFB 바이트 불변을 테스트한다.
2. **Device + Drivers:** 실제 보드/드라이버 profile을 기존 패키지에서 발행하고
   해석 계획을 configure/bundle 경로에 연결한다. 실제 ELF 및 profile digest를 고정하고
   기존 장문의 authored hardware 형식을 이전할 수 있는 변환을 제공한다. 기존 설치의
   이행이 검증되면 active 구형 작성 경로를 제거한다.
3. **Device / #249 연계:** 같은 RS485 자원을 여러 독립 인스턴스가 안전하게 공유하도록
   admission과 endpoint 식별을 정리한다. 한 장치 장애가 다른 인스턴스의 상태가 되지
   않도록 검사하고, 지원하지 않는 호스트는 배포 단계에서 거부한다.

문서와 Language 단계만으로 새 source의 ESS3 배포 완료를 선언하지 않는다. 현재 Device
packager에는 고정 CURRENT_A/B/C endpoint와 공유 RS485 admission 제약이 있다.
실제 profile 배포, CLI의 profile 공급, package 연결, MCU 공유 버스 실행은 별도 완료
근거가 필요하다. Import된 문서 사이의 장치 공유 규칙은 이번 범위에 포함하지 않는다.

완료 판단의 질문은 다음과 같다. **고객이 이미 정해진 하드웨어 사실을 다시 쓰지 않고도,
자신의 설치 차이와 제어 의도를 명료하게 연결했으며, 누락·충돌·이상 상태를 숨기지 않고
예측 가능하게 실행할 수 있는가?** 각 단계의 결과와 남은 일은 #555에 연결한다.
