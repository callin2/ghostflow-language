<!-- translation-source: examples/curriculum/pc-03-motor-contactor.ghost.en.md -->
[英語の原文](pc-03-motor-contactor.ghost.en.md)
> 閲覧用の翻訳です。コンパイルには、リンク先の韓国語の原本 [`pc-03-motor-contactor.ghost.md`](pc-03-motor-contactor.ghost.md) を使用してください。

# PC-03 — モーター接触器のコマンドと過負荷の許可

<!-- ghostflow:anchor id=GF-INT-PC03-MOTOR-PERMIT-REARM-V1 kind=intent status=confirmed origin=imported -->
> 学習シナリオ：PC-02 の自己保持動作に、モーターの過負荷保護による許可を追加する。この文書はカリキュラムの学習シナリオを定義するものであり、ユーザーの発言を直接引用したものではない。

リンク先の韓国語の原本が、PC-03 の唯一の正本となる、文芸的で実行可能なソースです。PC-02 の新たな起動イベントと再起動の抑止を再利用し、レッスン [E03](../../docs/ProgrammingInGhostflow.ja.md#ch03) の基本的な自己保持の例はそのまま残します。

`stop_ok` と `overload_ok` は、意味がすでに正規化された許可入力です。`true` は、停止経路または過負荷保護が運転を許可していることを意味します。実際の停止ボタンと過負荷リレー（サーマルリレー）の b接点配線や接点極性は、電気設備とデバイスアダプタに属します。この学習例が受け取るのは Bool 値だけです。

この入力品質を明示するリビジョンでは、正常入力のリプレイは変わりません。取得故障については次のとおりです。

- 利用できない START 要求は、`control` を起動することも再アームすることもできません。STOP と保護が正常で運転を許可している間は、既存の運転は継続できます。
- 利用できない STOP 入力または保護入力は、許可を取り除きます。
- 復旧後は、正常な START の解放と、それに続く新たな START 要求が必要です。

以前のソースは、実行不可能な履歴として `tests/fixtures/history/issue531/pc-03-motor-contactor.ghost.en.md.pre-input.txt` に保存されています。

```ghost
// Source revision: issue531-approved-fault-restart-v1
control MotorContactor {
  input start, stop_ok, overload_ok: Bool;
  output motor_contactor: Bool;

  // ghostflow:link id=GF-INT-PC03-MOTOR-PERMIT-REARM-V1 relation=implements
  state armed: Bool = false;
  // ghostflow:link id=GF-INT-PC03-MOTOR-PERMIT-REARM-V1 relation=implements
  state running: Bool = false;

  let start_good = case start { ok(_) => true; fault(_) => false; };
  let start_value = start |> recover(false);
  let stop_ok_good = case stop_ok { ok(_) => true; fault(_) => false; };
  let stop_ok_value = stop_ok |> recover(false);
  let overload_ok_good = case overload_ok { ok(_) => true; fault(_) => false; };
  let overload_ok_value = overload_ok |> recover(false);

  let permit = stop_ok_value && overload_ok_value;
  let start_event = start_good && armed && start_value;

  running' = permit && (start_event || running);
  armed' = start_good && permit && !start_value;

  motor_contactor <- running';
}
```

`motor_contactor` は、MC（電磁接触器）のコイルに送られる論理コマンドです。主接点が閉じたこと、モーターに通電されていること、回転していることを証明するものではありません。

運転中に過負荷リレーがトリップすると（`overload_ok=false`）、同じ tick で次状態とコマンドがオフになります。保護が復旧しても、START を押し続けているだけでは `control` はアームされないため、モーターがひとりでに再起動することはありません。新たな起動を許可するには、START をいったん離してから押し直す必要があります。

設備では、2 つの回路は次のとおりです。

- **主回路：** ブレーカーから MC の主接点と過負荷リレーを経てモーターに至る電力経路。
- **制御回路：** 制御電源から、STOP 接点と過負荷保護接点、および START と MC 補助接点で構成される自己保持回路を経て、MC コイルを励磁する経路。

ソフトウェアによるコイルコマンドは、独立した電気的な過電流保護、非常停止、保護機能の代わりにはなりません。

この例には、アラーム出力、故障ラッチ/リセット、タイマー、センサフィードバック、ハードウェア動作、新しい GhostFlow 構文はありません。これらはカリキュラムの後の段階で個別に扱います。

`tools/check-pc-03.mjs` は、現在のコンパイラと既存の WASM ランタイムを使って、仮想/コンパイラ/WASM の学習用証拠を生成します。その結果には、リレー、MC 主接点、モーター電源、モーター回転に関する物理的な証拠は含まれません。
