# 工作区数据迁移消费者清单

Status: proposed
Type: architecture
PR: [#1572](https://github.com/LodyAI/Lody/pull/1572)
Translation: current

[English](2026-10-14-desktop-data-consumers.md)

## 摘要

本清单把普通消费者、底层适配器与注入回调映射到提议的领域 Services，避免统一数据 owner 后仍依赖 Repo/Doc/transport 逃逸口。静态候选扫描固定远端 main，另外补入不含原始 API 的持久输入、presence、预取和薄命令入口。所有迁移目标仍为 proposed；本表没有通过生产行为或 lint 验收，未审定行阻止其领域关闭。

## 来源与使用

Source: [main df5b5a068e2f6a44118a30d0cc8fa34c2e4fcc49](https://github.com/LodyAI/Lody/tree/df5b5a068e2f6a44118a30d0cc8fa34c2e4fcc49).

[决策与同步调用点](2026-10-14-desktop-data-process.zh.md#当前服务与迁移决策2026-10-14)、[公共契约](../../../docs/workspace-data-service.zh.md)。

范围：CLI/src 与 components/src，排除 tests/stories/declarations。TypeScript 5.8.2 AST 扫描 141 文件/847 处候选，取 SDK imports、repo/doc/room 成员、同步/权威成员与 WorkspaceRuntime 中已声明的 request/waitFor 名称；再加 19 个薄入口/存储/注入依赖。此工具无 type checker，不能证明 alias/dynamic/injection 完整性；Pure DTO 的 repo 与真实 Repo 分开。此 SHA 的行号不等于当前旧 worktree 行号。

M = 提议方法映射；A = 拟登记的私有 adapter/入口（需审定范围与删除 gate）；X = 已核对的非数据 API 同名项；U = 尚未逐 API 审定。M/A/U 均不是“已迁移”。adapter 豁免只允许表中路径和所列领域，不能让整个目录绕过。new raw dependency 先登记；闭合后静态导入/成员边界与真实行为测试同时通过。

## 本次契约约束

同步按真实调用点选 wait-for-route、bounded-confirmation、require-route、retain-until-ack 四种一期策略，详细表在 [同步登记](2026-10-14-desktop-data-process.zh.md#同步权威调用点登记)。会话 SyncTarget 只叫 session-control；Roost history flush/owner receipt 在 backend/写命令，不被控制 ACK 替代。DirectoryStatus.cloud 与 SyncAuthority(workspace-meta) 共用一个状态源。

MachineRpc 的二期 server 网络入口在 host，执行 handler 在 daemon；切换前验证 host 故障后的 timeout/unknown 与恢复查询。machine/active presence 的发布 lease 随 daemon 失联有界撤销，实际执行资源仍由 daemon 释放。静态边界作为 pnpm check 的 lint 交付，相关源码约束从 Vitest 迁出；本次只定 gate，没有实现 lint 或迁移任何行。

本次核对 main 7541fbf76d154e3a98987e646c6aa932baebacd5 与本 ledger 的 df5b5a0 差异，本文同步/RPC/presence 源码未变；settings 等新改动不属于本次全量扫描。每个实施切片先刷新清单与允许列表，表中的行号仍属于原固定 SHA。

## 文件清单

| 文件与首个候选行 | API/依赖 | 目标方法 | 分类与关闭条件 |
| --- | --- | --- | --- |
| `apps/cli/src/agent/session-mcp-resolver.ts:70` | `openFlockDoc, repo` | WorkspaceCatalog + CatalogManagement + MachineLaunchData/MachineCommands | M: family 权限、冻结配置/Role、Magpie 本机确认、敏感 DTO gate |
| `apps/cli/src/commands/agent-config.ts:369` | `repo` | WorkspaceCatalog + CatalogManagement + MachineLaunchData/MachineCommands | M: family 权限、冻结配置/Role、Magpie 本机确认、敏感 DTO gate |
| `apps/cli/src/commands/export.ts:1` | `injected consumer / storage / lifecycle` | SessionAccess.exportSnapshot + SyncAuthority.refresh | M: 保留一致完整导出、附件、--offline 与失败语义 |
| `apps/cli/src/commands/machine.ts:148` | `openFlockDoc, repo` | MachineRpc.machine/agent + WorkspaceCatalog + MachineCommands | M: 保留机器身份、能力/进度、secret 与本机解析兼容行为 |
| `apps/cli/src/commands/mcp.ts:218` | `repo` | domain Services + MachineRpc + SyncAuthority | M: 保留 CLI/MCP requester、默认在线/显式 offline、bounded DTO/receipt |
| `apps/cli/src/commands/review.ts:137` | `repo` | domain DTO / native UI | X: 字段为 GitHub/route/UI DTO；不是数据 Repo，保持普通计算 |
| `apps/cli/src/commands/session-observe-runtime.ts:26` | `getOrCreateSessionDoc, waitForRemoteSync, repo` | domain Services + MachineRpc + SyncAuthority | M: 保留 CLI/MCP requester、默认在线/显式 offline、bounded DTO/receipt |
| `apps/cli/src/commands/session.ts:870` | `repo, getOrCreateSessionDoc, openFlockDoc, requestSessionDispatchTurn, waitUntilSynced, requestLocalProjectGitState, requestSessionCancel` | domain Services + MachineRpc + SyncAuthority | M: 保留 CLI/MCP requester、默认在线/显式 offline、bounded DTO/receipt |
| `apps/cli/src/commands/sync.ts:1` | `injected consumer / storage / lifecycle` | SyncAuthority.refresh (domain-selected targets) | M: 显式批量 sync，保留枚举范围、Result/汇总与 file-index 排除 |
| `apps/cli/src/lib/agent-config-machine-flock.ts:22` | `LoroRepo, openFlockDoc` | WorkspaceCatalog.observe/read + CatalogManagement.change | A: 改为私有 family adapter，普通 hooks 不再取 Flock；权限/秘密按 family |
| `apps/cli/src/lib/agent-role-create.ts:37` | `openFlockDoc, repo` | WorkspaceCatalog + CatalogManagement + MachineLaunchData/MachineCommands | M: family 权限、冻结配置/Role、Magpie 本机确认、敏感 DTO gate |
| `apps/cli/src/lib/code-collab/code-collab-flock-publish.ts:44` | `openFlockDoc, repo` | FileCollaboration.acquireIndex/observe/publish | A: owner-session 资源/版本 helper 私有；local RPC seed、LRU/release |
| `apps/cli/src/lib/command-runtime.ts:40` | `LoroStreamsMachineRpcClient, repo` | MachineRpc + SyncAuthority + domain Services | A: composition/路由 adapter；manager/授权/关闭 owner 不重复构造 |
| `apps/cli/src/lib/local-project-history-sync-service.ts:208` | `repo, getOrCreateSessionDoc, waitUntilSynced` | SessionAccess.importHistory + SyncAuthority.refresh/awaitUpload | M: import/cursor 同写、冻结 source 与四处 boolean 确认失败处理 |
| `apps/cli/src/lib/local-project-meta.ts:18` | `LoroRepo, openFlockDoc` | WorkspaceCatalog.observe/read + CatalogManagement.change | A: 改为私有 family adapter，普通 hooks 不再取 Flock；权限/秘密按 family |
| `apps/cli/src/lib/lody-fleet.ts:861` | `repo` | DataOwnerLive composition + native existing Services | A: 应用入口/Legacy executor；root owner 与 cleanup ledger gate |
| `apps/cli/src/lib/lody.ts:164` | `hasCompletedInitialMetaSync, waitForInitialMetaSync` | DataOwnerLive composition + native existing Services | A: 应用入口/Legacy executor；root owner 与 cleanup ledger gate |
| `apps/cli/src/lib/loro/connection-recovery.ts:4` | `LoroRepo, RepoTransportRoomStatus, RepoRoomSubscription, repo, firstSyncedWithRemote, waitUntilSynced` | SyncAuthority + DataOwnerLive private backend | A: 底层 owner adapter：cursor/Result、local/remote、读兴趣与写持有 |
| `apps/cli/src/lib/loro/doc.ts:6` | `LoroDoc, LoroRepo, RepoRoomSubscription, RepoTransportRoomStatus, doc, openFlockDoc, repo, firstSyncedWithRemote, waitUntilSynced` | SyncAuthority + DataOwnerLive private backend | A: 底层 owner adapter：cursor/Result、local/remote、读兴趣与写持有 |
| `apps/cli/src/lib/loro/history-auto-read.ts:1` | `injected consumer / storage / lifecycle` | SessionAgentWriter.markLatestSeen | A: auto-seen 只在执行兴趣启用，同步 last-copy guard 保留 |
| `apps/cli/src/lib/loro/machine-flock-command-watcher.ts:2` | `LoroRepo, RepoRoomSubscription, repo, openFlockDoc, joinRoom, firstSyncedWithRemote` | MachineCommands + MachineCommandConsumer.serve | A: 私有消费 adapter；权威 scan、取消优先、family 结果 |
| `apps/cli/src/lib/loro/machine-flock-sync-coordinator.ts:2` | `LoroRepo, RepoTransportRoomStatus, repo, openFlockDoc, joinRoom, firstSyncedWithRemote` | SyncAuthority + DataOwnerLive private backend | A: 底层 owner adapter：cursor/Result、local/remote、读兴趣与写持有 |
| `apps/cli/src/lib/loro/machine-monitor.ts:1` | `injected consumer / storage / lifecycle` | Presence.observe/holdViewing + SessionExecutionPresence.hold | A: 私有原生/Legacy transport adapter；按 origin、lease、监控授权拆开 |
| `apps/cli/src/lib/loro/presence-replica.ts:1` | `injected consumer / storage / lifecycle` | Presence.observe/holdViewing + SessionExecutionPresence.hold | A: 私有原生/Legacy transport adapter；按 origin、lease、监控授权拆开 |
| `apps/cli/src/lib/loro/repo-existence.ts:9` | `repo` | SyncAuthority + DataOwnerLive private backend | A: 底层 owner adapter：cursor/Result、local/remote、读兴趣与写持有 |
| `apps/cli/src/lib/loro/session-model-summary.ts:1` | `injected consumer / storage / lifecycle` | SessionDirectory.updateModelSummary | A: 窄 scalars/count 摘要留 owner；hidden/deleted 与串行 publish |
| `apps/cli/src/lib/loro/streams-room-binding.ts:1` | `RepoRoomSubscription, RepoTransportRoomStatus, firstSyncedWithRemote, waitUntilSynced` | SyncAuthority + DataOwnerLive private backend | A: 底层 owner adapter：cursor/Result、local/remote、读兴趣与写持有 |
| `apps/cli/src/lib/loro/streams-transport.ts:16` | `LoroRepo, repo` | SyncAuthority + DataOwnerLive private backend | A: 底层 owner adapter：cursor/Result、local/remote、读兴趣与写持有 |
| `apps/cli/src/lib/loro/workspace-presence.ts:1` | `injected consumer / storage / lifecycle` | Presence.observe/holdViewing + SessionExecutionPresence.hold | A: 私有原生/Legacy transport adapter；按 origin、lease、监控授权拆开 |
| `apps/cli/src/lib/message-handler.ts:1062` | `getOrCreateSessionDoc, repo, hasCompletedInitialMetaSync, openFlockDoc, waitForInitialMetaSync, waitUntilSynced, requestSessionTerminate` | SessionAccess + SessionAgentWriter + MachineLaunchData + SyncAuthority + Presence | M: 按职责逐 API 拆迁；不把 Agent runtime/cleanup 放进 reader；同步 guard 表 |
| `apps/cli/src/lib/oss-migration/attachments.ts:4` | `LoroDoc` | MigrationData.importFrozenSnapshot | A: 专用 source/target adapter：只读源、CAS/receipt/journal；普通消费者不能借用 |
| `apps/cli/src/lib/oss-migration/model.ts:3` | `LoroDoc` | MigrationData.importFrozenSnapshot | A: 专用 source/target adapter：只读源、CAS/receipt/journal；普通消费者不能借用 |
| `apps/cli/src/lib/oss-migration/source.ts:7` | `LoroRepo` | MigrationData.importFrozenSnapshot | A: 专用 source/target adapter：只读源、CAS/receipt/journal；普通消费者不能借用 |
| `apps/cli/src/lib/oss-migration/target.ts:5` | `Flock, LoroDoc, doc` | MigrationData.importFrozenSnapshot | A: 专用 source/target adapter：只读源、CAS/receipt/journal；普通消费者不能借用 |
| `apps/cli/src/lib/pr-poller/pr-poll-scheduler.ts:244` | `waitForInitialSync` | SessionDirectory.observe/updatePr + Presence.observe + SyncAuthority | M: 保留 fresh-meta 条件写、bounded 初扫/重试与 viewing 优先级 |
| `apps/cli/src/lib/pr-poller/pr-poller-workspace.ts:107` | `repo, waitForInitialMetaSync` | SessionDirectory.observe/updatePr + Presence.observe + SyncAuthority | M: 保留 fresh-meta 条件写、bounded 初扫/重试与 viewing 优先级 |
| `apps/cli/src/lib/prepared-session-input.ts:55` | `repo, getOrCreateSessionDoc` | SessionSubmissions.submit/restore/cancel + SyncAuthority.awaitUpload | M: 保留唯一副本、顺序/identity、未知 receipt、附件与原上传策略 |
| `apps/cli/src/lib/provider-setup-manager.ts:25` | `LoroRepo, repo, openFlockDoc` | MachineCommands + MachineCommandConsumer.serve | A: 私有消费 adapter；权威 scan、取消优先、family 结果 |
| `apps/cli/src/lib/remote-local-project-list.ts:11` | `LoroRepo, repo` | SessionDirectory/SessionAccess + CatalogManagement + MachineCommands/MachineRpc | M: 真实 UI 操作按命令收拢，保留草稿/首帧/权限与 queue/执行顺序 |
| `apps/cli/src/lib/resource-discovery-runtime.ts:65` | `repo, openFlockDoc` | WorkspaceCatalog + CatalogManagement + MachineLaunchData/MachineCommands | M: family 权限、冻结配置/Role、Magpie 本机确认、敏感 DTO gate |
| `apps/cli/src/lib/schedules/schedule-command-service.ts:54` | `repo, getOrCreateSessionDoc, openFlockDoc, waitUntilSynced` | WorkspaceSchedules.read/change/observe + SyncAuthority.refresh/awaitUpload | M: 保留 definition/registry flush、当前连接 gate 与原确认结果 |
| `apps/cli/src/lib/schedules/schedule-documents.ts:10` | `openFlockDoc, repo` | WorkspaceSchedules.read/change/observe + SyncAuthority.refresh/awaitUpload | M: 保留 definition/registry flush、当前连接 gate 与原确认结果 |
| `apps/cli/src/lib/schedules/schedule-sync-gate.ts:17` | `firstSyncedWithRemote, waitUntilSynced` | WorkspaceSchedules.read/change/observe + SyncAuthority.refresh/awaitUpload | M: 保留 definition/registry flush、当前连接 gate 与原确认结果 |
| `apps/cli/src/lib/schedules/schedule-workspace.ts:1` | `RepoRoomSubscription, repo, openFlockDoc, getOrCreateSessionDoc, joinRoom` | WorkspaceSchedules.read/change/observe + SyncAuthority.refresh/awaitUpload | M: 保留 definition/registry flush、当前连接 gate 与原确认结果 |
| `apps/cli/src/lib/session-command-environment.ts:82` | `repo` | MachineRpc + SyncAuthority + domain Services | A: composition/路由 adapter；manager/授权/关闭 owner 不重复构造 |
| `apps/cli/src/lib/session-export/export-service.ts:66` | `repo, openFlockDoc` | SessionAccess.exportSnapshot + SyncAuthority.refresh | M: 保留一致完整导出、附件、--offline 与失败语义 |
| `apps/cli/src/lib/session-file-attachments.ts:1` | `injected consumer / storage / lifecycle` | SessionSubmissions.attachments | A: 私有附件 adapter：不可缓存清理唯一 ready 引用，保留 source/ACL/实际 IO |
| `apps/cli/src/lib/workspace-command-manager.ts:1` | `injected consumer / storage / lifecycle` | MachineRpc + SyncAuthority + domain Services | A: composition/路由 adapter；manager/授权/关闭 owner 不重复构造 |
| `apps/cli/src/lib/workspace-mcp-store.ts:52` | `openFlockDoc` | WorkspaceCatalog.observe/read + CatalogManagement.change | A: 改为私有 family adapter，普通 hooks 不再取 Flock；权限/秘密按 family |
| `apps/cli/src/mcp/daemon-session-tools.ts:41` | `repo` | domain Services + MachineRpc + SyncAuthority | M: 保留 CLI/MCP requester、默认在线/显式 offline、bounded DTO/receipt |
| `apps/cli/src/mcp/lody-mcp-server.ts:1466` | `repo, getOrCreateSessionDoc, openFlockDoc` | domain Services + MachineRpc + SyncAuthority | M: 保留 CLI/MCP requester、默认在线/显式 offline、bounded DTO/receipt |
| `apps/cli/src/mcp/workspace-mcp-configure.ts:257` | `repo` | domain Services + MachineRpc + SyncAuthority | M: 保留 CLI/MCP requester、默认在线/显式 offline、bounded DTO/receipt |
| `apps/cli/src/orchestration/operation-coordinator.ts:113` | `repo` | OperationRepository + SessionSubmissions + SessionAgentWriter | M: 保留 machine-local SQL 事务/执行身份和未知交接；store IO 单独移动 |
| `apps/cli/src/orchestration/platform/coordinator-sessions.ts:39` | `repo, getOrCreateSessionDoc` | OperationRepository + SessionSubmissions + SessionAgentWriter | M: 保留 machine-local SQL 事务/执行身份和未知交接；store IO 单独移动 |
| `apps/cli/src/preview/preview-service.ts:1156` | `repo, getOrCreateSessionDoc` | PreviewComments + MachineRpc.preview/files + SyncAuthority | M: 预览/评论分开，lease/proof/readonly 与当前 sync 策略 |
| `apps/cli/src/session/message-author.ts:35` | `openFlockDoc, repo` | SessionAccess + SessionAgentWriter + MachineLaunchData + SyncAuthority + Presence | M: 按职责逐 API 拆迁；不把 Agent runtime/cleanup 放进 reader；同步 guard 表 |
| `apps/cli/src/session/roost-session-backend.ts:400` | `waitUntilSynced` | SessionAccess.history + SessionAgentWriter + SyncAuthority | A: backend adapter，backend 绑定、分页/分支/receipt 不变 |
| `apps/cli/src/session/session-backend.ts:503` | `waitUntilSynced` | SessionAccess.history + SessionAgentWriter + SyncAuthority | A: backend adapter，backend 绑定、分页/分支/receipt 不变 |
| `apps/cli/src/session/session-dispatch-watcher.ts:2` | `RepoTransportRoomStatus, repo, getOrCreateSessionDoc, waitUntilSynced` | SessionAccess + SessionAgentWriter + MachineLaunchData + SyncAuthority + Presence | M: 按职责逐 API 拆迁；不把 Agent runtime/cleanup 放进 reader；同步 guard 表 |
| `apps/cli/src/session/session-edit-and-resend-service.ts:82` | `getOrCreateSessionDoc, repo` | SessionAccess.editAndResend/fork + MachineRpc.session | M: 完整 saga、rewrite barrier、条件补偿、stored-copy owner |
| `apps/cli/src/session/session-execution-service.ts:849` | `getOrCreateSessionDoc, repo, waitUntilSynced` | SessionAccess + SessionAgentWriter + MachineLaunchData + SyncAuthority + Presence | M: 按职责逐 API 拆迁；不把 Agent runtime/cleanup 放进 reader；同步 guard 表 |
| `apps/cli/src/session/session-fork-service.ts:315` | `getOrCreateSessionDoc, repo` | SessionAccess.editAndResend/fork + MachineRpc.session | M: 完整 saga、rewrite barrier、条件补偿、stored-copy owner |
| `apps/cli/src/session/session-history-owner.ts:2` | `LoroRepo` | SessionAccess.history + SessionAgentWriter + SyncAuthority | A: backend adapter，backend 绑定、分页/分支/receipt 不变 |
| `apps/cli/src/session/session-launch-config-resolver.ts:111` | `openFlockDoc, repo` | WorkspaceCatalog + CatalogManagement + MachineLaunchData/MachineCommands | M: family 权限、冻结配置/Role、Magpie 本机确认、敏感 DTO gate |
| `apps/cli/src/session/session-manager.ts:934` | `repo, openFlockDoc, getOrCreateSessionDoc` | SessionAccess + SessionAgentWriter + MachineLaunchData + SyncAuthority + Presence | M: 按职责逐 API 拆迁；不把 Agent runtime/cleanup 放进 reader；同步 guard 表 |
| `apps/cli/src/session/turn-post-processing-service.ts:79` | `getOrCreateSessionDoc, repo` | SessionAccess + SessionAgentWriter + MachineLaunchData + SyncAuthority + Presence | M: 按职责逐 API 拆迁；不把 Agent runtime/cleanup 放进 reader；同步 guard 表 |
| `apps/cli/src/session/workspace-git-service.ts:67` | `getOrCreateSessionDoc` | SessionAccess + SessionAgentWriter + MachineLaunchData + SyncAuthority + Presence | M: 按职责逐 API 拆迁；不把 Agent runtime/cleanup 放进 reader；同步 guard 表 |
| `apps/cli/src/session/worktree/worktree-config-resolver.ts:77` | `repo` | WorkspaceCatalog + CatalogManagement + MachineLaunchData/MachineCommands | M: family 权限、冻结配置/Role、Magpie 本机确认、敏感 DTO gate |
| `apps/cli/src/session/worktree/worktree-gc.ts:1` | `injected consumer / storage / lifecycle` | SessionAccess + SessionAgentWriter + MachineLaunchData + SyncAuthority + Presence | M: 按职责逐 API 拆迁；不把 Agent runtime/cleanup 放进 reader；同步 guard 表 |
| `apps/cli/src/session/worktree/worktree-script-history.ts:105` | `waitUntilSynced` | SessionAccess + SessionAgentWriter + MachineLaunchData + SyncAuthority + Presence | M: 按职责逐 API 拆迁；不把 Agent runtime/cleanup 放进 reader；同步 guard 表 |
| `packages/components/src/atoms/agents.ts:59` | `openFlockDoc, repo` | WorkspaceCatalog + CatalogManagement + MachineLaunchData/MachineCommands | M: family 权限、冻结配置/Role、Magpie 本机确认、敏感 DTO gate |
| `packages/components/src/atoms/doc-meta.ts:6` | `LoroRepo, repo` | domain Layers + Legacy reader/View facade | A: 迁移 composition/公开 Repo/Doc 字段；所有借用方关闭后移除 |
| `packages/components/src/atoms/magpie-import.ts:83` | `openFlockDoc, repo` | WorkspaceCatalog + CatalogManagement + MachineLaunchData/MachineCommands | M: family 权限、冻结配置/Role、Magpie 本机确认、敏感 DTO gate |
| `packages/components/src/atoms/repo.ts:4` | `repo` | domain Layers + Legacy reader/View facade | A: 迁移 composition/公开 Repo/Doc 字段；所有借用方关闭后移除 |
| `packages/components/src/atoms/runtime.ts:7` | `LoroDoc, LoroRepo` | domain Layers + Legacy reader/View facade | A: 迁移 composition/公开 Repo/Doc 字段；所有借用方关闭后移除 |
| `packages/components/src/components/ai-gui/github-reference-link.tsx:89` | `repo` | domain DTO / native UI | X: 字段为 GitHub/route/UI DTO；不是数据 Repo，保持普通计算 |
| `packages/components/src/components/ai-gui/message-send-status-context.tsx:1` | `injected consumer / storage / lifecycle` | SessionSubmissions.observe + SyncAuthority.awaitUpload | M: confirmed 绑定原 barrier/目标，不误报远端执行 |
| `packages/components/src/components/ai-gui/view.tsx:4827` | `requestSessionCancel` | SessionAccess + MachineRpc.session.cancel | M: 渲染 DTO/control 与取消身份/实际 release 顺序 |
| `packages/components/src/components/bug-report/bug-report-dialog-container.tsx:98` | `requestMachineBugReport` | MachineRpc.machine.bugReport | M: 原能力/授权、大小/进度与 secret handling |
| `packages/components/src/components/chat/chat-landing-derived.ts:622` | `repo` | domain DTO / native UI | X: 字段为 GitHub/route/UI DTO；不是数据 Repo，保持普通计算 |
| `packages/components/src/components/chat/chat-landing.tsx:1476` | `repo, requestLocalProjectGitState, requestLocalProjectControl` | SessionDirectory/SessionAccess + CatalogManagement + MachineCommands/MachineRpc | M: 真实 UI 操作按命令收拢，保留草稿/首帧/权限与 queue/执行顺序 |
| `packages/components/src/components/chat/session-pending-sends-host.tsx:54` | `repo` | SessionSubmissions.submit/restore/cancel + SyncAuthority.awaitUpload | M: 保留唯一副本、顺序/identity、未知 receipt、附件与原上传策略 |
| `packages/components/src/components/local-projects/add-local-project-dialog-container.tsx:114` | `requestLocalProjectControl` | SessionDirectory/SessionAccess + CatalogManagement + MachineCommands/MachineRpc | M: 真实 UI 操作按命令收拢，保留草稿/首帧/权限与 queue/执行顺序 |
| `packages/components/src/components/loro-app-sidebar.tsx:1802` | `repo` | SessionDirectory/SessionAccess + CatalogManagement + MachineCommands/MachineRpc | M: 真实 UI 操作按命令收拢，保留草稿/首帧/权限与 queue/执行顺序 |
| `packages/components/src/components/mentions/mention-analytics.ts:139` | `repo` | domain DTO / native UI | X: 字段为 GitHub/route/UI DTO；不是数据 Repo，保持普通计算 |
| `packages/components/src/components/mentions/mention-project-file-source.ts:456` | `requestLocalProjectControl` | FileCollaboration.index + MachineRpc.projects | M: local-project owner/path、prefix 查询和 native 路由 |
| `packages/components/src/components/mobile/mobile-workspace-stack.tsx:43` | `repo` | domain DTO / native UI | X: 字段为 GitHub/route/UI DTO；不是数据 Repo，保持普通计算 |
| `packages/components/src/components/onboarding/screens/providers-screen.tsx:986` | `requestMachineAcpCapabilitiesRefresh, requestMachinePiExtensions` | WorkspaceCatalog + MachineRpc.agent + MachineCommands | M: 真实安装/能力/认证与 provider command，不用 fake 成功 |
| `packages/components/src/components/onboarding/tour/tour-repo.ts:1` | `injected consumer / storage / lifecycle` | InMemoryDataLive | A: 只准合成 onboarding 数据；迁成 Service fixture 后删除 fake Repo 公开面 |
| `packages/components/src/components/schedules/schedule-proposal-notice.tsx:411` | `repo` | WorkspaceSchedules.read/change/observe + SyncAuthority.refresh/awaitUpload | M: 保留 definition/registry flush、当前连接 gate 与原确认结果 |
| `packages/components/src/components/schedules/schedules-workspace.tsx:267` | `repo` | WorkspaceSchedules.read/change/observe + SyncAuthority.refresh/awaitUpload | M: 保留 definition/registry flush、当前连接 gate 与原确认结果 |
| `packages/components/src/components/sessions/ios-simulator/session-ios-simulator-panel.tsx:170` | `requestIosSimulatorControl` | MachineRpc.simulator | M: 原 capability/本机 scope/许可与 viewer 资源 lease |
| `packages/components/src/components/sessions/session-browser-panel.tsx:103` | `doc, requestSessionPreviewStatus, requestSessionPreviewEndpointRelease, requestSessionPreviewCreate, requestSessionPreviewEndpointAcquire, requestSessionPreviewRevoke` | PreviewComments + MachineRpc.preview/files + SyncAuthority | M: 预览/评论分开，lease/proof/readonly 与当前 sync 策略 |
| `packages/components/src/components/sessions/session-chat-interface.tsx:3561` | `requestSessionEditAndResend` | SessionDirectory/SessionAccess + CatalogManagement + MachineCommands/MachineRpc | M: 真实 UI 操作按命令收拢，保留草稿/首帧/权限与 queue/执行顺序 |
| `packages/components/src/components/sessions/session-detail.tsx:1617` | `requestSessionFork, requestLocalProjectGitState, repo, requestSessionTerminate` | SessionDirectory/SessionAccess + CatalogManagement + MachineCommands/MachineRpc | M: 真实 UI 操作按命令收拢，保留草稿/首帧/权限与 queue/执行顺序 |
| `packages/components/src/components/sessions/session-file-content-view.tsx:782` | `requestLocalProjectControl` | FileCollaboration.read/save/index + MachineRpc.files/projects | M: 保留路径/owner、readonly、local 路由和并发/实际请求释放 |
| `packages/components/src/components/sessions/session-message-submit-route.ts:1` | `injected consumer / storage / lifecycle` | SessionSubmissions route planner + Presence.observe | M: 纯 planner 保留正 live+unfinished barrier+capability |
| `packages/components/src/components/sessions/session-preview-preload.tsx:68` | `requestSessionPreviewStatus` | PreviewComments + MachineRpc.preview/files + SyncAuthority | M: 预览/评论分开，lease/proof/readonly 与当前 sync 策略 |
| `packages/components/src/components/sessions/use-session-diff-summary.ts:491` | `firstSynced` | SessionAccess.history/observeStatus + FileCollaboration.readTurnDiff | M: 按需真实 evidence/diff；不把 firstSynced 等同远端权威 |
| `packages/components/src/components/settings/github-settings-view.tsx:196` | `repo` | domain DTO / native UI | X: 字段为 GitHub/route/UI DTO；不是数据 Repo，保持普通计算 |
| `packages/components/src/components/settings/machine-agent-settings.tsx:381` | `waitForMachinePingResponse, requestSessionTerminate, requestMachineAcpCapabilitiesRefresh, waitForMachineRestartResponse, waitForMachineUpgradeResponse, requestMachinePiExtensions` | MachineRpc.machine/agent + WorkspaceCatalog + MachineCommands | M: 保留机器身份、能力/进度、secret 与本机解析兼容行为 |
| `packages/components/src/components/settings/mcp-setting.tsx:104` | `requestLocalMcpTools` | CatalogManagement.mcp + MachineRpc.agent.listTools | M: 权限/summary/秘密与原 tool discovery protocol |
| `packages/components/src/hooks/use-agent-role-schema-reconciliation.ts:63` | `requestMachineAcpCapabilitiesRefresh` | WorkspaceCatalog + CatalogManagement + MachineLaunchData/MachineCommands | M: family 权限、冻结配置/Role、Magpie 本机确认、敏感 DTO gate |
| `packages/components/src/hooks/use-code-collab-session-file-provider.ts:367` | `requestLocalCodeCollabFileIndex, requestFilePreview, requestCodeCollabOpenText, requestCodeCollabRefreshText, requestCodeCollabSaveText, requestCodeCollabOpenCurrentDiff, requestCodeCollabOpenAllChangesDiff, requestCodeCollabOpenTurnDiff, requestCodeCollabInitDirectory, requestCodeCollabLspDefinition, requestCodeCollabLspReferences` | FileCollaboration.read/save/index + MachineRpc.files/projects | M: 保留路径/owner、readonly、local 路由和并发/实际请求释放 |
| `packages/components/src/hooks/use-local-project-file-paths.ts:175` | `requestLocalProjectControl` | FileCollaboration.read/save/index + MachineRpc.files/projects | M: 保留路径/owner、readonly、local 路由和并发/实际请求释放 |
| `packages/components/src/hooks/use-local-projects-admin.ts:322` | `requestLocalProjectControl` | SessionDirectory/SessionAccess + CatalogManagement + MachineCommands/MachineRpc | M: 真实 UI 操作按命令收拢，保留草稿/首帧/权限与 queue/执行顺序 |
| `packages/components/src/hooks/use-machine-acp-authentication.ts:96` | `waitForMachineAcpAuthenticateResponse` | MachineRpc.machine/agent + WorkspaceCatalog + MachineCommands | M: 保留机器身份、能力/进度、secret 与本机解析兼容行为 |
| `packages/components/src/hooks/use-machine-acp-binary-actions.ts:50` | `waitForMachineAcpBinaryStatusResponse, waitForMachineAcpBinaryInstallResponse` | MachineRpc.machine/agent + WorkspaceCatalog + MachineCommands | M: 保留机器身份、能力/进度、secret 与本机解析兼容行为 |
| `packages/components/src/hooks/use-machine-actions.ts:49` | `repo` | MachineRpc.machine/agent + WorkspaceCatalog + MachineCommands | M: 保留机器身份、能力/进度、secret 与本机解析兼容行为 |
| `packages/components/src/hooks/use-machine-flock-rows.ts:418` | `firstSyncedWithRemote, openFlockDoc, repo, joinRoom` | WorkspaceCatalog.observe/read + CatalogManagement.change | A: 改为私有 family adapter，普通 hooks 不再取 Flock；权限/秘密按 family |
| `packages/components/src/hooks/use-machine-lifecycle-capability.ts:31` | `waitForMachineStatusResponse` | MachineRpc.machine/agent + WorkspaceCatalog + MachineCommands | M: 保留机器身份、能力/进度、secret 与本机解析兼容行为 |
| `packages/components/src/hooks/use-memory-provider.ts:42` | `requestMemoryProvider` | WorkspaceCatalog.memory + MachineRpc.memory | M: association CRUD 与 Provider 内容/权限分开 |
| `packages/components/src/hooks/use-preview-visual-comment-doc.ts:121` | `getSyncState, waitUntilSynced` | PreviewComments + MachineRpc.preview/files + SyncAuthority | M: 预览/评论分开，lease/proof/readonly 与当前 sync 策略 |
| `packages/components/src/hooks/use-project-skills.ts:339` | `requestLocalProjectControl` | FileCollaboration.read/save/index + MachineRpc.files/projects | M: 保留路径/owner、readonly、local 路由和并发/实际请求释放 |
| `packages/components/src/hooks/use-provider-quota-refresh.ts:18` | `requestProviderRateLimitsRefresh` | MachineRpc.agent.refreshQuota + WorkspaceCatalog.rateLimits | M: 共用既有 RPC/transport、缓存 freshness 不代替能力协商 |
| `packages/components/src/hooks/use-remove-local-project.ts:208` | `requestLocalProjectControl` | SessionDirectory/SessionAccess + CatalogManagement + MachineCommands/MachineRpc | M: 真实 UI 操作按命令收拢，保留草稿/首帧/权限与 queue/执行顺序 |
| `packages/components/src/hooks/use-schedules.ts:32` | `openFlockDoc, repo, joinRoom, firstSyncedWithRemote, firstSynced` | WorkspaceSchedules.read/change/observe + SyncAuthority.refresh/awaitUpload | M: 保留 definition/registry flush、当前连接 gate 与原确认结果 |
| `packages/components/src/hooks/use-session-actions.ts:185` | `repo, openFlockDoc, requestSessionCancel, requestSessionGoal` | SessionDirectory/SessionAccess + CatalogManagement + MachineCommands/MachineRpc | M: 真实 UI 操作按命令收拢，保留草稿/首帧/权限与 queue/执行顺序 |
| `packages/components/src/hooks/use-session-doc.ts:141` | `getSyncState, doc, waitUntilSynced` | SessionAccess.acquire + Legacy ConversationView/control facade | A: 移除 doc/getSyncState 公开面，保留同步 control、first-frame 和按帧 history |
| `packages/components/src/lib/code-collab-file-index-cache.ts:2` | `Flock, RepoRoomSubscription, firstSyncedWithRemote` | FileCollaboration.acquireIndex/observe/publish | A: owner-session 资源/版本 helper 私有；local RPC seed、LRU/release |
| `packages/components/src/lib/conversation-view/create-conversation-session.ts:8` | `LoroDoc, Mirror` | domain Layers + Legacy reader/View facade | A: 迁移 composition/公开 Repo/Doc 字段；所有借用方关闭后移除 |
| `packages/components/src/lib/doc-meta-batch.ts:1` | `LoroRepo` | domain Layers + Legacy reader/View facade | A: 迁移 composition/公开 Repo/Doc 字段；所有借用方关闭后移除 |
| `packages/components/src/lib/flock-version.ts:1` | `Flock` | FileCollaboration.acquireIndex/observe/publish | A: owner-session 资源/版本 helper 私有；local RPC seed、LRU/release |
| `packages/components/src/lib/legacy-session-send-migration.ts:121` | `repo` | SessionSubmissions.submit/restore/cancel + SyncAuthority.awaitUpload | M: 保留唯一副本、顺序/identity、未知 receipt、附件与原上传策略 |
| `packages/components/src/lib/local-project-import.ts:37` | `requestLocalProjectControl` | SessionDirectory/SessionAccess + CatalogManagement + MachineCommands/MachineRpc | M: 真实 UI 操作按命令收拢，保留草稿/首帧/权限与 queue/执行顺序 |
| `packages/components/src/lib/local-project-rpc-file-provider.ts:115` | `requestLocalProjectControl` | FileCollaboration.read/save/index + MachineRpc.files/projects | M: 保留路径/owner、readonly、local 路由和并发/实际请求释放 |
| `packages/components/src/lib/local-project-skills-provider.ts:33` | `requestLocalProjectControl` | FileCollaboration.read/save/index + MachineRpc.files/projects | M: 保留路径/owner、readonly、local 路由和并发/实际请求释放 |
| `packages/components/src/lib/memory-association-write.ts:14` | `openFlockDoc, repo` | WorkspaceCatalog + CatalogManagement + MachineLaunchData/MachineCommands | M: family 权限、冻结配置/Role、Magpie 本机确认、敏感 DTO gate |
| `packages/components/src/lib/project-history-control-client.ts:168` | `requestLocalProjectControl` | FileCollaboration.read/save/index + MachineRpc.files/projects | M: 保留路径/owner、readonly、local 路由和并发/实际请求释放 |
| `packages/components/src/lib/room-readiness.ts:1` | `RepoRoomSubscription` | SyncAuthority + DataOwnerLive private backend | A: 底层 owner adapter：cursor/Result、local/remote、读兴趣与写持有 |
| `packages/components/src/lib/roost-session-bridge.ts:910` | `requestHistoryRead, requestHistoryWrite` | SessionAccess.history + SessionAgentWriter + SyncAuthority | A: backend adapter，backend 绑定、分页/分支/receipt 不变 |
| `packages/components/src/lib/session-content-sync-state.ts:1` | `injected consumer / storage / lifecycle` | SessionAccess.status projection | M: 纯计算留普通函数；opening/cold/hasCaughtUp 顺序不变 |
| `packages/components/src/lib/session-input-storage.ts:1` | `injected consumer / storage / lifecycle` | SessionSubmissions.submit/restore/cancel + SyncAuthority.awaitUpload | M: 保留唯一副本、顺序/identity、未知 receipt、附件与原上传策略 |
| `packages/components/src/lib/session-pending-sends.ts:1` | `injected consumer / storage / lifecycle` | SessionSubmissions.submit/restore/cancel + SyncAuthority.awaitUpload | M: 保留唯一副本、顺序/identity、未知 receipt、附件与原上传策略 |
| `packages/components/src/lib/session-preparation-lease.ts:20` | `requestSessionPrepare, requestSessionPrepareCancel` | MachineRpc.prepare + MachineLaunchData | M: Scope/refcount、prepared claim 与取消交接 gate |
| `packages/components/src/lib/session-send-admission.ts:27` | `repo` | SessionSubmissions.submit/restore/cancel + SyncAuthority.awaitUpload | M: 保留唯一副本、顺序/identity、未知 receipt、附件与原上传策略 |
| `packages/components/src/lib/session-send-delivery.ts:79` | `repo, waitUntilSynced, requestSessionDispatchTurn, requestSessionSteer` | SessionSubmissions.submit/restore/cancel + SyncAuthority.awaitUpload | M: 保留唯一副本、顺序/identity、未知 receipt、附件与原上传策略 |
| `packages/components/src/lib/session-share-publisher.ts:47` | `firstSynced` | SessionAccess.shareSnapshot + SyncAuthority | M: 受限一致导出/first-sync timeout、原分享授权 |
| `packages/components/src/lib/session-submission.ts:130` | `repo` | SessionSubmissions.submit/restore/cancel + SyncAuthority.awaitUpload | M: 保留唯一副本、顺序/identity、未知 receipt、附件与原上传策略 |
| `packages/components/src/lib/workspace-catalog-room.ts:91` | `openFlockDoc, repo, joinRoom, firstSyncedWithRemote` | WorkspaceCatalog.observe/read + CatalogManagement.change | A: 改为私有 family adapter，普通 hooks 不再取 Flock；权限/秘密按 family |
| `packages/components/src/lib/workspace-catalog-write.ts:45` | `openFlockDoc, repo` | WorkspaceCatalog.observe/read + CatalogManagement.change | A: 改为私有 family adapter，普通 hooks 不再取 Flock；权限/秘密按 family |
| `packages/components/src/providers/create-workspace-runtime.ts:28` | `LoroRepo, RepoRoomSubscription, LoroStreamsMachineRpcClient, Mirror, LoroDoc, getSyncState, waitUntilSynced, requestMachineAcpCapabilitiesRefresh, openFlockDoc, firstSyncedWithRemote, doc, joinRoom, repo` | domain Layers + Legacy reader/View facade | A: 迁移 composition/公开 Repo/Doc 字段；所有借用方关闭后移除 |
| `packages/components/src/providers/eager-sync-snapshot-cache.ts:1` | `injected consumer / storage / lifecycle` | SessionAccess.prefetch/acquire + MigrationData.importReplica | A: raw worker/replica adapter；host 预取与副本覆盖 gate 后退出 renderer IO |
| `packages/components/src/providers/eager-sync-worker-client.ts:1` | `injected consumer / storage / lifecycle` | SessionAccess.prefetch/acquire + MigrationData.importReplica | A: raw worker/replica adapter；host 预取与副本覆盖 gate 后退出 renderer IO |
| `packages/components/src/providers/eager-sync-worker-task.ts:1` | `LoroDoc, firstSyncedWithRemote` | SessionAccess.prefetch/acquire + MigrationData.importReplica | A: raw worker/replica adapter；host 预取与副本覆盖 gate 后退出 renderer IO |
| `packages/components/src/providers/ephemeral-room-transport.ts:1` | `injected consumer / storage / lifecycle` | Presence.observe/publishSessionViewing + DataOwnerLive private presence adapter | A: 私有原生/Legacy transport adapter；按 origin、lease、监控授权拆开 |
| `packages/components/src/providers/local-window-bootstrap.ts:1` | `LoroRepo, LoroDoc, doc` | SessionAccess.prefetch/acquire + MigrationData.importReplica | A: raw worker/replica adapter；host 预取与副本覆盖 gate 后退出 renderer IO |
| `packages/components/src/providers/prompt-shortcut-provider.tsx:11` | `LoroRepo` | PromptShortcuts.read/edit/observe | A: 独立 index/body grant 与 durable-close；不是 workspace token |
| `packages/components/src/providers/room-sync-registry.ts:114` | `getSyncState` | SyncAuthority + DataOwnerLive private backend | A: 底层 owner adapter：cursor/Result、local/remote、读兴趣与写持有 |
| `packages/components/src/providers/room-sync-tracker.ts:1` | `RepoTransportRoomStatus, firstSyncedWithRemote` | SyncAuthority + DataOwnerLive private backend | A: 底层 owner adapter：cursor/Result、local/remote、读兴趣与写持有 |
| `packages/components/src/providers/room-sync.ts:60` | `firstSyncedWithRemote` | SyncAuthority + DataOwnerLive private backend | A: 底层 owner adapter：cursor/Result、local/remote、读兴趣与写持有 |
| `packages/components/src/providers/schedule-write-sync.ts:1` | `RepoRoomSubscription, waitUntilSynced, firstSynced` | WorkspaceSchedules.read/change/observe + SyncAuthority.refresh/awaitUpload | M: 保留 definition/registry flush、当前连接 gate 与原确认结果 |
| `packages/components/src/providers/workspace-machine-monitor-transport.ts:56` | `getSyncState` | Presence.observe/publishSessionViewing + DataOwnerLive private presence adapter | A: 私有原生/Legacy transport adapter；按 origin、lease、监控授权拆开 |
| `packages/components/src/providers/workspace-machine-rpc-facade.ts:12` | `LoroStreamsMachineRpcClient, requestFilePreview, requestCodeCollabOpenText, requestCodeCollabRefreshText, requestCodeCollabSaveText, requestCodeCollabOpenCurrentDiff, requestCodeCollabOpenAllChangesDiff, requestCodeCollabOpenTurnDiff, requestCodeCollabInitDirectory, requestCodeCollabLspDefinition, requestCodeCollabLspReferences, requestSessionCancel, requestSessionTerminate, requestSessionDispatchTurn, requestSessionPrepare, requestSessionPrepareCancel, requestSessionSteer, requestSessionGoal, requestSessionFork, requestSessionEditAndResend, requestSessionPreviewCreate, requestSessionPreviewStatus, requestIosSimulatorControl, requestSessionPreviewRevoke, requestLocalProjectGitState, requestLocalProjectControl, requestMemoryProvider, requestMachinePiExtensions, requestMachineBugReport` | MachineRpc + SyncAuthority + domain Services | A: composition/路由 adapter；manager/授权/关闭 owner 不重复构造 |
| `packages/components/src/providers/workspace-pending-sends.ts:28` | `repo` | SessionSubmissions.submit/restore/cancel + SyncAuthority.awaitUpload | M: 保留唯一副本、顺序/identity、未知 receipt、附件与原上传策略 |
| `packages/components/src/providers/workspace-presence-transport.ts:71` | `getSyncState` | Presence.observe/publishSessionViewing + DataOwnerLive private presence adapter | A: 私有原生/Legacy transport adapter；按 origin、lease、监控授权拆开 |
| `packages/components/src/providers/workspace-streams-transport.ts:17` | `LoroRepo, repo` | SyncAuthority + DataOwnerLive private backend | A: 底层 owner adapter：cursor/Result、local/remote、读兴趣与写持有 |
| `packages/components/src/providers/workspace-target-router.ts:1` | `LoroRepo, repo` | MachineRpc + SyncAuthority + domain Services | A: composition/路由 adapter；manager/授权/关闭 owner 不重复构造 |
| `packages/components/src/providers/workspace-writer-impl.ts:9` | `LoroRepo, repo, openFlockDoc` | domain Layers + Legacy reader/View facade | A: 迁移 composition/公开 Repo/Doc 字段；所有借用方关闭后移除 |
| `packages/components/src/routes/$workspaceName/_auth/chat.tsx:45` | `repo` | SessionDirectory/SessionAccess + CatalogManagement + MachineCommands/MachineRpc | M: 真实 UI 操作按命令收拢，保留草稿/首帧/权限与 queue/执行顺序 |

## 未闭合范围

U 行按其切片进一步追踪；共享 packages 的实现、raw requests、原始 IDB/SQLite、公开 API 的返回类型、Electron 与 platform ports 还需在对应实现中纳入最终调用图。源扫描清单不是“只有这些文件用数据”的证明。Source API 成员可能只是 callback/reference，不是直接 I/O。
