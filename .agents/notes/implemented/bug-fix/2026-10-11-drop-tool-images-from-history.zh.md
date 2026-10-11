# 从持久化历史中丢弃工具图片

Status: implemented
Translation: current
PR: [LodyAI/Lody#1456](https://github.com/LodyAI/Lody/pull/1456)

[English](2026-10-11-drop-tool-images-from-history.md)

## 摘要

普通 ACP 工具可能把图片数据和内嵌图片 blob resource 写入会话历史，而会话附件已经使用引用。
最初的共享历史投影直接丢弃工具图片，不再上传附件；后续将此规则扩展到工具音频、全部
resource blob、内嵌 base64，并为根工具、导入工具和规范化子工具的 raw 对象、metadata 设置预算。
小型可读输出及调度、权限字段保留，过大的显示内容可能截断或丢弃。存量历史不批量迁移，
provider 执行输出保持不变。

## 最初的图片决策（#1456）

```text
根工具 / 回放 → 根内容投影 ─┐
                           ├→ 丢弃工具图片 → HistoryWriter
规范化子工具 → 子内容投影 ──┘
```

`packages/shared/src/acp/tool-call-history.ts` 负责图片移除：丢弃所有 ACP image 块，以及
通过图片 MIME 类型或图片 data URI 识别的 blob resource。保留 resource link、文本 resource
和其他媒体。子投影只使用图片过滤器，保留读取结果和 diff，不套用根工具的终端压缩规则。
省略 content 时保留原列表；只包含图片的替换列表变为空列表。

没有选择为每张工具图片上传附件，因为这些执行产物无需在会话中持久保留。仅过滤根通知不够：
外部历史导入复用根 reducer，规范化子工具则使用独立投影。本改动不检查任意 raw 字段，也不
重写旧记录；未变更的不透明数据继续遵循[单一写入者决策](../architecture/2026-09-07-single-history-writer.zh.md)。
已有 R2 图片和 image-group 附件与工具内容相互独立。

## 验证

行为覆盖通过真实 Loro HistoryWriter 检查根与子输出、稀疏更新和仅图片列表替换，并将过滤后的
历史复制到 fork。导入覆盖使用共享回放入口。测试数据均为合成数据；本改动不迁移已有历史，
也不改变 provider schema。

## 后续：二进制与重复载荷

审查发现音频、非图片 blob、data URI、文本或扩展中的 base64、无界 raw 对象与 metadata，
以及子工具标量或数组输出的重复副本。后续让 ACP 根通知、回放、直接规范工具写入、子工具
与权限数据共用工具历史策略：图片、音频、全部 resource blob 和 data URI resource
直接丢弃，不解码或上传。文本中的 data URI、至少 4096 个字符的连续类 base64 字符串，以及
整段换行 base64 替换为省略标记；特别长的普通连续 token 也可能被误判。

显示字符串限制为 16 KiB UTF-8，不拆开字符。JSON 上限 32 KiB、深度 8、访问节点 256、
每个容器字段或元素 128；移除 `blob`、`base64` 字段与嵌套图片、音频对象。
content 列表上限 128 块、序列化后 64 KiB UTF-8。需要修改文本的 diff 整块丢弃，避免错误的
局部 diff。终端快照先保留真实的合计 1 KiB 尾部，再应用普通文本预算。
文件位置的扩展字典使用同样的有界 JSON 策略，保留有效路径和行号。

子工具 raw 输入丢弃，raw 输出对象及 metadata 保留有界可用 JSON；标量或数组 raw 输出
只保留一份可读内容，不再复制进 `_meta.lody.subagentRaw`。根调度输入仅选取面板读取的六个
字段，输出保留有界 JSON 或文本，用于任务 ID 匹配及已提交触发时间。权限请求、选项与结果
保留身份、选定选项及有界 metadata，包括问答定义和答案；未使用的选项、结果扩展丢弃。

普通 assistant 音频和 resource 通过 `acp-agent-attachments.ts` 上传附件并存引用；图片和文件
上传上限分别为 5 MiB 和 100 MiB。内联 ACP 数据先解码再检查上限，因此上限不约束解码内存。
展开工具详情时，`components/ai-gui/view.tsx` 提供音频播放器；删除工具音频会去掉该预览。
这些发现来自代码路径检查，不是生产载荷大小统计。后续过滤不限制普通会话文本、provider
执行内存、累计 transcript 长度或旧历史；超过新预算的有用工具文本也会截断或丢弃。
行为测试覆盖真实 Loro 持久化和 fork、导入音频与 blob、直接规范 raw 扩展、子工具稀疏更新
以及权限问题答案。
