# 移动端对话底部滚动的控制权

Status: implemented
Translation: current

[English](2026-10-11-mobile-conversation-bottom-ownership.md)

## 摘要

快速向下滚动会与引擎反复写回底部竞争，composer 布局变化也可能在没有对话手势时恢复跟随。
控制器现在以真实滚动范围内的逻辑位置采样弹性越界值，只凭对话输入恢复跟随，并等待原生
滚动结束后再补齐底部附近的偏差。composer 在真实 flex 布局之外测量内容，避免短暂扩大
viewport 导致阅读位置丢失。模型、React 接线与 Chromium、WebKit 布局验证覆盖了这些路径；
iOS 原生惯性效果仍未验证。

## 定位与决策

本修复部分替代[滚动引擎决策](../architecture/2026-09-27-conversation-scroll-engine.zh.md)中的
立即按 4px 恢复跟随和清理输入证据的行为，保留锚点所有权、有界事务和相对布局补偿。
它实现既有[对话滚动意图](../../../../specs/conversation-scroll.zh.md)：布局变化本身不能要求跟随。

- `onScrollEvent` 原先仅凭位置和方向恢复跟随；进入 follow 又清掉惯性证据，后续原生位移
  便被当作 unknown 并写回底部。超出最大值的弹性 offset 会继续触发 reset，父组件提交也能触发。
- 控制器现在在分类、锚点、覆盖判断、写后读回及稳定判断中使用范围内的逻辑位置。
  范围外回弹本身不能释放 follow，也不会仅因越界而触发修正写入。
  真实布局变化仍使用既有补偿协议。
- wheel 和导航键监听在两个方向上提供输入证据，排除编辑目标、嵌套滚动和 wheel 缩放。
  触摸惯性与按住指针保留既有分类。准确到达边界时恢复跟随，但不清掉原生输入证据，也不增加修正。
  距边界 4px 内以及记住的旧底部都等到 `scrollend` 再恢复跟随。
- unknown 位移和 clamp 清除已记住的手势底部。scroll 事件先采样当前 viewport 高度再判断 clamp，
  因为浏览器先派发滚动步骤，再交付 ResizeObserver。对话外的 focus、pointer 输入和
  `beforeinput` 清理旧证据，composer 已有焦点时继续输入也生效。
  显式导航和隐藏 viewport 同样清理之前的输入证据。
- `ChatComposer` 使用临时、隐藏且 fixed 的 textarea，复制已解析的文字及盒模型参数，测量后立即移除，
  然后一次性写入真实高度。空草稿继续跳过测量，直接使用最小高度。

## 证据与验证边界

既有模型测试扩展了弹性采样、回弹期间反复提交、准确到达边界后保留输入证据、滚动结束前不补齐几像素、
unknown 位移、活动手势被 viewport clamp 结束及旧底部恢复等场景。React 接线测试派发真实
wheel/key/touch 事件，以及 composer 的 focus、pointer 和编辑事件。
两套测试保留既有行为覆盖及模型的 40 组固定随机种子，共 103 个测试通过。

前后对比在隔离 clone 中使用修复前 `4922c038c` 和 PR 版本 `4601077e2` 的真实产品代码，
配以相同的当前行为测试 fixture。12 个针对性的模型、React 接线和 composer 用例中，
修复前 11 个失败，修复后 12 个全部通过；余下那个 viewport clamp 用例在旧版就已通过。
对比排除了要求新 `onReaderInput` API 的用例，缺少新方法的错误不作为原问题的证据。
修复版本完整运行这三套测试，共 104 个全部通过。

| 相同场景 | 修复前 | 修复后 |
| --- | --- | --- |
| +24、+18、+12、+6px 弹性采样，包含父组件提交 | 4 次修正写入 | 0 次修正写入 |
| 原生位移停在距底部 3px，尚未 `scrollend` | 立即进入 follow 并写回底部 | 保持 read，不写入；`scrollend` 后恢复 follow |
| 无对话输入，浏览器移至底部附近，再缩小 viewport 40px | 恢复 follow，额外移动 40px | 保持 read，不额外移动 |
| 活动手势、短暂 viewport clamp、恢复原高度 | 阅读位置丢失 40px | 保留原阅读位置 |
| composer 获得焦点、已有焦点时编辑或对话外 pointer 输入 | 旧证据误恢复 follow | 保持 read，追加输出不移动位置 |
| React composer 测量 | 测量时真实高度变为 `auto` | 测量时保留之前的真实高度 |

