# 本机外部 MCP 接入

Status: implemented
Translation: current
PR: [#1766](https://github.com/LodyAI/Lody/pull/1766)

[English](2026-10-20-external-mcp.md)

## 摘要

外部 Agent 现在可以使用本机 Lody HTTP host，无需活跃的调用会话。默认关闭的
独立路由通过绑定 workspace 的本地 token 认证，复用资源发现、历史读取和
会话命令服务；内部 MCP 保留活跃 Turn 授权。外部写入在提交前持久化固定的请求/
目标标识，绝不自动重放结果不确定的请求。首版支持资源发现、该用户本机会话的
操作及任务提交/结果检查，不提供云端账户 token 认证或完成回调。

## 决定与范围

采用现有 loopback HTTP host 的 `/mcp/external` 路由。`mcp access enable`
签发仅展示一次的 token，`status` 显示地址，`disable` 撤销新调用。磁盘只保存
token 哈希和明确的用户/workspace/机器绑定；轮换保留外部请求身份。host 尽量
复用已保存端口，地址发布采用 best-effort，避免外部发现失败影响内部 MCP。

新增认证和持久性边界需要人工评审，记录在
[外部 MCP Spec 草案](../../../../specs/external-mcp.zh.md)。
内部调用继续遵循既有的
[daemon 托管 MCP 决策](2026-10-16-daemon-hosted-mcp-workspace-commands.md)。
Spec 草案状态或测试通过都不代表详细契约已经获批。

资源发现复用目录注册和资源服务，历史复用有界读取器。创建/发送经独立于
Session 工具认证的 daemon 入口调用已有命令服务。会话读写限定为绑定用户
在本机的会话。创建必填 Agent config，可选本地项目以及 model/mode/config
选项；不开放 Role、附件、父会话选择、批量、计划任务或目录修改等外部写能力。
显式 `currentSessionId: null` 阻止环境中的 `LODY_SESSION_ID` 成为调用方或创建来源。

## 请求归属与失败行为

内部 Operation 存储按父 Session 定位请求，并负责自动 Inbox 续接；原样复用会
伪造来源。外部回执按用户/workspace/机器/operation id 定位，只记录规范化参数
哈希及固定 Session/Turn id，不存 prompt、token 或输出。排他创建文件在调用
命令前占用写入，文件权限为 0600，新目录为 0700；并发重复请求不会再次执行。

准入后的命令由 daemon 持有，不随 HTTP 等待方断开而结束。HTTP 和写入边界
都校验当前凭据；撤销影响后续准入，不取消已经准入的工作。命令成功返回且 repo
flush 后记录 accepted，它不表示 Agent 已完成。占用之后的崩溃或失败保留为
uncertain，需要检查固定目标。不增加自动 materializer、过期或回执删除；
换新 token 不会允许重用旧请求 id。

Effect feature/fix 评估：涉及的服务和 HTTP owner 仍依赖既有 Promise 命令编排。
本改动不迁移这些 owner，也不声称完成原生生命周期。HTTP/CLI 应用边界调用现有
原生 IPC/catalog 程序；新回执 I/O 是文件系统适配，没有独立计时器、runtime
或恢复 worker。

## 验证与限制

测试覆盖真实 daemon 持有的 Loro 历史创建/发送、固定 id 重试、没有父会话来源、
隐藏工具、跨用户拒绝、凭据轮换/撤销、回执持久化和并发重复请求隔离。
真实 MCP client 使用内存 transport，HTTP 准入使用内存 request/response
测试。CLI 类型检查及公开仓库/平台/local writer/Inbox 边界检查通过。
不声称已经验证第三方桌面客户端、托管云账户或断电故障注入。
