<!-- translation-source: docs/KEYBOARD-HOST.md -->
[English 원문](KEYBOARD-HOST.md)

# 실시간 키보드 호스트

네이티브 `keyboard` 예제는 가상 터미널 입력으로 컴파일된 GFB를 실행합니다. GPIO, 직렬 포트, MQTT 또는 네트워크 장치에 접근하지 않습니다.

```sh
cargo run --locked --offline -p ghostflow-core --example keyboard -- \
  build/program.gfb \
  --key 1=start --key 2=stop \
  --record build/keyboard-events.csv
```

프로세스 실행 중 터미널은 raw 모드가 되며 정상 종료 시 복원됩니다. 종료하려면 `Ctrl-C`를 누릅니다. `1`부터 `8`까지의 숫자는 대응 입력을 전환하고 런타임 tick 하나를 생성합니다.

매퍼는 설정된 각 입력에 불리언 상태 하나를 유지합니다. 바인딩된 숫자를 누를 때마다 입력이 `true`와 `false` 사이에서 바뀝니다. keyup 이벤트는 필요하지 않습니다. 바인딩되지 않은 키는 무시합니다. 매번 누를 때마다 현재의 완전한 불리언 상태로 런타임을 tick합니다.

`--record`는 다음 헤더가 있는 재생 가능한 이벤트 레코드를 씁니다.

```csv
logical_time_ms,key,event
```

기존 `run` CSV 실행기는 변경되지 않습니다. 기록된 이벤트 CSV는 호스트 어댑터용 감사 스트림이며 `run`이 사용하는 일반 입력 행렬로는 허용되지 않습니다.

## 실시간 ASCII 콘솔

대화형 터미널에서 `ghostsim-console`은 지속형 가상 GhostFlow 런타임을 시작합니다. 0 ms에 스캔한 뒤 키 입력 전에도 첫 전체 화면 패널을 즉시 그립니다. 100 ms 벽시계 타이머가 tick마다 새 스캔 하나를 공급합니다. 논리 시간은 시작 후 경과한 단조 시각입니다. 타이머 콜백이 늦으면 놓친 tick을 재생하지 않고 현재 경과 시각에 한 번 스캔합니다. 각 행은 최근 입력, 요청 출력 의도 및 안전 출력 의도를 ASCII 추적으로 표시합니다. 화면은 터미널 대체 화면을 사용하며 종료할 때 화면, 커서 및 raw 키보드 모드를 복원합니다. 물리 Driver를 열지 않습니다. 이 실시간 화면에는 stdin과 stderr 모두 터미널이어야 합니다.

```sh
node tools/ghostsim-console.mjs build/program.gfb \
  --bind DI1=start --bind DI2=stop --bind RO1=pump --bind RO2=valve
```

`--profile`이 없으면 레이아웃은 Bool `DI1`–`DI8`, `RO1`–`RO8`을 가진 **가상 Waveshare 8DI/8RO**입니다. 기본 이름 바인딩은 이름과 유형이 정확히 같은 매니페스트 논리 포트에만 연결됩니다. 다른 논리 포트에는 명시적인 `--bind CHANNEL=port` 할당이 필요합니다. 이 레이아웃은 핀 번호, 설치된 하드웨어 또는 현장 승인을 나타내지 않습니다. 모든 논리 출력에는 바인딩이 필요합니다. 바인딩되지 않은 논리 입력에는 명시적 `--input port=value` 시작값이 필요하며 패널에서 전환할 수 없습니다. 사용하지 않는 프로필 채널은 `(unbound)`로 표시됩니다.

선택한 설명자는 기존 `GhostFlow/board-profile-v1` 스키마를 사용할 수 있습니다. 필드는 `schema`, `id`, `revision`, `boardModel`, `endpoints`입니다. 각 엔드포인트 키는 채널 ID입니다. 각 값은 `direction`(`input` 또는 `output`), `type`, `driver`, `address`, `activeLevel`, `safeLevel`을 가집니다. 콘솔은 JSON 파일에 나타난 순서를 유지하면서 입력과 출력을 나누어 엔드포인트 ID를 나열합니다. 바인딩 검증에는 방향과 유형을 씁니다. 지정된 driver를 열거나 주소를 확인된 핀으로 취급하지 않습니다. 모든 논리 포트 바인딩은 `--bind`로 명시해야 합니다. 선택한 보드 프로필은 통합 계약의 정확한 필드 집합, 비어 있지 않은 텍스트 필드, 엔드포인트 방향/레벨 값 및 고유한 `driver`/`address` 쌍 조건을 만족해야 식별 정보를 표시하거나 해시할 수 있습니다.

아래의 대안 `GhostFlow/console-profile-v1` JSON은 표시 전용 Driver 설명자입니다. ID, 순서가 있는 채널, 레이블 및 유형이 가상 패널을 제어하며 물리 설치 매핑은 포함하지 않습니다.

```json
{
  "format": "GhostFlow/console-profile-v1",
  "id": "example-2DI-4RO",
  "inputs": [
    { "name": "A", "label": "Input A", "type": "Bool" },
    { "name": "B", "label": "Input B", "type": "Bool" }
  ],
  "outputs": [
    { "name": "R1", "label": "Relay 1", "type": "Bool" },
    { "name": "R2", "label": "Relay 2", "type": "Bool" },
    { "name": "R3", "label": "Relay 3", "type": "Bool" },
    { "name": "R4", "label": "Relay 4", "type": "Bool" }
  ]
}
```

