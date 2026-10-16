# 保留客户端日志，并随机器 bug 上报一起发送

Status: implemented
Translation: current

[English](2026-10-16-client-bug-report-log.md)

## 摘要

Bug 上报会带上机器守护进程的日志，但不包含用户正在使用的应用本身的任何信息；渲染进程自己的诊断信息只在内存中，
所以当 iOS 用户的 WebView 刚被系统杀掉并重新加载、再打开上报对话框时，这些信息已经没了。现在渲染进程会把重要事件
记录到 IndexedDB，限定为 48 小时内最新的 2 MiB。记录的内容包括：错误边界捕获的崩溃、启动失败、没有重试的失败、
卡住的启动等待、重新加载，以及没有正常卸载就结束的上一个页面。选择了机器的 bug 上报会把日志 gzip 后发给守护进程，
由它作为同一个 `logContent` 中的 `client.log` 一节上传，一次上报就包含两边的日志。只有描述的上报仍然不带日志，
因为托管接口在这条路径上的契约在本仓库中看不到。

## 问题

`machine/bug-report` 让所选机器上传它自己的日志，渲染进程只附带构建信息。它知道的其他信息（会话渲染轨迹、启动请求
失败）都在内存里，会随最重要的事件一起消失：被系统杀掉并重新加载的 WebView，或用户随后通过重新加载摆脱的渲染进程
崩溃。

## 决定

**记录（`lib/client-log.ts`）。** 提供显式接口 `recordClientLog` 和 `recordClientError`，不拦截 `console`，
所以只保留调用方选择记录的事件。每个字符串都经过 `redactClientLogText`，去掉 bearer token、JWT 和类似 token 的
查询参数。单条记录（含堆栈）最多 16 KiB。

| 事件                                          | 来源                                                     |
| --------------------------------------------- | -------------------------------------------------------- |
| `react.error_boundary`                        | 每次 `ErrorBoundary` 捕获，含边界名称和组件堆栈          |
| `boot.failed`、`boot.failure_reload_clicked`  | React 之前的启动失败页                                   |
| `runtime.operation_failed`                    | `RuntimeProvider` 中非关闭阶段的失败                     |
| `boot.wait_stuck`                             | `BlockingWaitPlaceholder` 进入恢复页，含 gate 和 blocker |
| `cache.clear_on_boot`、`app.reload_requested` | 启动时执行的清除，以及应用请求的重新加载                 |
| `window.error`、`window.unhandled_rejection`  | 未捕获的错误                                             |
| `page.boot`、`page.visibility`、`page.hide`   | 这些事件前后的生命周期，含导航类型和构建信息             |
| `page.previous_ended_without_unload`          | 没有到达 `pagehide` 的上一个页面                         |

最后一行就是“自动重启”的表现。WebContent 进程被杀掉时什么都不会运行，所以每个页面在 `localStorage` 中保存一个启动
标记，并在可见性变化和 `pagehide` 时同步更新。下一次启动时，如果标记从未结束，就记录它，以及它最后的可见性和那次
变化的时间。

**存储。** 记录分批写入（错误立即写入，页面隐藏时也会写入）`lody-client-log` 数据库。清除缓存会保留日志，因为它说明了
为什么需要清除；完全重置会删除它。没有 IndexedDB 时，日志在内存中按同样的上限保留。

**发送。** bug 上报对话框构建上传内容：在原始 2 MiB、gzip 后 1 MiB 以内的最新若干行，再做 base64 编码。压缩后 1 MiB
的上限与已经经过 Loro Streams 请求路径的 Code Collab 和文件预览载荷一致。`machine/bug-report` 的请求 schema 是严格的，
旧版守护进程如果收到这个字段会拒绝整个上报，所以客户端日志由新的机器协议能力 `bugReportClientLog` 控制：对于没有
声明这项能力的机器，工作区 RPC facade 会去掉这个字段，上报照常提交。守护进程解码日志并附加在自己的日志之后；无法
解码时，这一节会说明原因，而不是让上报失败。

## 未采用的方案

- **捕获所有 `console` 输出。** 会保留调用方从未选择保留的智能体文本、路径和 URL。
- **由渲染进程以同一个上报 id 直接上传客户端日志。** 需要新的托管接口，还会把一次上报拆成两次上传。
- **把日志放进描述。** 描述是用户编写的文本，会按原样显示，其大小限制在这里也不清楚。

## 局限

- **只有描述的上报：** 没有在线机器时提交的上报仍然不带客户端日志。要在这条路径上发送 `logContent`，需要托管接口
  接受它。
- **请求流中的明文：** 客户端日志与描述一样以明文放在请求参数里，所以会在工作区请求流中保留到过期。像认证输入那样
  加密给目标机器，就能消除这一点。
- **被杀前的最后几秒：** 进程被杀前最后一秒内写入的记录可能丢失；启动标记是同步写入的，所以不受影响。

## 验证

- `tests/client-log.test.tsx` 覆盖：
  - 模拟重新加载后日志仍然保留；
  - 识别没有经过 `pagehide` 就结束的页面；
  - 未捕获的错误和 rejection；
  - 时间和字节上限；
  - 脱敏；
  - 上传内容能解码回原日志；
  - `ErrorBoundary` 捕获的错误连同组件堆栈被记录。
- `tests/workspace-machine-rpc-facade.test.ts` 检查：日志会发给声明了这项能力的守护进程；发给旧版守护进程时，
  上报不带日志也照常提交。去掉能力判断后这项检查会失败。
- `packages/loro-streams-rpc` 的服务端测试：该字段能到达守护进程的处理函数。
- `apps/cli` 的 `bug-report.test.ts`：上传的 `logContent` 包含 `client.log` 一节，无法解码的日志会在原位置说明。
