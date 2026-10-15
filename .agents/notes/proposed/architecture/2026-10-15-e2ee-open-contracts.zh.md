# E2EE 未决契约与未完成集成

Status: proposed
Translation: current

[English](2026-10-15-e2ee-open-contracts.md)

## 摘要

当前公开消费者没有完成白皮书全部行为，也没有建立生产 E2EE。未定决定保留在已有 draft Spec 中，不在每张 PR 的 Note 里重复拟议字段；缺失的接线与需要人类批准的决定分开记录。[当前决策记录](../../implemented/architecture/2026-10-15-e2ee-current-decisions.zh.md) 不批准下面任何选项。

## 需要审议的决定

| 归属 | 未定边界 |
| --- | --- |
| [原子移除](../../../../specs/e2ee/atomic-removal.zh.md) | 移除与换 epoch 同条记录、一次 CAS 已定；最终 operation/snapshot 编码和被认证的位置未定。不需要旧客户端 capability 或降级机制。 |
| [Recovery vault](../../../../specs/e2ee/recovery-vault.zh.md) | 派生/包装、并发 CAS/reservation、保留和恢复新鲜度仍是 draft；合法旧密文不证明最新状态。 |
| [发布者可恢复性](../../../../specs/e2ee/publisher-key-recoverability.zh.md) | 发布前独立备份与接受首次交付前丢失窗口之间仍未决定。受限 installed-key 保护不批准候选备份，也不能恢复管理身份。 |
| Snapshot 与 checkpoint 信任 | 内容 continuation 位置需要被认证；生产权限 snapshot 的资格/当前 checkpoint 来源未接通；显式合资格读取/启动消费者已实现。已有 update binding 或 SQL cache 不提供这些保证。 |
| 其他产品/协议范围 | Installed-history 产品范围、签名比较 notes、严格期限 B、基于 entropy 的精确 replay 各自需要决定。首次 seal 的安全随机和现行普通容忍没有改变。 |

## 尚未完成的集成

逐项去向归 [manifest](../../../docs/e2ee-migration-manifest.json)。剩余包括可恢复的 workspace 创建/checkpoint 持久化、独立 publisher 备份契约（本地耐久发布已实现）、受保护内容 snapshot、上游历史保留/恢复、原模型驱动的攻击与 replay 覆盖、机器执行和其他内容消费者、真实原生 protector 与产品组装。教程只有 Spec，没有已迁应用源码。这些缺口并非全是新协议决定；已定工作可以推进，不能发明未定部分。

本文不选择待定方案。Note、来源清单、合成测试或祖先 READY/CI，都不能代替人类批准或生产验收。