```sh
node tools/ghostsim-console.mjs build/program.gfb \
  --profile build/profile.json --bind A=start --bind B=stop \
  --bind R1=pump --bind R2=valve
```

터미널에서 `1`부터 `8`까지 누르면 바인딩된 Bool 입력을 전환하고 즉시 스캔합니다. Enter는 필요하지 않습니다. `:`를 눌러 명령을 입력한 뒤 Enter를 누릅니다. 이후 채널에는 `:toggle CHANNEL`을 입력합니다. 예: `:toggle DI9`. `:exit` 또는 Ctrl-C로 끝냅니다. 패널은 scan 0에서 시작하고 종료 뒤 짧은 사람이 읽을 요약을 출력합니다. 실시간 TTY 모드에서는 `--record`와 `--format`을 거부합니다. 제한 없는 실시간 실행은 제한된 `GhostFlow/scenario-v1` 기록 계약에 맞지 않습니다. `target/wasm32-unknown-unknown/release/ghostflow_wasm.wasm`이 없으면 먼저 `npm run build:wasm`으로 WASM 런타임을 빌드합니다. `:scan N`은 파이프 재생 명령이며 대화형 클록은 자동으로 실행됩니다.

stdin으로 명령을 파이프할 때는 `:`를 생략하고 줄마다 명령 하나를 사용합니다. 이 제한 재생 모드는 `ghostsim` 시나리오 실행기를 구동하고 완전한 `GhostFlow/scenario-result-v1` 문서 하나를 stdout에 씁니다. 기본은 TOON이며 `--format json`은 JSON을 선택합니다. 각 스캔 뒤 패널은 stderr에 출력됩니다.

파이프 재생 모드에서 각 전환은 키 에지 또는 입력 동작을 기록하고 현재 가상 시각에서 한 번 스캔합니다. 시간은 0 ms에서 시작하며 뒤로 갈 수 없습니다. 명령이 없으면 종료 시 0 ms의 초기 스캔 하나를 기록합니다. 두 모드 모두에서 매니페스트 입력이 Bool이 아니면 `--input port=value`로 형식이 지정된 초기값을 제공합니다. Bool이 아닌 채널도 설명자에는 나타날 수 있지만 패널 상태는 `unsupported`이고 전환 단축키가 없습니다.

행은 입력과 출력 목록을 인덱스별로 맞춥니다. 한쪽 목록이 짧으면 빈 셀을 그대로 둡니다. Bool 값은 ON 또는 OFF로 표시하며 누락 관찰은 `unobserved`로 표시합니다. 출력 열에는 요청 및 안전 가상 의도를 따로 표시합니다. 패널은 프로필/Driver 식별자, 스캔 ID, 가상 시각, 상태/오류 및 `physical: unconfirmed`를 보고합니다. 실시간 패널은 최근 120개 스캔으로 제한된 순환 추적을 유지합니다. 파이프 재생은 정확한 바인딩을 출력합니다.

파이프 재생 모드에서 `--record`는 정확한 재생 가능 TOON 시나리오를 기록합니다. 예를 들면 다음과 같습니다.

```sh
printf '1\nscan 100\nexit\n' | node tools/ghostsim-console.mjs build/program.gfb \
  --bind DI1=start --bind DI2=stop --bind RO1=pump --bind RO2=valve \
  --record build/session.toon
```

다음으로 재생합니다.

`node tools/ghostsim.mjs build/program.gfb build/session.toon --format toon`로 재생합니다.

스캔이 완료된 뒤 명령 또는 스캔 시각을 거부하면 최종 결과는 `outcome: command-error`, `command` 오류 및 완료된 스캔 행을 가집니다. 이는 콘솔 세션 실패입니다. 실행기 입력 거부는 스캔 없이 `outcome: rejected`를 사용합니다. 기록된 시나리오에는 승인된 동작과 스캔만 들어가며 동일한 스캔 행 및 시나리오 식별자로 재생됩니다. 거부된 시도는 제외됩니다. 스캔이 하나도 완료되지 않으면 재생 가능한 시나리오를 기록하지 않습니다.

최종 결과에는 선택한 프로필 ID, 있을 경우 리비전, 다이제스트, 바인딩 및 물리 상태를 포함하는 `console` 필드가 있습니다. 보드 프로필은 통합 계약의 정규 JSON SHA-256을 다이제스트로 사용합니다. 콘솔 설명자는 JSON 파일의 정확한 바이트를 해시합니다. 재생 결과에는 동등한 스캔, 결과, 아티팩트/소스 식별자 및 시나리오 다이제스트가 있습니다. `ghostsim`은 콘솔 표시 메타데이터를 추가하지 않습니다. 이전 키보드 예제의 `logical_time_ms,key,event` CSV는 `ghostsim`에서 재생하기 전에 `GhostFlow/scenario-v1` 초기 입력, 키 바인딩 및 순서가 지정된 키/스캔 동작으로 명시적으로 변환해야 합니다.
