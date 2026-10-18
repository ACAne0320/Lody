# 在正确的生命周期时点报告 Claude 额度限制

Status: implemented
Translation: current

宿主 PR：[LodyAI/Lody#1701](https://github.com/LodyAI/Lody/pull/1701)。

适配器 PR：[LodyAI/acp-extension-claude#43](https://github.com/LodyAI/acp-extension-claude/pull/43)。

[English](2026-10-19-claude-goal-quota-notifications.md)

## 摘要

Claude 的额度限制可能被放入上下文用量元数据后丢失，让用户在没有解释的情况下等待。
现在 Lody 收到限制就显示通知，并在适用的原生结束边界返回 ACP 错误；没有 result 时也识别 idle 和真实消息流结束。
SDK 消息流、排队请求和其他后台任务各自保留原有生命周期。
确定性测试覆盖提前通知、终态用量、延迟 idle 消息、恢复和复用运行时；未使用真实受限账号验证。

## 原因和纠正

此前只有观察到真实助手消息的用量后，SDK 的 `rate_limit_event` 才会产生
`usage_update`。宿主只消费上下文大小和 token 数量，忽略 `_claude/rateLimit`；
此前没有用量观察时，适配器完全不发送通知。
明确的额度文字能够显示，但终态将额度耗尽按致命内部错误处理，也不更新 goal。

限制事件确认的是额度事实，不代表 SDK 进程或所有任务都已结束。
适配器负责报告限制并继续消费原生消息，由既有的原生结束边界决定何时结束 prompt。

## 事件顺序和所有权

ACP v1 通过结果或 JSON-RPC 错误响应结束 `session/prompt`，通知不会结束请求。
ACP 不规定必须等待 Claude SDK 的 `result`，也没有专门的额度停止原因。
依据：[错误处理](https://agentclientprotocol.com/protocol/v1/overview#error-handling)和
[请求轮次](https://agentclientprotocol.com/protocol/v1/prompt-turn)。
当前 SDK 0.3.293 将额度事件定义为状态变化；适配器已有生命周期将活跃轮次不欠账的 idle
和真实 EOF 作为结束边界。本次在这些相同边界表达额度失败，不要求某一种消息一定到达，也不添加计时器。

1. 订阅窗口被拒绝且无可用额外额度时，立即发送 Core 错误通知，不依赖是否已有模型用量。
   提供的秒级重置时间以 ISO UTC 显示，不声称已经停止进程。
   `allowed`、`allowed_warning` 和额外额度可用的情况沿用原路径。
   原生助手的额度错误解释也通过同一通知路径送达。
2. 当前 prompt 保持等待，直到适用的原生结束边界到达。
   额度通知保留所属轮次标识，避免自主运行结果消费前台的限制记录。
   同一轮次延迟的 echo 不会丢失该记录；匹配结果或另一轮次的激活会清除它。
3. 原生结果确认额度失败后，保留目标内容，并将活跃 goal 发布为 `limited`。
   正常结果路径记入用量，只拒绝该结果所属的 prompt，携带 `errorKind: quota_exhausted`。
   自主运行结果只报告会话事实，不拒绝下一个用户请求。
   原生结果若成功，不因此前出现过限制事件而被改为失败。
   活跃轮次若没有保存成功结果、没有等待 steer 回答、也不欠此前轮次的 idle，
   其 idle 会返回已知额度错误，避免误报为普通 `no_result` 内部错误。
   排队输入收到的提前 idle 和前一结果的延迟 idle 都不会进入这条失败路径。
   自主运行额度受阻后进入 idle，只更新 goal，不拒绝排队用户的输入。
   真实 EOF 对额度记录所属的活跃或未启动排队请求返回额度错误，避免误报成功或可自动恢复的会话断线。
4. 宿主保留普通 `acp_internal_error` 分类和「Agent 内部错误」卡片，
   详情展示供应商给出的额度原因和重置时间。单独识别结构化额度标志，避免终止进程或自动重放。
   Core 的错误级通知经 AgentClient 保留严重级别，复用既有失败历史写入；普通警告沿用原路径。
   通知只追加历史，活跃轮次仍可继续接收原生输出。
   终态错误中的 `quotaNoticePublished` 避免重复；没有提前通知时使用相同卡片。
   本次不新增共享错误原因或额度专属本地化标题。
5. 仍存活的消息流保留给后续明确的用户请求。
   延迟 idle 的记账、原生任务生命周期、取消和真实流关闭仍归既有机制负责。
   额度事件不取消排队请求、不清空任务、不移除会话，也不捏造任务完成。
   AIR 的结构化会话错误行为保持原样。
   真实 EOF 仍沿用原有的流结束清理，因为该 query 已经结束；单纯的额度通知不会发起清理。

宿主将错误级中立通知持久化为既有的 `chat_failed`，并将 `limited` 映射为持久化的 `blocked`。
Codex 在 Lody 当前协议路径中已将原生 `usageLimitExceeded` 返回为普通内部错误响应；
本次复用同一展示，不改变 Codex 生命周期。
沿用现有 [goal 职责](../../../../specs/session-goal-control.md)和
[通知呈现](../../../../packages/components/src/components/ai-gui/agent-notices.md)。
重启后的历史任务状态校准不属于本次修复。

## 生命周期与 Effect 评估

供应商适配器拥有 SDK 解释和 prompt/结果关联；宿主拥有轮次收尾和实际进程终止职责。
报告限制不会取消本地等待，也不会停止 SDK 原始工作。
正常取消和消息流结束仍是资源释放条件；额度失败的终态不销毁存活的运行时或交接给替代进程，
真实 EOF 则仍释放已经结束的 query。
额度标志只记录通知已成功送达，不声称模型或其他进程已被杀死。
后续明确的用户输入才触发恢复尝试。

本次沿用第三方 SDK 适配器，宿主改动为纯错误分类和历史通知选择。
原生 Effect 迁移会扩展到[迁移台账](../../proposed/architecture/2026-09-27-effect-lifecycle-migration-roadmap.md#unit-ledger)
中尚未完成的 ACP 生命周期依赖链。本次不改变依赖或原生所有权边界。

## 验证和限制

合成消息流和显式 Promise 信号验证实际 SDK 消费循环。
先检查“通知已到、结果未到”的区间，再释放结果，验证 goal 状态、最终用量、
排队轮次隔离、延迟 idle、后台任务状态保持，以及同一 query 上的第二次请求。
覆盖两种原生错误结果、成功恢复、自主运行额度错误、预警和额外额度，以及原有 AIR 行为。
没有 result 的用例覆盖活跃及排队 EOF、活跃 idle、欠账的延迟 idle、输入 echo 前的 idle，
以及没有 prompt 等待者时自主运行的 idle/EOF。

宿主测试覆盖先通知后更新 goal、额度分类、不自动重放、保留运行时、释放轮次，
以及有无提前通知时历史都只显示一次错误。
真实历史写入另验证错误严重级别、普通警告保持原样，以及同一未结束助手轮次仍能继续接收输出。
相关包类型检查、适配器构建及 lint/格式检查、共享历史与解析测试、组件通知测试补充验证。
未使用真实账号、真实额度重置或打包桌面运行，测试不能证明原反馈者账号受限的具体时点。

基于当前 main 的隔离工作区已通过 `pnpm check` 和 `pnpm format`，包含全量包测试和边界检查。
文档检查仍有 subagent-events 提议引用缺失 Kimi/Pi 文件的原有六处错误，未修改这些无关文件。
本记录不表示 Spec 获批或已发布版本。
