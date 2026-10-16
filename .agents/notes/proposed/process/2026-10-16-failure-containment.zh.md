# 故障隔离指引与审查技能

Status: proposed
Translation: current
PR: https://github.com/LodyAI/Lody/pull/1607

[English](2026-10-16-failure-containment.md)

## 摘要

已有的生命周期指引要求 agent 保留释放失败的 owner、保留完整的失败信息，并在确认释放之前拒绝替换，但没有限定这种严格性可以扩散多远。对草稿 PR #1607 的审查发现：一次普通的释放失败就可能中断整个 workspace 的关闭，或者让某个文档在重新加载前都无法打开；另外，每一次本地能力探测前都新增了一道确认等待。本次改动补上对应的约束：失败只影响它所在的操作，关闭流程跑完每一步，被保留的 owner 在下次使用时重试，新的门控必须限定范围并有时限。同时新增一个审查技能，从真实的触发条件一路追踪到用户可见的影响。这套指引还需要在后续的生命周期 PR 中实际使用来验证。

## 问题

[Effect 指南](../../../docs/cli-effect-ts.md#behavior-contract)会问"谁保留未释放的资源、谁可以重试清理"，它的验收矩阵也要求释放失败时保留 owner 和完整 Cause。根 `AGENTS.md` 倾向显式契约、反对隐藏的兜底。但两者都没有问：严格路径失败时，还有什么会跟着停止工作。如果只读这些规则，把尽力而为的清理改成向上抛错、再加上隔离，看起来都是局部更正确的做法，因此会被鼓励。

审查标准加剧了这一点。`.github/codex-review.md` 把"假设性的边界情况"排除在外，而清理过程中的存储或网络失败很容易被当成这类情况，于是按标准审查的人不会报告这些回归。

## 证据

对草稿 PR #1607 的 `9b5122ca` 与合并基点 `d73db66f4` 对比审查，发现：

- `createManagedStoreCache.disposeAll` 从吞掉 store 释放错误改为抛出 `AggregateError`。`create-workspace-runtime.ts` 中 workspace 的 `dispose` 在 `teardownTransport()` 和 `repo.destroy()` 之前无保护地 await 这三个缓存，并且记忆化了 `disposePromise`。因此一次 lease 释放失败就会让 transport 和 Repo 保持打开，且没有重试。
- 释放失败后，`retainedDisposals` 会让该 key 之后的每次 `get` 都 reject。tracker 的释放回调需要先 acquire 成功才会触发，所以没有任何自动重试。`PromptShortcutSync` 用 `retiring` 和 `failure` 加了同样的隔离。而该 PR 自己的 README 写明：native Repo 本来就在多个借用者之间共享同一个 replica。
- 每一次本地 `acp-capabilities-refresh` 都开始等待 Machine Flock 的 peer 回执，时限 20 秒。只有保存配置后紧接着的那次探测才可能与写入竞争；离线时，其他探测现在也会失败。
- `WorkspaceRepoLegacy.failures` 在 workspace 整个生命周期内收集所有非中断的后台失败，没有上限，`destroy()` 最后会带着全部这些失败报错。
- 同一个 PR 中，`WorkspaceRepo`、`workspaceRepoLayer` 以及 `openWorkspaceDoc`/`acquireWorkspaceRoom` 这几个辅助函数没有任何使用方。`LocalLoroTransportAdapter` 被保留下来，尽管它所在的模块只剩一个类型还被导入。

以上结论来自阅读代码，没有运行任何东西。native lease 在配额不足或离线时是否真的会释放失败，取决于 `loro-repo` 和 `streams-crdt` 的内部实现，这一点没有核实。

## 决定

- 新增[故障隔离](../../../docs/failure-containment.md)作为跨模块说明文档，包含规则、真实的触发条件、五个影响范围问题、适度性检查，以及上面的实例。
- 在根 `AGENTS.md` 中加入必读触发条件：修改关闭流程、隔离、重试或就绪门控之前先读该文档；并在 Code Review Rules 中把故障隔离回归列为 P1。`.github/codex-review.md` 给出这个术语的定义，并说明普通的存储、网络和 peer 失败不属于假设性的边界情况。
- 在 Effect 行为契约中加入 Containment 问题，在验收矩阵中加入 Containment 一行，并在那里说明"禁止替换"只约束同一个 owner。
- 新增 `failure-containment-review` 技能，并链接到 `.claude/skills`。技能里放审查流程和委派用的提示词；规则本身留在文档中。
- 为了让根 `AGENTS.md` 保持在大小上限以内，把重复表述的句子交给它们的归属文档。文档整合条目改为指向[提交时的文档整理](../../../AGENTS.md#documentation-at-submission)的链接；其中"更新归属文档和笔记"以及关于 Spec 的部分，根文件的"Context and documentation"已经覆盖。"Effect reference"里关于拆分模块的那句话，Effect 指南中选择 native 单元的章节已有同样的表述。

## 考虑过的方案

- **只写一个审查提示词。** 它能在事后发现一部分回归，但导致这些回归的编写指引仍然不变。
- **放宽 Effect 的保留规则。** 为了恢复，保留失败的 owner 和 Cause 仍然是对的。问题出在扩散没有边界，而不在于保留本身。
- **把完整规则或规则摘要写进根 `AGENTS.md`。** 根文件距离 8 KiB 上限只剩 3 字节。只加必读触发条件，符合仓库现有的"改 X 之前先读 Y"模式。

## 局限

这套指引还没有在后续 PR 上检验过。技能中的搜索模式只是起点，换一种写法的失败处理改动会漏掉。根 `AGENTS.md` 仍然高于 7000 字节的警告阈值，距离上限从 3 字节变为 30 字节。
