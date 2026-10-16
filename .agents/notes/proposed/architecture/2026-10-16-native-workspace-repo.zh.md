# 原生 Workspace Repo 所有权

Status: proposed
Translation: current
PR: [#1607](https://github.com/LodyAI/Lody/pull/1607)

[English](2026-10-16-native-workspace-repo.md)

## 摘要

用户要求在正式依赖接入的同一个 PR 中完成内部原生接线。CLI、renderer、预取 worker 和私有快捷指令 durable room 现在消费 `loro-repo/effect` 或 Streams 原生 SDK，由一个 workspace Scope 拥有 Repo 和 transport。现有应用 Promise API 经过唯一、明确废弃的执行入口，底层共享同一个原生 Repo。WorkspaceData 仍是提案；本次不把 renderer 存储迁往新 host，也不宣称上层 Session/Turn 已完成迁移。

## 行为合同

- 触发：workspace 初始化在既有 SQLite 或每个 renderer 的 IndexedDB 上创建唯一 Repo；本地模式不请求云端。
- 所有者：workspace 拥有 Repo，消费者在子 Scope 中借用文档和房间；打开缺失与创建业务身份分开。
- 取消：关闭一个消费者只释放其 lease，不驱逐其他借用者的副本，也不取消共享且已接受的上传 producer。
- 交接：Streams 使用原生 transport 和副本绑定 checkpoint；前台原地升级显式沿用同一存储的 Doc cursor；服务端确认、peer 收敛与本地持久化独立。
- 恢复：释放失败保留完整 Cause 和 retry owner，未完成已接受 I/O 时不得替换 owner 或关闭存储。

## 实现边界

原生内核包含 Repo 组合、基于 catalog 的 SessionDirectory、要求新鲜服务端确认的 SyncAuthority、transport 配置、本机 v7 客户端及可重试的借用 Scope。CLI/MCP 目录读取使用这些 Service；CLI session handle 和 renderer 的 session/preview/schedule store 使用原生 lease。预取 worker 使用独立原生 Repo、transport 和易失 checkpoint。私有快捷指令 room 使用原生 durable SDK，但 grant 和发布流程仍是尚未迁移的应用边界。

`WorkspaceRepoLegacy` 是唯一执行入口，底层没有旧 Repo；静态 AST guard 禁止原生模块启动程序或导入 Legacy。关闭时必须先结束消费者，再关闭 Repo，否则 Repo 会等待尚未释放的 lease。Scope finalizer 只执行一次，失败后保留 `RepoReleaseFailed.retry`，不能假装再次 Scope.close 会重试保存。store cache 保留释放失败的 owner，在成功重试前拒绝替换。

本机客户端保留 v7 协议和物理连接，用 Effect worker 管理导入、追赶、有界队列和期限。分块快照必须完整且版本覆盖远端公告的 frontier，单独的 join header 不算成功。peer 回执不等于服务端确认。输入队列同时限制项数和约 64 MiB 的字符串保留量，溢出明确要求重取快照；本地编辑不递增 epoch。

前台根只在同一存储上沿用 Doc cursor，Meta/Flock checkpoint 始终绑定原生副本。Streams 借用既有原生 token 服务，不另建 token cache。协议错误保留私有完整 Cause，日志只读取上游验证后的安全标量投影。

自动恢复保留仍在建立 baseline 的 generation；仅显式重置 backoff 或 offline/failed 路由才替换它。pnpm 的不同 peer context 可能持有不同的 Repo 错误类，因此诊断桥接识别来源构造器，并用调用方绑定的构造器创建安全投影。真实 HTTP 503 的 MCP 回归验证可重试语义，不输出私有失败内容。

Legacy 元数据观察者在投递 patch 时读取已完成的 catalog 行，避免原生逐行事件让历史就绪检查看到 owner/backend 的中间组合。既有纯内存 Legacy persist 方法保留空操作语义；原生 lease.persist 仍要求存储，不能把内存当成持久化。

## 验证与限制

行为覆盖：共享文档与最后释放、缺失正文和存储加载失败、保存失败重试、catalog 观察、新鲜服务端权威；真实 SQLite/IndexedDB 的 Streams checkpoint 和受保护快照；真实本机 v7 server 在丢写后的收敛；预取分块；store 异步释放失败与替换隔离；私有只读快捷指令使用原生 SDK 同步且不回传更新。

workspace 关闭回归确认：保存失败返回类型化的 `RepoReleaseFailed`，存储保持打开，重试先完成原始字节保存再关闭。历史所有权/恢复覆盖 62 项；ACP batching 测试只伪造 timeout 与 Date，保留原生 fiber 的真实调度。

最终受影响包类型检查和 `check:quick` 通过；shared 1,512 项、最终 CLI/MCP 203 项、renderer 恢复 50 项、原生所有权/Streams 与既有 iOS 套件 73 项通过。根 `format` 通过。CLI、OSS desktop 构建及 CLI bundle 导入/启动检查通过，但早于最后的恢复/诊断修正，最终提交仍需 CI 重新构建。

已运行完整根 `check`，尚未全绿：迁移后的组合 fixture 与一次 iOS 超时失败，修正后各自所属套件均通过；未改动的 Git SSH fixture 单独运行仍报 `context_unreadable`（其他 23 项通过），原因尚未确定。修正 fixture 后尚未重跑完整根套件。最终文档检查结果记录在 #1607。

本地浏览器 fixture 不代表真实生产、浏览器进程崩溃或跨平台验收。host 本机 server、SessionDocument wrapper cache、Session/Turn/dispatch、快捷指令 grant/发布、RPC、迁移 target 上传仍保留既有应用生命周期。host 存储迁移和完整 WorkspaceData 提案尚未完成。
