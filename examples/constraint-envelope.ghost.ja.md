<!-- translation-source: examples/constraint-envelope.ghost.md -->
[英語の原文](constraint-envelope.ghost.md)
> 閲覧用の翻訳です。コンパイルには、リンク先の原本 `.ghost.md` ファイルを使用してください。

# 完全なローカル出力包絡

このソフトウェアのみの例には、`control` がちょうど 1 つだけ含まれ、インポートも隠れたバインディングもありません。テストホストは 4 つの入力すべてを Bool の観測として供給します。4 つの出力はすべて仮想的な Bool の意図エンドポイントです。これらの仮想エンドポイントに限っては、`false` を非アクティブ値として明示的に選んでいます。この選択によって、任意の物理リソースにとって `false` が安全な振る舞いになるわけではありません。

要求（request）は目標を表します。そのうえで、ローカルの必須ルールが、どの出力を許可するかを制限します。ポンプには準備のできたバルブが必要であり、2 つの方向出力は同時にアクティブになってはなりません。これらのルールは自動/手動の調停ポリシーを選ぶものではなく、どの出力がハードウェアに到達したかを保証するものでもありません。

これは入力品質を明示する input-quality-v1 リビジョンです。生成元のデータが不明（故障）のとき、この例はその入力の最後の観測値を維持します。初期値 `false` は、このソース内ローカルな観測メモリを初期化するだけです。元の文書は別途保存されています。

```ghost
control OutputEnvelope {
  input observed_start, observed_valve_ready, observed_forward_request, observed_reverse_request: Bool;
  state remembered_start: Bool = false;
  let start = case observed_start { ok(value) => value; fault(_) => remembered_start; };
  remembered_start' = start;
  state remembered_valve_ready: Bool = false;
  let valve_ready = case observed_valve_ready { ok(value) => value; fault(_) => remembered_valve_ready; };
  remembered_valve_ready' = valve_ready;
  state remembered_forward_request: Bool = false;
  let forward_request = case observed_forward_request { ok(value) => value; fault(_) => remembered_forward_request; };
  remembered_forward_request' = forward_request;
  state remembered_reverse_request: Bool = false;
  let reverse_request = case observed_reverse_request { ok(value) => value; fault(_) => remembered_reverse_request; };
  remembered_reverse_request' = reverse_request;
  output pump, valve, forward, reverse: Bool;
  pump <- start;
  valve <- valve_ready;
  forward <- forward_request;
  reverse <- reverse_request;

  constraints LocalEnvelope {
    require at safe_output pump => valve;
    mutex(forward, reverse);
  }
}
```

`constraints LocalEnvelope` ブロックには 2 つのローカルルールがあります。各スキャンで、`control` はまず入力から*要求*出力（requested）を計算します。次にルールがそれらを、ホストが実際に受け取る*安全*出力（safe）へ射影します。

| 状況 | 入力 | 要求出力 | 安全出力 | 適用されるルール |
| --- | --- | --- | --- | --- |
| バルブ未準備 | `start=true`, `valve_ready=false` | `pump=true`, `valve=false` | `pump=false`, `valve=false` | `require at safe_output pump => valve` |
| バルブ準備完了 | `start=true`, `valve_ready=true` | `pump=true`, `valve=true` | `pump=true`, `valve=true` | ルールを満たすため、同じ要求が今度は許可される |
| 両方向を要求 | `forward_request=true`, `reverse_request=true` | `forward=true`, `reverse=true` | `forward=false`, `reverse=false` | `mutex(forward, reverse)` |

これはローカルな出力射影にすぎません。受け入れ制御（admission control）でも、汎用的な共有リソースの強制でもありません。それらの別個の段階と明示的なバインディング境界については、[制約契約](../docs/CONSTRAINTS.ja.md) で説明しています。
