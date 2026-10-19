# 恢复目录与已安装 Repo 的 API 兼容

Status: implemented
Type: bug-fix
Translation: current
PR: [#1728](https://github.com/LodyAI/Lody/pull/1728)

[English](2026-10-19-catalog-repo-api-rollback.md)

## 摘要

#1692 的 Daemon 目录改动调用了原生运行时桥接方法，但已安装的
`loro-repo@0.23.2` Promise `LoroRepo` 并未提供这些方法，导致 CLI 和桌面无法编译。
本次在当前 main 上撤回 #1692，保留 #1679 的会话闲置回收修复和已确认的发布文案。
目录发现恢复此前的显式同步行为，读取仍可能受网络故障影响。

## 决策与边界

回退删除不兼容的后台读取所有者，恢复 #1692 之前的目录实现与测试。
它保留更早引入的 Daemon 承接 MCP 调用，不改存储结构、不升级依赖，
也不移除 #1679 对 Agent 工作状态的回收保护。不会创建第二份 Repo。

按公开 Promise 房间 API 重写读取所有者属于另一项生命周期改动。
请求的等待不能拥有或取消 Daemon 读取者；恢复纯缓存读取前，必须验证元数据、
工作区目录和已授权机器目录的首次同步状态。直接换用原生 Repo 无法与现有
Promise Repo 共享副本。本次有意推迟这些改动，让发布使用锁定依赖完成编译。

中英文公开 changelog 仅把版本从 0.107.0 改为 0.107.1，已确认的功能、
修复与贡献者正文不变。0.107.1 仍以工作流生成的 Release Please 结果为准。

## 证据

npm 已发布的 `loro-repo@0.23.2` 声明提供 `joinMetaRoom`、
`joinFlockDocRoom`、`destroy` 等 Promise 方法，没有 `runLegacy`、
`acquireScopeLegacy` 或 `native`。#1692 还引用了未导入的 `Scope`。
调用边界位于 `apps/cli/src/lib/loro/doc.ts`。

已执行的验证及限制记录于 PR。本说明不代表已经部署，也不代表任何用户的
运行中 Daemon 已恢复。
