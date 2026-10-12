# 原生工作区 presence 所有权

Status: proposed
Translation: current

[English](2026-10-12-effect-workspace-presence.md)

## 摘要

现有工作区 presence 使用 timer 与 Promise join，在确认清理前清空远端句柄，且超时的 bootstrap 读者仍被登记。
拟议原生内核保留同步 CRDT 状态，以子 Scope 拥有 heartbeat 与远端任务，并保留释放失败的完整 Cause 与恢复拥有者。
共享应用 registry 与一个显式 Legacy 门面将连接既有消费者。
token 与上游原生 ephemeral API 稳定、固定正式发布版本并真实消费之前，产品集成仍未完成。

## 行为合同

授权 attach 启动远端代际；本地双 store 与 30 秒机器 heartbeat 不依赖云授权。
远端 detach 先禁止请求，终止任务并启动 transport 关闭，以独立有界观察者等待实际 Exit，最后关闭 Scope。
超时保留原 Fiber、资源拥有者及完整 Cause，并阻止 replacement。
并发 stop/detach 共享 Deferred receipt。恢复先等待原任务，仅在释放失败已实际完成后调用下层恢复 API。
取消读者只解除其 bootstrap/barrier/token waiter，不关闭共享 producer 或工作区 token provider。
应用根拥有工作区关停；session 租约和本地 relay pacer 属于后续 P6/P7。

双 store 保持来源划分：远端合入工作区 replica，本地 relay 仅编码本进程写入。
CRDT 编解码、解析、set/delete 与快照保持同步。
不新增周期 durable metadata 写入、第二套 POST/SSE 队列、每工作区 ManagedRuntime 或重复 token 缓存。
bootstrap readiness、捕获的 queue barrier、send ACK 与 peer receipt 是不同证据。
read joined 不能证明投递新鲜。上传无进展仅产生有界安全诊断，不自动触发重连。
health 的 idle 只表示本地队列为空，不证明 peer 已观察到新鲜状态。
终态重试保留 flap 历史，rejoin 后重发最新本地状态。

## 依赖与集成局限

本单元部分替代[presence 预算决定](../../implemented/architecture/2026-09-20-ephemeral-presence-channel-budget.zh.md)中的工作区所有权机制，
不改变 publisher 频率/大小义务与三态读取合同。
根[路线图](2026-09-27-effect-lifecycle-migration-roadmap.zh.md)由协调者维护。
CLI 消费锁定 Effect 4.0.2；已完整读取其 AGENTS 及相关 resource/service/Fiber/Scope/testing 源码。
Scope.close 不等待先前 close，中断不可中断释放也不能施加真实期限，因此需要显式共享 receipt 与保留释放 Fiber。
这是官方 Effect 原语上的协调，并非第二套传输实现。

提交的验收通过注入原生 Service 与真实 EphemeralStore 进行；另有两个独立实验消费真实上游原生入口及 P4 token producer，见下文。
这些实验不证明正式版本依赖、产品 durable Legacy 门面、P1 日志投影、doc/bridge 消费或产品应用关停已完成。
完成这些集成闸门后才能宣告 P5 交付；未声称生产、npm 发布、macOS/Windows、daemon 全链路或吞吐验收。


## 开发证据

