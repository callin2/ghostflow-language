<!-- translation-source: CONTRIBUTING.md -->
[英文原文](CONTRIBUTING.md)

# 为 GhostFlow 做贡献

[English](CONTRIBUTING.md) · [한국어](CONTRIBUTING.ko.md) · 简体中文

本指南面向编码代理以及审查其工作的人。它是仓库规则的入口，而不是这些规则的替代品。完整规则请阅读：

- [`AGENTS.md`](AGENTS.zh.md)：所有权和语言约束。
- [`docs/DEVELOPMENT-WORKFLOW.md`](docs/DEVELOPMENT-WORKFLOW.zh.md)：任务规模划定、交接和证据复用。

简而言之，一次贡献分为四步：从 `dev` 开始，定义一个有界任务，同时修改代码和文档，并清晰地报告证据。

## 从当前开发分支开始

新工作从 `dev` 开始。编辑任何内容之前：

1. 确认仓库根目录和分支。
2. 用 `git rev-parse HEAD` 记录确切的 base SHA。
3. 检查 `git status`。

保留无关的变更。不要凭临时检出目录的名字去猜测其中的内容。

在阅读设计或实现文件之前，先搜索文档索引：

```sh
npm run docs:find -- --limit 8 QUERY
```

该索引只搜索路径和标题，不搜索全文。要搜索内容，请使用 `rg` 或打开匹配到的文档。如果索引过期或缺失：

- 在只读的探索阶段，报告这一情况。
- 在获得授权的文档工作中，在完成一批编辑后刷新索引。

## 定义一个有界任务

有些任务带有来自现场的 oracle（根据真实现场案例得出、独立于实现而规定的预期结果）以及有界的变异（mutation）证据。对于这类具体任务，请使用 [AI 贡献包](docs/AI-CONTRIBUTION-PACKAGE.zh.md)。Issue 和 PR 模板会记录它所需的最少标识、范围和独立证据。

开始之前，写下：

- 预期结果；
- 负责的文件或边界；
- 验收标准；
- 前提条件；
- 专门的验证命令。

将已完成、受阻和独立的工作区分开。不要添加请求并不需要的功能范围或清理工作。

**修复 bug：**

1. 在修改代码之前，先捕获一个会失败的复现。
2. 添加一个有意义的回归检查：没有修复时它必须失败。
3. 保持现有的测试 oracle 和仓库检查关卡完好。

对于语言行为，请保留规范的 `.ghost.md` 源以及 `AGENTS.md` 中描述的所有权边界。按照[开发工作流](docs/DEVELOPMENT-WORKFLOW.md#language-rule-changelog)中的说明，把语言规则变更以及改变可观察语言行为的 bug 修复记录到根目录的两个变更日志文件中。

## 代码与文档一起修改

做最小但完整的变更。在同一个任务中更新：

- 实现；
- 回归覆盖；
- 相关的英文和韩文文档。

各译文中的可执行示例保持完全一致。按照 [`docs/DOCUMENTATION-LANGUAGES.md`](docs/DOCUMENTATION-LANGUAGES.zh.md) 的要求更新已审查的哈希值和目录元数据。

要查看当前支持的范围及其证据，请使用 [`docs/REFERENCE-FEATURE-STATUS.md`](docs/REFERENCE-FEATURE-STATUS.zh.md)。实际的宿主检查关卡及其局限，请见 [`docs/VERIFICATION.md`](docs/VERIFICATION.zh.md)。运行相关的专门检查和必需的仓库 CI。不要为了通过而削弱或跳过任何检查。

CI 根据变更的文件选择验证路径：

| 变更 | CI 运行的内容 |
| --- | --- |
| 仅普通 README、贡献指南、目录、索引或 README 插图文件 | `docs:check` 和路径路由回归测试 |
| 代码、可执行示例、规范、契约、验证策略、混合变更或未知路径 | 完整的 current/frontend-pin 验证和覆盖率 |

确切的允许列表见[开发工作流](docs/DEVELOPMENT-WORKFLOW.zh.md)。仅文档的 CI 不会产出经过验证的 WASM 产物。如果需要该产物，请用确切的 `source_sha` 手动运行完整工作流。这种路由并不允许你跳过相关的本地检查。合并之前，最终的 `Verification result` 必须为绿色。

## 清晰地报告证据

向 `dev` 提交 pull request。说明用户可见的变更及其必要性。包括：

- issue 链接；
- 验证命令及其退出状态和结果；
- 剩余的限制。

说明哪些内容没有验证。不要暗示宿主测试能证明 Device、物理或农户层面的验收。如果某项检查无法运行，请报告确切的阻碍原因。

创建 issue 时，至少添加一个适用的模块标签，例如 `module:ghostflow-toolchain`。如果你无法添加标签，请请维护者代为添加。

维护者会把经过验证的变更从 `dev` 提升到 `main`。

任务或 pull request 请使用以下简洁的交接格式：

```text
结果：
范围与负责的文件：
已完成 / 受阻 / 独立：
验收标准：
前提条件与约束：
专门的验证命令：
返回：变更的文件、命令及结果、剩余风险或阻碍。
```

对于文档批次，先运行一次 `npm run docs:index`，再运行 `npm run docs:check`。其他适用的检查请参阅工作流和验证文档。
