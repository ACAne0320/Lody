# 公开 E2EE Lab（迁移中）

这个可运行、private 的 workspace 消费公开 `@lody/e2ee-core` 和实际发布 SDK：
streams-client 0.9.0、streams-crdt 0.16.2、Loro 1.16.3、Flock 0.4.3、
SQLite Riverrun 0.3.0，以及根锁定的 Effect 4.0.2。不保留另一套复制 core。

独立 checkout 使用仓库支持的 Node 和固定 pnpm，初始化公开 submodules、
执行 `pnpm install --frozen-lockfile` 后，从根目录运行：

```sh
pnpm --filter @lody/e2ee-lab typecheck
pnpm --filter @lody/e2ee-lab test
```

测试启动真实 loopback Riverrun，使用自动分配端口、合成账户和临时 SQLite。
不安装全局工具，不接入托管产品、生产数据库或真实密钥，不启用生产 E2EE。

账本客户端独立选定签名 checkpoint，通过公开模块验证，串行成对保存原始记录和游标。
actor 消费公开 admission/signing 和未改动的 P09 submission recovery；
真实 feed 落盘失败时不能消费 terminal 结果。另一个 OS 进程重开真实文件，
无需可用 signer 即可恢复原始签名记录。

内容 provider 消费公开 header3 update binding；真实 Loro/Flock SDK 执行加密、
解密和原生状态导入。每文档独立 SQLite 文件，以事务和读回将实际原生状态与精确
SDK 游标一起保存；失败保留旧的持久化对。Loro 在另一 OS 进程重开文档、游标和
受保护 epoch store。AES 包装能力明确是合成 fixture，不是原生安全存钥或生产算法决策。

`makeLabLoroSession` 管理串行操作、每次新建的 SDK 与真实 Loro 文档。
SDK 必须先订阅再编辑，本地状态先保存再上传。失败只停该文档。
显式全历史恢复保留持久化本地编辑，整次 SDK 拉取成功后才提交状态和游标，
不删除或修改宿主快照。Riverrun 0.3.0 在非零 offset 发布快照会推进
`earliest_offset`，旧前缀从公开历史接口不可读。只有历史仍可读时恢复成功；
否则保持失败，不推进持久化对。历史保留/读取 API 与宿主归属仍需协调，不能报恢复完成。

Scope 关闭入口、abort 请求、等待真实 SDK 原生操作结束，再关闭 SDK/存储并释放
真实 Loro owner。发布 SDK 的 `close()` 本身不会等待所有单次操作。
Flock 0.4.3 没有公开的确定性 free/dispose；关闭 SDK 订阅、丢弃引用，不访问私有
实现，不声称确定性释放 Wasm 分配。permit runtime 要求显式 mode/time/fetch，
已弃用的 Promise bridge 仅用于 SDK 回调；纯 scheduler 使用类型化 Result。

`authorizeLabStream` 先通过公开 core 检查 genuine 账本，再读取当前成员，
绑定 credential/request Org，拒绝 R 发送或内容写入。它只做策略检查，
不代表凭据认证、固定 CAS 或 payload 准入。`makeLabMailboxRemote` 通过 HTTP
消费公开接收/分发接口，限制 JSON/hex/page 大小，关闭时 abort 并等待完整响应体。
可选原生 transport lease 明确转交，实际工作结束后才 close；global fetch 不需 close。
真实 HPKE 投递、SQLite 保存/读回/报告经过此适配器；篡改帧不安装也不报告，
重开后 R 仍不能发送。HTTP fixture 的预认证合成会话和 AES 包装是明确的 mock
边界；宿主凭据认证、完整轮换/actor 组合仍未完成。该密钥轮次在同一 OS 进程内
重开存储，不代表跨进程密钥轮次验收。

原完整 host/gateway、诚实 actors、密钥投递/轮换组合、Flock 进程重开/恢复/live
session、schedule driver、攻击能力、捕获 replay、原 fixtures 和 CLI/启动流程
尚未完成。当前 30 个测试不代表原 Lab2 失败闭合或原故障矩阵完成。
快照 wire/offset、replay 熵、严格期限 B、恢复库、D12、发布设备永久丢失仍是待决项。
原生存钥、生产 E2EE、整栈独立审查、CI 和产品验收各自独立。
参见[完整清单](../../.agents/docs/e2ee-migration-manifest.json)和
[所属 Note](../../.agents/notes/proposed/architecture/2026-10-12-e2ee-lab-integration.zh.md)。
