# 原子格式、恢复库与发布设备丢失的审阅提案

Status: proposed
Translation: current

[English](2026-10-12-e2ee-unsettled-contracts.md)

## 摘要

原子移除已定，互操作编码和备份契约尚未批准。三份短 draft Spec 推荐复用现有域的新 operation、明确并发续做与保留的包装恢复库，以及发布前独立受保护的候选副本。它们区分真正协议/产品增量，不要求用户选择字段名。现有账本、持钥和元数据消费者独立继续；没有实现或把这些待定格式/发布门槛视为批准。

## 需要审阅的决定

- [D12 编码](../../../../specs/e2ee/atomic-removal.zh.md)：现有 ordinary v1 域/CBOR，推荐 tag8 与 capability；前态 Owner 权限及历史包算法沿用。原字节对账已经定了。
- [恢复库](../../../../specs/e2ee/recovery-vault.zh.md)：独立主钥包装、加密索引 reservation/CAS、逐工作区续做、退役秘密显式保留。全新恢复不能由合法旧密文密码学推断最新状态。
- [发布者丢失](../../../../specs/e2ee/publisher-key-recoverability.zh.md)：推荐必须先有独立受保护候选，无恢复库时提供操作专用文件；替代方案明确接受首次分发前失钥窗口。钥副本不等于管理身份恢复或持续持钥。

需要 review 的是互操作、资料保留及用户可见的发布阻塞，不另做小实现 PR。现有源 Spec 表达方向，但只读且未定义这些增量；新增 draft 不改变其已定保证。不改普通 JWT 容差/U03B、算法套件、最低平台或生产启用。

## 核对与归属

已读现行公开 codec/policy/history 与源 decisions/whitepaper/permission-ledger。现行 codec 仍拒绝新 tag8 和旧 tag2，不另造 core。没有新协议实现/模型证明或永久丢失验收结论。清单保留部分实现和教程缺应用源码，旧失败证据不变。提案随集成审阅保留，具体落层待协调，不改已审父层 head 冒充早已包含。
