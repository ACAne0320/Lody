# 对齐已恢复的 ACP gitlink 与依赖锁

Status: implemented
Translation: current

[English](2026-10-13-selected-acp-lock-closure.md)

## 摘要

main c10ca856 已恢复四个兼容 ACP gitlink，并保留已发布 runtime 清单。后继 a4270dd8 的锁仍是较新 Claude/Codex importer，完整固定子模块的 frozen 安装报告反向的九项 Claude 不匹配。本修复沿用原维护者恢复的 gitlink：仅还原其此前兼容的 importer，并补精确缺失的 resolution/snapshot 闭包。其他 importer、当前 main 已有 package/snapshot 值、catalog、overrides、等待期例外、Spec 和 gitlink 全部保留。

## 证据与边界

早期 main567afa 候选针对当时选定的较新适配器；原维护者的 main 修复已替代该版本选择。当前相对 main 的 diff 不含新版本等待期例外，也不含已失效的历史链接改动。递归只解析恢复的两个 importer 所需依赖，已有定义沿用 main，仅缺项取此前兼容 main567afa 的闭包，包含平台 alias。原失败及中间候选证据与最终完整 frozen 安装分列。最终组合 root/build/smoke 和远端 CI 各有准确版本与结果；此锁修复不授权 runtime 上传、新协议或生产启用。

main1535 已声明 providerRateLimitsRefresh 版本1，但机器注册的穷举期望表遗漏此键。本修复补该显式期望，保留整表严格相等断言；不改生产协商或行为。
