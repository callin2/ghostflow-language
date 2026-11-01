<!-- translation-source: docs/TEMPORAL-DESCRIPTOR-ARTIFACT.md -->
[英文原文](TEMPORAL-DESCRIPTOR-ARTIFACT.md)

# 延迟的时间类构件

本页说明编译器为时间类（依赖时间和自然现象的）声明生成什么产物，以及产物在什么情况下**不可**执行。

**可执行的自然条件。** 对于 `tide_is` 和 `moon_is` 等自然条件，规范的 `.ghost.md`
编译器会生成可执行的 GFB11。配套的 `GhostFlow/control-v10` 清单（manifest）保留它们带类型的
provider 描述符（descriptor）。仅完成编译并不足以运行它们：

- 运行时激活需要一个显式的上下文 profile，其中包含已声明的 provider 绑定。
- provider 观测必须携带分类、覆盖范围、过期、不确定性、位置/时区以及修订版（revision）证据。
- 调用方不能直接提供受保护的 Result 投影。

**延迟的 `after_event` 声明。** 当执行契约不可用时，未被使用且没有显式投影的
`after_event` 声明会保留为经过检查的 `GhostFlow/temporal-descriptor-artifact-v1`。
这个 JSON 构件**不是 GFB 字节码**。它的载荷和配套清单都声明 `executable: false`。

**构件保留的内容。** 构件保留完整提取出的控制源码和带类型的描述符。常规的源文档封装保留精确的
文学式（literate）文本、其 SHA-256 以及源码位置。验证时会重新编译该规范源，并拒绝被改动的字节、
被改动的描述符清单以及被改动的源身份标识。

对于延迟的描述符，`requiredRuntimeContracts` 会列出缺失的执行边界：

- `identified-event-delivery` 和 `per-identity-result-projection`：标识一个没有可执行投影、
  且未被使用的 `after_event` 声明。

`ControlRuntime` 会拒绝延迟描述符清单。对于缺少所需上下文激活或 provider 绑定的可执行自然条件构件，
它同样会拒绝。仅凭编译不能证明运行时一致性，也不能证明已完成设备部署。

**可执行的 `after_event` 投影。**
[after_event WASM ABI](AFTER-EVENT-WASM-ABI.zh.md) 在一次控制事务中执行带标识的投递、原生的逐标识结果，
以及显式的 `after_event_any` 和 `after_event_all` 投影。使用其中任一投影的源码会编译为可执行的 GFB。
编译器绝不会为裸的或未被使用的信号推断投影。
