# 公开 E2EE 迁移

[English](e2ee-migration.md)

本栈增加不自动运行的公开 core 和合成环境 Lab。E2EE 尚未上线，不兼容旧账本／数据／API；不会启用产品 E2EE 或迁移生产数据。

## 来源与归属

[manifest](e2ee-migration-manifest.json)保留全部380项固定来源、core/candidate SHA 与源导出清单。淘汰原实现不等于取消当前必要行为。原 source/design/candidate 只读。当前依赖以 package/lock 为准，不以旧检查点进度为准。

| 当前 owner | 职责 |
|---|---|
| [core](../../packages/e2ee-core/README.md) | 规范字节、签名、账本事实／权限、固定密码学及显式子入口 |
| [ledger](../../packages/e2ee-core/src/ledger/README.md) | 完整／增量回放、快照资格、普通命令准入及独立预期 checkpoint |
| [keys](../../packages/e2ee-core/src/keys/README.md) | 信封／历史、接收／修复／报告／分发；共享接收器持有的单一保护存储 |
| [submission](../../packages/e2ee-core/src/submission/README.md) | 已合入 P09：CAS前保存原字节、不重签、核原件与实际读回 |
| [content](../../packages/e2ee-core/src/content/README.md) | header3更新与当前作者接纳，同一操作复用已解析的自有字节 |
| [Lab](../../packages/e2ee-lab/README.md) | 真实SDK／HTTP／SQLite／Loro／Flock／OS进程和有限动作／CLI证据 |

## 当前格式与简化实现

不计划旧JSON日志导入、schema升级、双decoder或metadata补genesis前缀。当前P09 control历史包含原签名genesis。淘汰无消费者的内存钥cache、member-only作者查询包装、Promise-phase路径与未接通攻击hooks。不支持的格式拒绝且不改写输入。当前格式重开、原字节重试、历史作者归属和向后代次钥恢复仍须保留。

[当前格式与简化决定](../notes/implemented/architecture/2026-10-15-e2ee-current-decisions.zh.md#只保留当前格式)记录保留范围；[Lab边界](../notes/implemented/architecture/2026-10-15-e2ee-current-decisions.zh.md#模块与验证边界)负责资源与权限边界。旧逐步检查点与不可变失败证据留在Git／关联报告，不再当作当前完成声明。

## 剩余事项

- 可续做workspace创建、独立可信checkpoint取得和host崩溃／丢ACK耐久性收口。
- 受保护内容快照位置／格式及实际有权限的全历史保留／读取API。
- 原子成员移除／换代producer编码、candidate可恢复性／备份例外与恢复vault决定。
- 原字节replay熵及剩余原actor／attack场景；纯比较不等于执行覆盖。
- comparison-note权限、严格期限B、真实native protector与私有产品接线。

受限A仅批准初始化保护已验证installed钥，不批准完整恢复／vault／publisher范围。无完整修订批准的Specs仍draft。教程有Spec，但固定来源没有应用源码。作者验证、CI、独立审查、生产验收分别归属；测试数与文件状态不是完成百分比。

## 交付

沿用原生stack #1490及已有PR范围，上限24；未获用户明确修改前保持Draft。本清理留在 [#1557](https://github.com/LodyAI/Lody/pull/1557)，旧head保留为祖先，不启用产品或发布。准确head/base与检查结果由各PR及固定交付报告负责，本页不再复制实时pin表。
