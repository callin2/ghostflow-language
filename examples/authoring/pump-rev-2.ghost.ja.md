<!-- translation-source: examples/authoring/pump-rev-2.ghost.md -->
[英語の原文](pump-rev-2.ghost.md)
> 閲覧用の翻訳です。コンパイルには、リンク先の原本 `.ghost.md` ファイルを使用してください。

# 許可付きのポンプ要求

このファイルは、文書 `GF-EXAMPLE-PUMP` のリビジョン `rev-2-input-v1` です。[リビジョン 1](pump-rev-1.ghost.ja.md) の不完全な式を、診断が報告した文書上の正確な範囲で修正しています。ユーザーは 2 つのルールを確認しました。STOP が優先されること、そして許可がないとポンプの安全意図（safe intent）がブロックされることです。

<!-- ghostflow:anchor id=GF-INT-PUMP-REQUEST kind=intent status=confirmed origin=user -->
> START はポンプを要求します。STOP は要求を取り消します。

<!-- ghostflow:anchor id=GF-INT-PUMP-PERMIT kind=intent status=confirmed origin=user -->
> 許可がないときは、ポンプをブロックしなければなりません。

<!-- ghostflow:anchor id=GF-ASM-PUMP-MAX-RUN kind=assumption status=unconfirmed origin=ai -->
> 最大運転時間が必要になる可能性があります。その値と再起動ルールは提供されていません。タイマーを追加する前にユーザーに確認してください。

これは入力品質を明示する input-quality-v1 のソースリビジョンです。各入力は生成元の品質（`ok` または `fault`）を持ちます。不明な（故障した）要求は保存済みの要求状態を維持し、新しい要求を作ることは決してありません。既知の STOP、または既知の離された START は要求を取り消します。元のソースのバイト列と日付付きのベンチマーク証拠は別途保存されています。修正後の代入は `pump <- requested';` です。これによりポンプ要求は次の要求状態に従い、許可がない間は `require pump => permit` がそれをブロックします。

```ghost
control PumpRequest {
  input start, stop, permit_ok: Bool;
  output pump, permit: Bool;
  // ghostflow:link id=GF-INT-PUMP-REQUEST relation=implements
  state requested: Bool = false;
  let start_good = case start { ok(_) => true; fault(_) => false; };
  let stop_good = case stop { ok(_) => true; fault(_) => false; };
  let start_value = case start { ok(value) => value; fault(_) => requested; };
  let stop_value = case stop { ok(value) => value; fault(_) => false; };
  requested' = if stop_good && stop_value then false
    else if start_good && !start_value then false
    else if start_good && stop_good then start_value && !stop_value
    else requested;

  // ghostflow:link id=GF-INT-PUMP-PERMIT relation=implements
  state permission: Bool = false;
  permission' = case permit_ok { ok(value) => value; fault(_) => permission; };

  // ghostflow:link id=GF-INT-PUMP-REQUEST relation=implements
  pump <- requested';
  permit <- permission';

  // ghostflow:link id=GF-INT-PUMP-PERMIT relation=constrains
  require pump => permit;
}
```
