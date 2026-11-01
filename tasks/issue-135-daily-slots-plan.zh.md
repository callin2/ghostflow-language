<!-- translation-source: tasks/issue-135-daily-slots-plan.md -->
[英文原文](issue-135-daily-slots-plan.md)

# Issue 135：字面量 DailySlots 执行

跟踪：https://github.com/callin2/ghostflow-language/issues/135

**状态：** 全部四个步骤均已完成。

## 范围

- **目标：** 通过共享的 Rust 调度计划运行时执行未修改的 `REF-03-032`。
- **已支持：** 使用 `pulse`、`trusted_only`、`baseline` 和 `skip` 的字面量 `DailySlots<15min>` 选择。
- **尚不可执行：** 由 config 选择的 `REF-03-057` 在按键设置编辑和持久化实现之前，仍是不可执行的描述符。

## 步骤

1. [x] 为字面量 DailySlots 描述符和稳定的字面量时段键加入 GFB9/control-v8。
2. [x] 用源日期、时段键和 DST 折叠（fold）扩展 Rust 调度事实和准入身份标识。谓词、跨越、终态账本和事务的所有权仍归 Rust。
3. [x] 加入 GFSF v3、公共 WASM 和 ghostsim 集成，并使用显式的提供方事实。拒绝缺失、陈旧、格式错误以及由调用方计算的结果。
4. [x] 通过 native、WASM 和模拟器测试证明未修改的 Reference 源，包括有界容量和原子回滚。

不在范围内：Device 修订版、物理输出声明，以及对 Reference 源或预期的修改。
