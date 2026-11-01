<!-- translation-source: docs/TRACEABILITY.md -->
[英語の原文](TRACEABILITY.md)

# 言語の実装と検査

このページでは、言語の各契約を、それを実装するコードと、それを検査するテストに対応付けます。

このページが示すのは、保持されているテストが**どこに**あるかだけです。それらのテストが成功したかどうかは示しません。どの検査が実行され成功したかを確認するには、現在のチェックアウトの[検証レポート](VERIFICATION.ja.md)を参照してください。また、この表は、元のワークスペースにおける完了や実機に関する主張を引き継ぐものでもありません。

| 契約 | 実装 | 検証 |
|---|---|---|
| モダンな`control`構文、型、ローワリング | `tools/control.mjs`, `tools/gfb1.mjs` | `tests/control.test.mjs`, `tests/compiler.test.mjs` |
| 文芸的（literate）ソースの抽出と元の位置 | `tools/literate.mjs`, `tools/toolchain.mjs` | `tests/literate.test.mjs`, `tests/toolchain.test.mjs` |
| 検証済みのVM／状態／意図のセマンティクス | `crates/ghostflow-core/src/lib.rs` | Rustの単体テスト、ネイティブ／WASMのチュートリアルパリティ |
| 型付きのホスト入力とマニフェスト／ハッシュの検査 | `runtimes/wasm/control-runtime.mjs` | `tests/control-host.test.mjs` |
| センサのコンディショニングと信号 | コアの`signals.rs`、WASMのsignals ABI／アダプタ | Rustのテスト、`tests/signals-wasm.test.mjs`、土壌水分チュートリアル |
| 単独の制約とバインディング | `tools/constraints.mjs`, `runtimes/wasm/policy.mjs` | `tests/constraints.test.mjs`, `tests/policy.test.mjs` |
| スケジュールの発生と固定ID | WASMのschedule／admissionアダプタ | `tests/schedule.test.mjs`, `tests/scheduled-admission.test.mjs` |
| ステーションの所有権、割り当て量、永続化 | コアの`station.rs`、WASMのstation ABI、Nodeの台帳 | Rustのテスト、`tests/station-wasm.test.mjs`、`tests/ledger.test.mjs`、ステーションデモ |
| ネイティブ／WASMで同一の生成入力トレース | `tools/tutorial.mjs`、コアのネイティブランナー | チュートリアルのアサーションと生成されたトレース |
| リリースの同一性と実行の証拠の区別 | `tools/integration-contract.mjs`, `contracts/integration-v1` | `tests/integration-contract.test.mjs`（架空のフィクスチャ） |

次の2種類の検査は、このリポジトリの外にあります。

- プロジェクト横断のリリースの来歴と、デバイス／API／フロントエンドの検査は、統合プロジェクトと利用側プロジェクトに属します。
- 元のタスクと会話の履歴は、非公開の移行用ワークスペースに保管されています。
