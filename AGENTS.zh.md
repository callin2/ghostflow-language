<!-- translation-source: AGENTS.md -->
[英文原文](AGENTS.md)

# GhostFlow 语言所有权

这些是在本仓库中工作的 AI 编码代理和其他贡献者需要遵守的规则。开始任何任务之前，请先阅读第一部分。

**查找与维护文档**

- 按照[开发工作流](docs/DEVELOPMENT-WORKFLOW.zh.md)进行有界搜索、委派执行和证据复用。
- 使用 `npm run docs:find -- --limit 8 QUERY` 查找文档路径和标题。
- 完成一批文档编辑后，先运行 `npm run docs:index`，再运行 `npm run docs:check`。

**以语言参考为基准事实**

- 在进行任何语言、运行时、设置或 Interaction IR 相关工作之前，先阅读[语言参考](docs/LANGUAGE-REFERENCE.zh.md)。
- 它是语言理念、语法、语义和特性设计依据的共同基准事实。
- 不要在参考中写入实现状态和进度报告。
- 修改语言语义时，同时更新参考中的相关章节及其设计依据。

**在变更日志中记录语言变更**

- 每一项语言规则变更，以及每一个改变可观察语言行为的 bug 修复，都必须在同一个 PR 中记录到根目录的 `CHANGELOG.md` 和 `CHANGELOG.ko.md`。
- 遵循[语言规则变更日志流程](docs/DEVELOPMENT-WORKFLOW.md#language-rule-changelog)。

**评判输出生命周期之前先核实**

- 在评判 GhostFlow 的控制/输出生命周期、模拟器行为或 Device 输出故障策略之前，先阅读[参考 §4.7](docs/reference/04-sensors-constraints-control.md#47-requested-safe-applied-confirmed)和[物理时序](docs/LLM-TOOLCHAIN-ARCHITECTURE.md#physical-driver-and-device-boundary)。
- 区分命令结果的生命周期与请求意图（requested）、安全意图（safe）、已应用（applied）和已确认（confirmed）的输出证据。
- 在声称某项策略不存在或物理行为已经验证之前，先检查正在审查的 `farm-device` 固件的实际修订版。

**本仓库负责的内容**

本仓库负责 GhostFlow 的语法、解析、类型检查、降级（lowering）、GFB1 编码、可移植的 Rust VM/signal/station 引擎及其 WASM ABI，以及参考宿主适配器和一致性测试。当某项变更改变执行语义时，编译器和运行时的修改要放在一起。

## 边界

其他一切由其他仓库和模块负责。请遵守以下边界：

- **API 宿主。** API 宿主负责 LLM 请求、安装上下文、对话历史、源修订版存储和部署编排。LLM 编写一份完整的 GhostFlow 候选程序；本编译器在不依赖 LLM 或 API 服务的情况下对其进行校验。
- **Device 仓库。** Device 仓库负责固件、板卡 profile（设备配置档）、引脚映射、driver/renderer 集成、看门狗、时钟和物理 I/O。
  - 在明确的修订版上使用可移植核心。此处的变更并不意味着 Device 发布或硬件验证。
  - 输入驱动程序和输出渲染器的源代码属于 `farm-device-drivers`。渲染器把逻辑输出应用到继电器、电机、灯或屏幕上；机柜 UI 是 `@ghostflow/cabinet-view`。Device 负责宿主/板卡集成。
- **前端。** 前端负责农户交互和可视化。安装标签、能力（capability）和绑定是外部上下文。可执行规则属于带版本的 GhostFlow 源及其编译产物，而不属于另一份 JSON 程序。
- **参考适配器。** `runtimes/wasm` 和 `runtimes/node/ledger.mjs` 是参考适配器。它们可以校验清单（manifest），并提供生成的输入、调度计划的触发实例（occurrence）和持久化。表达式/状态/意图的执行留在共享的 Rust 核心中。

## 在本仓库中工作

**保持文档双语**

- 为编写的文档维护完整的英文版和韩文版。这包括理念、架构、规范、工具链指南、设计方案和教学示例。报告和执行证据可以只用一种语言。
- 保留现有源路径，并添加同级的 `.en.md` 或 `.ko.md` 译文。翻译后的示例只是阅读投影，绝不是新的规范编译输入。
- 在同一次变更中更新两个版本以及 `docs/translations.json` 中它们已审查的哈希值。每一项报告、生成产物或测试数据的排除也要在那里记录并说明原因。
- 运行 `npm run docs:check`。哈希值只确立新鲜度，并不代表语义翻译质量。
- 完整策略见 `docs/DOCUMENTATION-LANGUAGES.md`，英文/韩文文档目录见 `docs/DOCUMENTATION.md`。

**安全编辑，不越出范围**

- 使用 `apply_patch` 编辑源代码，并保留无关的工作。
- 不要向本仓库添加产品服务器、POC UI、凭据、模型连接器、板卡固件、设备调用或导入的对话记录。
- 测试必须在 `tools/verify-language.mjs` 中显式列出；绝不通过通配符去发现同级产品的测试。

**验证**

- 安装依赖和 WASM Rust 目标后，运行 `npm test` 进行宿主验证。它会在调用 Cargo 之前编译 Rust 测试所需的 fixture，构建 WASM/原生 runner，并执行语言测试和教程。
- 修改可运行的 FAQ 和编程示例时，要让它们保留在专门的 `tests/docs-runnable-examples.test.mjs` 编译器检查中。
- 编辑 `contracts/requirements/catalog.json` 引用的任何文件后，运行 `node --test tests/requirement-catalog.test.mjs`。行号移动时，重新定位未改变的摘录范围，并保留它们的预期哈希值。
- 使用 `npm run test:portable-package` 进行专门的包检查。它会在包回归测试之前运行快速的目录预检。

**保持证据分离**

- 在发布记录中保存源和产物的哈希值。
- 生成的验证与教程追踪是执行证据，位于被忽略的 `build/` 目录下，与源发布分开。
- 宿主验证要与 Device、API 和农户 UX 验证分开报告。

**保护历史基准**

- 绝不能仅仅因为一次合理的源变更导致 CI 报告标识漂移，就覆盖历史基准或其固定摘要。
- 将三件事分开：由检出文件派生的当前来源、独立固定的历史快照完整性，以及测得的行为比较。
- 修改哈希之前，先诊断这一契约。有意建立的新基准要保存在一个新的带日期的产物中。用回归测试覆盖来源变更和已存储记录被篡改的情况。
- 参见 [`docs/2026-09-24-authoring-baseline-provenance.md`](docs/2026-09-24-authoring-baseline-provenance.zh.md)。

**编程书变更时重新生成 PC-01 摘要**

- 编程书发生变更时，在验证之前运行 `npm run generate:pc01`。
- 该生成器只更新课程目录和重放清单中 PC-01 的当前源摘要。
- 重放帧、检查点、其他课程以及带日期的基准证据保持不变。对任何残留的不匹配要进行诊断，而不是重写它。

## v1 彻底切换：仅接受规范文学式源文件

- 这个 1.0 之前的工具链只接受规范的 `.ghost.md` 文学式（literate）文档作为产品编译输入。替代方案一经接受并验证，就删除被取代的现行源/API/回退（fallback）路径及其兼容性测试。
- 只有在明确批准的、具体的当前用户、数据或部署需求下才添加兼容性。历史原始材料可以作为明确隔离的证据保留，但绝不能作为可执行的回退。

## 自动构建标识 — System #199

正式构建从一个共享的在线分配器获取构建号。

**分配**

- `npm run build:wasm`、`make wasm`、`npm test` 以及直接的验证器命令，都会通过固定在 `scripts/vendor/BUILD-IDENTITY.json` 中的精确字节 System 工具在线分配构建号。
- 目前每个 Cargo crate 的基础版本都是 0.1.0。构建钩子在分配之前检查这一致性。将来若出现分歧，需要一份明确的产物基础版本契约。
- 不要手动选择编号，也不要绕过内部保护。
- 直接使用 Cargo 属于依赖/开发者编译，而不是正式的、带标识的交付。

**标识记录**

- 生成的 `build/build-identity.json` 将签发的完整人类可读构建版本绑定到实际输出的 SHA-256。
- 完整验证包含 native/framed 输出的哈希值，并把该标识复制到它的报告中。
- CI 打包会验证实际的 WASM SHA/源，并把同一标识写入交付清单。
- 运行时 ABI/导出保持不变。没有这些钩子的历史固定源不会被追加 ID。

**失败**

- 重新构建失败时，会在编译之前使先前的标识失效，并作废其编号。
- 不要在清理时删除仅存元数据的远程 `build-counter` 分支。
- 离线/只读的权威服务会在编译之前失败；绝不要猜测或重置计数器。

**测试与所有权**

- `npm run test:build-identity` 使用本地裸仓库权威服务和一个合成编译器，测试标识传播、失败作废和内部保护。它并不证明真实的 WASM 编译；现有的完整 CI 编译器/打包关卡负责证明这一点。
- 共享的规范分配器由 [System #199](https://github.com/callin2/farm_studio_system/issues/199) 负责。请保留其 vendored 字节/校验和。
- 源 SHA 只描述已提交的 HEAD。

**兼容性与标识符**

迁移导出保留编译器/运行时语义。格式或 ABI 的变更需要明确的兼容性决定和一致性测试。包版本、源语言 profile、GFB1 格式、清单格式和 Device 固件版本是各自不同的标识符。参见 `docs/IMPLEMENTATION.md` 和 `docs/VERIFICATION.md`。
