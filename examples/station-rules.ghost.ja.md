<!-- translation-source: examples/station-rules.ghost.md -->
[英語の原文](station-rules.ghost.md)
> 閲覧用の翻訳です。コンパイルには、リンク先の原本 `.ghost.md` ファイルを使用してください。

# 共有ステーションのポリシー

この正本の文芸的（literate）文書は、1 台の共有ポンプについて、ホストが所有するステーションの制限とモードのインターロックを宣言します。これは有界な **Station アダプタプロファイル**です。つまり、`ghostrules` と `bindStationPolicy` が利用する、固定された有限のルールセットです。control が所有する汎用的な制約の文法ではありません。

このプロファイルには具体的な利用者が 2 つあります。ステーションのデモと、プログラミングブックの Station WASM テストです。このプロファイルは、それらの利用者が引き続き動作するように維持されています。任意の共有リソースの出力ポリシーを可能にするものではありません。

ホストは次のものを明示的にバインドしなければなりません。

- station、pump1、settings、starts の同一性
- モードとアクティビティの別名
- 有限のバルブ数の設定

完全なバインディングと実行可能な Station のライフサイクルは、`tests/programming-book-simulation.test.mjs` と `tests/policy.test.mjs` で検査されます。停止の振る舞いは固定された Station 契約が所有しており、このソースは汎用的な物理的安全シーケンスを定義しません。`check pump_capacity` は助言のためだけのものです。
1 つの control が所有する完全なローカル包絡については、[constraint-envelope.ghost.ja.md](constraint-envelope.ghost.ja.md) を参照してください。

`Station::session_actual_on_ms(session_id)`（Rust）と WASM ラッパーの `sessionActualOnMs(sessionId)` は、一致するアクティブなセッションについて、適用済みのポンプ ON 時間の累計をミリ秒単位で読み取ります。

- WASM の結果は厳密な `BigInt` です。
- このゲッターは時間を進めません。`advance` を含む既存のタイムスタンプ付き Station 操作が、ホストの `reportApplied` 状態を積算します。
- OFF の間隔があってもセッションの合計は保持されます。たとえば、10 秒 ON、10 秒 OFF、その後 20 秒 ON の場合、時刻 40,000ms で `30_000n` になります。
- `dailyUsedMs` は、セッションが永続的に終了するまで確定しません。
- 欠落した、一致しない、終了した、または復元されたセッションに対して 0 を返すことはありません。Rust は `SessionMismatch` を返し、ラッパーは例外をスローします。
- 復元では、既存の保守的な予約と復旧の契約が維持されます。アクティブなセッションのカウンタは復元されません。

この観測は、有界な Station アダプタだけに属します。汎用的なジョブカウンタ、フェーズの経過時間、連続 ON タイマー、あるいは要求された出力・安全な出力・確認済みの出力の使用量計上（アカウンティング）を定義するものではありません。ホストテストにおける適用済みの状態はフィクスチャであり、物理フィードバックではありません。[リファレンス §3.4](../docs/reference/03-time-and-schedules.ja.md) で示されている区別は、[#208](https://github.com/callin2/ghostflow-language/issues/208) のもとで引き続き別の契約として扱われます。

```ghost
constraints StationRules {
  exclusive(automatic, manual, configuring);

  allow enter(Auto, Manual, Configure)
    only when mode == Stopped && stopped(station);
  allow apply(settings)
    only when mode == Configure && stopped(station);

  require count_on(pump1.valves) <= 2;
  require pump1.on => any_on(pump1.valves);
  limit on_time(pump1) <= 1h per day("Asia/Seoul");
  once starts per occurrence;
  check pump_capacity(pump1);
}
```
