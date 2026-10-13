# 修复已选 ACP 依赖的锁闭包

Status: implemented
Translation: current

[English](2026-10-13-selected-acp-lock-closure.md)

## 摘要

main 567afa18 已选 Claude 2ff63b6、Codex aae32a2，但依赖 importer 仍旧，完整固定子模块的 frozen 安装因此在测试前失败。仅对齐这两个 importer 并补其必要 package/snapshot 闭包；保留其他 importer、已有依赖解析、catalog、overrides、gitlink 和七天发布等待规则。等待规则只增加这两个 manifest 已选版本及配套平台/Vitest 包的精确例外。

## 验证与边界

原完整子模块 frozen 安装报告九项 Claude specifier 不匹配；Codex 也改变了声明的 Codex 版本范围，并增加 cross-spawn 依赖。最终修复锁在全部八个固定 gitlink 上实际 frozen 安装通过。候选锁生成只是准备，不能冒充 frozen 安装证据。生成器带来的无关 peer/importer 漂移已丢弃，原条目及旧闭包全部保留。root 检查与最新 main 的 E2EE 组合验证另记准确版本和退出码。本依赖修复不批准新 E2EE 协议或生产启用。

所选 Codex gitlink 删除了规划命令 Spec 引用的 ACP v2 生命周期测试。证据保留为原公开 b67f2ea commit 的固定链接，并明确标为历史；不宣称当前覆盖，也不改 draft 约束。
