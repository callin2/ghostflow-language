<!-- translation-source: .github/pull_request_template.md -->
[英文原文](pull_request_template.md)

## 问题与变更后的行为

Issue / 契约 ID 及所需文档路径：
确切的 base SHA / candidate SHA / 源文件与 fixture 路径：
允许的范围与前提条件：

## 独立 oracle 与验证

预期结果及其权威来源（不得由本实现生成）：
变更前 / 变更后的命令、退出码、结果，以及确切的产物/报告标识：
边界 / 失败情况，以及刻意削弱保护后的结果：
回归检查与剩余限制（宿主 / Device / 物理）：

## 分别审查变更的证据

- [ ] 我已将任何保护规则的删除或削弱，与预期值的修改分开审查。
- [ ] 我已审查 oracle 的变更、丢失的断言、被删除/跳过/标记为 todo 的测试，以及 runner 列表的变更。
- [ ] 我已审查 requirement status、testIds、locator digest 和 pendingReason 的变更。
- [ ] 我已说明实现与其测试共享同一误解的风险；native/WASM 一致只是可移植性证据。
- [ ] 任何合理的规范变更都引用了权威证据，并经过单独的语义审查。
- [ ] 相关的双语文档/变更日志以及必需的仓库检查关卡保持完好。

参考：[有界贡献包](../docs/AI-CONTRIBUTION-PACKAGE.zh.md)。
