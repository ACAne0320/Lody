# 带认证检查的逐接收者密钥 mailbox

Status: implemented
Translation: current

[English](2026-10-11-e2ee-key-mailbox.md)

## 摘要

旧全局 epoch stream 可被合法重复密文填满，超过读取上限后连无关投递也停止。本层提供公共本地 SQLite mailbox，按接收者限量读取、按密文去重，并绑定主机已认证设备和固定账本／签名验证。保留现有安装报告字节与接收者修复语义，以独立 schema 替换旧整份 JSON 存储。签名报告仍只是声明；持久安装、Lab 集成和生产认证尚未完成。

## 归属与取舍

直接父层为 snapshot Draft #1464，5d3967ec94e3b10fdec76220937e9fcfe2623590。[mailbox 契约](../../../../packages/e2ee-core/src/keys/MAILBOX.md) 说明信任、分页、资源和存储边界。报告模块保持跨平台，SQLite 只进入明确的 Node 子入口。调用方负责真实 Org／设备认证、当前已验证账本来源，以及自身异步请求的取消和等待；不增加隐藏 Runtime、后台 fiber 或生产消费者。

源实现已有中心 mailbox 和 key-installed/v1 来源／revision 报告。本层把它适配为真正的不可伪造账本 view 和已合入固定密码实现，不复制全局 JSON 展开或可注入成功的 verifier。索引存储使用不同 application ID，不转换或误认旧文件。原密文全部保留；相同包重复追加不增行，不同合法包与历史仍可增长，不自行定义保留策略。分页只是当前投影提示，不是跨请求稳定快照或持久同步游标。

已验证公共 head/count 在观察账本时独立保存，与内容／传输进度分开。轮内观察与持久精确位置检查拒绝回退、分叉；endorsed snapshot 只能证明实际保留的位置，不补造未知历史 hash。异步查询后再次检查信封／报告当前资格。报告必须匹配当前 revision 和实际已保存来源；修复保留历史、排除坏包并使先前报告失效。实际密钥持久性由接收工作流证明，不由服务器声明证明。

## 证据与限制

冻结候选的原重复 stream 测试仍为 0/1：合法密文洪水超过 16MiB 即失败。新版接收 500 个真实固定验签重复包只保存一行，另一接收者仍可读；这只证明新路径，不能称为旧 stream 修好或完整 Lab 验收。所属测试覆盖真实签名／身份拒绝、来源／报告／revision 绑定、幂等修复与历史保留、SQLite 重开、已持久观察撤销后的回退拒绝、输入复制、外国与旧 schema 文件保留、无关超大坏行隔离，以及 Deferred 控制查询期间关闭后不晚写并显式等待调用方任务。

包测试 196/196 通过。测试 fixture 类型错误和首轮重复测试的 5 秒超时已修正，原日志保留，没有隐藏协议失败。完整 root、格式、文档／公共边界和精确 head CI 分别报告。不声称生产启用、真实存钥、永久丢失备份、原子移除／恢复库格式、传输认证或 Lab 已迁完；[迁移归属](../../../docs/e2ee-migration.zh.md) 保留这些门槛。

最终 196 测试代码树通过 native Git／本地 IPC 的完整 root check、root format、docs check 和公共边界。精确 head 远端 CI 另报。

Draft: [#1472](https://github.com/LodyAI/Lody/pull/1472).

同步父层计数修复后，组合 core 197/197、typecheck 与完整 root check 通过。精确 Draft head/base 交独立审查；组合验证后未再改代码。
