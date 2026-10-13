# Effect lint 接入

Status: implemented
Translation: current

实施 PR: [#1530](https://github.com/LodyAI/Lody/pull/1530)

[English](2026-10-13-effect-lint-integration.md) | 中文

## 摘要

现有 type-aware lint 不检查 Effect 特有错误，quiet 模式也会隐藏建议规则。新增的独立 Effect lint 命令及隔离工具包通过现有静态检查路径显示五条官方正确性规则和一条社区函数风格规则的警告。工具锁定兼容版本并经过 patch，不改变 TypeScript 或 Effect runtime 版本。初始策略采用建议级别，展示诊断基线而不把接入扩展成全仓代码迁移，也不代表已经证明完整的生命周期正确性。

## 决策

`lint:effect` 选择独立配置，禁用嵌套配置发现，并在执行前 patch Oxlint。实际安装依赖的 workspace 也在 prepare 时对工具包的二进制执行 patch；重复这一幂等步骤支持跳过 lifecycle scripts 的安装方式。普通 lint 和快速 lint 保留现有版本及配置。runner 通过 `OXLINT_TSGOLINT_PATH` 显式选择工具包的 type-aware 引擎，避免误用根目录的旧引擎。嵌套 checkout 执行实际安装依赖的父 workspace 的 Effect lint 命令，不安装第二套依赖存储。

锁定 `@effect/tsgo@0.48.1`、`oxlint@1.86.0`、`oxlint-tsgolint@7.0.2003` 和 `effect-rules@0.3.5`，与官方支持版本表匹配。所选版本均满足现有发布时间等待期，不添加例外。`--no-typescript --oxlint` 保留当前 TypeScript 编译器安装。

普通 Oxlint 升级会激活另外 22 条规则，也改变已有规则的行为，在同一源码上产生无关诊断。为避免关闭检查或修改产品代码，workspace 增加了具有独立依赖闭包的 `scripts/effect-lint`，仅 patch 该工具包的二进制。两套工具链均满足现有发布时间策略。

五条官方规则检查悬空 Effect、Effect 内执行 runner、裸 yield、generator 返回 Effect，以及返回 Promise 的 sync thunk。选择社区 `effect/prefer-effect-fn`，因为其可复用 generator 包装函数约定已经通过行为验证。不整体启用社区 preset，以免给普通代码和适配器引入超出本任务范围的约定。官方 `effecttsgo/` 与选定社区插件的 `effect/` 命名空间独立。

`check:quick` 和 `check` 执行新命令，不加 `--quiet`。CI scope selector 将新配置视为全量检查输入。排除生成代码及供应商 ACP workspace，覆盖维护中的 app/package 源码。先以 `warn` 展示警告，审查基线后再提升正确性规则的等级。[Effect 指南](../../../docs/cli-effect-ts.md#effect-lint)负责现行使用方式。

## 验证边界

`scripts/effect-lint.test.mjs` 在合成 TypeScript 项目上执行实际安装的 Oxlint，检查六条诊断代码及可见警告级别、严格执行的退出状态，以及合法的组合、顶层 runner 和普通代码。样例解析 CLI 消费包实际使用的 Effect 依赖。

初始隔离 Linux 实验验证了两个插件命名空间同时工作。`runSync` 包异步构造器仍不在这组规则覆盖范围内；[上游提案 #430](https://github.com/Effect-TS/tsgo/issues/430)不代表覆盖保证。context/error 缺口规则及其他平台仍需独立验证。本次不修改产品生命周期源码。
