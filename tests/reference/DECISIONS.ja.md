<!-- translation-source: tests/reference/DECISIONS.en.md -->
[英語の原文](DECISIONS.en.md)

# 当初の決定待ち 49 件がどのように確定したかの追跡

Reference の個別の受け入れケースを最初に書いたとき、そのうち 49 件の状態は `decision` でした。期待される意味が、まだ確定していない構文やポリシーに依存していたためです。現在、49 件はすべて確定しています。この表は、各ケースを、それを定義している現在の Reference の節と、現在それが検証されている形態に対応付けます。

現場固有の値は、決定待ちの構文では**ありません**。運転時間、許容される品質、デバイスの選択、ゲインなどがその例です。これらは、プログラムや設置の契約が明示的に記述する引数です。この区別は [Reference §8.6](../../docs/reference/08-language-runtime-and-device-boundaries.ja.md#86-言語の決定と作成者が選ぶポリシー) に従います。

表の読み方：

- **ID** — 受け入れケースの識別子です。`REF-NN-…` は Reference の第 `NN` 章に属します（`00` は [Language Reference](../../docs/LANGUAGE-REFERENCE.ja.md) の概要です）。
- **確定した決定の要旨** — かつての決定待ちを解決した規則です。
- **Reference** — 現在その規則を定めている節です。リンク先は各章の日本語訳です（正本は韓国語の章です）。
- **検証形態** — [受け入れテストの README](README.ja.md) で定義されているケースの状態です：
  - `executable`（41 件）：確定した構文に対するコンパイラの受け入れ/拒否ケースで、実際の CLI を通して実行されます。
  - `specified`（8 件）：入力、動作、期待結果が文書化された、ランタイム、環境、Driver、UI、ツールの契約です。有効な外部オラクルへのリンクがある場合に限り `externally-covered` として数えられ、それ以外の場合は TODO のままです。どちらの結果も、CLI の実行合格としては数えられません。

| ID | 確定した決定の要旨 | Reference | 検証形態 |
|---|---|---|---|
| `REF-00-010` | 再利用した 2 つのインスタンスは、記憶と来歴（provenance）を互いに分離したまま保持します。 | [docs/LANGUAGE-REFERENCE.ja.md §10](<../../docs/LANGUAGE-REFERENCE.ja.md#10-よい例を-2-つ見つけたらそれを一緒に使えること>) | `specified` |
| `REF-01-044` | 削除された purefn の別名は、fn として黙って解釈されることはなく、移行用の診断とともに拒否されます。 | [01-source-and-syntax.ja.md](<../../docs/reference/01-source-and-syntax.ja.md#16-代表的な記法参照用の別名過去の代替案>) | `executable` |
| `REF-01-045` | control の値宣言は、宣言の種類が異なっていても 1 つの名前空間を共有します。同じ名前を 2 回宣言することはできません。 | [01-source-and-syntax.ja.md](<../../docs/reference/01-source-and-syntax.ja.md#17-ソース規則の章の境界>)<br>[01-source-and-syntax.ja.md](<../../docs/reference/01-source-and-syntax.ja.md#名前のスコープと解決>) | `executable` |
| `REF-01-056` | 期待される数値型がない場合、整数の形をしたリテラルは Int であり、小数点または指数を持つリテラルは Number です。 | [02-types-expressions-state.ja.md](<../../docs/reference/02-types-expressions-state.ja.md#22-リテラルと期待される型>) | `executable` |
| `REF-01-057` | すでに確立した Number の文脈では、整数の形をしたリテラルは最初から Number です。実行時の Int から Number への変換ではありません。 | [02-types-expressions-state.ja.md](<../../docs/reference/02-types-expressions-state.ja.md#22-リテラルと期待される型>) | `executable` |
| `REF-01-058` | 型注釈のない let の初期化子の型を、後の使用箇所がさかのぼって変更することは決してありません。 | [02-types-expressions-state.ja.md](<../../docs/reference/02-types-expressions-state.ja.md#22-リテラルと期待される型>) | `executable` |
| `REF-01-059` | 期待される数値型が競合すると診断が出ます。コンパイラはオーバーロードを推測しません。 | [02-types-expressions-state.ja.md](<../../docs/reference/02-types-expressions-state.ja.md#22-リテラルと期待される型>) | `executable` |
| `REF-01-060` | Int リテラルは、元の 10 進の桁を使って符号付き 32 ビットの範囲が検査されます。負の境界で許可される値は -2147483648 だけです。 | [02-types-expressions-state.ja.md](<../../docs/reference/02-types-expressions-state.ja.md#22-リテラルと期待される型>)<br>[02-types-expressions-state.ja.md](<../../docs/reference/02-types-expressions-state.ja.md#23-厳密な整数の設計>) | `executable` |
| `REF-01-061` | 桁区切り文字は Int リテラルの契約に含まれません。 | [02-types-expressions-state.ja.md](<../../docs/reference/02-types-expressions-state.ja.md#22-リテラルと期待される型>) | `executable` |
| `REF-01-065` | Int/Number の変換は丸めのポリシーを名前で示し、小数部による原因と範囲外による原因を区別します。 | [02-types-expressions-state.ja.md](<../../docs/reference/02-types-expressions-state.ja.md#明示的な変換>) | `executable` |
| `REF-01-086` | if、&&、\|\| は左から右へ決定的に短絡評価されます。そのため、実行時の故障を発生させうる選択されなかった式が実行されることは決してありません。 | [02-types-expressions-state.ja.md](<../../docs/reference/02-types-expressions-state.ja.md#条件式>) | `specified` |
| `REF-01-092` | 通常の関数名は値として格納できません。言語は一般的な高階関数や実行時の関数選択を導入しません。 | [02-types-expressions-state.ja.md](<../../docs/reference/02-types-expressions-state.ja.md#27-純粋関数と計算の合成>) | `executable` |
| `REF-01-106` | Temperature、Pressure、FlowRate は、承認された単位サフィックス付きのリテラルを使います。 | [02-types-expressions-state.ja.md](<../../docs/reference/02-types-expressions-state.ja.md#29-物理量と単位>) | `executable` |
| `REF-01-107` | 異なる 2 つの名目上の物理量を比較すると拒否されます。 | [02-types-expressions-state.ja.md](<../../docs/reference/02-types-expressions-state.ja.md#29-物理量と単位>) | `executable` |
| `REF-01-108` | Percent の位置と RelativeHumidity は、画面上で似て見えても異なる名目型です。 | [02-types-expressions-state.ja.md](<../../docs/reference/02-types-expressions-state.ja.md#29-物理量と単位>) | `executable` |
| `REF-01-109` | 一般的な Date、TimeOfDay、DateTime の値は、それぞれ date、time、datetime のタグ付きリテラルを使います。DateTime にはオフセットが必要です。 | [02-types-expressions-state.ja.md](<../../docs/reference/02-types-expressions-state.ja.md#210-確定した型の境界>)<br>[03-time-and-schedules.ja.md](<../../docs/reference/03-time-and-schedules.ja.md#date-timeofday-datetime>) | `executable` |
| `REF-03-008` | date/time/datetime のタグ付きリテラルは、ミリ秒精度の厳密なグレゴリオ暦の値を生成します。DateTime には Z または -14:00 から +14:00 までの数値オフセットが必要です。 | [03-time-and-schedules.ja.md](<../../docs/reference/03-time-and-schedules.ja.md#date-timeofday-datetime>) | `executable` |
| `REF-03-015` | continuous_true(Bool) は、途切れずに true である区間を測定する公開のタイマー宣言です。経過時間とも、累積 ON 時間とも異なります。 | [03-time-and-schedules.ja.md](<../../docs/reference/03-time-and-schedules.ja.md#33-boolが連続してtrueである時間>) | `executable` |
| `REF-03-024` | trigger と basis は、型付けされた別々のフィールドです。Daily スケジュールは、timezone、DST、basis、when、clock、gap、recovery、fallback を明示的に記述します。 | [03-time-and-schedules.ja.md](<../../docs/reference/03-time-and-schedules.ja.md#35-scheduleの共通意味論>) | `executable` |
| `REF-03-036` | Periodic には、every に対する正の Duration、明示的な anchor と interval_change、そして共通のスケジュールポリシーが必要です。 | [03-time-and-schedules.ja.md](<../../docs/reference/03-time-and-schedules.ja.md#periodic>) | `executable` |
| `REF-03-038` | Cron には、分、時、日、月、曜日の順の cron5 リテラルに加えて、明示的な timezone、DST ポリシー、共通ポリシーが必要です。 | [03-time-and-schedules.ja.md](<../../docs/reference/03-time-and-schedules.ja.md#cron5>) | `executable` |
| `REF-03-050` | resource/event/account/used/rolling/local_day/limit の構文は、段階、永続化、予約を明示的に記述し、時間予算、イベント回数、occurrence once を別々に保ちます。 | [03-time-and-schedules.ja.md](<../../docs/reference/03-time-and-schedules.ja.md#310-時間に基づく使用制約>)<br>[03-time-and-schedules.ja.md](<../../docs/reference/03-time-and-schedules.ja.md#311-確立された時間構文と境界>) | `executable` |
| `REF-04-004` | below、map、and_then、recover は、互換性のある物理量を尊重し、Result のエラーを保持する純粋な変換です。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#41-sensorとresultの品質>) | `executable` |
| `REF-04-020` | debounce は、候補が正の安定 Duration の全体にわたって変化しない場合にのみ、安定値を変更します。安定値、候補、そして候補の単調時間での開始時刻を保持します。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#有界な信号演算の設計契約>) | `executable` |
| `REF-04-021` | moving_average(n) は、直近 n 個の有効な新しい数値サンプルだけを平均します。部分的なウィンドウは NotReady であり、状態は n 個に制限されます。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#有界な信号演算の設計契約>) | `executable` |
| `REF-04-022` | ema の alpha は有限で、0<alpha<=1 です。ema は最初の有効なサンプルから初期化され、復旧するまで健全な結果を生成しません。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#有界な信号演算の設計契約>) | `executable` |
| `REF-04-025` | condition for d は、正の Duration の全体にわたって、許容される true が途切れずに続くことを要求します。false または許容されない品質になるとリセットされます。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#44-時間的証拠temporal-evidence>) | `executable` |
| `REF-04-026` | within d は、基準イベントの後の半開区間の内側でのみ、条件が満たされたと認めます。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#44-時間的証拠temporal-evidence>) | `executable` |
| `REF-04-027` | average(x,d) は、品質を考慮したタイムスタンプ付きの観測だけを使います。まばらなサンプルを補間して、連続的な測定上の事実にすることはありません。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#44-時間的証拠temporal-evidence>) | `executable` |
| `REF-04-028` | min/max は、ウィンドウ内の許容される観測の極値だけを計算します。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#44-時間的証拠temporal-evidence>) | `executable` |
| `REF-04-029` | window_rate は、サポートされる順序付き数値ペイロードの 2 つの観測の差を経過時間で割ります。結果は式の中でだけ使える Rate<Q> であり、格納したり、制限のない算術演算に使ったりすることはできません。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#44-時間的証拠temporal-evidence>) | `executable` |
| `REF-04-031` | hold は、明示的な Duration と品質ポリシーの範囲内でのみ以前の値を保持し、Held の来歴を生成します。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#44-時間的証拠temporal-evidence>) | `executable` |
| `REF-04-035` | オプションのケイパビリティは、adapt 戦略の match の内側でのみ読み取られます。選択では、i32 の優先度が最大の match が 1 つ選ばれます。欠落がゼロや健全な値に変えられることは決してありません。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#45-オプションのセンサとケイパビリティ>) | `executable` |
| `REF-04-037` | where は、match したケイパビリティのメタデータと、定数の Bool の組み合わせだけを読み取ります。サンプル、状態、次状態、現在値を読むことは決してありません。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#46-デバイス照会と戦略選択>) | `executable` |
| `REF-04-044` | exclusive、allow enter、require、limit、once、check、warn は、それぞれ固有の適用段階と結果を持ちます。必須の制約はすべて AND で結合され、優先度によって緩和されることは決してありません。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#48-制約の共通表記と演算>) | `executable` |
| `REF-04-045` | count_on は最終候補の中の異なる物理的な項目を数え、any_on は明示的な有限集合を調べます。空集合に対しては、それぞれ 0 と false になります。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#48-制約の共通表記と演算>) | `executable` |
| `REF-04-050` | 同じ tick 内の要求は、1 つのスナップショットから、上限付きのキュー/期限切れと明示的なタイブレークのポリシーを使って、リースと予算をまとめて予約します。並行実行とプリエンプションはオプトインです。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#49-共有リソースと調停>) | `executable` |
| `REF-04-058` | 連続制御目標は、品質の測定値、互換性のある目標、意味上のアクチュエータの対象、コントローラのポリシー、そしてケイパビリティと交差させた出力範囲を結び付けます。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#412-連続制御目標>) | `executable` |
| `REF-04-059` | PI/PID は、正のサンプル周期、互換性のある有限値、方向、次元付きのゲイン、出力クランプ、アンチワインドアップ、有効化、バンプレス切り替え、故障、再起動の各ポリシーを明示的に記述しなければなりません。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#pipidの意味論に必要な項目>) | `executable` |
| `REF-04-061` | 縮退した fallback は、そのケイパビリティ、許容される品質、出力の範囲、権限を記述します。グローバルな制約、リソース、モードを迂回することは決してありません。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#413-明示的なフォールバックと縮退制御>) | `executable` |
| `REF-04-063` | 適応は、型付けされた設定/目標値に対する有界な提案であり、プログラムや出力に対する直接の権限ではありません。値、ソース/モデル、証拠、プログラム/設定の同一性を伴います。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#414-有界適応>) | `executable` |
| `REF-04-067` | Reference 04 で確定した制御の表面は、他の章が担う境界、つまりローリングでの使用量計上、一般的な物理量/品質、バインディング/設定のレコードと一貫性を保ちます。 | [04-sensors-constraints-control.ja.md](<../../docs/reference/04-sensors-constraints-control.ja.md#416-確定済みの制御構文と章の境界>) | `specified` |
| `REF-05-018` | 一時設定は 1 つの Program に結び付けられ、別の Program へ自動的に引き継がれることはありません。 | [05-settings-and-observation.ja.md](<../../docs/reference/05-settings-and-observation.ja.md#ライフサイクルと一時設定>) | `specified` |
| `REF-06-010` | 厳密なドキュメントダイジェストで固定されたインポートのインスタンスと型付きポートは、接続できます。 | [06-composition-and-replay.ja.md](<../../docs/reference/06-composition-and-replay.ja.md#64-importと接続の構文>) | `executable` |
| `REF-06-023` | 型付きの式マクロは、quote/splice の展開後に、通常の状態検査と型検査を受けます。 | [06-composition-and-replay.ja.md](<../../docs/reference/06-composition-and-replay.ja.md#610-syntaxquotespliceの構文>) | `executable` |
| `REF-08-013` | カレンダー/DST のプロバイダは、§3 の明示的なポリシーと同じ発生（オカレンス）の結果を供給します。 | [08-language-runtime-and-device-boundaries.ja.md](<../../docs/reference/08-language-runtime-and-device-boundaries.ja.md#86-言語の決定と作成者が選ぶポリシー>) | `specified` |
| `REF-08-014` | 型付きスロット設定のライブ変更と、運転時間の長さの変更は、それぞれ固有の型を保ちます。 | [08-language-runtime-and-device-boundaries.ja.md](<../../docs/reference/08-language-runtime-and-device-boundaries.ja.md#86-言語の決定と作成者が選ぶポリシー>) | `specified` |
| `REF-08-015` | 状態の初期化と通常の config の永続化は別々の関心事です。停電していた時間は elapsed に加算されません。 | [08-language-runtime-and-device-boundaries.ja.md](<../../docs/reference/08-language-runtime-and-device-boundaries.ja.md#86-言語の決定と作成者が選ぶポリシー>) | `specified` |
| `REF-08-016` | 設置のバインディングと Driver の配備フォーマットは、ソース文法の外側にある環境の契約です。 | [08-language-runtime-and-device-boundaries.ja.md](<../../docs/reference/08-language-runtime-and-device-boundaries.ja.md#86-言語の決定と作成者が選ぶポリシー>) | `specified` |
