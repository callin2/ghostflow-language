<!-- translation-source: docs/SUNCALC-ATTRIBUTION.md -->
[英文原文](SUNCALC-ATTRIBUTION.md)

# 便携式太阳 provider 的 SunCalc 署名

`crates/ghostflow-core/src/solar.rs` 是
[SunCalc 2.0.2](https://github.com/mourner/suncalc/tree/v2.0.2) 中海平面日出/日落计算的
Rust 移植版本。它没有任何依赖。

移植范围：

- **已移植：** SunCalc 的 `getTimes` 路径及其视太阳坐标辅助函数。
- **未移植：** 月球计算和可变的自定义时间配置。
- **身份标识：** 移植版本沿用现有 JavaScript 参考适配器所使用的
  `suncalc-2.0.2/sea-level` 计算身份标识。

Copyright (c) 2026, Volodymyr Agafonkin. Redistribution and use in source and
binary forms, with or without modification, are permitted subject to the
conditions in the upstream BSD 2-Clause license. The complete retained license
notice follows.

（上述版权与许可声明保留英文原文。中文说明：版权归 Volodymyr Agafonkin 所有，2026 年。在满足上游 BSD 2-Clause 许可证条件的前提下，允许以源代码和二进制形式再分发和使用，无论是否经过修改。下方为保留的完整许可声明。）

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

**验证移植版本。** `cargo test` 会验证已签入的测试向量。你还可以选择验证这些 fixture
的来源：运行
`GHOSTFLOW_SUNCALC_REFERENCE_DIR=/absolute/path/to/suncalc node tools/compare-solar-reference.mjs`，
并让该变量指向一份明确的 SunCalc 2.0.2 本地软件包副本。该脚本会：

- 检查 JavaScript provider 是否恰好解析到该软件包；
- 检查软件包版本；
- 拒绝非有限（non-finite）结果；
- 同时覆盖 preview 和 polling 两组 fixture。
