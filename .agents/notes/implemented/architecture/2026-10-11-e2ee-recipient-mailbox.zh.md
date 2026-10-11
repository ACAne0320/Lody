# 接收者 mailbox 组合

Status: implemented
Translation: current

[English](2026-10-11-e2ee-recipient-mailbox.md)

## 摘要

原 distribution 的 fetch/install 与 repair 消费方尚缺公开组合。本层直接基于 #1485 `680686d1442e7f8b12f6f8b84af3f17f3c514b97`。显式 host-only facade 构造真实 receiver／保护存储与持久 repair 队列，在初始化固定借用能力，portable root 不变。详见[契约](../../../../packages/e2ee-core/src/keys/RECIPIENT-MAILBOX.md)与[源指纹](../../../../packages/e2ee-core/src/keys/recipient-mailbox-provenance.json)。

## 归属

fetch 前后检查真实 Org／接收者／epoch 权限；异步再次查账本前，按数字索引复制整页有界字段。坏字段整页拒绝，不先保存任务／密钥。每个 envelope 再走真实签名、HPKE、承诺校验和保护 save／reload，才保存原签名报告。后续密码／安装失败时，保留此前合法安装与原件，当前调用返回失败且不给出成功 pagination-next；不发明跨数据库事务，不保存文档游标。

Scope 关闭本地入口和存储；调用方取消并等待借用 transport／ledger 后再销毁其 owner。无 Runtime、后台循环、自动重试、原生适配、新 wire、恢复格式、严格期限或生产组合。

## 证据与后续

十项 owning 测试使用实际公共 mailbox／签名／HPKE／SQLite，明确 synthetic protector：安装／报告、合成本地丢钥与保留密文的持久 repair；坏 envelope 保留 Verify／不返 next，包括先合法安装后失败；坏字段／超量／隐藏 iterator 行在写盘前拒绝；fetch 中撤销；显式 Deferred 账本信号间整页复制和初始化固定 fetch；Scope 关闭后晚页拒绝。相同 suite／typecheck 已在实际680父树通过；原型结果不能替代本树验收。

sender 发现／当前 key／outbox rounds、实际发布 SDK／CAS 消费方、合格快照 bootstrap、完整 Lab 与受决策约束的 recovery 工作继续由[manifest](../../../docs/e2ee-migration-manifest.json)记录。本层不关闭原 Lab2／永久丢失失败，不证明原生／全平台／生产验收。独立审查与准确 CI 绑定新精确 head；全部 Draft，由主协调安排独立审查。

最终作者验证：owning10/core273、package typecheck、完整 root `pnpm check`、format/docs 和 public boundary 通过。离线锁刷新解析后相同，仅排序变化，保留既有版本／完整性值及原布局。
