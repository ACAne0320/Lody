# 恢复库：入口、并发与保留提案

Status: draft
Translation: current

[English](recovery-vault.md)

## 已定与推荐格式

沿用一份恢复文件、每用户每 workspace 独立 R、后来设置的 workspace 可加入原恢复库；R 只能收钥/修复及授权本人的新 personal。允许跳过恢复设置，不增加加密密码。普通换代使用已入账 R 公钥，不要求再次解锁恢复文件。

推荐 canonical CBOR 的独立 vault-v1，不重用原合成设备 JSON。文件保存版本、随机 vaultId、定位服务标识和256位随机解锁材料 U；随机生成独立库主钥 V，文件入口用 HKDF-SHA256 从 U 按 vaultId/入口用途派生包装钥，以现行 XChaCha20-Poly1305 包装 V。Passkey PRF 如实际可用，派生另一入口包装同一个 V；普通登录 Passkey 不算入口。入口 AAD 绑定版本/vaultId/入口类型与标识，nonce24B 每次新加密随机。换入口可重包装 V，不重加密全库；删除入口不使已复制秘密失效。

R 条目和索引用 V 分用途派生的钥独立加密。外部只需 opaque entryId/revision；AAD 绑定 vaultId、entryId、revision、前一密文摘要和用途。私有条目包含 Org创世锚、当前成员实例、R 双公钥/私钥、条目代次及取得可信创世/账本材料的来源。索引绑定同一身份元组及条目摘要，防替换；解密不授予当前资格，恢复仍验证真实账本及 R 当前有效性，目录自报 Owner 不能形成信任。

## 并发保存与恢复

先上传不可变候选条目并回读解密，再对加密索引做 expected revision+digest CAS。两台设备同时首次设置同一 Org/成员实例，先成功的索引 reservation 固定该 R；另一端重新读取并复用，不登记第二个 R。无关 workspace 的更新在冲突后显式合并再 CAS；同身份冲突呈现状态，不能 last-write-wins。这是恢复库并发契约，不是新账本权限。

持久进度保存 candidate entryId、原索引/CAS意图、账本原记录与阶段。仅选中的、已回读私钥包对应的 R 才继续登记；账本结果未知先核对原字节。登记成功但保存信封失败从该 R 继续，不重生身份。当前钥实际可解、承诺匹配且账本资格有效后才显示该 workspace 已验证；其他 workspace 不受一次失败影响。索引上传、账本登记、发钥是多步流程，无跨存储原子保证。

推荐有效条目不自动过期；普通替换在新条目/新 R 验证后再撤旧，旧条目转退役，未解决的阶段和仍被索引/未完成操作引用的密文不 GC。退役秘密默认保留到用户显式清理，清理需显示可能失去旧恢复路径；确认泄漏优先撤销，不等待替代验证。删除云端文件不撤销已复制的钥。未引用的失败候选仅在核对所有 pending 引用后可清理，不定天数。

## 用户代价与真正待批准项

推荐增加包装主钥、索引 CAS/reservation 和默认保留退役密文，需批准这套格式/并发/保留语义。文件丢失且无合格入口则不能解库；云端缺条目也不能凭文件找回。冲突或断网显示该 workspace 等待继续，不误报备份成功；保留旧密文增加存储与秘密暴露面，用户清理减少恢复余地。

AEAD 证明字节绑定，不证明最新：已有客户端保存最高 revision/digest 可拒绝回滚；全新恢复端依赖现有可信服务的新鲜读取与独立账本资格，不能只凭一个合法旧库声称最新恢复完成。该信任限制需与并发契约一同确认。平台安全存钥/临时秘密清理是已定方向；实际 protector、PRF 跨平台支持和完整离线内容导出不由本提案批准。

## 证据

[已迁权限草案](permission-ledger.zh.md)、[白皮书](whitepaper.zh.md)、[密钥保护边界](../../packages/e2ee-core/src/keys/HOST-PROTECTION.md)。这是格式/流程提案，尚无 vault 实现、并发恢复验收或全平台支持结论。

[HKDF RFC5869](https://www.rfc-editor.org/rfc/rfc5869), [WebAuthn PRF](https://www.w3.org/TR/webauthn-3/#prf-extension), [XChaCha20-Poly1305](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction).
