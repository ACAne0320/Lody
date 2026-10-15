# 对话中的 Turn 计时与活跃度

Status: implemented
Translation: current
Date: 2026-10-15
Language: Chinese
Other language: [English](2026-10-15-turn-timing-liveness.md)

## 摘要

运行中的 assistant turn 只显示已工作多久，看不出是否还在收到内容，用户分不清是在跑耗时命令还是已经卡住。现在 Turn configuration 弹窗会显示这一轮的开始时间、已运行或总用时；对进行中的 turn，还会显示对话上次收到历史更新距今多久，超过 60 秒后以弱警告样式标出。运行状态行在两分钟无更新后追加「N 分钟无输出」。更新时间只是渲染端 `ConversationView` 上的内存记录，history、其 schema、同步协议和 `endedAt` 规则都没有变。代价是这个时间只覆盖打开对话之后收到的更新。

## 需求

一位社区用户（Discord 帖子「More Detailed Turn Information」）想排查一个看上去正在跑 `local_bash` lint 检查的 turn。要判断它是在忙还是卡住，需要知道它的开始时间和最后一次历史更新的时间。

## 决定

- **开始、结束和时长都来自已有字段。** 开始时间优先用 `startedAt`，没有记录时用 `timestamp`；老条目只有 `timestamp`。进行中的时长和已结束的时长分别复用 `resolveLiveSessionHistoryDurationMs` 和 `resolveSessionHistoryDurationMs`。两者都是「Worked for」的口径，弹窗和状态行不会出现两个数。时间按用户本地时区显示：当天只显示带秒的时间，其他日期加上日期，跨年再加年份。悬停显示包含时区的完整日期时间。
- **「最后更新」是渲染端记录，不是存储数据。** `endedAt` 只在 finalize 时写一次，必须保持（#260）：流式过程中移动它会改变已结束 turn 的语义。单独持久化一个时间戳，则每个流式 delta 都会多写一次文档。因此改为由 `ConversationView.lastUpdateAt` 记录每次后端历史通知的时间。Loro 和 Roost 共用这条 reader 路径，两种后端都能覆盖，也不需要额外订阅。打开、hydration 和分页都不会改变这个时间。它也不会递增 `version`，因为使用方会在自己的时钟刷新时读取。
- **按 session 粒度记录，只在进行中的 turn 上显示。** 只有最新的未结束 assistant turn 的「最后更新」才有意义。已结束的 turn 显示开始、结束和用时。打开之后还没收到更新时显示 `—`，不会显示 `0s` 或猜测的时间。
- **阈值是常量。** `TURN_LAST_UPDATE_STALE_MS`（60 秒）让弹窗中的值使用警告色，悬停提示 agent 可能在跑耗时命令，也可能卡住了。`TURN_SILENCE_NOTICE_MS`（2 分钟）在运行状态行追加「N 分钟无输出」。这里按整分钟显示，避免每秒变化。状态行只陈述沉默时长，不加警告色，因为耗时命令本来就可能长时间没有输出。

## 考虑过的方案

- **流式过程中刷新 `endedAt`。** 否决：这会破坏只写一次的规则，也会改变 `canAppendAssistantDeltas` 和「Worked for」依赖的语义。
- **把 `lastUpdateAt` 写进 history。** 否决：每个 delta 都要多一次 CRDT 写入，还要改 schema。它衡量的也只是写入方的活动，而不是这个客户端实际收到了什么。
- **按 turn 分别记录。** 没有必要：只有进行中的 turn 会显示这个值，按 turn 记录会让状态随历史增长。

## 局限

- 打开对话后马上到达的追赶同步也会算作一次更新。因此，打开前就已经卡住的 turn，可能会在最多一分钟内看起来像是刚有更新，之后才出现警告。
- 本地写入，例如回应权限请求或发送 steer 消息，也会更新这个时间。后端变更通知不携带来源信息。
- 等待过权限的 turn 在结束前显示的时长仍会偏大。这个问题属于实时时长标签，见[桌面端实时 turn 时长](2026-09-17-desktop-live-turn-duration.zh.md)。

## 验证

`packages/components/tests/assistant-turn-timing.test.ts` 覆盖进行中、已结束和缺字段三种情况的 row 数据，以及 `startedAt` 回退、无输出阈值，并用固定时区验证跨本地午夜和跨年的时间格式。`tests/conversation-view-from-reader.test.ts` 在真实 Loro 存储上验证：打开和区间 hydration 期间这个时间保持为 `null`，只有历史写入才会更新它。`tests/agent-activity-row.test.tsx` 渲染真实的 stream，覆盖「no output for 4m」状态、超过警告阈值前后的进行中弹窗、尚未收到更新时的 `—`，以及已结束弹窗。`AssistantTurnAlignment.stories.tsx` 提供 `DesktopTurnTimingLive` 和 `DesktopTurnTimingFinished` 用于视觉检查。没有复现真实的 daemon 卡住或真实断网。
