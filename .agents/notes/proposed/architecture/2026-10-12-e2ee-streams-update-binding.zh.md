# 带资源归属的已发布 SDK update 绑定

Status: proposed
Translation: current

[English](2026-10-12-e2ee-streams-update-binding.md)

## 摘要

原 SDK 内容 provider 使用旧授权回调和没有释放归属的叶子密钥。新增 header3 update
Effect 编解码，消费公开的已验证内容工作流，核对真实 epoch 承诺并释放本次操作拥有的密钥。
快照格式仍需人决定，实际 SDK/Lab 消费仍由集成层负责。这是部分绑定，不是完整迁移。

## 归属与证据

直接父层为 sender #1493 `36ca2685b7eefeb15ebd041e50444796c2686652`。
[内容契约](../../../../packages/e2ee-core/src/content/README.md) 说明当前行为，
[来源记录](../../../../packages/e2ee-core/src/content/streams-provenance.json) 保存只读来源指纹。
保留 HPKE、v0 内容算法和已定 header3；不创建 runtime、签名身份、原生存钥或 nonce 覆盖。

每次成功读取须转移一份独立拥有的 opaque epoch key。真实账本上下文和固定历史签名验证
先于读钥；准确承诺核对先于延迟叶子派生。资源括号在成功、失败、取消时清理并失效拥有的副本。
Scope 先关闭入口，再等待活跃操作，最后才释放之前的原生/存储 owner。调用方 Effect 仍需
履行自己的取消契约，此编解码器不能让任意回调停止。

作者测试使用合成身份的真实签名/HKDF/AEAD、真实账本重放和已发布 SDK 类型契约，覆盖
迟到结果拒绝、关闭顺序、错误承诺/AAD、伪造作者不读钥，以及叶子/独立副本/借用密钥寿命。
第一次关闭测试的信号只证明进入关闭，不能证明入口已经关闭；保留失败日志。修正探针将关闭
执行到明确的活跃 lease 等待点并验证入口关闭。删除等待后，真实 owner 释放顺序断言失败。
这些测试不等于实际 SDK envelope/transport 或独立验收。

SDK 0.16.2 AAD 认证 envelope/header，但不包含快照 continuationOffset。不发明新 writer
header，也不暗中决定旧 snapshot4 兼容。manifest 保留 provider 快照/replay 与实际 Lab 消费
未完成。严格 B、恢复库格式/并发保留、发布设备永久丢失和 D12 仍未定。SDK 准备不是生产保护器。

作者owning42/core302、包typecheck、完整root `pnpm check`、格式、文档和public boundary通过。
禁用脚本的frozen安装通过；SDK类型依赖只新增三行importer锁项，不升级版本。
新克隆检查先缺ACP依赖／构建产物，后发现新增测试变量遮蔽；保留失败与修正后完整检查。
branch CI与独立审查分别记录，此处不宣称通过。

首次Draft后的证据纠正：原无等待负控日志是超时，不是此前报告的释放顺序断言。
断言失败进入清理后仍等待没有释放的测试门；保留该日志但不把它计为充分证据。
现在明确拥有child Scope，并在worker之后登记失败路径释放门的finalizer。修订无等待
负控在放行门之前命中 `ownerReleased` 断言，随后完成真实清理。此次增量不改
生产代码、算法、wire、API或依赖。

组合依赖修正（2026-10-13）：#1496引入的core SDK类型测试依赖明确钉当前main已有streams-crdt0.17.0，保留直接SDK0.9.0/Effect4.0.2。锁文件复用main发布包与client0.10.0依赖图，并保留冻结父链其他消费者的0.16.2记录。不变更workspace catalog或运行源码/wire。原0.16.2 catalog条目与实际GitHubmain合并树错配，准确CI38347426649因缺失snapshot失败，保留日志；新准确CI独立归属。

## Main 整合

本栈消费 main `129996ed7d641be68aa1f1f9cc480c7c88d49917`，不改变已审 core 实现。锁冲突处理保留 main 的依赖条目及 Flock 0.4.4 选择，本层只补 core SDK 测试依赖入口；Lab 依赖仍归子层。旧 0.4.3 检查保持原版本归属。最终组合检查与准确 head CI 分别记录；本次同步不批准未决协议或生产启用。
