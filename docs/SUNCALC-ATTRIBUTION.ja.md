<!-- translation-source: docs/SUNCALC-ATTRIBUTION.md -->
[英語の原文](SUNCALC-ATTRIBUTION.md)

# ポータブル太陽プロバイダにおけるSunCalcの帰属表示

`crates/ghostflow-core/src/solar.rs` は、[SunCalc 2.0.2](https://github.com/mourner/suncalc/tree/v2.0.2)の海抜0m（sea-level）における日の出・日の入り計算をRustに移植したものです。外部依存関係はありません。

移植の範囲は次のとおりです。

- **移植済み:** SunCalcの`getTimes`経路と、その視太陽座標（apparent solar coordinate）用ヘルパー。
- **未移植:** 月の計算と、変更可能なカスタム時刻設定。
- **同一性:** この移植は、既存のJavaScript参照アダプタが使用しているものと同じ`suncalc-2.0.2/sea-level`計算同一性を保持します。

Copyright (c) 2026, Volodymyr Agafonkin. ソース形式およびバイナリ形式での再配布と使用は、改変の有無にかかわらず、上流のBSD 2-Clauseライセンスの条件に従う限り許可されます。保持しているライセンス表示の全文を以下に示します（原文のまま掲載します）。

```text
Copyright (c) 2026, Volodymyr Agafonkin
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of
   conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list
   of conditions and the following disclaimer in the documentation and/or other materials
   provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

**移植の検証。** `cargo test`は、リポジトリに格納されたテストベクトルを検証します。必要に応じて、フィクスチャの出所も検証できます。SunCalc 2.0.2パッケージの明示的なローカルコピーを指すように変数を設定して、
`GHOSTFLOW_SUNCALC_REFERENCE_DIR=/absolute/path/to/suncalc node tools/compare-solar-reference.mjs`
を実行してください。このスクリプトは次のことを行います。

- JavaScriptプロバイダが、まさにそのパッケージに解決されることを確認します。
- パッケージのバージョンを確認します。
- 有限でない結果を拒否します。
- プレビュー用とポーリング用の両方のフィクスチャを対象にします。