复现时，在安装锁定依赖的临时 clone 中 checkout `4922c038c`，只用
`git show 4601077e2:<path> > <path>` 覆盖 `packages/components/` 下的三个测试文件，
保留旧版产品源码。运行：

```sh
NODE_ENV=test pnpm --filter @lody/components exec vitest run \
  tests/conversation-scroll-engine.test.ts \
  tests/engine-conversation-scroller.test.tsx \
  tests/chat-composer-autoresize.test.tsx \
  -t 'keeps the reading anchor when a viewport clamp|waits for the native fling|ignores elastic|never follows after|downward .* input re-arms|composer .* clears|grows through 11 rows'
```

恢复覆盖的测试文件，再 checkout `4601077e2` 并运行相同命令，即为修复后对比；
去掉 `-t` 可运行全部 104 个相关测试。

`tests/e2e/conversation-scroll-engine.spec.ts` 的浏览器回归在真实 flex 布局中执行产品测量函数，
验证换行及中英文混排，所属回归在 Chromium 和 WebKit 中均通过（两个浏览器测试）。
Chromium 145 和 WebKit 26.0 的补充布局实验确认恢复真实高度也不能恢复旧阅读位置。
composer 高度为 240px 时，旧 `auto` 测量会把对话
viewport 从 480px 短暂扩大到 696px，让距底部 80px 的阅读位置丢失 136px；
恢复 textarea 高度不能恢复阅读位置。新的镜像测量得到相同内容高度，同时保持 viewport
高度和阅读位置不变。

控制器、模拟器和测量函数的 strict TypeScript 编译通过。在隔离的公开仓库 clone 中安装
锁定依赖后，composer React 测试与两套滚动测试共同通过，共 104 个测试。实际失败的 CI 命令
`NODE_ENV=test pnpm --filter @lody/components run test --maxWorkers=4 --shard=3/3`
在该 clone 中也全部通过，共 185 个文件、1,755 个测试。
测量不变量记录包括 padding 在内的真实初始高度：把它写死为 48px 会在 CI 的真实
52px 输入框上误报。测试仍验证增长和缩小测量时真实输入框的高度不变。
仓库格式化、类型检查和 lint 通过。完整 `pnpm check` 随后因本机的 CLI 进程、模拟器、Git
和历史测试失败而停止；已读取的 GitHub run 中该 CLI 任务通过。这些测试不涉及本次改动。
manifest 和 lockfile 不变。原始工作区的文档检查保留了缺失子模块及既有文档
造成的 82 个基线错误，没有注册 SHA 保护主题。

WebKit 验证使用仓库锁定的 Playwright Linux 构建，布局实验的移动 viewport 为
390×844 并启用触摸能力。控制器弹性采样由模型注入，并非真实 iOS 甩动产生。
这些检查不能证明 iOS 原生动画、键盘或手势效果。
真机验收仍需覆盖快速向下甩动、底部回弹、向上打断，以及 composer 刚获得焦点和原本已有焦点时的输入。
阅读模式下的流式输出和键盘显示/隐藏必须保留锚点；follow 仍须跟踪新输出和最终 viewport 变化。

## 权衡

没有增加 timer 或 frame 重试。没有原生 `scrollend` 的宿主仍可在准确到达底部或显式导航时恢复跟随，
但近底部和旧底部恢复需要该原生信号。没有通过禁用 overscroll 消除弹性采样：范围内采样直接修复
引擎控制权，不改变原生手势表现。真实行高增长时的布局补偿仍保留已记录的 WebKit 惯性中断可能，
本修复没有移除那项独立成本。

PR：[#1445](https://github.com/LodyAI/Lody/pull/1445)。
