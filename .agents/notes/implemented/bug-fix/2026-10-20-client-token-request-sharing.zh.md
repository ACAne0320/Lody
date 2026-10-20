# 共享客户端 token 请求并对失败结果退避

Status: implemented
Translation: current

[English](2026-10-20-client-token-request-sharing.md)

## 摘要

客户端向托管服务请求同一个 token 的次数，多于其缓存应有的次数。并发或迟到的 GitHub
401 各自强制刷新；两个 Convex JWT 入口不共享请求；CLI 凭据 broker 没有进行中请求合并；
PR 轮询即使最终使用本地 `gh`，每轮仍先请求云端；文档同步与 Machine RPC 各持一个 Streams
token 内核。现在这些路径对同一身份与范围只发起一次请求；只有缓存仍是被拒绝的旧 token
时才使其失效。CLI 对失败的 GitHub 结果至多复用 30 秒，因此没有配置信号时，新授予的
凭据最多 30 秒后才会被使用。跨窗口共享与线上请求率不在本次范围内。

## 问题与证据

离线复现使用真实客户端模块，只替换网络响应。以下场景原本每个调用者各发一次请求，
而不是每个键一次：

| 路径                                                  | 修改前                  |
| ----------------------------------------------------- | ----------------------- |
| 20 个操作对同一个人 GitHub token 收到 401             | 20 次刷新               |
| 新 token 已发布后，旧请求的 401 才返回                | 删除新缓存并再次刷新    |
| Convex 登录刷新与 GitHub `unauthorized` 恢复同时发生  | 2 次 JWT 请求           |
| 20 个并发 broker 候选查询（`getCredentialCandidate`） | 20 次请求               |
| 个人身份不可用，连续查询 20 次                        | 20 次请求               |
| 托管 token 不可用、`gh` 可用时的 PR 轮询              | 每轮一次云请求          |
| 同一工作区文档同步与 Machine RPC 冷启动               | 2 次 Streams token 请求 |

原因都在客户端：`getGitHubOperationToken` 带 `invalidatedPersonalToken` 时跳过缓存与
进行中请求；失效按键删除而非按 token；`cloud-github-token-port.ts` 自有一份进行中 JWT，
与 provider 的按会话 Map 分离；`GitHubTokenManager` 只缓存成功结果，且会话与 PR 轮询
各建一个 manager；CLI 云端口为每个消费者构建一个 Streams 内核。

## 决定

**前端 GitHub token。** `github-token.ts` 中普通获取、过期刷新与拒绝后刷新共用一条路径。
收到 401 的调用者传入它使用的 token；只有缓存仍持有该 token 时才删除，迟到的 401 因此
复用新 token。等待者加入该键进行中的请求；只有当该请求不知道这次拒绝且返回了被拒绝的
token 时，才再发起一次，并由所有携带同一拒绝的等待者共享。工作区代际隔离保持不变。

**Convex JWT。** `lib/convex-jwt.ts` 持有每个 auth client 的请求表。已挂载的 provider
发布其 auth key（恢复代际、登出意图、会话 ID）；GitHub 恢复加入该键的请求，若 JWT 返回前
意图代际或键已变化则返回 null。不同会话仍从不共享请求。

**CLI GitHub token。** `createSharedGitHubTokenManagers` 让会话与 PR 轮询以租约共用每个
工作区一个 manager，最后一个租约释放时关闭。候选查询按缓存键合并进行中请求，拒绝规则
与前端相同。候选缓存与写 token 状态都按分区记住失败：

| 结果                                           | 复用                              |
| ---------------------------------------------- | --------------------------------- |
| 仓库未关联、个人授权不可用、安装/授权/成员错误 | 30 秒                             |
| 网络错误、超时、`token_generation_failed`      | 从完成时起 1 秒并翻倍，最长 30 秒 |
| `unauthorized`（CLI 登录）                     | 从不复用                          |

`invalidate` 与 `invalidateAll` 清除记住的失败，并以 epoch 隔离进行中的请求；对已被替换
的 token 的拒绝会被忽略。复用期间该来源仍视为失败；来源顺序、机器资格与“每次操作每个
来源一次”保持不变。[身份降级 Spec](../../../../specs/github-identity-fallback.zh.md)
已同步说明，仍为待审 draft。这部分取代了[身份降级记录](../architecture/2026-10-03-github-identity-fallback.zh.md)中“失败不缓存”的选择。

**CLI Streams token。** `streams-token-shares.ts` 在官方云端口中为每个工作区保留一个内核，
原生与 Legacy provider 都是它的视图：

| 问题     | 回答                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 触发     | 首次借用在共享自有的 Scope 中构建内核，之后的借用加入它                                                                                                             |
| 拥有者   | 共享对象拥有内核；每个消费者拥有自己的视图                                                                                                                          |
| 取消     | 等待者中断只释放自己的内核租约；视图关闭只隔离并中断该视图的读取，其他视图继续                                                                                      |
| 交接     | 最后一个关闭移除共享并关闭内核；之后的借用构建新内核，与原先每消费者一个内核一致                                                                                    |
| 失败恢复 | 内核关闭失败时报告内核为拥有者；任一视图的 `retryCleanup` 委托给它                                                                                                  |
| 隔离     | 内核释放失败或终止性 401/403 现在会同时隔离 Machine RPC 与已共享的 durable/presence。此前 Machine RPC 从不调用 `retryCleanup`，现在 durable attach 路径也会替它恢复 |

## 考虑过的方案

- 固定间隔节流 PR 轮询，会同样延迟成功的托管 token；失败缓存只影响本会再次失败的结果。
- 通过内存 storage 端口共享 Streams 缓存，后来的 provider 能复用 token，但同时冷启动仍会请求两次。
- 全局 token 队列会串行化无关的键；共享按键进行。

## 验证与限制

所属测试套件（`github-token.test.ts`、`recoverable-convex-better-auth-provider.test.tsx`、
`github-token-manager.test.ts`、`cloud-cli-port.test.ts`）新增的用例使用显式 deferred 响应
与注入时钟，断言到达云边界的请求与调用者拿到的 token。对旧实现做消融时，关键用例失败：
前端 2 个、manager 8 个，以及 Streams 共享用例。

未覆盖：跨窗口/跨标签页共享（阶段 D 需要平台服务并单独审查）、一次性 CLI 命令（独立
进程）、Electron 主进程自身的 JWT 获取，以及服务端去重。未测量线上请求率；节省效果需在
发布后按客户端版本比较。
