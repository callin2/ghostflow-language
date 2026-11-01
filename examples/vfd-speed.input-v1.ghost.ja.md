<!-- translation-source: examples/vfd-speed.input-v1.ghost.md -->
[英語の原文](vfd-speed.input-v1.ghost.md)
> 閲覧用の翻訳です。コンパイルには、リンク先の原本 `.ghost.md` ファイルを使用してください。

# VFD 速度 — 入力を明示したリビジョン

<!-- source-revision: issue531-input-quality-vfd-v1 -->

start と stop は、押されている間 true です。生成元はポテンショメータの観測値をボルト単位で供給します。想定する動作範囲は引き続き 0〜10 V です。速度は引き続き Run から独立しています。この仮想の例は、既存の正常時のレベル検出型ラッチを維持します。利用できない START は運転を開始できず、利用できない STOP は Run を禁止します。これらは生成元の品質を扱う明示的なソース上の分岐であり、物理的なボタンの診断ではありません。速度表示は 0 V から始まり、品質が利用できないときは最後に受け付けた観測値を記憶します。この表示の初期化は、合成された Good サンプルではありません。以前のソースとシナリオは、過去の証拠としてそのまま残されています。

```ghost
control VfdSpeed {
  input start, stop: Bool;
  input potentiometer_v: Number;
  output run: Bool;
  output speed_v, speed_hz: Number;
  state running: Bool = false;
  state observed_speed_v: Number = 0.0;
  // Preserve the existing healthy STOP priority and level-sensitive latch.
  running' = case stop {
    ok(stopped) => !stopped && (case start { ok(requested) => requested || running; fault(_) => running; });
    fault(_) => false;
  };
  run <- running';
  // Authored display memory is separate from producer acquisition evidence.
  observed_speed_v' = case potentiometer_v { ok(value) => value; fault(_) => observed_speed_v; };
  speed_v <- observed_speed_v';
  speed_hz <- observed_speed_v' * 5;
}
```
