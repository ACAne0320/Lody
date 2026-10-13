# D12：原子移除的编码提案

Status: draft
Translation: current

[English](atomic-removal.md)

## 已定与现行实现

同条记录、一次 CAS 同时移除成员并启用新代已经确定；不再询问是否原子。准备阶段持久保存候选钥和签名原文，未知结果查原文；成功读回验证后才向仍获准设备投递。移除目标成员实例的全部个人、机器及 R，不连带撤其他成员的已入账设备。投递不属于该 CAS。

当前公开账本是 canonical CBOR v1：创世 body `[1, signer, user, member, encKey, commitment]`，普通 body `[previousHash, signer, operation]`，record `[body, signature]`。普通 body 没有独立 version 字段；签名为 `lody-e2ee/sig/v1\0 || canonical(body)`，记录摘要为 SHA256(`lody-e2ee/rec/v1\0 || canonical(record)`)。未知创世版本失败为 unknown-version；未知 operation、旧 tag2 都失败为 unknown-operation，不跳过。tag7 目前只发布新代；不能拼接 tag2/tag7 来实现 D12。

## 推荐工程落实

新增未占用 tag8，operation 编码 `[8, targetMembershipId, nextEpoch, commitment, previousEpochKey]`；沿用现有普通 body、签名域、记录哈希及精确长度校验，不复活 tag2、不改已有记录字节。函数名可用 removeMemberAndPublishEpoch。新语义由 capability atomic-removal-v1 明示，旧端不能把“支持创世 v1”当作支持全部 operation。

前态权限只允许当前 Owner 的有效 personal 设备，目标须当前存在且不是 Owner；移除 Owner 先按现行移交规则处理。nextEpoch 必须前态 epoch+1（越界拒绝），commitment 使用现行 Org/代次绑定，拒绝已用 commitment；与 tag7 相同。一次私有状态转移删除目标当前成员/全部设备、保留历史作者及已退役身份/公钥事实，保存新承诺和历史包，清除 rotationRequired；任何校验失败不发布新 view、也不推进持久游标。

历史包沿用现行72B：24B nonce + 用新钥加密的32B旧钥 +16B AEAD tag；AAD 为 epoch-history/v1 用途、Org、u32be 新代次（上一代确定为 n-1）。与 commitment 一起纳入同一签名/CAS。发布客户端先实解包并核旧承诺；宿主/纯回放只验证结构、顺序、签名和前态权限，不能从 opaque 包证明密钥内容正确。读端恢复旧钥仍核对每代承诺。

旧公开端遇 tag8 明确停止该 Org 的权限推进及依赖的新授权操作，保留原历史/游标；不跳过、两步降级或以只读掩盖未知权限。产品列表/发证使用已定能力门槛；普通工作区照常。不承诺历史旧二进制会显示友好升级提示，须实际安装包验证。

## 快照入口不能绕过能力检查

现行 snapshot-v1 没有必需 operation 集合；合法签名的移除后完整状态可能被旧 snapshot 读端接受，而不曾看到 tag8。仅拒绝 feed 的未知 tag 不足够。

推荐为包含 tag8 的 Org 使用 snapshot-v2：版本及单调保留的 requiredOperationTags（至少8）与 Org、head、length、完整state一起签名；建议保持6项外层body（首项2），必需tag集合纳入v2 state编码；snapshot、head-attest、digest采用独立v2用途域，禁止降写v1。状态摘要/安全码比较同时带格式版本，跨版本先统一已认证编码，不把合法重编码误报同位置分叉。完整回放产生的私有 view 和 v2 bootstrap/后续增量保留这组必需能力。v1 快照不能自动证明过去从无 tag8；新入口要求独立取得的 Org/快照格式能力 pin，或完整回放已有记录后才能确认 v1 可用，不能从快照自报“没有扩展”取得权限。

客户端 snapshot/import、恢复库 bootstrap、普通 current-view 入口都检查必需能力；服务器按已定旧端准入规则拒绝缺能力的列表/直达/发证。旧 v1 读端遇实际 v2 必须unknown-version失败，保留原状态/游标；新 producer 不生成 tag8 后的 v1 兼容快照。旧端缓存的前态v1只代表旧位置，不能由相同格式绕过独立的新鲜endpoint/准入检查。不新增抵抗恶意快照背书者说谎的承诺；现有快照信任边界仍明确。

这增加了 snapshot-v2/capability pin 互操作范围，是真正待审的协议增量；当前实现未改。不能只改 UI 或说“旧端不导出 tag8”作为兼容验收。

## 需要审阅的增量

原子性、Owner 管理范围、后态排除目标、原文重试和成功后发钥均沿用已定规则；字段/函数名是工程选择。需要确认的是上述 tag8、snapshot-v2 和 capability pin 的互操作契约，以及旧端停止未知权限推进的具体入口；不扩大 Admin/R 权限，不变更算法、历史共享范围或 U03B。本提案未被批准、未接入生产；当前 codec 仍拒绝 tag8。

## 证据

[现行 codec](../../packages/e2ee-core/src/ledger/records.ts)、[权限](../../packages/e2ee-core/src/ledger/policy.ts)、[历史包](../../packages/e2ee-core/src/keys/history.ts)。这是代码核对及提案，不是新格式互操作测试或安全证明。
