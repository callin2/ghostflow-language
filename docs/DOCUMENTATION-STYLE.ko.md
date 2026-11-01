<!-- translation-source: docs/DOCUMENTATION-STYLE.md -->
[영문 원문](DOCUMENTATION-STYLE.md)

# 문서 스타일 가이드

이 가이드는 GhostFlow 문서를 다시 쓰거나 번역하는 모든 사람을 위한 것입니다.
언어 정책, 파일 이름, 검사는 [문서 언어](DOCUMENTATION-LANGUAGES.ko.md)에
있습니다. 이 문서는 [영문 원문](DOCUMENTATION-STYLE.md)의 번역입니다.

## 목표

1. **정확성.** 기술적 정확성이 언제나 단순함보다 우선합니다. 문장을 줄이려고
   조건, 한계, 단위, 실패 사례, 예외를 빼지 마십시오.
2. **읽기 쉬움.** 처음 읽는 사람도 각 문단을 한 번에 이해할 수 있어야 합니다.
   짧은 문장, 흔한 단어, 구체적인 예를 우선합니다.
3. **일관성.** 같은 개념에는 모든 곳, 모든 언어에서 같은 단어를 씁니다.
   [용어집](#용어집)을 따르십시오.

## 영어로 쓰기

- 문서를 시작할 때 한두 문장으로 문서의 목적과 독자를 밝힙니다. 긴 문서에는
  짧은 "In this document" 개요를 더할 수 있습니다.
- 핵심을 먼저 쓰고, 그다음 세부 내용, 마지막에 근거를 씁니다.
- 한 문장에는 한 가지 생각, 한 문단에는 한 가지 주제를 담습니다. 문장은 대략
  25단어 이하를 목표로 합니다.
- 능동태로 쓰고 주체를 밝힙니다. "It is rejected …"가 아니라
  "The compiler rejects …"처럼 씁니다.
- 요구 사항에는 "must", 허용에는 "may", 능력에는 "can"을 씁니다. 원문이
  그렇게 말하지 않는 한 요구 사항을 "should"로 약하게 바꾸지 마십시오.
- 용어는 처음 나올 때 정의하거나 정의로 연결합니다.
- 단계와 나란한 항목은 목록으로, 비교는 표로 나타냅니다.
- 도움이 되면 일반 규칙 앞에 작은 예를 보여 줍니다.
- 식별자, 키워드, 파일 경로, 명령, 값은 `code` 형식으로 둡니다. 번역하거나
  형식을 바꾸지 마십시오.
- 관용구, 농담, 지역 표현, "simply", "obviously", "just" 같은 단어를 피합니다.

## 기존 문서 다시 쓰기

1. 영어판과 한국어판을 모두 읽습니다. 두 판은 따로 쓰인 경우가 있어서, 한쪽이
   어떤 점을 더 분명히 설명하거나, 예를 더하거나, 다른 쪽이 잃은 제약을
   간직하고 있을 수 있습니다. 정확한 내용은 모두 영어판으로 가져옵니다.
2. 두 판이 사실관계에서 다르면 추측하지 마십시오.
   [언어 레퍼런스](LANGUAGE-REFERENCE.md), 코드, 테스트를 확인합니다. 그래도
   분명하지 않으면 정본 파일의 표현을 유지하고 차이를 보고합니다.
3. 모든 번역과 그것을 가리키는 모든 링크를 함께 고치지 않는 한, 제목 수준과
   명시적 HTML 앵커(`<a id="…">`)를 그대로 둡니다.
4. 실행 코드 블록은 바이트 단위로 그대로 둡니다. 문서형 `*.ghost.md` 파일은
   컴파일러 입력이므로 코드를 절대 바꾸지 말고, 설명도 특히 주의해서 다룹니다.
5. 과거 기록, 해시, 줄 참조, `<!-- … -->` 기계용 표시는 바꾸지 않습니다.
6. 작성된 문서에 구현 상태나 진행 보고를 넣지 않습니다.
7. 파일을 고치기 전에 `tests/`와 `tools/`에서 파일 이름을 검색합니다. 어떤
   테스트는 문서의 특정 절, 표, 문자열을 정확히 고정하므로 그 부분은 그대로
   둡니다.

## 다이어그램

글보다 그림이 이해하기 쉬울 때 다이어그램을 더합니다. 예를 들면 다음과 같습니다.

- 구성 요소 사이의 데이터나 제어 흐름(컴파일러 → GFB1 → VM → 장치)
- 생명주기나 상태 기계(requested → safe → applied → confirmed)
- 시간 축(tick, 예약, 발생, 시간 창)
- 저장소나 계층 사이의 소유권과 경계

짧은 목록을 되풀이하기만 하는 다이어그램은 넣지 않습니다. 다이어그램은 짧은
레이블의 노드 12~15개 정도로 유지하고, 더 크면 나눕니다. 레이블은 본문과
일치해야 합니다. 다이어그램은
[문서 언어](DOCUMENTATION-LANGUAGES.ko.md#다이어그램)에 설명한 대로 PlantUML로
작성하고, 핵심을 말하는 대체 텍스트와 한 줄 설명을 반드시 붙입니다. 그림이
없어도 본문만으로 내용이 완전해야 합니다.

## 번역하기

- 영어 파일을 번역합니다. 원래 언어 파일은 모호함을 풀 때만 읽습니다.
- 어순이 아니라 의미를 옮깁니다. 대상 언어의 기술 독자에게 자연스러운 문장으로
  씁니다.
- 제목 수준, 앵커, 목록, 표, 코드 블록을 같게 유지합니다. 주석과 레이블은
  `text`, `mermaid`, `plantuml` 블록에서만 번역합니다.
- GhostFlow 키워드, 식별자, 타입 이름, 단위, 명령은 영어로 둡니다(`sensor`,
  `Result`, `config`, `Schedule`, `npm run docs:check`). 번역한 개념은 문서에서
  처음 나올 때 괄호 안에 영어 용어를 쓸 수 있습니다. 예: "安全意図（safe intent）".
- 다른 문서로 연결할 때는 같은 언어판이 있으면 그것을, 없으면 영어 파일을
  가리킵니다.
- 유지하는 다이어그램은 모두 번역합니다. `<name>.<code>.puml`을 만들고
  렌더링한 뒤, 번역된 SVG를 넣습니다.
- translation-source 표시와 영어 파일 링크로 시작한 뒤, 파일을 기록합니다
  ([문서 언어](DOCUMENTATION-LANGUAGES.ko.md#해시-기록) 참고).

다음 하위 절은 언어별 문체와 문장 부호를 정합니다.

### 한국어(ko)

- 본문은 **합니다체**를 일관되게 씁니다. 예: “~합니다”, “~할 수 있습니다”,
  “~하지 않습니다”. 한 문서 안에서 한다체나 해요체와 섞지 않습니다. 질문형
  제목은 “~하려면?”, “~할 수 있나요?”처럼 기존 형태를 유지할 수 있습니다.
  - *저장소 참고:* 기존 한국어 레퍼런스 장은 대부분 한다체를 쓰고,
    `LANGUAGE-REFERENCE.md`와 튜토리얼 FAQ형 제목은 해요체나 의문형을 씁니다.
    새 번역의 본문은 합니다체를 씁니다.
- 기존의 영어 혼용 방식을 유지합니다. 저장소에서 provenance, admission,
  fallback, stale, revision, descriptor, checkpoint처럼 영어로 두는 용어는
  영어로 둡니다. 처음 나올 때 괄호 안에 한국어 설명을 붙일 수 있습니다.
- 영어와 코드 단어 뒤의 조사는 소리 내어 읽는다고 생각하고 고릅니다:
  “`tick`은”, “`state`를”, “fallback으로”.
- 문장 부호는 반각을 씁니다. 기존 문서처럼 목록 구분자로 ·를 쓸 수 있습니다.
- 링크 레이블은 `[영문 원문](NAME.md)`을 씁니다.

### 간체 중국어(zh)

- 简体中文과 중국 본토 기술 문체로 씁니다. 번체자나 대만식 용어는 쓰지 않습니다.
  예를 들어 程式, 預設이 아니라 程序, 默认을 씁니다.
- 본문에는 전각 문장 부호 ，。：；（）“”를 씁니다. 코드와 인라인 코드 안에서는
  원래의 반각 문자를 유지합니다.
- 한자와 라틴 단어, 숫자, 인라인 코드 사이에는 반각 공백을 하나 둡니다.
  예: “每个 tick 读取一次 `input`”, “5 分钟”.
- 담백한 서술체로 씁니다. 啦, 哦 같은 구어 조사는 피합니다. 독자를 你로 부르는
  일은 줄이고, 비인칭 표현을 우선합니다.
- 링크 레이블은 `[英文原文](NAME.md)`을 씁니다.

### 스페인어(es)

- 중립적인 국제 또는 중남미 기술 스페인어를 씁니다. 지역 표현과 *vosotros*는
  피합니다. 독자를 부를 때는 **usted** 형태나 비인칭 *se*를 씁니다. 예:
  “Compile el documento”, “se compila el documento”.
- 정착된 스페인어 용어가 있으면 영어식 표현을 쓰지 않습니다. 예를 들어
  constraint는 *restricción*, interlock은 *enclavamiento*로 씁니다. 용어집에서
  **Term**으로 표시한 영어 용어는 그대로 둡니다.
- 스페인어 문장 부호(¿…?, ¡…!)와 문장형 대소문자 제목을 씁니다. 소수점 쉼표는
  본문에서만 쓸 수 있으며, 코드 안이나 코드에서 옮긴 값에는 쓰지 않습니다.
- 링크 레이블은 `[Original en inglés](NAME.md)`을 씁니다.

### 일본어(ja)

- 전체를 **です・ます調**로 씁니다. 제목은 “タイマーの読み方”처럼 명사구나
  보통형을 씁니다.
- 전각 문장 부호 、。（）「」를 씁니다. 일본어와 라틴 문자, 인라인 코드 사이에
  공백을 넣지 않습니다.
- JIS나 업계 표기가 일반적이면 외래어를 끝 장음 없이 가타카나로 씁니다. 예:
  センサ, フィルタ, カウンタ, ドライバ, アクチュエータ. サーバー, タイマー처럼
  정착된 장음 표기는 예외입니다. 선택한 표기를 일관되게 씁니다.
- 링크 레이블은 `[英語の原文](NAME.md)`을 씁니다.

## 용어집

모든 번역에서 아래 번역어를 씁니다. GhostFlow 코드, 키워드, 식별자는 번역하지
않습니다. 용어가 없으면 가장 가까운 항목을 따르고, 그 용어가 필요한 풀
리퀘스트에서 새 용어를 제안합니다. 용어집은 이 가이드 하나뿐이며, 영어 파일과
한국어 파일을 함께 갱신합니다. 표는 모든 언어판에서 같으며, Notes 열의 약어는
다음과 같습니다: kw = GhostFlow 키워드 또는 식별자, “1st use” = 처음 나올 때
괄호 안에 영어를 붙임.

### 일반 규칙

1. **코드는 절대 번역하지 않습니다.** 다음은 모든 언어에서 그대로 둡니다: GhostFlow 키워드, 문맥 키워드, 내장 타입 이름, 내장 호출 가능 항목, 투영(`.due`, `.missed`, …), 식별자, 파일 이름과 경로, 명령, CLI 플래그, JSON/YAML 키, 진단 코드(`E…`, `REF-…`), 이슈 번호. 영어 파일이 백틱을 쓰면 번역에서도 백틱 안에 둡니다.
   - 예약어: `control fn input output state config let type sensor signal schedule timer calendar provider event require mutex if then else case in true false div ok fault syntax adapt constraints check limit quote instance connect elapsed` (그리고 거부되는 옛 형태 `purefn enum next ifthenelse not and or is isnt`).
   - 문맥 키워드: `parameter resource account import from revision sha256 timezone selected basis when clock gap recovery fallback dst_missing dst_repeated sample valid filter stale_after recover_after samples min max step access label has`.
   - 내장 타입: `Bool Int Number Percent Duration Result SensorFault Expr Date TimeOfDay DateTime TimeSlots WorkCalendar HolidayCalendar TidePredictions LunarEphemeris BoolActuator Event ClockFault CalendarFault TemporalContextFault AccountingFault OutputStatus …`와 물리량 타입.
   - 내장 호출 가능 항목: `number int_exact int_floor int_ceil int_trunc int_nearest_even elapsed median hysteresis debounce date time datetime cron5 sun tide day moon continuous_true instant civil on_time count_events local_day_is calendar_is tide_is moon_is used rolling local_day hold_last map and_then recover output_status …`.
2. **제품, 형식, 표준 이름은 그대로 둡니다:** GhostFlow, GFB (GFB5, GFB10 …), WASM, ABI, C ABI, AST, IR, CLI, JSON, YAML, Markdown, PlantUML, Mermaid, Rust, Node.js, PLC, MCU, GPIO, RS485, ESP32, Waveshare, PI/PID, EMA, VPD, DST, UTC, Cron/`cron5`, `.ghost.md`, `@ghostflow/cabinet-view`, D 번호(D6, D9), R 번호(R14–R17), 예제 ID(E01, PC-03).
3. **“Keep as-is?” 열의 뜻:**
   - **Yes**: 절대 번역하지 않습니다. 코드, 이름, 형식입니다.
   - **Term**: 본문에서 영어 용어를 그대로 쓰고, 처음 나올 때 괄호 안에 짧은 설명을 붙일 수 있습니다. 예: ko “tick(논리 판단 단위)”.
   - **No**: 표의 번역어로 옮깁니다. 문서에서 처음 나올 때 검색을 돕도록 괄호 안에 영어를 붙일 수 있습니다. 예: ja “安全意図（safe intent）”.
4. **본문 표기와 코드 표기.** 키워드가 본문에서 개념을 가리키면 키워드는 코드 형식으로 쓰고 번역한 중심 명사를 덧붙입니다. 예: ko “`input` 선언”, zh “`input` 声明”, es “la declaración `input`”, ja “`input` 宣言”.
5. **한 문서에서는 한 번역어만 씁니다.** 동의어를 번갈아 쓰지 않습니다. 특히 constraint/limit, evidence/rationale, observation/measurement, commit/confirm 같은 짝에 주의합니다.
6. **단계 이름을 구별합니다.** `requested`, `safe`, `applied`, `confirmed`는 서로 다른 네 단계입니다. 두 단계를 같은 단어로 옮기지 않습니다. 특히 *commit*(tick이 상태를 확정함)과 *confirmed*(피드백이 물리적 결과를 보여 줌)는 다릅니다.

### 실행 모델과 언어 핵심

| # | English | 한국어 (ko) | 简体中文 (zh) | Español (es) | 日本語 (ja) | Keep as-is? | Notes |
|---|---|---|---|---|---|---|---|
| 1 | GhostFlow | GhostFlow | GhostFlow | GhostFlow | GhostFlow | Yes | Product/language name. Never transliterate it. |
| 2 | control (block) | `control` 블록 | `control` 块 | bloque `control` | `control` ブロック | Yes (kw) | In prose, “a control” may be rendered as 제어 / 控制 / control / 制御 when no keyword is meant. |
| 3 | program | 프로그램 | 程序 | programa | プログラム | No | “Program” = identity of executable rules (§7.7). |
| 4 | run (execution identity) | 실행(run) | 运行（run） | ejecución (run) | 実行（run） | No | Do not confuse it with the schedule shape `Run`, which stays as-is. |
| 5 | tick | tick | tick | tick | tick | Term | The unit that reads inputs and commits one logical decision. 1st-use gloss: ko “논리 판단 단위”, zh “逻辑决策步”, es “paso de decisión lógica”, ja “論理判断の単位”. es gender: *el tick*. |
| 6 | scan | 스캔 | 扫描 | escaneo (ciclo de escaneo) | スキャン | No | PLC “scan cycle”: ko 스캔 주기, zh 扫描周期, es ciclo de escaneo, ja スキャンサイクル. |
| 7 | scan frame | 스캔 프레임 | 扫描帧 | trama de escaneo (scan frame) | スキャンフレーム | Term | One complete host→core input frame for a tick. Keep it in English in doc titles such as “Scan frame WASM ABI”. |
| 8 | scan tape | 스캔 테이프 | 扫描带（scan tape） | cinta de escaneo (scan tape) | スキャンテープ | Term | A recorded sequence of scan frames, used for parity tests. |
| 9 | state | 상태 | 状态 | estado | 状態 | No (kw `state`) | |
| 10 | previous state | 이전 상태 | 前一状态 | estado anterior | 前状態 | No | The state committed before the current decision. |
| 11 | next state (`x'`) | 다음 상태 | 下一状态 | estado siguiente | 次状態 | No | Keep the `'` notation as-is. |
| 12 | candidate state | 후보 상태 | 候选状态 | estado candidato | 候補状態 | No | The next state computed during this decision but not yet committed. |
| 13 | commit (a decision/state) | 확정 | 提交（确定） | consolidar | 確定 | No | Never use confirm/confirmar/確認 here. Those words are reserved for `confirmed` (#47). |
| 14 | snapshot | snapshot(스냅샷) | 快照 | instantánea (snapshot) | スナップショット | No | The ko reference keeps “snapshot”. Either form is acceptable, but stay consistent within a document. |
| 15 | decision | 판단 | 判定 | decisión | 判断 | No | |
| 16 | logical time | 논리 시간 | 逻辑时间 | tiempo lógico | 論理時間 | No | |
| 17 | deterministic | 결정적 | 确定性的 | determinista | 決定的 | No | |
| 18 | evaluation | 평가 | 求值 | evaluación | 評価 | No | |
| 19 | expression | 식(표현식) | 表达式 | expresión | 式 | No | ko: use 식 in the reference and 표현식 in tutorials, as in the existing text. |
| 20 | pure function | 순수 함수 | 纯函数 | función pura | 純粋関数 | No | Keyword `fn`. |
| 21 | identifier | 식별자 | 标识符 | identificador | 識別子 | No | |
| 22 | reserved word / keyword | 예약어 / 키워드 | 保留字 / 关键字 | palabra reservada / palabra clave | 予約語 / キーワード | No | |
| 23 | contextual word | 문맥 키워드 | 上下文关键字 | palabra contextual | 文脈キーワード | No | A word that is special only in a specific syntax position. |
| 24 | type | 타입 | 类型 | tipo | 型 | No (kw `type`) | |
| 25 | enum (enumeration) | enum | 枚举 | enumeración (enum) | 列挙型（enum） | Term | The ko repo keeps “enum”. `enum` itself is a rejected legacy keyword. |
| 26 | exhaustive branching | 빠짐없는 분기 | 穷尽分支 | ramificación exhaustiva | 網羅的な分岐 | No | Used with `case`. |
| 27 | exact integer | 정확한 정수 | 精确整数 | entero exacto | 厳密な整数 | No | |
| 28 | literal | 리터럴 | 字面量 | literal | リテラル | No | |
| 29 | operator | 연산자 | 运算符 | operador | 演算子 | No | |
| 30 | physical quantity | 물리량 | 物理量 | magnitud física | 物理量 | No | |
| 31 | unit / display unit | 단위 / 표시 단위 | 单位 / 显示单位 | unidad / unidad de visualización | 単位 / 表示単位 | No | |
| 32 | dimension | 차원 | 量纲 | dimensión | 次元 | No | zh 量纲 (physics sense), not 维度. |
| 33 | diagnostic | 진단 | 诊断 | diagnóstico | 診断 | No | Diagnostic codes stay as-is. |
| 34 | compile / compiler | 컴파일 / 컴파일러 | 编译 / 编译器 | compilar / compilador | コンパイル / コンパイラ | No | recompile: 재컴파일 / 重新编译 / recompilar / 再コンパイル. |
| 35 | (hygienic) syntax extension | (위생적) 구문 확장 | （卫生）语法扩展 | extensión sintáctica (higiénica) | （衛生的）構文拡張 | No | Keywords `syntax`, `quote`, and `splice` stay as-is. |
| 36 | canonical notation | 대표 표기 | 规范写法 | notación canónica | 正準表記 | No | The ko tutorial also uses “canonical 표기”. Prefer 대표 표기. |
| 37 | alias (reference/removed) | 별칭 | 别名 | alias | 別名（エイリアス） | No | |
| 38 | name resolution / scope | 이름 해석 / 범위 | 名称解析 / 作用域 | resolución de nombres / ámbito | 名前解決 / スコープ | No | |

### 출력, 의도, 제약, 안전

| # | English | 한국어 (ko) | 简体中文 (zh) | Español (es) | 日本語 (ja) | Keep as-is? | Notes |
|---|---|---|---|---|---|---|---|
| 39 | intent (output intent) | 의도 (출력 의도) | 意图（输出意图） | intención (intención de salida) | 意図（出力意図） | No | The logical wish for an output. It is not the physical result. |
| 40 | design intent (author’s intent) | 의도 | 设计意图 | intención de diseño | 設計意図 | No | In intent anchors and intent evidence, this means the human reason behind code. |
| 41 | requested intent | 요청 의도 (requested) | 请求意图（requested） | intención solicitada (requested) | 要求意図（requested） | Term in headings | ko heading §4.7 keeps the four English stage names. Do the same in zh/es/ja headings. |
| 42 | safe intent | 안전 의도 (safe) | 安全意图（safe） | intención segura (safe) | 安全意図（safe） | Term in headings | The output intent after arbitration and constraints. |
| 43 | requested / safe intent (pair) | 요청 의도 / 안전 의도 | 请求意图 / 安全意图 | intención solicitada / segura | 要求意図 / 安全意図 | No | |
| 44 | effective intent | 유효 의도 | 有效意图 | intención efectiva | 有効意図 | No | Synonym slot for safe intent in §4.7. |
| 45 | applied (command) | 적용됨 (applied) | 已应用（applied） | aplicado (applied) | 適用済み（applied） | Term in headings | The renderer applied the command. This is not proof of a physical effect. |
| 46 | actual effect | 실제 효과 | 实际效果 | efecto real | 実際の効果 | No | |
| 47 | confirmed (by feedback) | 확인됨 (confirmed) | 已确认（confirmed） | confirmado (confirmed) | 確認済み（confirmed） | Term in headings | Reserve 확인/确认/confirmar/確認 for this stage only. |
| 48 | output connection (`<-`) | 출력 연결 | 输出连接 | conexión de salida | 出力接続 | No | |
| 49 | constraint | 제약 | 约束 | restricción | 制約 | No | ko 제약 (not 제약조건). The block keyword `constraints` stays as-is. |
| 50 | constraint statement | 제약문 | 约束语句 | sentencia de restricción | 制約文 | No | |
| 51 | prerequisite (`require a => b`) | 전제 조건 | 前提条件 | requisito previo | 前提条件 | No | `require` stays as-is. |
| 52 | mutex / mutual exclusion | 상호 배제 (`mutex`) | 互斥（`mutex`） | exclusión mutua (`mutex`) | 相互排他（`mutex`） | Yes (kw) | |
| 53 | conflict group | 충돌 그룹 | 冲突组 | grupo de conflicto | 競合グループ | No | |
| 54 | blocked (output/target) | 차단된 (대상) | 被阻止的（目标） | bloqueado | ブロックされた（対象） | No | Constraints only move true→false. |
| 55 | permit / allow | 허용 | 允许 | permitir | 許可する | No | The keyword `allow` stays as-is. |
| 56 | interlock | 인터록 | 互锁 | enclavamiento | インターロック | No | Do not use es “interbloqueo”, which means deadlock. |
| 57 | arbitration | 중재 (arbitration) | 仲裁 | arbitraje | 調停（アービトレーション） | No | |
| 58 | shared resource | 공유 자원 | 共享资源 | recurso compartido | 共有リソース | No | The keyword `resource` stays as-is. |
| 59 | resource envelope | 자원 허용 범위 | 资源包络 | envolvente de recursos | リソース包絡 | No | ko follows the existing heading “공유 자원의 허용 범위”. |
| 60 | ceiling (upper limit) | 상한 | 上限 | techo (límite superior) | 上限 | No | lower limit: 하한 / 下限 / límite inferior / 下限. |
| 61 | output ownership | 출력 소유권 | 输出所有权 | titularidad de la salida | 出力の所有権 | No | Covers the manual ↔ automatic handover. |
| 62 | mode | 모드 | 模式 | modo | モード | No | e.g., mode interlock: 모드 인터록 / 模式互锁 / enclavamiento de modo / モードインターロック. |
| 63 | fallback | fallback | 回退（fallback） | respaldo (fallback) | フォールバック | Term | The ko repo keeps “fallback”. The contextual word `fallback` is code. Do not use zh 回退 for “rewind” (#151). |
| 64 | degraded control | degraded 제어 | 降级控制 | control degradado | 縮退制御 | No | |
| 65 | bounded adaptation | 제한된 적응 (bounded adaptation) | 有界自适应 | adaptación acotada | 有界適応 | No | The keyword `adapt` stays as-is. |
| 66 | bounded | 제한된 / 유한한 | 有界的 | acotado | 有界の | No | ko: use 제한된 in titles, as in “제한된 live timeline”. |
| 67 | fail-safe | 페일세이프 | 故障安全 | a prueba de fallos (fail-safe) | フェイルセーフ | No | |
| 68 | emergency stop | 비상정지 | 急停 | parada de emergencia | 非常停止 | No | |
| 69 | stop priority | 정지 우선 | 停止优先 | prioridad de paro | 停止優先 | No | |

### 산업 제어(PLC 실무)

| # | English | 한국어 (ko) | 简体中文 (zh) | Español (es) | 日本語 (ja) | Keep as-is? | Notes |
|---|---|---|---|---|---|---|---|
| 70 | PLC | PLC | PLC | PLC | PLC | Yes | |
| 71 | ladder (logic) | 래더 | 梯形图 | lógica de escalera (ladder) | ラダー | No | |
| 72 | self-holding (seal-in) | 자기유지 | 自锁（自保持） | autorretención (enclavamiento propio) | 自己保持 | No | |
| 73 | latch | 래치 | 锁存 | latch (retención) | ラッチ | Term (es) | Used for an alarm latch and for an output latch/register. es: avoid “enclavamiento”, which is reserved for interlock. |
| 74 | contactor | 접촉기 | 接触器 | contactor | 電磁接触器（コンタクタ） | No | |
| 75 | overload (relay) | 과부하 (계전기) | 过载（继电器） | sobrecarga (relé de sobrecarga) | 過負荷（サーマルリレー） | No | |
| 76 | limit switch / limit feedback | 리미트 스위치 / 리미트 피드백 | 限位开关 / 限位反馈 | final de carrera / retroalimentación de final de carrera | リミットスイッチ / リミットフィードバック | No | |
| 77 | end position | 끝 위치 | 终端位置 | posición final | 端位置 | No | |
| 78 | relay | 릴레이 | 继电器 | relé | リレー | No | |
| 79 | coil | 코일 | 线圈 | bobina | コイル | No | |
| 80 | contact (NO/NC) | 접점 (a접점/b접점) | 触点（常开/常闭） | contacto (NA/NC) | 接点（a接点/b接点） | No | |
| 81 | ON-delay / OFF-delay | ON-delay / OFF-delay | 通电延时 / 断电延时 | retardo a la conexión / a la desconexión | オンディレイ / オフディレイ | Term (ko) | ko headings keep the English. |
| 82 | forward / reverse (rotation) | 정회전 / 역회전 | 正转 / 反转 | giro directo / inverso | 正転 / 逆転 | No | direction change: 방향전환 / 换向 / cambio de sentido / 方向切替. |
| 83 | fresh start | 새 시작 | 新的启动 | arranque nuevo | 新たな起動 | No | Means waiting for a new START press. |
| 84 | edge (rising/falling) | (상승/하강) 에지 | （上升/下降）沿 | flanco (ascendente/descendente) | （立ち上がり/立ち下がり）エッジ | No | |
| 85 | manual / automatic | 수동 / 자동 | 手动 / 自动 | manual / automático | 手動 / 自動 | No | |
| 86 | debounce | debounce | 消抖 | antirrebote (debounce) | チャタリング除去（デバウンス） | Term (ko) | The callable `debounce` stays as-is. |
| 87 | hysteresis | 히스테리시스 | 迟滞（滞回） | histéresis | ヒステリシス | No | The callable `hysteresis` and its parameters `on_below`/`off_above`/`initial` stay as-is. |
| 88 | feedback | 피드백 | 反馈 | retroalimentación | フィードバック | No | |
| 89 | actuator | 액추에이터 | 执行器 | actuador | アクチュエータ | No | |
| 90 | setpoint | setpoint(설정점) | 设定值 | consigna | 目標値（設定値） | No | |
| 91 | process value | 공정값 | 过程值 | variable de proceso | プロセス値 | No | |
| 92 | control objective (continuous) | (연속) 제어 objective | （连续）控制目标 | objetivo de control (continuo) | （連続）制御目標 | No | The ko heading keeps “continuous control objective”. |
| 93 | PI / PID | PI / PID | PI / PID | PI / PID | PI / PID | Yes | |
| 94 | integral / anti-windup | 적분 / 안티 와인드업 | 积分 / 抗积分饱和 | integral / anti-windup | 積分 / アンチワインドアップ | No | |
| 95 | saturation | 포화 | 饱和 | saturación | 飽和 | No | |
| 96 | controller (device) | 컨트롤러 | 控制器 | controlador | コントローラ | No | es: do not use “controlador” for a software driver (#141). |

### 센서, 신호, 값 품질

| # | English | 한국어 (ko) | 简体中文 (zh) | Español (es) | 日本語 (ja) | Keep as-is? | Notes |
|---|---|---|---|---|---|---|---|
| 97 | sensor | 센서 | 传感器 | sensor | センサ | No (kw `sensor`) | |
| 98 | optional sensor (`sensor?`) | 선택적 센서 | 可选传感器 | sensor opcional | オプションのセンサ | No | |
| 99 | signal | 신호 | 信号 | señal | 信号 | No (kw `signal`) | |
| 100 | input / output | 입력 / 출력 | 输入 / 输出 | entrada / salida | 入力 / 出力 | No (kw `input`/`output`) | I/O: 입출력 / 输入输出 / E/S / 入出力. |
| 101 | sample | 샘플 | 样本 | muestra | サンプル | No | The contextual words `sample`/`samples` stay as-is. |
| 102 | measured value / measurement | 측정값 / 측정 | 测量值 / 测量 | valor medido / medición | 測定値 / 測定 | No | |
| 103 | quality (of a value) | 품질 | 质量 | calidad | 品質 | No | |
| 104 | Result | Result | Result | Result | Result | Yes | Built-in type. Variants `ok`/`fault` stay as-is. Option also stays as-is. |
| 105 | fault | fault(고장) | 故障 | fallo | 故障（fault） | No (kw `fault`) | ko prose: 고장, as in “고장 원인”. |
| 106 | recover / recovery | 복구 | 恢复 | recuperación / recuperar | 復旧 | No | `recover`, `recover_after`, and `recovery` stay as-is. |
| 107 | stale | stale(오래된 값) | 陈旧 | obsoleto (stale) | 古い（stale） | Term (ko) | `stale_after` stays as-is. |
| 108 | valid range (`..`) | 유효 범위 | 有效范围 | rango válido | 有効範囲 | No | |
| 109 | filter | 필터 | 滤波（滤波器） | filtro | フィルタ | No | |
| 110 | median / moving average | 중앙값 / 이동평균 | 中值 / 移动平均 | mediana / media móvil | 中央値 / 移動平均 | No | |
| 111 | noise / disconnection | 노이즈 / 끊김(단절) | 噪声 / 断线 | ruido / desconexión | ノイズ / 断線 | No | |
| 112 | unknown | 알 수 없음 (Unknown) | 未知 | desconocido | 不明 | No | `Unknown`/`OutputUnknown` and similar names are code. |
| 113 | absent | 부재 | 缺失 | ausente | 欠落 | No | §7.3: false ≠ absent ≠ uncertain. |
| 114 | uncertain | 불확실 | 不确定 | incierto | 不確実 | No | |
| 115 | temporal evidence | temporal evidence (시간 증거) | 时间证据 | evidencia temporal | 時間的証拠 | Term (ko) | ko heading §4.4 keeps the English. |
| 116 | estimate / estimated value | 추정 / 추정값 | 估计 / 估计值 | estimación / valor estimado | 推定 / 推定値 | No | |
| 117 | capability | capability | 能力（capability） | capacidad (capability) | ケイパビリティ | Term | |
| 118 | strategy selection | 전략 선택 | 策略选择 | selección de estrategia | 戦略選択 | No | `strategy` and `priority` stay as-is. |
| 119 | device query | 장치 질의 | 设备查询 | consulta de dispositivos | デバイス照会 | No | |

### 시간, 예약, accounting

| # | English | 한국어 (ko) | 简体中文 (zh) | Español (es) | 日本語 (ja) | Keep as-is? | Notes |
|---|---|---|---|---|---|---|---|
| 120 | schedule | 예약 | 调度计划 | programación (horaria) | スケジュール | No (kw `schedule`) | ko: 예약, as in the chapter “시간과 예약”. Use 일정 only for an informal human timetable. The type `Schedule` stays as-is. |
| 121 | occurrence | 발생 | 触发实例（occurrence） | ocurrencia | 発生（オカレンス） | No | One identifiable firing of a schedule rule. Avoid zh 事件, which is reserved for event. |
| 122 | due / missed | due / 놓친 발생 | 到期 / 错过 | pendiente (due) / omitida | 到来（due）/ 取りこぼし | Term | The projections `.due` and `.missed` stay as-is. |
| 123 | admission / admit | admission(수용) | 准入 | admisión / admitir | 受け入れ（アドミッション） | Term (ko) | The ko repo keeps “admission” in most places. |
| 124 | late start | 늦은 시작 | 延迟启动 | inicio tardío | 遅延開始 | No | |
| 125 | duplicate suppression | 중복 억제 | 重复抑制 | supresión de duplicados | 重複抑止 | No | |
| 126 | observation gap | 관측 공백 | 观测间隙 | brecha de observación | 観測ギャップ | No | The contextual word `gap` stays as-is. |
| 127 | timer | 타이머 | 定时器 | temporizador | タイマー | No (kw `timer`) | |
| 128 | elapsed time | 경과 시간 | 经过时间 | tiempo transcurrido | 経過時間 | No | The callable `elapsed` stays as-is. |
| 129 | duration | 지속 시간 | 持续时间 | duración | 継続時間 | No | The type `Duration` stays as-is. |
| 130 | monotonic clock / time | 단조 시계 / 단조 시간 | 单调时钟 / 单调时间 | reloj monotónico / tiempo monotónico | 単調クロック / 単調時間 | No | |
| 131 | wall clock / calendar clock | 벽시계 / 달력 시계 | 墙钟 / 日历时钟 | reloj de pared / reloj de calendario | 壁時計 / 暦時計 | No | |
| 132 | clock domain | 시계 영역 | 时钟域 | dominio de reloj | クロック領域 | No | |
| 133 | time zone | 시간대 | 时区 | zona horaria | タイムゾーン | No | `timezone` stays as-is. |
| 134 | daylight saving time (DST) | 서머타임(DST) | 夏令时（DST） | horario de verano (DST) | 夏時間（DST） | No | |
| 135 | work calendar / workday / holiday | 업무 달력 / 업무일 / 공휴일 | 工作日历 / 工作日 / 节假日 | calendario laboral / día laborable / día festivo | 稼働カレンダー / 稼働日 / 祝日 | No | |
| 136 | Pulse / Window / Run / Range | Pulse / Window / Run / Range | Pulse / Window / Run / Range | Pulse / Window / Run / Range | Pulse / Window / Run / Range | Yes | These are schedule shapes. TriggerRule, DayRule, DailySlots, and Periodic also stay as-is. |
| 137 | sunrise / sunset | 일출 / 일몰 | 日出 / 日落 | amanecer / atardecer (salida/puesta del sol) | 日の出 / 日の入り | No | `Solar` stays as-is. |
| 138 | tide (high/low; spring/neap) | 조석 (만조/간조; 사리/조금) | 潮汐（高潮/低潮；大潮/小潮） | marea (pleamar/bajamar; viva/muerta) | 潮汐（満潮/干潮；大潮/小潮） | No | `Tide` stays as-is. |
| 139 | moon phase | 달의 위상 | 月相 | fase lunar | 月相 | No | |
| 140 | accounting | accounting(사용량 집계) | 用量核算 | contabilización de uso | 使用量計上（アカウンティング） | Term (ko) | The keyword `account` stays as-is. |
| 141 | budget / rolling window | 예산 / rolling window(이동 구간) | 预算 / 滚动窗口 | presupuesto / ventana móvil | 予算 / ローリングウィンドウ | No | `rolling` stays as-is. |
| 142 | ledger | ledger(원장) | 账本 | libro mayor (ledger) | 台帳（レジャー） | Term (ko) | |
| 143 | accumulated operating time | 누적 동작 시간 | 累计运行时间 | tiempo de operación acumulado | 累積稼働時間 | No | |
| 221 | time window | 시간 창 | 时间窗口 | ventana de tiempo | 時間窓 | No | |

### 설정, 관찰, 설명

| # | English | 한국어 (ko) | 简体中文 (zh) | Español (es) | 日本語 (ja) | Keep as-is? | Notes |
|---|---|---|---|---|---|---|---|
| 144 | setting / settings | 설정 | 设置 | ajuste / ajustes | 設定 | No (kw `config`) | A value whose changeability the program declares. setting value: 설정값 / 设置值 / valor de ajuste / 設定値. |
| 145 | operating setting | 운영 설정 | 运行设置 | ajuste operativo | 運用設定 | No | |
| 146 | live setting (atomic) | (원자적) live 설정 | （原子）实时设置 | ajuste en vivo (atómico) | （アトミックな）ライブ設定 | No | |
| 147 | default / effective value | 기본값 / 유효값 | 默认值 / 生效值 | valor predeterminado / efectivo | 既定値 / 有効値 | No | |
| 148 | temporary value / expiry / return | 임시값 / 만료 / 복귀 | 临时值 / 过期 / 恢复原值 | valor temporal / vencimiento / retorno | 一時値 / 期限切れ / 復帰 | No | |
| 149 | revision | revision(판본) | 修订版 | revisión | リビジョン | Term (ko) | The contextual word `revision` stays as-is. |
| 150 | observation | 관찰 (UI/설정 모델) · 관측 (측정 데이터) | 观测 | observación | 観測 | No | ko: ref ch.5 uses 관찰 (“관찰 모델”, “관찰 계약”), and sensor/output text uses 관측. Follow that split in ko. Use one word in the other languages. |
| 151 | observation contract / model | 관찰 계약 / 관찰 모델 | 观测契约 / 观测模型 | contrato / modelo de observación | 観測契約 / 観測モデル | No | |
| 152 | descriptor | descriptor | 描述符 | descriptor | ディスクリプタ | Term (ko) | |
| 153 | event | event(이벤트) | 事件 | evento | イベント | No (kw `event`) | |
| 154 | alarm | 알람 | 报警 | alarma | アラーム | No | |
| 155 | counter | 카운터 | 计数器 | contador | カウンタ | No | |
| 156 | command result | 명령 결과 | 命令结果 | resultado del comando | コマンド結果 | No | |
| 157 | explanation (DAG) | 설명 (DAG) | 解释（DAG） | explicación (DAG) | 説明（DAG） | No | |
| 158 | provenance | provenance(출처) | 来源 | procedencia | 来歴 | Term (ko) | The ko repo mostly keeps “provenance” and uses 출처 in headings. |
| 159 | trace | 추적(trace) | 追踪 | traza | トレース | No | |
| 160 | operator (person) | 운영자 | 操作员 | operador | オペレーター | No | |
| 161 | cabinet-view | Cabinet-view | Cabinet-view | Cabinet-view | Cabinet-view | Yes | Package `@ghostflow/cabinet-view`; operator UI. |
| 162 | identity | identity(정체성) | 身份标识 | identidad | 同一性 | No | |
| 163 | atomic | 원자적 | 原子的 | atómico | アトミック | No | |
| 164 | label / access / min / max / step | 라벨 / 접근 / … | 标签 / 访问 / … | etiqueta / acceso / … | ラベル / アクセス / … | Yes (in code) | These stay as-is as setting fields. Translate them only as ordinary prose words. |

### 합성, 재생, 증거

| # | English | 한국어 (ko) | 简体中文 (zh) | Español (es) | 日本語 (ja) | Keep as-is? | Notes |
|---|---|---|---|---|---|---|---|
| 165 | (behavior) composition | (behavior) 합성 / 조합 | （行为）组合 | composición (de comportamientos) | （振る舞いの）合成 | No | ko: 조합 in ch.6 titles and 합성 for function composition. |
| 166 | definition / instance | definition / 인스턴스 | 定义 / 实例 | definición / instancia | 定義 / インスタンス | No | `instance` stays as-is. |
| 167 | import / connect | 가져오기 (`import`) / 연결 (`connect`) | 导入 / 连接 | importar / conectar | インポート / 接続 | Yes (kw) | |
| 168 | logical port | 논리 포트 | 逻辑端口 | puerto lógico | 論理ポート | No | |
| 169 | (physical) binding | (물리) 바인딩 | （物理）绑定 | vinculación (binding) | （物理）バインディング | No | `bindings:` in front matter is code. |
| 170 | parameter / dependency | 파라미터 / 의존성 | 参数 / 依赖 | parámetro / dependencia | パラメータ / 依存関係 | No | |
| 171 | semantic DAG | 의미 DAG | 语义 DAG | DAG semántico | 意味 DAG | No | This is distinct from a screen-layout graph. |
| 172 | replay | 재생 (replay) | 重放 | reproducción (replay) | リプレイ | No | The mechanism of re-executing recorded inputs. ko ch.6: “조합, 재생과 교체”. |
| 173 | reproduce (an incident/bug) | 재현 | 复现 | reproducir | 再現 | No | Do not mix 재생 and 재현. |
| 174 | ghost (run/execution) | ghost (고스트 실행) | ghost（影子运行） | ghost (ejecución fantasma) | ゴースト（ゴースト実行） | Term | Product concept. Keep “ghost” and gloss it on 1st use. |
| 175 | rewind | 되감기 | 倒带 | rebobinado | 巻き戻し | No | |
| 176 | (live) timeline | (live) timeline | （实时）时间线 | línea de tiempo (en vivo) | （ライブ）タイムライン | Term (ko) | |
| 177 | branch | branch(분기) | 分支 | rama | ブランチ | No | |
| 178 | checkpoint | checkpoint | 检查点 | punto de control (checkpoint) | チェックポイント | Term (ko) | |
| 179 | journal | journal(저널) | 日志（journal） | registro (journal) | ジャーナル | Term | |
| 180 | (program) hot replacement | (Program) 실행 중 교체 (hot replacement) | （程序）热替换 | reemplazo en caliente (del programa) | （プログラムの）ホット置換 | No | |
| 181 | compatible device replacement | 호환 장치 교체 | 兼容设备替换 | reemplazo de dispositivo compatible | 互換デバイスの交換 | No | |
| 182 | evidence | 증거 | 证据 | evidencia | 証拠（エビデンス） | No | ko exceptions: “intent evidence” = 의도 근거 and “estimate evidence” = 추정 근거, matching existing doc titles. |
| 183 | rationale / “Why” | 근거 / 이유 | 依据 / 原因 | fundamento / por qué | 根拠 / 理由 | No | ko headings: “설계 이유와 근거”. |
| 184 | incident | incident(사고) | 事故 | incidente | インシデント | No | |

### 소스 문서와 작성

| # | English | 한국어 (ko) | 简体中文 (zh) | Español (es) | 日本語 (ja) | Keep as-is? | Notes |
|---|---|---|---|---|---|---|---|
| 185 | canonical source | 정본 소스 | 规范源 | fuente canónica | 正本ソース | No | |
| 186 | original (source text) | 원문 / 원본 | 原文 / 原始来源 | original / texto original | 原文 / 原本 | No | |
| 187 | literate source / literate program | 문서형 소스 (literate source) | 文学式源文件（literate） | fuente literaria (literate) | 文芸的ソース（literate） | Term | Keep “literate” in doc titles. `.ghost.md` stays as-is. |
| 188 | code fence / `ghost` fence | 코드 펜스 / `ghost` fence | 代码围栏 / `ghost` 围栏 | bloque delimitado / bloque `ghost` | コードフェンス / `ghost` フェンス | No | |
| 189 | front matter | front matter | front matter（前置元数据） | front matter (metadatos iniciales) | フロントマター | Term | Hardware front matter: 하드웨어 front matter / 硬件 front matter / front matter de hardware / ハードウェアフロントマター. |
| 190 | profile (device/board profile) | 프로필 | profile（设备配置档） | perfil | プロファイル | No | `profile:` keys and values like `jsy-mk-333@1` are code. ko: prefer 프로필 (77 uses) over 프로파일. |
| 191 | intent anchor | 의도 앵커 | 意图锚点 | ancla de intención | 意図アンカー | No | `ghostflow:anchor` / `ghostflow:link` stay as-is. |
| 192 | premise / assumption | 전제 / 가정 | 前提 / 假设 | premisa / supuesto | 前提 / 仮定 | No | |
| 193 | comment | 주석 | 注释 | comentario | コメント | No | |
| 194 | executable block | 실행 블록 | 可执行块 | bloque ejecutable | 実行可能ブロック | No | |
| 222 | translation (documentation projection) | 번역 (문서 투영) | 译文（文档投影） | traducción (proyección documental) | 翻訳（文書投影） | No | A translation is never a compile input. |

### 런타임, 도구 체인, 하드웨어 경계

| # | English | 한국어 (ko) | 简体中文 (zh) | Español (es) | 日本語 (ja) | Keep as-is? | Notes |
|---|---|---|---|---|---|---|---|
| 195 | host | 호스트 | 宿主（host） | host (anfitrión) | ホスト | No | |
| 196 | driver | 드라이버 | 驱动程序 | driver | ドライバ | Term (es) | The input role that turns physical signals into logical inputs. es: keep “driver”, because “controlador” means controller (#96). |
| 197 | renderer | 렌더러 | 渲染器（renderer） | renderizador (renderer) | レンダラー | No | The output role that applies logical intent to actual effects. |
| 198 | ABI / C ABI | ABI / C ABI | ABI | ABI | ABI | Yes | |
| 199 | GFB (GhostFlow bytecode) | GFB 바이트코드 | GFB 字节码 | bytecode GFB | GFB バイトコード | Yes (GFB) | Version tags such as GFB5 and GFB10 stay as-is. |
| 200 | WASM / native | WASM / native | WASM / 原生 | WASM / nativo | WASM / ネイティブ | Yes (WASM) | |
| 201 | runtime | 런타임 | 运行时 | runtime (entorno de ejecución) | ランタイム | No | `ControlRuntime` stays as-is. |
| 202 | manifest | manifest(매니페스트) | 清单（manifest） | manifiesto | マニフェスト | No | |
| 203 | loader | 로더 | 加载器 | cargador | ローダー | No | |
| 204 | parity | parity(동등성) | 一致性 | paridad | パリティ（一致性） | Term | As in “scan tape parity”. |
| 205 | firmware / flashing | 펌웨어 / 플래싱 | 固件 / 烧录 | firmware / grabación | ファームウェア / 書き込み | No | |
| 206 | GPIO / MCU / RS485 / ESP32 | GPIO / MCU / RS485 / ESP32 | GPIO / MCU / RS485 / ESP32 | GPIO / MCU / RS485 / ESP32 | GPIO / MCU / RS485 / ESP32 | Yes | pin: 핀 / 引脚 / pin / ピン. |
| 207 | I/O mapping | 입출력 매핑 | I/O 映射 | mapeo de E/S | I/O マッピング | No | |
| 208 | expansion board | 확장 보드 | 扩展板 | placa de expansión | 拡張ボード | No | |
| 209 | installation / facility | 설비 / 설치 | 设施 / 安装 | instalación | 設備 / 設置 | No | |
| 210 | wiring | 배선 | 接线 | cableado | 配線 | No | |
| 211 | power outage / restart | 정전 / 재시작 | 停电 / 重启 | corte de energía / reinicio | 停電 / 再起動 | No | |
| 212 | contract (interface) | 계약 | 契约 | contrato | 契約 | No | |
| 223 | lowering | lowering(하위 변환) | 降级（lowering） | reducción (lowering) | 低水準化（lowering） | Term | Compiler stage from AST/IR to GFB. |

### 응용 분야(예제)

| # | English | 한국어 (ko) | 简体中文 (zh) | Español (es) | 日本語 (ja) | Keep as-is? | Notes |
|---|---|---|---|---|---|---|---|
| 213 | irrigation / watering | 관수 / 급수 | 灌溉 / 浇水 | riego | 灌水 / 給水 | No | |
| 214 | zone | 구역 | 区域 | zona | 区画（ゾーン） | No | |
| 215 | soil moisture | 토양 수분 | 土壤湿度 | humedad del suelo | 土壌水分 | No | |
| 216 | water level (switch) | 수위 (스위치) | 水位（开关） | nivel de agua (interruptor de nivel) | 水位（スイッチ） | No | |
| 217 | pump / valve | 펌프 / 밸브 | 泵 / 阀门 | bomba / válvula | ポンプ / バルブ | No | |
| 218 | VPD (vapour-pressure deficit) | VPD (증기압차) | VPD（蒸汽压差） | VPD (déficit de presión de vapor) | VPD（飽差） | Yes (VPD) | |
| 219 | relative humidity | 상대습도 | 相对湿度 | humedad relativa | 相対湿度 | No | |
| 220 | heater / ventilation / humidification | 히터 / 환기 / 가습 | 加热器 / 通风 / 加湿 | calefactor / ventilación / humidificación | ヒーター / 換気 / 加湿 | No | |

### 규범어

영어 문서는 소문자 규범어를 씁니다. 대문자 RFC 2119 형태는 문서에 나오지 않습니다. 규범의 강도를 정확히 유지합니다. *must*를 *should*로 약하게 바꾸거나 금지를 권고로 바꾸지 않습니다.

| English | 한국어 (합니다체) | 简体中文 | Español | 日本語 (です・ます) |
|---|---|---|---|---|
| must / is required to | ~해야 합니다 (강조: 반드시 ~해야 합니다) | 必须 | debe | ~しなければなりません / ~する必要があります |
| must not / never | ~해서는 안 됩니다 / 절대 ~하지 않습니다 | 不得 / 绝不 | no debe / nunca | ~してはなりません / 決して~しません |
| should | ~하는 것이 좋습니다 / ~하도록 권장합니다 | 应当 / 应 | debería / se recomienda | ~すべきです / ~することを推奨します |
| should not | ~하지 않는 것이 좋습니다 | 不应 | no debería | ~すべきではありません |
| may (permission) | ~할 수 있습니다 | 可以 | puede | ~してもかまいません / ~できます |
| is rejected (by the compiler) | 거부됩니다 | 被拒绝 | se rechaza | 拒否されます |
| is not supported / unsupported | 지원하지 않습니다 / 미지원 | 不支持 | no se admite | サポートされていません |
| [Changed] / [Partially unsupported] (FAQ tags) | [변경됨] / [부분 미지원] | [已变更] / [部分不支持] | [Modificado] / [Parcialmente no admitido] | [変更あり] / [一部未対応] |

영어 파일이 규범어를 굵게 또는 기울임꼴로 강조하면 번역에서도 같은 강조를 유지합니다. “Constraints do not turn false into true”처럼 언어 동작을 서술하는 문장은 사실입니다. 권고가 아니라 평범한 서술문으로 번역합니다.

## 점검 목록

문서를 기록하기 전에 확인합니다.

- [ ] 영어판과 한국어판의 모든 사실, 한계, 예제가 빠짐없이 정확하게 들어 있습니다.
- [ ] 제목, 앵커, front matter, 코드 블록이 원본 파일과 일치합니다.
- [ ] 용어집 용어를 일관되게 썼습니다.
- [ ] 새 다이어그램을 렌더링해 커밋했고 대체 텍스트가 있습니다.
- [ ] 문서를 고정하는 테스트가 여전히 통과합니다.
- [ ] `npm run docs:index`와 `npm run docs:check`가 통과합니다.
