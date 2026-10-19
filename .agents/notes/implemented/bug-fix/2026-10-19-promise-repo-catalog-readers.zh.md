# daemon 目录 reader 改用已发布的 Promise Repo API

Status: implemented
Translation: current
PR: [#1715](https://github.com/LodyAI/Lody/pull/1715)

[English](2026-10-19-promise-repo-catalog-readers.md)

## 摘要

#1713 已将产品消费者恢复到已发布的 Promise Repo API，但之后加入的 daemon 目录 reader 仍调用已撤回的原生 workspace facade，导致 CLI 类型检查和新增集成测试失败。reader 现持有公开 Repo room subscription；每个请求的首次基线等待有界且不会取消 daemon 的 room 所有权，临时加入失败会按有上限的退避策略重试，并在关闭 Repo 前释放房间。

## 原因

#1692 加入的目录 reader 使用了 `repo.native.acquireRoom`、`runLegacy` 和仅供测试使用的 `WorkspaceRepoLegacy` 路径。#1713 已撤回这些消费者 API，并在保留 Repo 0.23.2 的同时移除了原生 facade。因此产品消费者与实际依赖不兼容，测试也导入了未发布的 Shared 子路径。

## 所有权

`workspace-catalog-sync-legacy.ts` 通过 `LoroRepo.joinFlockDocRoom()` 持有被查询机器目录的订阅，并观察 manager 已有的 metadata 订阅。Repo subscription 可跨 transport 断开与重连继续使用；每次 discovery 请求只对已有的首次同步 Promise 添加自己的超时。可重试的 room 获取错误使用有上限的指数退避。关闭 reader 时会中止等待中的获取并取消已持有的订阅，且发生在 Repo 关闭之前。Role 提议校验仍使用独立的严格 `syncFlockDocOrThrow` 流程。

此实现遵循 [#1713](../simplification/2026-10-19-repo-upgrade-without-consumer-migration.md) 的回退决策，并取代早期 [daemon workspace 命令记录](../architecture/2026-10-16-daemon-hosted-mcp-workspace-commands.md) 中的原生目录 reader 生命周期及专用测试；旧记录保留原始实现历史。

## 验证

- 本机 `workspace-catalog-sync-legacy.test.ts` 通过（2 项），覆盖有界等待、退避重试、断线及关闭；`daemon-session-tools.test.ts` 通过（11 项），覆盖双 Repo 目录载入、实时更新和重连。
- CLI worktree 链接到了相邻 checkout 的旧依赖，与此锁文件不一致。完整 CLI 类型检查产生无关的依赖和测试类型错误；修改文件没有类型错误。完整检查仍以干净 CI 为准。此前 CI 已复现上述 API 与 export 缺失错误。
