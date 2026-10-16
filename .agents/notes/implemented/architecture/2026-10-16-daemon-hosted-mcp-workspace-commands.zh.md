# 由 daemon 执行 MCP 工作区命令

Status: implemented
Type: architecture
Translation: current

[English](2026-10-16-daemon-hosted-mcp-workspace-commands.md)

## 摘要

在 Cloud 组合下，每次触及工作区的 Lody MCP 工具调用，都会在 MCP 进程里打开一整套第二副本：Loro repo、Streams 传输、token provider 和 presence 订阅，调用结束时再全部拆掉。释放 presence 需要在五秒预算内完成网络 I/O，普通的慢网络就会让清理失败；而失败会被保留成一道栅栏：长期运行的 MCP host 里，该工作区之后的每条命令都以 `INTERNAL_ERROR`（"Workspace cleanup failed" / "Workspace presence operation failed"）失败，直到重启。现在，MCP 工作区工具在所有组合下都由 daemon 用它已有的副本执行（OSS 早已如此），且任何地方的释放失败都不再阻塞工作区。终端里独立运行的 `lody` 命令仍会打开短生命周期副本；打包应用与线上 Cloud 验收尚未测试。

## 缺陷是怎么叠出来的

每一步单独看都合理，叠在一起就让一次清理错误变成永久故障。

| 变更                                                                                                            | 影响                                             |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 公开历史（2026-08）：`withWorkspaceManager` 每条命令新建一次性 `LoroDocumentManager`                            | 每条命令都创建并销毁一份副本，包括 presence      |
| #1133（2026-09-29）：`session/call-tool` 在 daemon 中执行 Session 工具                                          | 仅限 OSS；Cloud 组合保留一次性路径               |
| `e0ad6d4` / `2263513`（2026-10-12）：原生 presence 注册表每个工作区只允许一个 owner，上一次释放未确认时拒绝替换 | 一次释放失败会拒绝之后所有 owner                 |
| #1560（2026-10-14）：重叠命令共用一个 manager，presence 未释放的清理失败会保留失败回执                          | 后续命令拿到旧错误，进不到自己的逻辑，也没人重试 |

presence 只是本地存储时，一次性 manager 很便宜；一旦它持有网络订阅和释放期限，就成了负担。栅栏又把一次有界的网络失败，变成了某个工作区无限期的不可用。

## 决定

```text
agent / MCP 客户端
      │  MCP 协议、operation store（留在 MCP 进程）
      ▼
MCP 进程 ──session/call-tool──▶ daemon：唯一的工作区副本
                                ├─ Loro repo、Streams 传输、token provider
                                └─ presence owner（写心跳、读在线状态）
```

- 一台机器上，daemon 持有唯一的工作区副本。Session 与目录类 MCP 工具（包括 MCP 配置、归档、取消和 schedule）都在那里执行；`session/call-tool` 同时服务两种组合。
- `runWithDaemonWorkspace` 把 daemon 的 manager 借给 daemon 执行的命令。它只改变命令使用哪份副本：Cloud 的鉴权、工作区解析和远端恢复都保持原样。本地平台另外保留单用户环境和"活跃本地 Turn"网关检查；Cloud 工具自行鉴权请求者，因为共享机器上可能是协作者在驱动 Session。
- 借用副本的命令从不清理 daemon 的副本，因此命令结束时不再有可能失败的释放步骤。
- MCP 的取消和归档改为调用共享的进程内函数，不再启动会自建副本的子 `lody` CLI。
- 释放失败永远不阻塞工作区。presence 注册表会让"已停止但释放失败"的 owner 退役并接纳新 owner；退役 owner 的残留工作仍归应用根 Scope 所有，退出时照样被停止，并获得一次脱离调用方的 `retryCleanup`。两个存活 owner 仍被禁止。独立命令池对清理失败只报告一次，并总是移除条目。

## 考虑过的方案

- **先重试失败的释放，再放行下一条命令。** 这是最初考虑的修法。网络持续失败时它仍会阻塞，保留了它本想消除的故障。
- **在 MCP 进程里缓存一个空闲 manager。** 能减少清理次数，但每个工作区仍在 daemon 之外多一份副本、presence owner 和 token owner。
- **为 renderer 与 daemon 统一数据 owner。** [WorkspaceData services](../../proposed/architecture/2026-10-14-workspace-data-services.zh.md) 提议了这一更大的改动。本次变更与之兼容：去掉一份重复副本，但不替它选定进程拓扑。

## 取舍与限制

- Cloud MCP 工具的工作现在跑在 daemon 事件循环上，包括 operation store 的同步 SQLite 调用。OSS 自 #1133 起即如此；MCP 进程仍是协议适配层，因此没有把这部分挪回去。
- 路由后的调用依赖 daemon。调用 Lody MCP 的 agent 本身就运行在 daemon 管理的 Session 中，所以没有新增可用性依赖。IPC 上限为最长的旧式等待回复时长加十分钟，路由不会截断进程内路径原本允许的调用；此前 OSS 的上限是 30 秒。
- 旧 owner 的工作仍被保留时就接纳替换者，旧流的迟到写入可能到达。presence 是最新状态，TTL 90 秒、心跳 30 秒，零星条目会自愈；durable 数据不受影响。
- 终端独立运行的 `lody` 命令仍打开短生命周期副本，因为那里不保证有 daemon；它们的失败不再阻塞后续命令。`lody_session_share` 留在 MCP 进程，因为它需要 MCP 请求的 abort signal，且不使用工作区副本。

## 验证

- 新的归属测试 `daemon-session-tools.test.ts` 在 Cloud 组合下使用真实 `LoroDocumentManager`：MCP 客户端调用经真实 local-control socket 到达 daemon；协作者的请求在 daemon 副本上执行；嵌套命令借用该副本且不销毁它；超出 daemon 工作区或机器范围的调用被拒绝。
- `loro-document-manager-create.test.ts` 的清理失败用例新增了经原生注册表的真实 presence 释放失败。恢复旧注册表后，该用例以用户报告的 `Workspace presence operation failed` 失败。
- `presence.test.ts` 检查原生注册表：拒绝存活的重复 owner，替换释放失败的已停止 owner，其脱离调用方的恢复能完成释放。恢复旧注册表后该测试同样失败。
- 命令池测试证明清理失败只报告一次，等待中与之后的命令都不被阻塞。已删除被移除的子 CLI 取消路径对应的参数形状测试。
- CLI 类型检查、类型感知 lint、Effect lint，平台、进程、presence、公开边界、本地写入器、inbox 与 Code Collab 边界检查，以及 MCP、session、schedule、zero-cloud 与 presence 测试均通过。未运行打包应用、线上 Cloud 与真实 agent 端到端测试。
