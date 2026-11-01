<!-- translation-source: tasks/issue-135-daily-slots-plan.md -->
[英語の原文](issue-135-daily-slots-plan.md)

# Issue 135：リテラル DailySlots の実行

トラッカー：https://github.com/callin2/ghostflow-language/issues/135

**状況：** 4 つのステップはすべて完了しています。

## 範囲

- **目標：** 変更されていない `REF-03-032` を、共有の Rust スケジュールランタイムで実行すること。
- **サポート対象：** `pulse`、`trusted_only`、`baseline`、`skip` を伴うリテラルの `DailySlots<15min>` の選択。
- **まだ実行不可：** config で選択される `REF-03-057` は、キー付きの設定編集と永続化が実現するまで、実行不可能なディスクリプタのままです。

## ステップ

1. [x] リテラル DailySlots ディスクリプタと安定したリテラルスロットキーのために、GFB9/control-v8 を追加する。
2. [x] Rust のスケジュール事実と受け入れ（アドミッション）の同一性を、ソースの日、スロットキー、DST の fold で拡張する。述語、交差判定、終端台帳、トランザクションの所有権は Rust が保持する。
3. [x] 明示的なプロバイダ事実を伴う GFSF v3、公開 WASM、ghostsim の統合を追加する。欠落した結果、古い結果、不正な形式の結果、呼び出し側が計算した結果は拒否する。
4. [x] 変更されていない Reference ソースを、有界の容量とアトミックなロールバックを含め、ネイティブ、WASM、シミュレータのテストで証明する。

範囲外：デバイスのリビジョン、物理出力に関する主張、Reference のソースまたは期待値の変更。
