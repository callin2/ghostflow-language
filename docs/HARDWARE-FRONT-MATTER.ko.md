<!-- translation-source: docs/HARDWARE-FRONT-MATTER.md -->
[English original](HARDWARE-FRONT-MATTER.md)

# 정본 소스의 하드웨어 선언

[한국어](HARDWARE-FRONT-MATTER.ko.md) · [Reference 1.1](reference/01-source-and-syntax.en.md)

`.ghost.md` 문서의 최상위 YAML 예약 필드 `hardware`는 입력 드라이버와 출력
렌더러의 설치 의존성과 논리 바인딩을 선언한다. 소스 문서가 정본이며 컴파일러는
파생 `hardwarePlan`을 반환한다. 선언은 코드를 실행하거나 GFB 바이트, 런타임 ABI,
portable package 형식을 바꾸지 않는다. 작업: [#555](https://github.com/callin2/ghostflow-language/issues/555).

## 선언

이 예제는 JSY 입력 모듈과 relay 출력 모듈을 보여 준다. 예제 digest는 표시용이며
배포에는 실제 profile/module 바이트의 digest와 검토한 불변 revision이 필요하다.

```yaml
hardware:
  schema: GhostFlow/hardware-v1
  profile:
    id: ess3h32
    revision: r1
    sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  modules:
    meter:
      id: jsy-mk
      revision: r1
      sha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    relay:
      id: relay-bank
      revision: r1
      sha256: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
  buses:
    serial:
      service: modbus-rtu
      config: { port: 1, baud: 9600, parity: none }
  instances:
    power:
      module: meter
      role: input
      config: { bus: serial, address: 1 }
    panel:
      module: relay
      role: output
      config: { channels: [{ pin: 3, inverted: false }] }
  bindings:
    inputs:
      current: { instance: power, channel: current }
    outputs:
      pump: { instance: panel, channel: relay1 }
```

문서 시작의 여는 `---`와 닫는 `---` 사이에 YAML을 두고 Markdown과 일반 `ghost`
fence를 이어 쓴다. 닫는 `...`도 허용한다. 대응하는 논리 선언은 다음과 같다.

```ghost
control MeterRequest {
  input current: Number;
  output pump: Bool;
  pump <- (current |> recover(0.0)) > 1.0;
}
```

여섯 hardware 필드는 모두 필수다. `profile`과 각 `modules` 값은 정확히 `id`,
`revision`, 소문자 64자리 16진수 `sha256`을 가지며 `latest`는 거부한다. 모듈 alias,
bus/instance 이름과 논리 바인딩 이름은 `[A-Za-z_][A-Za-z0-9_.:-]{0,127}`로 제한한다.
Pin ID, revision, service와 channel 문자열은 `[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}`를
사용한다. 이름 map은 비어 있어도 된다. 각 bus는 `service`, `config`, 각 instance는
`module`, `role`(`input` 또는 `output`), `config`, 각 binding은 `instance`, `channel`을
가진다. 구조 필드는 닫혀 있으며 오타나 누락은 컴파일 실패다.

`config`는 임의의 중첩 JSON 호환 데이터를 담는 객체다. 언어는 JSY, baud rate,
주소, GPIO나 채널 타입을 특별 취급하지 않는다. 배포 소유자는 고정 profile/module을
해석하고 provider가 제공한 schema로 각 설정을 검증하며 service 가용성, bus 참조,
채널 정체성과 타입을 확인한 후 활성화 admission을 검사해야 한다. 파싱은 provider
검증이나 모듈 설치, 물리 검증을 뜻하지 않는다.

바인딩은 컴파일러 manifest의 논리 입력·출력을 참조한다. 없는 모듈/instance,
잘못된 instance 역할, 선언되지 않은 논리 포트와 각 역할 안에서 중복된
instance/channel 바인딩은 실패한다. 바인딩하지 않은 논리 포트는 별도로 선언한 host
context를 쓸 수 있으며 언어는 바인딩을 합성하지 않는다. 두 Number 입력은 각각 다른
드라이버를 선택할 수 있다. 입력 취득 품질과 출력 requested/applied/confirmed 근거는
기존 계약을 유지한다. Root나 imported 문서에 hardware가 있는 실행 import 조합은
조합 의미가 정해질 때까지 명시적으로 거부한다.

## 공개 helper와 진단

`tools/hardware-frontmatter.mjs`의 `parseHardwareFrontMatter(source, { filename })`은
예약 필드가 없으면 `null`, 있으면 `{ format: 'GhostFlow/hardware-plan-v1', source:
{ filename, sha256 }, hardware, locations }`를 반환한다. `hardware`는 검증된 선언이며
`locations`는 `/hardware/instances/power/config/address` 같은 JSON pointer를 정본 문서의
`{ filename, line, column, endLine, endColumn }`에 매핑한다. 위치는 1부터 시작하고 끝은
포함하지 않는다. Digest는 설명과 줄바꿈을 포함한 정확한 소스 바이트를 포괄한다.
`validateHardwareBindings(plan, manifest)`는 논리 포트 소속을 별도로 검사한다.
`compileSource`와 `compileSourceSync`는 선언이 있을 때만 `hardwarePlan`을 반환한다.

고정한 YAML parser가 키 유일성을 강제한다. Hardware가 있는 front matter에서는
alias, anchor, 명시적 tag, merge key, 문자열이 아닌 키, 무한대·NaN 값과 prototype에
민감한 객체 키를 거부하고 중첩 깊이와 노드 수를 제한한다. 오류는 정본 line/column,
`GF_HARDWARE`와 source digest를 포함하는 `GhostFlow/diagnostics-v1` envelope를 가진다.
`hardware`가 없는 front matter는 기존의 비실행 동작을 유지한다.

Why: 설치 의도를 제어 소스와 함께 두면 다른 편집 가능한 제어 프로그램을 만들지
않으면서 드라이버 선택을 검토하고 revision에 묶을 수 있다. 일반 provider 경계는
보드 동작을 언어에 내장하지 않고 측정 드라이버, 스위치, relay, motor, 화면을 수용한다.
