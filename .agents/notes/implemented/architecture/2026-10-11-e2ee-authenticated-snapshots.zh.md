# 认证权限快照与核对边界

Status: implemented
Translation: current

[English](2026-10-11-e2ee-authenticated-snapshots.md)

## 摘要

旧快照路径接受 Admin 背书但 Owner 没有治理设备的状态；存储或快照自述的签署者也不能建立当前管理资格。本层保留 v1 完整状态/head 签名，要求外部角色与位置事实或真实同位置 view；仅签名证据不能恢复权限。快照起步的 view 只保存其后实际验证的 hash，不声称创世审计。外部确认必须绑定确切核对 tuple，替换旧仅凭公钥列表就把服务端 raw note 标成独立确认的捷径。

## 现行意图与归属

直接父层为投递 Draft #1450，34b918367fe23f6bf9c2ff1cea31b154de298cb2。现行 permission-ledger/whitepaper 允许背书快照起步，不强制创世回放，但要求独立认证的 Owner/Admin 个人设备，并核对实际状态与 head。不增加角色证书、比较签名域、D12 新格式或快照新 wire。独立 ledger/snapshot 入口管理规范状态/结构、固定验签、准备/签名、起步/证据及核对。现有 submission 代码未改，仍执行完整历史契约。

外部 SnapshotTrust 必须明确确认准确 genesis/head/count、设备公钥、成员、Owner/Admin 角色及 personal 类型。库复制并检查这些事实与签名状态一致，不建立其外部来源，也不从 snapshot/journal 补出缺失角色。可选 stateDigest 代表外部确认的完整状态，不能替代角色事实。调用方若无法取得独立同位置资格，先使用仅签名证据模式；本层未接入生产认证来源。“当前”相对明确选择的位置，旧确认不能证明设备现在仍活跃。

另一入口 snapshotTrustFromView 仅从同位置真实有资格 view 产生私有注册 token；复制 token 不授信。收到的完整 body 必须等于已知实际 view，返回 view 保留其原审计来源及历史作者信息。authenticateLedgerSnapshotEvidence 只返回签名/严格结构的 claims 与 digest，不返回 LedgerView。不从 journal 加载信任，解码状态不是权限构造器。

外部背书 view 明确 verification 和 historyStart，只保存签名起点 head 与其后实际验证的连续后缀 hash，并使用明确 offset。不创建稀疏数组、虚构旧 hash 或创世审计标记。前缀关系需要此前位置实际保有的 hash，未知前缀不能静默跳过。坏后缀保留原 view。规范历史/commitment 恢复可使用认证背书状态，但不证明快照前每次发布均已单独回放。

审计/B 返回的 view 保留完整作者归属；仅快照中的旧设备可由认证防重放事实标为 device-only，不猜测用户/成员。旧 strict historicalContentAuthor 保持严格，文档工作流消费 device-only 证据仍有后续归属。

raw 比较只报告相同、冲突或落后，始终 independent=false。confirmIndependentComparison 要求调用方通过人工或已认证通道确认完整 genesis/head/count/stateDigest/peer tuple。只有公钥、重标 note 或直接复制服务端数据都不是确认。结果记录来源，并排除原背书者和本地 signer；相同不升级历史验证，也不授予权限。通道/人工来源仍归调用方；所有 Member 可签的新 note 格式继续延后。

## 证据与限制

独立未改源测试中，Owner 无治理设备及 raw signer 重标各 0/1 失败；新所属行为拒绝两者，并保留正常快照/核对功能。真实 Node Ed25519 覆盖 Admin 起步和规范后缀、外部角色遗漏/不一致、伪 view/token/state、额外成功验签器、journal 换 signer、状态/head/count/genesis 修改、防重放复用、完整状态事实、仅签名证据不授信、大合成 pin count 不按 count 分配内存，以及 CBOR 展开预算/循环。真实 XChaCha 历史恢复/Scope 缓存使用背书 view；借用 signer 在异步后重查管理资格。

包 187/187 与类型检查通过。合成百万 count 测试只验证已 pin 位置的有限表示，不代表百万条审计。完整根检查/CI 另记。不代表产品冷启动信任来源、文档 SDK 快照 offset 接收/客户端恢复、持久信任保存、完整 Lab 或生产 E2EE 完成。原 core/Lab 旧失败继续逐项记录；旧提取指纹保留，新 provenance 记录共享文件修改。

最终 187 项测试代码树通过原生 Git/本地 IPC 环境的完整根检查，以及格式、文档和公共边界检查。首次根检查停在 fixture 变量遮蔽 lint 错误，修正后完整重跑最终树。精确 head CI 单独记录。

Draft: [#1464](https://github.com/LodyAI/Lody/pull/1464).

增量计数修复：独立审查 13ddba9823cbe51d0ff92e87c59ac9d1d206e6cf 发现 comparison note 重复累加 offset，使同点不同状态误判 pending sync。现只计一次，回归验证 full／endorsed 同点一致、不同状态明确冲突、已验后缀计数。原 reviewer 证据不改，另保留 old-fail／new-pass；信任／wire 与 P09 未改。

计数修复最终代码树：账本 47/47、完整 root check（core 188/188）通过，格式／文档及未改公共边界通过。原 count=5 失败与新版 count=3／conflict 证据分别保留。

补充对照覆盖零/非零historyStart、两种起点的suffix推进、full/endorsed同digest双向比较，以及真实重签不同状态的raw/confirm双向conflict。核查note/body/digest/view均只计一次offset，confirm绑定实际note count不再累加。零起点使用真实Owner标签，不用未登记peer。A/B/C信任、wire/domain、OwnerGov、unknown-prefix及冲突语义未变；下游heads不动，审查后另行协调同步。
