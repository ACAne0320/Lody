# D12：原子移除的编码提案

Status: draft
Translation: current

[English](atomic-removal.md)

## 已定与现行实现

同条记录、一次 CAS 同时移除成员并启用新代已经确定；不再询问是否原子。准备阶段持久保存候选钥和签名原文，未知结果查原文；成功读回验证后才向仍获准设备投递。移除目标成员实例的全部个人、机器及 R，不连带撤其他成员的已入账设备。投递不属于该 CAS。

当前公开账本是 canonical CBOR v1：创世 body `[1, signer, user, member, encKey, commitment]`，普通 body `[previousHash, signer, operation]`，record `[body, signature]`。普通 body 没有独立 version 字段；签名为 `lody-e2ee/sig/v1\0 || canonical(body)`，记录摘要为 SHA256(`lody-e2ee/rec/v1\0 || canonical(record)`)。未知创世版本失败为 unknown-version；未知 operation、旧 tag2 都失败为 unknown-operation，不跳过。tag7 目前只发布新代；不能拼接 tag2/tag7 来实现 D12。

## 推荐工程落实

新增未占用 tag8，operation 编码 `[8, targetMembershipId, nextEpoch, commitment, previousEpochKey]`；使用普通 body、明确的签名域、记录哈希及精确长度校验，不复活 tag2。函数名可用 removeMemberAndPublishEpoch。最终账本格式须明确支持的操作集合；没有线上旧账本或旧端兼容要求。

前态权限只允许当前 Owner 的有效 personal 设备，目标须当前存在且不是 Owner；移除 Owner 先按现行移交规则处理。nextEpoch 必须前态 epoch+1（越界拒绝），commitment 使用现行 Org/代次绑定，拒绝已用 commitment；与 tag7 相同。一次私有状态转移删除目标当前成员/全部设备、保留历史作者及已退役身份/公钥事实，保存新承诺和历史包，清除 rotationRequired；任何校验失败不发布新 view、也不推进持久游标。

历史包沿用现行72B：24B nonce + 用新钥加密的32B旧钥 +16B AEAD tag；AAD 为 epoch-history/v1 用途、Org、u32be 新代次（上一代确定为 n-1）。与 commitment 一起纳入同一签名/CAS。发布客户端先实解包并核旧承诺；宿主/纯回放只验证结构、顺序、签名和前态权限，不能从 opaque 包证明密钥内容正确。读端恢复旧钥仍核对每代承诺。

## 首次上线使用一套一致格式

E2EE 尚未上线。删除旧端升级路径、双快照读者、降写旧格式，以及仅用于区分上线前格式的 capability pin。不支持的格式或操作直接失败，不提供兼容迁移。

最终原子移除格式与权限快照须表达同一状态转移和精确认证位置；编码与签名／摘要用途域仍须在实现前审阅。当前快照不能绕过授权及独立新鲜度 pin，不能靠快照自报建立权限。这不要求新格式选定后仍保留 v1 读者，也不默认选择 snapshot-v2 或新用途域。

## 需要审阅的增量

原子性、Owner 管理范围、后态排除目标、原文重试和成功后发钥均沿用已定规则；字段/函数名是工程选择。需要审阅的是最终 operation／snapshot 编码与认证位置契约；旧端兼容不在范围内；不扩大 Admin/R 权限，不变更算法、历史共享范围或 U03B。本提案未被批准、未接入生产；当前 codec 仍拒绝 tag8。

## 证据

[现行 codec](../../packages/e2ee-core/src/ledger/records.ts)、[权限](../../packages/e2ee-core/src/ledger/policy.ts)、[历史包](../../packages/e2ee-core/src/keys/history.ts)。这是代码核对及提案，不是新格式互操作测试或安全证明。
