# 紧凑的权限控件与完整的选项文案

Status: implemented
Translation: current

PR: https://github.com/LodyAI/Lody/pull/1584

[English](2026-10-15-permission-option-wrapping.md)

## 摘要

过长的权限选项名会让拒绝按钮超出提示卡片，并让菜单中的后续授权范围被省略号截断。
提示组件现在保留短选项的直接点击操作，将直接选项过长的整组回答放入紧凑的菜单入口。
菜单左对齐显示完整 Provider 原文，并在视口内换行。长选项需要多一步展开菜单；
六个浏览器用例已在独立展示验收页面中通过，完整应用与原生设备验证仍待完成。

## 决策与职责

本次修复补充[分组按钮决策](../feature/2026-09-24-permission-prompt.md#fifth-review-split-buttons)，
更新既有的草案[权限展示契约](../../../../specs/permission-requests.zh.md#契约)。
直接让按钮文案换行，会产生大块居中段落，旁边挂着小箭头。视觉审阅否定了这一方案：
它解决了溢出，却让权限提示超出了输入框的尺度。

[PermissionPrompt](../../../../packages/components/src/components/sessions/floating-permission-request.tsx)
负责紧凑控件的文案预算：32 个字符位置，Latin-1 范围之外的字符按两个位置计数。
直接选项超出预算时，整组回答进入菜单，保留 Provider 顺序与选项原文。
入口按直接选项的语义显示“拒绝”“允许”或“选择回答”，仅表示分组，点击不会提交选项。
短选项保持既有的直接回答和可选分裂菜单交互。两条路径均使用现有 Button 和 Menu 原语，
不修改原语外观，也不引入多行 Button API。

菜单中的 Provider 标签保留空白，允许长路径换行，最大宽度为 32em，并在弹出菜单既有的
视口限制内收缩。元素子节点绕过原语自动添加的省略包装，其他菜单不受影响。
方向键仍聚焦该组控件；Enter 展开长选项菜单，选择原文行后提交原始选项 ID。
提示卡片上的 Escape 继续执行单次拒绝。

## 验证与限制

[权限 Stories](../../../../packages/components/src/stories/PermissionPrompt.stories.tsx)
提供合成的中英文长选项名、长路径与可见的已选 ID 结果。
六个[浏览器用例](../../../../packages/components/tests/e2e/composer-submission-focus.spec.ts)
已通过 Playwright 1.58.2 与 Chrome 在 320、390、1280 像素宽度下执行，
检查控件高度、卡片边界、菜单文本换行和视口边界，以及键盘展开不提交、选择后提交原始 ID。

验收页面复用主 checkout 的依赖，提取未经改写的提示组件展示代码，
渲染真实 Button、Menu、StyleX token 与 Story 数据。
页面不包含会话生命周期组合，并为未使用的命令标题截断辅助函数提供桩；数据均为编辑请求。
忽略产物 `.lody/permission-acceptance/screenshots/` 保存 Git 基线、被否定的多行按钮方案和
紧凑修订版的对比截图，并上传到本任务对话。该验证覆盖展示与选择，不覆盖守护进程交付或
原生设备；未重跑完整 Storybook 和组件单元测试。

根目录 `pnpm format`、`pnpm lint:i18n`、Oxfmt 0.65.0 和 `git diff --check` 通过。
`pnpm check` 在未修改的 `e2ee-core` 包因缺少依赖而中止。
组件包类型检查也报告其他模块的缺失依赖与既有错误，修改的提示组件和 Stories 没有诊断。
公开边界检查报告缺少 ACP 子模块工作区；`docs check` 报告 82 个指向这些缺失子模块的断链，
本次修改的文档没有错误。仓库未注册受 SHA 保护的文档主题。
