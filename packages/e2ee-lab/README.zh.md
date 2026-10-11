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
重开后 R 仍不能发送。传输单元 fixture 的预认证合成会话和 AES 包装是明确的 mock
边界；全部宿主路由认证、完整轮换/actor 组合仍未完成。该密钥轮次在同一 OS 进程内
重开存储，不代表跨进程密钥轮次验收。

mailbox 宿主当前通过真实 challenge/bearer HTTP 提供原七项操作，只绑定落盘
设备与 bound Org，消费公开 SQLite mailbox；JSON 不能选择 sender。envelope/
report 保留公开 512 字节限制，local-publication 记录保留 8192 字节，repair ID
保留已有 1–256 字符契约，不发明新 ID 格式。真实 HPKE 轮次经过此路由，包括 R
不能发送、修复自身接收 slot 的重试幂等。账户身份与 AES 包装仍是合成 fixture；
部分传输单元 fixture 仍明确预认证。这不代表完整 host/rotation 组合或跨进程密钥轮次验收。

scoped 凭证 owner 保留冻结 Lab v2 持有消息、60 秒单次 nonce 和最多 15 分钟
合成 token TTL。真实 Ed25519 证明、genuine 当前 Org 成员和 SQLite 事务读回
都是必要条件。account 只是测试标签，不增加 JWT claim、不改普通容差，也不代表
严格生产期限 B。loopback HTTP host 当前提供 health、challenge、credential 和
control append-CAS；检查精确路径、有限 JSON/单记录 body 和已落盘 bearer。
公开 submission 完整验证独立选定前缀并固定 SDK CAS，请求的生命周期/offset/auth
头没有上游转发入口。workspace 注册/checkpoint 持久化、其余 metadata、SDK 密钥/
内容 stream 路由及 CLI 仍未完成。共享操作 Scope 关闭时 abort、打断并等待所有子操作，
某个清理失败也不能跳过其他操作，再关闭此前的 SQLite/SDK owner。

join mailbox 消费公开请求签名/验证。真实 unbound 外来设备可提交无权威效力的
申请，只有 genuine 当前成员能读队列；收到申请不授予成员资格，也不改变期限策略。
同一 request ID 仅原 signer 可替换；首次合成 user/account 关联保持固定。SQLite
两个行须在同一事务读回，复用前重核已存请求与绑定。R 不能提交 join 申请。
借用账本读取接收 abort signal，并保留到实际结束；显式忽略 abort 的借用测试观察
真实 SQLite close/open 与 Riverrun 关闭顺序。完整宿主组合仍未完成。

原完整 host/gateway、诚实 actors、密钥投递/轮换组合、Flock 进程重开/恢复/live
session、schedule driver、攻击能力、捕获 replay、原 fixtures 和 CLI/启动流程
尚未完成。当前 45 个测试不代表原 Lab2 失败闭合或原故障矩阵完成。
快照 wire/offset、replay 熵、严格期限 B、恢复库、D12、发布设备永久丢失仍是待决项。
原生存钥、生产 E2EE、整栈独立审查、CI 和产品验收各自独立。
参见[完整清单](../../.agents/docs/e2ee-migration-manifest.json)和
[所属 Note](../../.agents/notes/proposed/architecture/2026-10-12-e2ee-lab-integration.zh.md)。

workspace registry 只保存实际公开签名验证过的原始 genesis 与原 signer，并在同一
事务读回；被忽略写入和坏存储拒绝确认，另一 OS 进程重开真实文件后重验。
认证 genesis 发现保留 unbound joiner 的访问，仅返回原始 genesis。metadata API
是私有 harness 注册，不代表完成 HTTP create-space 发布、当前可信端点、存钥或
crash-gap 恢复。
