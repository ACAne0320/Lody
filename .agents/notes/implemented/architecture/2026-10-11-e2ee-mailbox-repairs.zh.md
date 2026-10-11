# 稳定 ID 的 mailbox repair 队列

Status: implemented
Translation: current

[English](2026-10-11-e2ee-mailbox-repairs.md)

## 摘要

原 distribution 的 repair request／flush 子集仍需公共持久化归属。本层直接基于 #1484 `dd2975419c49bf129eff9b037239dac2a64a7bbc`，改成独立索引 SQLite 队列，保留稳定 request ID、原字段绑定与公共 mailbox 的幂等行为。不复制整块 JSON distribution，也不把 ACK 当作已安装密钥。

## 归属

[repair 契约](../../../../packages/e2ee-core/src/keys/REPAIR.md)与[源指纹](../../../../packages/e2ee-core/src/keys/repair-provenance.json)记录实现。enqueue 从真实当前账本得出 self／epoch slot，先持久保存原件，再允许 flush 在事务外发送同 ID。类型失败或丢 ACK 保留 Pending；只有真实当前 epoch／接收者变化能终结任务。本入口不产生保护密钥或安装报告。Scope 关闭本地入口和存储；借用的 ledger／transport 由调用方取消并等待后再销毁。

索引 keyset 页允许继续处理阻塞行后的任务。显式 acknowledgement 保留原 ID 绑定。Repaired 仅是本地 ACK 历史，不证明远端保管或当前安装。ID 和 rejected-digest 语义不变；没有新增 wire／域／加密 ACK、期限规则、backup／vault 格式、原生或生产组合。journal 只保存公开 repair 元数据与账本 checkpoint，不信任磁盘角色声明。

## 证据与后续

Owning6 使用实际公共 mailbox、真实 SQLite 与签名重放，验证先保存后发请求、服务端 ACK 丢失、另一真实 OS 进程重开相同 journal／mailbox 后同 ID 重试且 revision 不二次递增、明确拒收指定密文、ID 原字段不一致拒绝、真实撤销／Recovery／伪造 view、SQLite 忽略终态写入后幂等恢复、102 个任务的阻塞分页／结果 acknowledgement，以及 Scope 关闭后晚 ACK 不写盘。固定合成身份种子和本地公共 host 是声明的测试边界，不代表 HTTP／原生／部署验收。

早期源 kind 数值／字符串适配和 SQL 引号／harness 错误保留为原型日志，修正未删行为覆盖。sender 目标发现／当前 key／outbox rounds、receive fetch、SDK CAS 与 Lab 消费方仍须迁入。旧 core／Lab 失败与未决协议由[逐项 manifest](../../../docs/e2ee-migration-manifest.json)继续记录。新 head 不沿用父层审查结论；全部 PR 保持 Draft，由主协调安排独立审查。

最终作者检查：owning6/core254、package typecheck、完整 root `pnpm check`、format/docs/public boundary 通过。子进程公开入口实际重开相同 mailbox／repair DB，重用原 ID 后 server revision 仍为1。作者与独立审查、准确 CI 分列；此层不关闭原 Lab 与永久丢失失败。
