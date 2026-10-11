# 用当前会话 presence 保持长任务实时活动

Status: implemented
Translation: current
PR: [#1478](https://github.com/LodyAI/Lody/pull/1478)

[English](2026-10-11-live-activity-presence.md)

## 摘要

会话活跃状态迁移到临时 presence 后，实时活动汇总仍把持久化 `lastRunningSeen` 当作周期心跳。运行中的任务可能在三分钟后的下一次汇总中消失，让消费者提前结束活动。CLI 现在向所有汇总函数传入同一份实时状态映射，本机读取任务所有权，其他机器读取新鲜 presence。明确的持久化 `idle` 仍表示完成，因为提示执行结束早于收尾阶段释放 presence。测试覆盖真实 MessageHandler 在三分钟与 31 分钟时的汇总，但不能证明真机推送送达。

## 决策与边界

- 本机会话读取 `SessionActivePresenceController.getStatus`，传输暂停不会让仍由本进程持有的任务过期。
- 其他机器读取工作区 presence 快照并使用共享的新鲜度判断。presence 运行时不可用时，让尽力发送的汇总失败，不回退旧元数据或虚构空快照。
- 条目、候选总数、状态计数和权限提醒共用状态映射。不得恢复周期 doc-meta 心跳写入。
- 提示执行结束会写入 `idle`，此时 presence 仍代表收尾；汇总遵循完成状态，避免最后一次发送复活已完成任务。
- 保留未读历史供消费者使用。决定活动寿命时应依据运行／等待数量，而非未读历史。
- 不增加轮询、网络重试、后台所有者、载荷格式或远程启动策略。现有 30 分钟内容过期与结束活动是不同概念。

按仓库指南评估过小范围 Effect 迁移。本次是现有 Promise 通知边界内的同步投影；迁移 MessageHandler／会话所有者会牵涉未完成的依赖，且不能直接解决旧判断，因此保持现有所有权。

## 证据与限制

已有权限通知测试使用真实汇总方法、真实活跃 presence 控制器和受控时钟，覆盖三分钟／31 分钟未变更的持久化时间、权限选择、收尾期间 idle、本地所有权释放、其他机器 presence 新鲜／过期以及运行时不可用。数据全部为合成且不访问网络。实际 APNs 送达、平台限流和远程注册仍须真机证据。

相关所有权：[CLI presence](../../../docs/cli-lib-loro-presence.md)。
