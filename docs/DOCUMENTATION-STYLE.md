# Documentation style guide

This guide is for anyone who rewrites or translates GhostFlow documentation.
The language policy, file names and checks are in
[Documentation languages](DOCUMENTATION-LANGUAGES.md). The
[Korean version](DOCUMENTATION-STYLE.ko.md) of this guide is a translation.

## Goals

1. **Accurate.** Technical accuracy always wins over simplicity. Never drop a
   condition, limit, unit, failure case or exception to make a sentence shorter.
2. **Readable.** A new reader should understand each paragraph on the first
   pass. Prefer short sentences, common words and concrete examples.
3. **Consistent.** Use the same word for the same idea everywhere, in every
   language. Use the [glossary](#glossary).

## Writing English

- Start each document with one or two sentences that say what it is for and
  who should read it. Long documents may add a short "In this document"
  overview.
- Put the main point first, then details, then rationale.
- One idea per sentence; one topic per paragraph. Aim for sentences under about
  25 words.
- Use the active voice and name the actor: "The compiler rejects …", not
  "It is rejected …".
- Use "must" for requirements, "may" for permissions and "can" for abilities.
  Do not soften a requirement into "should" unless the original says so.
- Define a term the first time it appears, or link to its definition.
- Use lists for steps and parallel items, and tables for comparisons.
- Show a small example before a general rule when that helps.
- Keep identifiers, keywords, file paths, commands and values in `code` format.
  Never translate or reformat them.
- Avoid idioms, jokes, regional expressions and words such as "simply",
  "obviously" or "just".

## Rewriting an existing document

1. Read both the English and the Korean versions. They were sometimes written
   separately, and one may explain a point more clearly, add an example or keep
   a constraint that the other lost. Bring every accurate idea into English.
2. If the two versions disagree on a fact, do not guess. Check the
   [Language Reference](LANGUAGE-REFERENCE.en.md), the code and the tests. If it is
   still unclear, keep the wording of the canonical file and report the
   difference.
3. Keep every heading level and explicit HTML anchor (`<a id="…">`) unless you
   also update every translation and every link to it.
4. Keep executable code blocks byte-for-byte. Literate `*.ghost.md` files are
   compiler inputs: never change their code, and treat their prose with extra
   care.
5. Keep historical records, digests, line references and `<!-- … -->` machine
   markers unchanged.
6. Do not add implementation status or progress reports to authored documents.
7. Before you edit a file, search `tests/` and `tools/` for its name. Some tests
   pin exact sections, tables or strings of a document; keep them unchanged.

## Diagrams

Add a diagram when it is easier to see than to read, for example:

- data or control flow across components (compiler → GFB1 → VM → device);
- a lifecycle or state machine (requested → safe → applied → confirmed);
- a timeline (ticks, schedules, occurrences, windows);
- ownership and boundaries between repositories or layers.

Do not add a diagram that only repeats a short list. Keep a diagram to about
12–15 nodes with short labels; split larger pictures. Labels must agree with
the text. Write diagrams in PlantUML as described in
[Documentation languages](DOCUMENTATION-LANGUAGES.md#diagrams), always with
alternative text and a one-line caption that state the main point. The text
must stay complete without the picture.

## Translating

- Translate from the English file. Read the source language file only to
  resolve ambiguity.
- Translate meaning, not word order. Write natural sentences for a technical
  reader in the target language.
- Keep the same heading levels, anchors, lists, tables and code blocks.
  Translate comments and labels only in `text`, `mermaid` and `plantuml` blocks.
- Keep GhostFlow keywords, identifiers, type names, units and commands in
  English (`sensor`, `Result`, `config`, `Schedule`, `npm run docs:check`).
  For a translated concept, you may write the English term in parentheses the
  first time it appears in a document, for example "安全意図（safe intent）".
- Link to the same language version of another document when it exists;
  otherwise link to the English file.
- Translate each diagram you keep: create `<name>.<code>.puml`, render it and
  embed the translated SVG.
- Start with the translation-source marker and a link to the English file, then
  stamp the file (see [Documentation languages](DOCUMENTATION-LANGUAGES.md#stamping-digests)).

The following subsections give the register and punctuation for each language.

### Korean (ko)

- Use **합니다체** consistently for body text, for example “~합니다”,
  “~할 수 있습니다” and “~하지 않습니다”. Do not mix it with 한다체 or 해요체
  inside one document. Question-style headings may keep their existing form,
  such as “~하려면?” and “~할 수 있나요?”.
  - *Repo note:* Older Korean reference chapters mostly use 한다체, and
    `LANGUAGE-REFERENCE.md` and the tutorial FAQ-style headings use 해요체 or
    questions. New translations use 합니다체 for body text.
- Keep the established code-switching style. If the repository keeps an
  English term, such as provenance, admission, fallback, stale, revision,
  descriptor or checkpoint, keep it in English. On first use you may add a
  Korean gloss in parentheses.
- Use 조사 correctly after English and code words. Choose the particle as if the
  term were read aloud: “`tick`은”, “`state`를”, “fallback으로”.
- Use half-width punctuation. You may use · as a list separator, as in the
  existing documents.
- Use the link label `[영문 원문](NAME.md)`.

### Simplified Chinese (zh)

- Write in 简体中文 and a mainland technical register. Do not use Traditional
  characters or Taiwan-specific terms. For example, use 程序 and 默认, not 程式
  and 預設.
- Use full-width punctuation in prose: ，。：；（）“”. Inside code and inline
  code, keep the original half-width characters.
- Put one half-width space between Chinese characters and Latin words, numbers
  or inline code. Examples: “每个 tick 读取一次 `input`” and “5 分钟”.
- Use a plain declarative style. Avoid colloquial particles such as 啦 and 哦.
  Address the reader as 你 sparingly; impersonal phrasing is preferred.
- Use the link label `[英文原文](NAME.md)`.

### Spanish (es)

- Use neutral international or Latin-American technical Spanish. Avoid
  regionalisms and *vosotros*. When addressing the reader, use **usted** forms
  or impersonal *se*, for example “Compile el documento” or “se compila el
  documento”.
- Do not use anglicisms when an established Spanish term exists. For example,
  use *restricción* for constraint and *enclavamiento* for interlock. Keep the
  English terms marked **Term** in the glossary.
- Use Spanish punctuation (¿…?, ¡…!) and sentence-case headings. A decimal comma
  may appear only in prose, never inside code or in values copied from code.
- Use the link label `[Original en inglés](NAME.md)`.

### Japanese (ja)

- Use **です・ます調** throughout. Headings use noun phrases or plain forms, for
  example “タイマーの読み方”.
- Use full-width punctuation 、。（）「」. Do not add spaces between Japanese and
  Latin text or inline code.
- Write loanwords in katakana without a final long-vowel mark when the JIS or
  industry form is common, for example センサ, フィルタ, カウンタ, ドライバ and
  アクチュエータ. Established long forms such as サーバー and タイマー are
  exceptions. Apply the choice consistently.
- Use the link label `[英語の原文](NAME.md)`.

## Glossary

Use these renderings in every translation. Keep GhostFlow code, keywords and
identifiers untranslated. If a term is missing, follow the closest related
entry and propose the new term in the pull request that needs it. This guide
is the only glossary; update its English and Korean files together.
Abbreviations in the Notes column: kw = GhostFlow keyword or identifier;
“1st use” = add the English in parentheses on first use.

### General rules

1. **Never translate code.** Keep these unchanged in every language: GhostFlow keywords, contextual words, built-in type names, built-in callables, projections (`.due`, `.missed`, …), identifiers, file names and paths, commands, CLI flags, JSON/YAML keys, diagnostic codes (`E…`, `REF-…`), and issue numbers. Keep them in backticks if the English file uses backticks.
   - Reserved words: `control fn input output state config let type sensor signal schedule timer calendar provider event require mutex if then else case in true false div ok fault syntax adapt constraints check limit quote instance connect elapsed` (and rejected legacy `purefn enum next ifthenelse not and or is isnt`).
   - Contextual words: `parameter resource account import from revision sha256 timezone selected basis when clock gap recovery fallback dst_missing dst_repeated sample valid filter stale_after recover_after samples min max step access label has`.
   - Built-in types: `Bool Int Number Percent Duration Result SensorFault Expr Date TimeOfDay DateTime TimeSlots WorkCalendar HolidayCalendar TidePredictions LunarEphemeris BoolActuator Event ClockFault CalendarFault TemporalContextFault AccountingFault OutputStatus …` and the physical-quantity types.
   - Built-in callables: `number int_exact int_floor int_ceil int_trunc int_nearest_even elapsed median hysteresis debounce date time datetime cron5 sun tide day moon continuous_true instant civil on_time count_events local_day_is calendar_is tide_is moon_is used rolling local_day hold_last map and_then recover output_status …`.
2. **Product, format, and standard names stay as-is:** GhostFlow, GFB (GFB5, GFB10 …), WASM, ABI, C ABI, AST, IR, CLI, JSON, YAML, Markdown, PlantUML, Mermaid, Rust, Node.js, PLC, MCU, GPIO, RS485, ESP32, Waveshare, PI/PID, EMA, VPD, DST, UTC, Cron/`cron5`, `.ghost.md`, `@ghostflow/cabinet-view`, D-numbers (D6, D9), R-numbers (R14–R17), and example IDs (E01, PC-03).
3. **Keep-as-is column legend:**
   - **Yes**: never translate; this is code, a name, or a format.
   - **Term**: keep the English term in prose, optionally with a short gloss in parentheses on first use. Example: ko “tick(논리 판단 단위)”.
   - **No**: translate with the given rendering. On first use in a document, you may add the English in parentheses for searchability. Example: ja “安全意図（safe intent）”.
4. **Prose versus code form.** When a keyword names a concept in prose, write the keyword in code form and add a translated head noun. Examples: ko “`input` 선언”, zh “`input` 声明”, es “la declaración `input`”, ja “`input` 宣言”.
5. **Use one rendering per document.** Do not alternate synonyms. This applies especially to pairs such as constraint/limit, evidence/rationale, observation/measurement, and commit/confirm.
6. **Keep stage names distinct.** `requested`, `safe`, `applied`, and `confirmed` are four different stages. Never render two stages with the same word. In particular, *commit* (state is fixed by a tick) ≠ *confirmed* (feedback shows the physical result).

### Execution model and language core

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

### Outputs, intent, constraints, and safety

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

### Industrial control (PLC practice)

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

### Sensors, signals, and value quality

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

### Time, schedules, and accounting

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

### Settings, observation, and explanation

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

### Composition, replay, evidence

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

### Source documents and authoring

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

### Runtime, toolchain, and hardware boundary

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

### Application domain (examples)

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

### Normative words

English documents use lowercase normative words; uppercase RFC 2119 forms do not occur in the docs. Preserve strength exactly. Never weaken *must* into *should*, and never turn a prohibition into a recommendation.

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

If the English file bolds or italicizes a normative word, keep the same emphasis in the translation. Descriptive statements of language behavior, such as “Constraints do not turn false into true”, are facts. Translate them as plain indicative sentences, not as recommendations.

## Checklist

Before you stamp a document:

- [ ] Every fact, limit and example from both English and Korean is present and
      correct.
- [ ] Headings, anchors, front matter and code blocks match the source file.
- [ ] Glossary terms are used consistently.
- [ ] New diagrams are rendered, committed and have alternative text.
- [ ] Tests that pin the document still pass.
- [ ] `npm run docs:index` and `npm run docs:check` pass.
