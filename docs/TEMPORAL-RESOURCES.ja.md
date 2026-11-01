<!-- translation-source: docs/TEMPORAL-RESOURCES.md -->
[英語の原文](TEMPORAL-RESOURCES.md)

# 時間的リソース計画

時間的リソース計画（temporal resource planning）は、メモリを確保する前に、時間的機能（ウィンドウ、保持サンプル、チェックポイント、リプレイ）が特定のターゲット上で何バイト必要とするかを教えてくれます。静的な計画は、ネイティブランタイムと両方のWASMアダプタで利用できます。

`GhostFlowRuntime`と`FramedGhostFlowRuntime`は、2つの同期呼び出しを公開しています。

- `planTemporal`はライブ実行を計画します。有効化の前でも動作します。
- `planTemporalReplay`はリプレイを計画します（[TEMPORAL-REPLAY.ja.md](TEMPORAL-REPLAY.ja.md)を参照）。対象となる保持レコードを持つ、アクティブな実行（run）が必要です。

```js
const plan = runtime.planTemporal({ profile, maxJsonBytes });
// After activation and successful ticks/scans:
const replayPlan = runtime.planTemporalReplay({ count, profile, maxJsonBytes });
const lastPlan = runtime.resourcePlan; // last successful report
```

呼び出し側は`profile`、`count`、`maxJsonBytes`を指定します。このページは、既定の周期、密度、予算を一切前提としません。計画は、静的で上限のあるメタデータを返します。時間的なサンプル、証明、チェックポイント用のアリーナを割り当てることはなく、tickを実行することもありません。リプレイの計画には、対象となる保持レコードを持つ、アクティブなframedまたはlegacyの実行が必要です。最初の計画呼び出しが成功するまで、`resourcePlan`はnullです。

**ライブ計画レポート。** 形式は`GhostFlow/temporal-resources-v1`です。レポートには次のものが含まれます。

- インストールされたモジュールのフィンガープリントと戦略
- ターゲットのポインタ幅
- ジャーナル容量、ウィンドウ数、保持サンプル
- 計上された時間的バイト数
- `fitsBudget`

予算と不正な入力の扱いは次のとおりです。

- 正だが不十分な予算に対しては`fitsBudget: false`を返し、必要な容量は引き続き報告します。
- 無効な事実と互換性のないリプレイバインディングは拒否されます。
- ターゲットの検査済み整数範囲をオーバーフローするジオメトリも拒否されます。より小さな要件へとラップアラウンドされることは決してありません。

**`accountedTemporalBytes`が数えるもの。** これはターゲット固有の、計上された上限値です。

| 含まれるもの | 除外されるもの |
| --- | --- |
| 密度リング、保持された観測、証明／ハイウォーターの容量、候補バンクと確定済みバンク、チェックポイント、射影、トレース／マーカーの上限、構築用スクラッチ、重複する計画メタデータ | アロケータのメタデータ、スカラー／モジュールのストレージ、JSON／レポートの出力、呼び出し側が所有するJavaScriptのコピー |

`targetPointerBytes`は、計算に使用されたターゲットのレイアウト幅を示します。

**リプレイ計画レポート。** 形式は`GhostFlow/temporal-replay-resources-v1`です。レポートには、対象件数、要求件数、ライブとゴーストのバイト数、戻り値とフレームのヘッダ、必要なピーク時間的バイト数、`ghostFitsBudget`が含まれます。バイト数の合計は、同時に存在するものすべて、すなわちライブとゴーストのジオメトリ、返されるコアレコード、framedのoutcomeを対象とします。ゴーストのジオメトリは、要求件数に等しいジャーナル容量を使用します。リプレイのJSON予算は、時間的アリーナの予算とは独立に制限されます。

**置き換えと拒否。** `resourcePlan`を置き換えるのは、成功した計画だけです。拒否された場合は、以前の計画、以前のリプレイ、ライブ実行、フレームシーケンス、outcomeが保持されます。

**WASMエクスポート。** WASM側の対応関数は`gf_plan_temporal`、`gf_plan_temporal_replay`、`gf_frame_plan_temporal`、`gf_frame_plan_temporal_replay`で、それぞれに対応するリソース計画のポインタ／長さのゲッターがあります。`maxJsonBytes`は、以前の計画バッファとその置き換え候補の合計を制限します。リソース計画のバッファは、リプレイ結果のバッファとは別です。

**範囲。** この契約は、測定された物理ウィンドウと派生ウィンドウを対象とします。推定された証拠、その他の時間的演算子、外部チェックポイント、Reference §6.8の完全なブランチ／ソースクロージャの同一性は、この契約の範囲外です。
