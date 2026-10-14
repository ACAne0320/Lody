# 公共 E2EE 实现与 Lab 归属

Status: proposed
Translation: current

[English](2026-10-11-e2ee-complete-migration.md)

## 摘要

原型包含公共 main 尚缺的协议与 Lab 行为，也保留过期格式及可复现的信任和生命周期失败。本次给每个源文件明确公共归属，或列为淘汰、待决策、关联工作，继续复用已有的安全基础。公开架构文本作为草案迁入，私有计划和生产资料留在来源仓。实现按依赖建立 Draft 层；永久丢失备份、恢复库编码和原子移除编码仍需决定。

## 职责与证据

[迁移指南](../../../docs/e2ee-migration.zh.md)负责层次、共享文件、决策与验收边界，[manifest](../../../docs/e2ee-migration-manifest.json)记录原 core/候选指纹及逐文件去向。本次扩展[基础提取](../../implemented/architecture/2026-10-10-e2ee-foundations.zh.md)，不恢复候选的整套导出或复制另一套 core。[白皮书](../../../../specs/e2ee/whitepaper.zh.md)与[权限草案](../../../../specs/e2ee/permission-ledger.zh.md)保留设计意图，不宣称人类批准或当前产品行为。

候选暂存补丁仍为 SHA-256 `4c36a1e507f2e7bcc55e9e88906ffe2b617e9d9c9aed55ab5e76745bd4d7ee71`。独立选定审查套件用真实密码学、本地 HTTP/SQLite 复现核心七项、Lab 两项失败。旧 fail 证据留在公共仓外，对应新行为回归进入实施层。不提交捕获对话或私有恢复材料。

submission #1434 仍归原作者，SDK 准备 #1433 此后已合入。新底层基于包含 #1432 的实际公共 main，不复制并行未合代码。私有云端/生产和平台工作分别列所属仓关联栈。

## 结果与边界

文档基线和完整来源清单已实施，库/Lab 后续层尚未完成。一套公共实现避免漂移，但必须把来源工作流适配到现有不透明授权与字节所有权。旧协议只保留固定来源作历史，不悄悄恢复 MLS、JSON/hex Team 或非原子 tag2 移除。Scope 创建、取消、等待关闭和失败清理是验收要求，不会因迁类型自动成立。

文档检查与旧失败复现不证明整栈 CI、生产 E2EE、原生存钥、断电/永久丢失恢复或全平台验收。允许 Draft，不自动 Ready、merge、deploy 或 publish。

验证：公共 core 113 项测试与类型通过，docs check、public/platform boundary 通过，root format 通过且无无关改动。root check 完成类型/lint 后停在未改的 CLI native Git fixture（`context_unreadable`）；CLI 3723 过、1 败、4 跳过。不宣称余下 root 阶段全绿。

文档底层：[Draft PR #1438](https://github.com/LodyAI/Lody/pull/1438)。
