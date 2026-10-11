# 发布 SDK 与 P09 提交组合

Status: implemented
Translation: current

[English](2026-10-11-e2ee-sdk-submission.md)

## 摘要

原 StreamsLedgerStream 的 read／CAS 尚需接入已落地 P09。本层直接基于 #1487 `098e274221aae13305d29ff75629bee168678ded`，适配实际发布 SDK0.9 形状；HPKE 与 P09 实现不改。[适配契约](../../../../packages/e2ee-core/src/submission/STREAMS.md)和源指纹记录窄范围归属。

## 归属与修正

可信初始化固定 SDK read／CAS 和独立 checkpoint 选择器。真实全历史签名重放与前缀延续建立私有 endpoint／opaque-offset 对应；读取失败不替换。CAS 仅允许匹配该对应、真实延续历史的普通签名记录；不退回普通 append，不发明 producer 重试，不以 ACK 推导已提交。P09 保存原件并独立读回结果。

原源码筛查重复 transport 位置。实际 SDK 分帧测试发现迁入 reader 可在 `-1→a→b→a` 循环 offset 时仍组装有效签名历史，正确拒绝断言在修复前失败。共享 ledger reader 恢复 seen-position 筛查并拒绝空页跳转，不复制第二 reader 或靠缺少导出隐藏行为。新 SDK case 与原 feed19 全部通过。此共享文件修正属于账本 transport，不追溯改写 #1484 固定审查证据。

读取取消会 abort 并等待原 SDK 工作。SDK0.9 CAS 无每次调用 signal，保留该原 promise；中断／Scope 关闭均等待结束，拒绝晚完成。调用方设定有界 SDK timeout，并取消／等待借用 checkpoint 后再销毁 owner。原请求永不结束时，不能宣称已停止。没有 Runtime／后台 worker 或生产 E2EE。

## 证据与未完成范围

Owning9 使用 registry SDK0.9、合成 loopback HTTP 与真实 SQLite／P09：条件 framing 原件、丢 ACK 读回、不支持 CAS 保留 Pending 后同原件重试、真实竞争分支 Conflict、错误 Org／无对应或坏签名拒绝、坏全历史、字节预算／固定方法、分帧循环位置，以及 Scope 关闭等待被信号挂起的不可 abort CAS。正常／丢 ACK 两组还用另一真实 OS 进程重开相同 journal，消费公开入口且不重签。owning9/feed19 与 package typecheck 通过；完整 root 检查也通过，core287；准确 CI、独立审查分别绑定。

普通沙箱拒绝 loopback listen（EPERM），授权本地 HTTP 后相同测试通过；这是环境证据，不记作六项密码失败。既有 node_modules 不能无交互 purge，测试显式链接已声明 devDependency 到此前验证的 registry0.9 缓存，不宣称新 clean install 通过。新增三行 importer 与 pnpm 离线锁刷新解析后相同；版本／完整性值与父锁布局不变。

合格快照 bootstrap、snapshot-offset 保护／provider、sender 发布者重建、完整 Lab 与原 Lab2 仍未完成。严格期限、vault 格式／并发、发布者永久丢失备份、D12 和 Lab replay 随机源保留决策归属。合成 HTTP／进程证据不等于部署后端、原生平台存钥或完整产品验收。全部 Draft，主协调安排独立审查。

实际 SDK 空页跳转也使用准确父098 reader字节保留负向复现：修复前一项正确拒绝测试失败，共享修复后 SDK9/feed19 通过，合法 framing 仍可接受；空页／重复位置不产生 CAS 对应。早期测试 mode 类型遗漏单独保留为静态 harness 修正。

修订后授权恢复实施，整轮迁移PR最多24张。本层直接父仍为准确098，不改写已审父层或继承Ready。实际fetch确认main e395d84f与全部三个前置合入；相对冻结main984c没有新增core/RPC交集。此前冻结归档原件继续保留。
