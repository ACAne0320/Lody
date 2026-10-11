# 限制会话中的子对话创建卡片高度

Status: implemented
Translation: current

[English](2026-10-11-created-session-list.md)

## 摘要

大量 MCP 创建操作会让导航卡片占满会话。现在连续的纯创建记录共用 Subagent Task 风格的面板，内部为带状态图标的紧凑分隔行，顶部摘要显示总数及展开/收起。可滚动区域默认最多展示五行。批量创建与多次独立创建采用相同展示方式，标题、状态与跳转保持实时可用。遇到其他消息或未加载的轮次时结束分组，保留原有顺序。

## 决策与边界

用户要求参考现有 Subagent Task UI，因此复用它的面板、分隔线和状态标记样式，导航控件使用 `@lody/ui`。状态仍属于创建操作，点击行仍打开子对话。顶部展开/收起控制五行高度限制，不引入任务面板完成后自动折叠的行为。移除重复创建标签及各行独立卡片边框。

分组仅发生在渲染层，不改变存储历史或 Operation 协议。第一条记录提供稳定行键，可见范围上报覆盖分组末尾，保证组内所有轮次保持加载。原有活动折叠仍使用同级行，只有本次请求的创建卡片列表使用内部滚动。五张及以下不显示展开按钮。滚动区域可通过键盘聚焦，并禁止抽屉拖拽手势接管。

只限制单个 Operation 无法解决连续单次创建的问题。纯成功的旧版完成记录也可分组；失败、取消、续接通知的摘要保留在列表之外。关联进度的完成记录仍不重复创建卡片。此次改动补充现有的[创建进度实现](../../../../packages/components/src/components/ai-gui/README.md#creation-progress)，保留[滚动引擎的职责](../architecture/2026-09-27-conversation-scroll-engine.zh.md)。

## 验证

关系卡片测试覆盖分组、轮次范围、阈值、展开收起与导航，同时保留实时状态和完成去重测试。Storybook 的 `ManyCreatedSessions` 使用十二条合成的独立创建记录，供浏览器验证和截图。Chromium 在 375px 和 1280px 宽度下验证了 144px 区域正好显示五张卡片、内部滚轮滚动和两种展开状态。[收起截图](../../assets/created-session-list/collapsed.png) / [展开截图](../../assets/created-session-list/expanded.png)。消息选择模式保留原始行，确保选中的标识与导出记录对应。原生 iOS WebView 行为仍需真机验证。

24 项针对性测试、组件类型检查、lint、国际化、边界检查、格式化及文档检查均通过。根目录 `pnpm check` 通过类型检查和 lint 后，停在两项未改动的 CLI 测试：工作树检查的 macOS `/var` 与 `/private/var` 路径差异，以及原生 Git 测试的 `context_unreadable`；单独重跑均可复现。
