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

独立 dedf 审查发现已知撤销绕过和可变页长度违约。facade fetch／repair 共用实际 receiver 的真实持久 `observeLedger` 路径；receive／保护存储本已使用它。资格判断前记录观察；事务读回固定 Org／self／head／count，不确定写入时仍记住真实验证过的知识。固定初始 row count 并检查最终长度，getter 缩短／扩展均在安装前拒绝。准确隔离 dedf 上五项选中回归失败；修复工作树 facade15／receiver15／mailbox11 通过，覆盖真实忽略／改写观察的回滚、同 handle 拒绝／重试及 journal 重开。复制的独立输入现拒绝两项页故障且0任务／0密钥，已知撤销后回退报 checkpoint-mismatch；旧报告不改写。helper 与 facade 分别更新指纹，不继承整模块 READY。

dedf CI 确实因未改的500-put去重 case 在30秒失败，保留旧结果。只在该 case 中跨原500次真实签名 put 复用未变的真实已验证 fixture ledger，断言与 timeout 不改。focused mailbox11 通过（dedup约2.9秒）；不加超时，也不把作者结果当新 CI。SDK／CAS WIP 单独 stash 保留。

修复最终作者检查：facade15／receiver15／mailbox11／core278、package typecheck、完整 root `pnpm check`、format/docs/public boundary 通过。仅绑定修复树；原 dedf NOT READY／CI失败保留。新精确 head 独立增量与 CI 尚待核验。
