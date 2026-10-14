# 带 Scope 行级 outbox 的原字节投递

Status: implemented
Translation: current

[English](2026-10-11-e2ee-key-delivery.md)

## 摘要

旧 outbox 把全部历史信封放在一个 JSON 文档中，4096 条上限会永久阻断下一次正常投递。本层把原 ciphertext 保留为逐条索引的 SQLite 记录，并在新公共信封工作流上增加有限认证投递与恢复。每次发送重新检查真实账本权限及保存字节，不确定传输保留 pending。移除生命周期上限不依赖删除历史；接收方持久安装和 mailbox 协调仍有独立归属。

## 责任与取舍

直接父层为信封 Draft #1448，0a73d464b5c93fab4b4e0f7ce704778ba437ac94。平台无关 keys/delivery 入口管理路由 ID、固定信封再授权及一次有限 put/readback。调用者提供的成功授权回调不能成为证明。本轮中的本地前缀观察拒绝后续查询换回已知旧视图或分叉，包括准备与发送之间。独立当前端点信任和跨轮持久回退 pin 仍由调用者拥有，outbox 字节不建立权限。

本地 delivery ID 保留原 SHA-256 截断 16B 域与 CBOR 公式，只用于路由和幂等。已有 frame 优先；仅无保存字节时准备。并发进程通过原子 saveOriginal 保留首个提交记录，选中的 frame 发送前再次独立验证。不会展开或复制无关历史行。每条最多 512 字节，继续保留 ciphertext，不发明自动删除或保留策略。磁盘按保留行增长，不再全局解码一个文档。旧 JSON 全局 codec 淘汰，不自动转换旧文件。

独立 Node keys/delivery/sqlite Layer 要求绝对路径与 create/open 模式。create 排他创建；open 不创建缺失或外来数据库。Scope 拥有关闭，关闭后逃逸服务拒绝调用。SQLite WAL/FULL 与短同步首写事务在网络工作前持久保存字节，不在密码学或网络等待期间持有事务。超限损坏行局部失败，不改写，也不阻断另一行。平台无关入口无原生依赖、后台任务、隐式重试、隐藏 runtime 或生产消费者。

Stored 只表示适配器读回这些确切 ciphertext，不代表接收方安装，也不证明恶意服务端诚实。只有声明的传输错误转为不确定 Pending；校验、缺陷与中断继续传播。sender/principal 绑定及诚实主机接收检查由已认证适配器负责。安装报告、修复/发现、mailbox 重复洪泛修复、接收方持久存钥、发布设备永久丢失备份及新原子轮换仍有后续归属。

## 可复跑证据

独立且未改动的候选中，4096 信封 focused 测试 0/1 失败，错误为 ValidationError:oversize；源与暂存指纹不变。新版真实 SQLite 保留 4096 条历史，再接收下一条真实签名 HPKE 信封，全部 4097 条原记录仍在。两个独立子进程分别在 outbox 持久保存后/发送前和真实主机提交后/响应前退出，不执行 finalizer；另一个进程恢复确切字节，恢复调用不提供 signer/key。这证明 ciphertext 进程持久性，不代表真实设备永久丢失备份。

所属套件还覆盖跨连接首写不可覆盖、副本、Scope 关闭、错误或伪造视图、已观察撤销后回退且恶意主机故意不做授权、坏保存字节、取消不冒充 Pending、缺失/外来文件保留及单行损坏隔离。共有合成 epoch fixture 从现有 HPKE 套件抽出，其行为覆盖保留。包 172/172、类型检查及根 lint 通过；完整根检查和精确 Draft CI 分开记录。先前 fixture 类型/lint 修正保留在证据中。

最终 172 项测试代码树通过原生 Git/本地 IPC 环境的完整根检查；格式、文档及公共边界通过。检查后未修改代码；远端 CI 独立绑定精确 head 报告。

Draft: [#1450](https://github.com/LodyAI/Lody/pull/1450).
