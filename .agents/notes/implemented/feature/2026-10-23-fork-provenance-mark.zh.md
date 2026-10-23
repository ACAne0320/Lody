# 用分叉来源标记取代 "(fork)" 标题前缀

Status: implemented
Translation: current

[English](2026-10-23-fork-provenance-mark.md)

## 摘要

分叉会话原先被命名为 `(fork) <源标题>`，对分叉再分叉会叠加前缀（`(fork) (fork) …`），而且标题看不出来源是哪个会话。现在分叉沿用源会话的原始标题，并记录 `SessionMeta.forkedFromSessionId`；侧边栏行和会话标签在标题前显示一个小的分叉图标。桌面端悬停图标会显示源会话标题，点击则跳转到源会话。已有标题不会被改写，只有对旧分叉再分叉时才去掉遗留前缀。

## 决策

- **新增字段，而非 `parentSessionId`。** `parentSessionId` 只存在于原地/子标签分叉，并驱动标签分组和状态汇总。新会话分叉和 worktree 分叉需要来源信息，但不应有这些副作用，所以 `forkedFromSessionId` 只用于展示。它和 `openedBySessionId` 遵循同一规则：不参与汇总，也不用于过滤列表。
- **标题由 daemon 决定。** `SessionForkService` 使用 `stripLegacyForkTitlePrefix(sourceTitle)`，去掉开头任意个不区分大小写的 `(fork)` 前缀；如果去掉后为空，则保留原标题。分叉操作 marker 保存 `sourceSessionId`，崩溃恢复重新发布 meta 时也会带回该字段。
- **实时源标题。** `SessionForkMark` 通过 `sessionMetaAtomFamily` 读取源会话的 `SessionMeta`，因此源会话改名后会同步显示；源会话缺失或已删除时显示通用的“Forked conversation”。源会话是子标签时，按根会话加精确标签 id 导航。
- **展示位置。** 桌面侧边栏（`SessionList` 与更新会话列表）使用可交互标记。触屏布局只显示装饰性图标，因为没有悬停提示，且整行是点击目标。会话标签栏里，源会话在同一标签组时点击会选中源标签，否则只显示提示。

## 备选方案

- 保留单个 `(fork)` 前缀并去重：放弃，因为仍把 UI 写进持久数据，也看不出来源。
- 从克隆历史中的 `session_fork_origin` 通知推导来源：放弃，因为侧边栏行只有 `SessionMeta`，不应为此加载历史。

## 验证与限制

CLI 单元测试覆盖前缀去除、分叉提交时的新 meta 字段，以及 marker 修复路径。jsdom 组件测试覆盖提示文案、根会话加标签的导航、点击不会选中所在行、源会话删除后的回退文案和装饰模式。`SessionList` 的 `ForkedSessions` story 展示各状态。原生移动端和 Electron 的实际渲染未手动检查。旧 daemon 创建的分叉保留 `(fork)` 标题，也没有标记。
