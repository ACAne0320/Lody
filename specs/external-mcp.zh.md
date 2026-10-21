# 本机外部 MCP 接入

Status: draft
Translation: current

[English](external-mcp.md)

用户可用 HTTP URL 和 bearer token 将其他本机 Agent 连接到 Lody，无需伪造
Lody 调用会话或保持 Turn 活跃。接入默认关闭。共用的 HTTP host 继续仅监听
loopback，外部路由使用独立本地 token，绑定当前安装的用户、机器和一个
workspace。它不同于内部 MCP 凭据和云端 CLI 账户 token。本地组合不得请求产品云认证。

外部工具与内部 MCP 共用业务服务。首版写入可创建独立会话，或向该用户在本机的
会话发送输入。读取提供已授权的资源发现、该用户本机会话的摘要、实时状态、
有界历史。外部接口不开放 `lody_operation_get` 和 `lody_mcp_list`；创建/发送仍返回
接受回执。不推断内部调用身份、父会话关系、自动完成回调或
环境变量中的会话。持有 token 即获得以绑定用户身份执行这些动作的权限；
每次写入入口重新校验凭据和 daemon 范围。撤销拒绝新请求，不取消已准入的工作。

每次写入必须提供 operation id。服务端在调用写入服务之前固定目标 Session/Turn
并占用请求。相同 id 携带不同参数会被拒绝，同一 id 不会提交第二次写入。
占用后的中断代表结果不确定，不代表可以重放。客户端应检查固定目标，
不得自动换一个新 id 重发结果不确定的请求。accepted 回执表示分发已接受，
不表示任务完成。外部回执不自动过期，轮换本地 token 也不会清除。

## 证据

实现与限制：[MCP README](../apps/cli/src/mcp/README.md#http-and-loopback)。
本草案记录新增的外部认证和请求持久性契约，不批准或修改内部的
[会话编排](session-orchestration.zh.md)契约。
