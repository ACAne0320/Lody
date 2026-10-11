# 现行 epoch 历史与有 Scope 的临时安装

Status: implemented
Translation: current

[English](2026-10-11-e2ee-epoch-history.md)

## 摘要

来源同时保留了互不兼容的 JSON 与现行账本密钥协议，逆向历史恢复失败还遗留操作拥有的秘密副本。本层以真实已验证视图迁移现行账本的 commitment/72B 历史包及 install/read/clear 行为，保持字节和算法，清理失败恢复副本。临时安装检查当前接收者资格并保留本地已验证前缀；它不代表备份、原生存钥或持久轮换/投递。

## 决定与归属

直接父层为文档工作流 [#1442](https://github.com/LodyAI/Lody/pull/1442)，head `543f82d1c4f4470436d4ad183f0f53259faddf49`。`./keys` 拥有 commitment/历史包及应用 Scope 拥有的临时存储，`src/ledger` 拥有已验证前缀关系。调用方裸状态/map、可注入签名验证器或 journal 内信任不能创建安装权限。当前记录/commitment/history 域不变，保留 epoch 零刻意不绑定 genesis 的规则。JSON 原型的 lody-epoch-secret/v1 摘要及签名 history frame 淘汰；安装/清理责任迁到现行事实。

所有逆向链接与旧 commitment 通过后才返回恢复密钥。临时秘密用普通 try/finally 清理，不依赖 Result.gen 的迭代器 finally。同步安装内没有等待 native 操作，不引入 pending install 竞争。Scope 拥有创建与同步完成的关闭，擦除存储副本并拒绝关闭后的调用。clear 保留已知权限观察，不能拿旧视图重新恢复已知被撤销接收者。有效新视图可在本地读钥失败后仍被观察；这不同于推进远端游标或持久数据。调用方的新鲜度/持久化与最终分发授权仍属外部。

SDK 快照位置格式、原子移除、恢复库格式/并发/保留与发布端永久丢失备份仍由[迁移指南](../../../docs/e2ee-migration.zh.md)记录为提案。本密码切片不自动决定轮换/备份策略或启用生产功能。

## 证据与限制

在独立、不改候选实现的副本重现：有效包解出了错误旧密钥并返回 typed failure，但操作的 32 字节 buffer 仍含当前/旧秘密。公开 crypto 套件中同样的真实密码失败通过了清理断言。完整恢复使用原生签名的账本和 Python/libsodium 固定向量，覆盖坏 tag/上下文/commitment、伪造视图、已知回退/合法签名的另一 fork、活跃 R、clear 与 Scope 关闭。[来源指纹](../../../../packages/e2ee-core/src/keys/provenance.json)记录输入与调整。

这不证明持久存钥/轮换、真实设备存储、投递修复、设备永久丢失恢复、最终可运行 Lab 或生产 E2EE。原七个 core/两个 Lab 失败仍另列去向，不用本次新增清理复现掩盖它们。

另一个独立旧失败通过 EpochKey 原型反射调用 material symbol，并可给派生函数注入结构化 material 回调。最终 EpochKey 用私有 WeakMap，无可反射 accessor；伪造派生/安装失败且不创建 slot，合法字节和算法不变。最终包套件 147 项通过，含真实签名的另一 fork。

按测试树分别记录：完整 `env -u GIT_EXEC_PATH PATH="/usr/bin:$PATH" pnpm check` 在最终 EpochKey provenance 修复前的 146 测试树通过。最终代码上包 147/147/类型检查、重新运行的根类型/lint、实际已发布 SDK 消费者 43/43、格式/文档/公开边界通过，不声称重跑了最终树全根矩阵。远端 CI 绑定精确 Draft head。历史清理与 EpochKey 反射两个独立旧失败及新通过证据均保留。
