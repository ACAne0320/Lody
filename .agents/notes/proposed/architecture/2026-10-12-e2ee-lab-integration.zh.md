# 公开 Lab 集成进行中

Status: proposed
Translation: current

[English](2026-10-12-e2ee-lab-integration.md)

## 摘要

原 Lab 消费旧 core API，并留下两项账本读取失败。迁移至公开模块与发布 SDK，
先完成持久账本、明确逻辑 permit 与 Scope 原生工作，再组合真实内容 SDK。
当前真实本地传输、SQLite 和另一个 OS 进程重开测试通过；原完整 host/actor、
重放和故障验收仍未完成。工作集中在一个集成分支，尚未形成 Lab Draft。

## 归属与边界

直接父层为 update binding #1496 `0418fd69e22d1eeba47553714473ec54762837ec`。
实际来源和目标包都是 `packages/e2ee-lab`。客户端消费公开 reader/feed，
无复制 verifier/store 或签名接受回调。独立选定的签名 checkpoint 不来自传输 offset。
串行读取将原始验证记录和游标以一个 SQLite 事务提交；Scope abort 并等待借用 SDK
读取，再关闭 owner。原 scheduler/稳定 schedule identity 迁至 `src/pure`，
无效操作返回明确 Result。runtime 要求显式 mode/time/fetch；Promise bridge
仅供 SDK/harness 回调，关闭先拒绝入口、abort、等待实际原生工作，再关闭 Effect owner。

## 证据与依赖

当前作者 Lab **24 项通过**，包 typecheck 和 focused lint 通过；
包含真实 Riverrun0.3.0、streams-client0.9.0、合成账户真实 Ed25519、SQLite 和 OS 重开；
重复记录的新 offset/旧页拒绝、SQLite IGNORE 回滚重试、logical permit 和原生清理。
最初 runtime no-wait 负控逃逸；加强真实 owner finalizer 顺序断言后，删除等待明确失败。
旧逃逸日志和新失败均保留，不把它称作原 Lab2 完整闭合。
历史 e677 root `pnpm check` Lab9/core296、格式/docs/boundary 通过单独保留；
当前完整 root pnpm check Lab24/core302、format、docs 和 public boundary 通过，
CI=true 非交互 frozen install 忽略 scripts 通过；此前无 TTY 中止日志保留。
root 检查开始与结束之间 Lab 文件指纹不变。没有继承历史结果为当前通过，
也未声明 WIP 的 CI/独立验收。

Riverrun 固定0.3.0，根 catalog 不变；包级 override 使用 SQLite13.0.3。
旧 lock 条目逐字保留，仅添加 Lab importer/Riverrun 和 override；历史 frozen install
忽略 scripts 通过。当前 direct SQLite import 已移至 dependencies，版本不变。
Lab/core 同一 Effect4.0.2。main 核对至987962e77022df6a800f4e889f124b51f6eb8056，
对应CI38151323459成功，与实际 stack bottom 的 core/Lab/spec 路径无交集。

## 真实内容、submission 与恢复组合

actor 消费公开 admission/signing 和未改 P09，无重复 genesis/proposal codec。
等待前复制命令，pending 时拒绝新签名，terminal 被消费前必须在真实持久 feed 中出现。
真实 SQLite IGNORE 揭露未提交 actor 将 Result 当布尔值；修为 Effect.fromResult，
保留旧失败和无 signer 的真实子进程恢复通过。P09 没有修改。

Promise provider 消费公开 binding，仅在实际 SDK 回调边界保留内部 Effect owner。
真实 Loro/Flock SDK 使用本地 Riverrun。每文档 SQLite 原子保存实际 native snapshot
和精确 cursor，并事务读回；SQL IGNORE 无法确认保存。另一 OS 进程重开 Loro/
cursor/protected epochs，不需要可用 signer。fixture AES 包装明确是合成能力，
不是生产安全存钥或算法选择。

SDK owner 保留 raw 单次操作，真实结束后才 SDK.close 和 Loro.free。
发布 SDK.close 本身不等待所有单次操作。no-wait 负控明确命中 closedEarly 断言，
非 timeout；断言失败时 finalizer 释放门，避免清理死锁。Flock0.4.3 没有公开
free/dispose，只关闭 SDK 订阅并丢引用，不读 private inner，不声称确定性 Wasm 释放。

新 Loro session 串行管理单文档操作，上传前保存本地编辑，失败只停该文档。
初始 WIP 在编辑后才创建 SDK，使 appendWriteOnly 成功但未上传本地队列；
真实远端内容断言失败。已修为创建并订阅 SDK 后再编辑，保留旧失败/新通过。
全历史恢复重载实际持久本地状态，保留本地编辑；整次 SDK pull 成功后才保存最终对。
恢复失败时旧持久对不变。

实际 Riverrun0.3.0 在非零 offset PUT snapshot 后推进 earliest_offset。
公开历史读返回 gone，SDK 恢复回到同一个坏快照。真实测试区分历史可读时恢复成功，
历史不可读时保持 document-stopped/原游标，其他文档仍继续。
不得重置宿主 SQL offset 或删除快照制造恢复成功。
上游带授权的历史保留/读取 API 与可信宿主历史入口归属是需提前协调的契约缺口，
这里没有发明新 header/offset wire。

纯 replay 比较仅消费已记录合成 fixture，不提供熵源或重新 seal。除原始受保护请求/
响应字节，还比较 frame 的 actor/operation/phase/resource。原 multipart 改写不完整消息，
多段短 boundary 又触发越界；保留原4通过/新增2失败，修完整边界与精确容量后6通过。
完整 replay/driver/host 未完成，不复制原 driver 跳过缺失 identity、提前放行后续 permit 的启发式。

## 剩余工作

原完整 host/gateway、actors、投递/轮换组合、Flock 进程重开/恢复/live session、
driver、攻击能力、捕获 replay、fixtures 和 CLI 尚未完成，再独立复验原 Lab2。
快照 wire/offset、保留历史入口、replay 熵、严格期限 B、恢复库、D12、
永久丢失发布设备仍待决定。整栈 CI/独立验收尚未完成，无生产 E2EE、原生存钥或部署。