已远程核对初始 main `3ac76bad10f46720517a2ca6929f03de4ef5bb9b`。
独占分支包含 P1 `9c3d354bf283d7957b46f4bb2feb98e39310e5a0`
（[#1503](https://github.com/LodyAI/Lody/pull/1503)）；父工作区与其他 clone 未修改。
分支也包含 P4 稳定实现 `b79eea2df26e5ecd0e796e9dfd9c32a75a4d13b7`，实际合入审查 head
`980b0e595df068ce08815423c9e4f5a61e9f5d73`。本地测试 stack 为
`9922c8efbc8bdbc31ce8cbcf7cea5f898285133a`，测试源提交 `f20df9c0ba41f79efa88f9fcf462cba750beeb1f`。
Git credential helper 超时后，通过已授权 GitHub API 发布；远端 foundation
`45ecfc491314794f9e0d2f1a9d3676956b0b7ddb` 的 tree 与该本地 stack 完全相同，只有 commit 元数据不同。
新增原生验收与 P1 logger/presence 套件通过 44 项，应用拥有者的既有 shell 套件通过 18 项。
新 Legacy 消费者通过 makeApplicationRuntime 验证活跃工作区关停、失败保留与 runtime 关闭后的恢复。
产品 doc/bridge 消费者仍使用旧 presence 实现。

Retirement 在通知订阅者之前禁止同步新写入；订阅回调 defect 不跳过下层 IO 清理，完整 Cause 与恢复 owner 仍保留。
显式 retry 完成剩余本地 retirement，并确认已经结束的 heartbeat 失败，不抹去历史。
只有两个真实 store 均 destroy 后才标记完成。行为验收也包含失败 close 期间尝试写入的情况。

原生 port 显式识别 SDK typed release failure：pending raw 操作为零不代表失败释放已成功。
首个 bootstrap 十秒仍未完成时，提供 typed unknown-readiness 失败及一次安全诊断；共享 join 仍由拥有者保留，
可稍后完成，不制造重连风暴。状态回调同步撤销 availability，不等待状态 worker 恢复。
正式适配器必须以 SDK 公共错误类型实现 isReleaseFailure，不使用源码 tag 或隐藏 fallback。

临时集成提取上游稳定 `1c5f4b8c32e4a55c04534871321363d0936acfc9` 的源码及同提交 streams-client，
只编译到本人 clone 的忽略目录。原生入口 SHA-256：
`fc48c7c89ecb1a5767d656455af5fbf65a8c542228f71d66d6db99ec8f630207`。
两个显式 TestClock/Fetch/SSE 实验通过：真实 POST 忽略 abort 后阻止 replacement，等待实际结束后 retryCleanup；
同一个 P4 原生 token producer 在房间 waiter 取消后，仍为持有 refresh lease 的另一读者完成刷新，
再供下一代房间发送实际机器状态，由另一 EphemeralStore 解码观察。停止房间后 provider 仍可使用。
另一读者模拟 durable 需求，并非产品 durable Legacy 门面。实验 IO 由 SDK Effect 拥有，
没有在 Lody 实现第二套 POST/SSE 编排；产物、脚本、依赖 override、临时 tarball 均不进入产品或锁文件。

上述成功仅对应该修订。上游目前稳定 head `7126a255a5520e66ce05958d5a233b141b1601a2` 与实验修订
`ad4ec1f6444d0d431753970580574c2d876938fd` 的 tree 完全相同；重新编译入口 SHA-256：
`870f3ebd1a4a218ed66ae9c30a47d0f89bec4ce7c1b0728e7b525b4d2fdd02c7`。
重跑通过忽略 POST abort 的清理，但共享 provider replacement 后正常 stop 失败：
EphemeralReleaseFailure 包含 Fail(EphemeralClosed) 与嵌套 release failure。
已向 SDK 拥有者提供受控复现；它属于正常关闭还是实际清理失败仍未解决。
Lody 保留完整 Cause 与恢复 owner，不吞掉失败；该项仍是集成闸门，不能冻结较旧快照冒充 ready。
Probe 现调用原生 subscription.syncBarrier() 即时捕获 chain 集合，不借用延迟捕获的 waitUntilSynced。

registry 核验正式版本仍为 streams-client 0.9.0 / streams-crdt 0.16.2；新原生入口与 client helper 等待上游授权发布流程。
产品接线还需借用同一个工作区 provider、应用 executor 的 Legacy token 门面；现 P4 factory 创建独立拥有者，不能同时调用。
本 draft 尚未删除既有兼容入口；新增显式 presence Legacy 门面由测试消费，产品 startup 尚未登记。

三项临时机制消融均触发行为断言：去掉 raw Exit mask 会丢迟到 typed 清理失败；
忘记未释放代际会允许重叠；第二 close 调用者立即返回会违反完成保证。
最后一项使用显式第二调用者进入信号。
锁定的 4.0.2 中，exitFailCause 在中断跳过恢复处理器时可能移除 Fail，
因此恢复中断前以 mask 捕获原始 Exit，拥有者同时保留 typed failure 与 defect。
probe 延迟使用本地 Clock，server offset 只影响发布的 heartbeat 时间戳。
应用释放保留原拥有者供恢复，同时在共享 receipt 中累积后续恢复 Cause；脚本不进入产品。
workspace 类型与 type-aware lint 通过。此前完整 check 到 CLI 测试时有五个无关 process/transport 套件共 15 项失败；
将唯一修改的既有产品 owner 替换为 P1 baseline 后，复现同样 15 项失败及四项 unhandled errors。
Stacked 根 check 完成类型与 lint，CLI 为 4045 通过、17 失败、1 跳过、4 项 unhandled errors。
新增两个 worktree 用例在不变的 application owner 下，也在五秒诊断上限内超时；另两个选中的 worktree 用例亦超时。
其他递归套件（含 Electron）未完成；中止前观察到的 component 失败尚未宣称解决。
随后 Clock fixture 与 barrier 调整由最终 CLI 类型、owning 行为套件及串行根 lint 覆盖。
应用根消费者显式提供 TestClock，机器 heartbeat 有实际状态断言，不依赖墙上时间。
一次临时集成测试文件并发删除使 lint 崩溃，串行重跑零错误通过；这些结果不代表全量 check 通过。

pnpm format、format:check、i18n 与五项边界守卫通过。
只读 docs check 有六个既有 Kimi/Pi 子模块缺失链接，无新增错误与 SHA 保护主题；gitlink 未变。
未提交常规快照、validator 输出或实验日志。外部贡献 body checker 要求的 Issue/对话字段不适用于本内部 PR，
实际要求的章节与 Mermaid 保留，不编造这些字段。
