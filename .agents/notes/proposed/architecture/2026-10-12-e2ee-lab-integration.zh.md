# 公开 Lab 集成进行中

Status: proposed
Translation: current

[English](2026-10-12-e2ee-lab-integration.md)

## 摘要

原 Lab 消费旧 core API，且有两项账本读取失败证据。迁移至公开模块与发布 SDK，先完成持久账本读取、明确逻辑 permit 与 scoped 原生工作。这一实施检查点的真实本地传输和进程重开测试通过。原 host/actor、保护内容、重放及完整故障验收仍待完成，因此先集中在同一集成分支，再形成 Draft。

## 归属与边界

直接父层为 sender #1493 `36ca2685b7eefeb15ebd041e50444796c2686652`。
实际来源与目标包均是 `packages/e2ee-lab`。客户端消费公开 reader/feed，无复制 verifier/store 或注入签名接受。调用方选择的签名检查点独立于不可信传输游标。串行读取将验证后的原记录与游标在同一 SQLite 事务提交。Scope abort 并等待借用 SDK 读取后才关闭 owner。

原 scheduler 与稳定 schedule identity 已迁至 `src/pure`，无效 permit/time 操作返回明确的 Result。scoped runtime 要求显式 mode/time/fetch 输入，已弃用 Promise 桥仅供 SDK/harness 回调。关闭先拒绝新工作、abort，等待保留的原生请求和阶段工作，再关闭内部 Effect owner；晚返回值和 frame 被拒绝。runtime/driver/host 的组合仍不完整。

## 证据与依赖

九项作者测试通过：官方真实 SQLite Riverrun 0.3.0、发布 streams-client 0.9.0、合成账号的真实 Ed25519 记录、真实文件与另一 OS 进程；新位置重复记录/旧页拒绝；真实 SQLite IGNORE 回滚及同一历史重试；逻辑父链/单次消费 permit；原生结算与 owner 清理。原生工作 mock 边界明确。首版不等待负向控制逃过初版测试，日志保留；加入真实 owner-finalizer 顺序断言后，不等待控制失败而修复套件通过。这是新负向控制，不是原 Lab2 失败的关闭。

包 typecheck、完整根 `pnpm check`（Lab9/core296）、根格式化、docs 与公开边界通过。作者本地检查与独立审查、分支 CI 分列，后两项尚无此 WIP 结论。来源和目标指纹在包 migration provenance 与完整 manifest 中。

保留来源显式 Riverrun 0.3.0，不改根 catalog；包级 override 使用已定 SQLite 13.0.3。首次解析带出无关依赖变化，已保留所有旧锁项，仅加入 Lab importer、新 Riverrun package/snapshot 和 override。禁脚本 frozen install 通过，Lab/core 解析到同一 Effect 4.0.2。main 已 fetch 为 `987962e77022df6a800f4e889f124b51f6eb8056`，准确 CI `38151323459` 成功，相对实际栈底无 core/Lab/协议变化。

## 剩余工作

继续迁实际 host/actors、内容会话、Loro/Flock 持久化、driver、攻击者能力、捕获重放、fixtures 和 CLI，再独立复验原 Lab2 场景。快照 wire/offset、重放随机数、恢复库、D12、发布设备永久丢失仍待决定。整栈 CI 与验收待完成。未启用生产 E2EE、原生存钥或部署。
