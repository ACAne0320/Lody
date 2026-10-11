# 稳定 ID 的 mailbox repair 队列

Status: implemented
Translation: current

[English](2026-10-11-e2ee-mailbox-repairs.md)

## 摘要

原 distribution 的 repair request／flush 子集仍需公共持久化归属。本层直接基于 #1484 `5b90addffa22e5e88cc4442a03fe1422c4ef2b5e`，改成独立索引 SQLite 队列，保留稳定 request ID、原字段绑定与公共 mailbox 的幂等行为。不复制整块 JSON distribution，也不把 ACK 当作已安装密钥。

## 归属

[repair 契约](../../../../packages/e2ee-core/src/keys/REPAIR.md)与[源指纹](../../../../packages/e2ee-core/src/keys/repair-provenance.json)记录实现。enqueue 从真实当前账本得出 self／epoch slot，先持久保存原件，再允许 flush 在事务外发送同 ID。类型失败或丢 ACK 保留 Pending；只有真实当前 epoch／接收者变化能终结任务。本入口不产生保护密钥或安装报告。Scope 关闭本地入口和存储；借用的 ledger／transport 由调用方取消并等待后再销毁。

索引 keyset 页允许继续处理阻塞行后的任务。显式 acknowledgement 保留原 ID 绑定。Repaired 仅是本地 ACK 历史，不证明远端保管或当前安装。ID 和 rejected-digest 语义不变；没有新增 wire／域／加密 ACK、期限规则、backup／vault 格式、原生或生产组合。journal 只保存公开 repair 元数据与账本 checkpoint，不信任磁盘角色声明。

## 证据与后续

Owning6 使用实际公共 mailbox、真实 SQLite 与签名重放，验证先保存后发请求、服务端 ACK 丢失、另一真实 OS 进程重开相同 journal／mailbox 后同 ID 重试且 revision 不二次递增、明确拒收指定密文、ID 原字段不一致拒绝、真实撤销／伪造 view 与已登记 Recovery repair、SQLite 忽略终态写入后幂等恢复、102 个任务的阻塞分页／结果 acknowledgement，以及 Scope 关闭后晚 ACK 不写盘。固定合成身份种子和本地公共 host 是声明的测试边界，不代表 HTTP／原生／部署验收。

早期源 kind 数值／字符串适配和 SQL 引号／harness 错误保留为原型日志，修正未删行为覆盖。sender 目标发现／当前 key／outbox rounds、receive fetch、SDK CAS 与 Lab 消费方仍须迁入。旧 core／Lab 失败与未决协议由[逐项 manifest](../../../docs/e2ee-migration-manifest.json)继续记录。新 head 不沿用父层审查结论；全部 PR 保持 Draft，由主协调安排独立审查。

最终作者检查：owning6/core254、package typecheck、完整 root `pnpm check`、format/docs/public boundary 通过。子进程公开入口实际重开相同 mailbox／repair DB，重用原 ID 后 server revision 仍为1。作者与独立审查、准确 CI 分列；此层不关闭原 Lab 与永久丢失失败。

对照现行白皮书／permission-ledger 已定规则，修正 de3210a4 错误拒绝恢复接收者的适配：有效 R 可接收、恢复各代密钥，只禁止其发钥、写内容、执行命令和管理。repair 不授予这些权限。原泛化的 Recovery 拒绝断言替换为实际公共 mailbox 正向修复／revision／持久原件断言，保留撤销与伪造 view 拒绝。没有新增恢复库格式或协议决策。

Recovery 修复作者结果：准确 de3210a4 隔离 clone 加入相同正向断言时失败；修复后 owning6/core254 与完整 root 检查、typecheck、format/docs/public boundary 通过。旧失败／新通过分别保留，独立增量和新准确 CI 尚待核验。

父层同步到 #1484 5b90；repair 实现与 owning6／子进程 fixture 逐字未改。新组合独立绑定，旧 348／dd 结果不能自动变成此树结论。父 P1 的独立关闭证据待主协调核验。

新父组合作者检查：repair6/core257、完整 root `pnpm check`、format/docs/public boundary 通过；repair runtime／测试与 348 逐字一致。仅父层源码／历史原件回归和本层父指纹、说明改变，独立 parent integration 与准确 CI 另核，不沿用旧READY。

终态原件修复增量：独立发现真实远端 repair 成功后，SQLite trigger 可改写已保存 epoch，而本地 flush 仍返回 Repaired。终态 DML 后必须保持全部原字段和 consumed=0；acknowledgement 独立事务也校验原字段／phase 与 consumed=1，忽略写入或字段被替换均回滚。四组实际 trigger 覆盖 epoch、拒收摘要、ID、消费标记，并分别验证终态与 acknowledgement。准确 d518 上终态回归三组失败（ID 改写此前已拒绝）；修复工作树 owning10 和 typecheck 通过。作者证据不等于独立关闭或新 head CI 通过。

终态增量最终作者检查：repair10/core261、package typecheck、完整 root `pnpm check`、format 与 docs check 通过。复制的独立终态反例在故障后保留 Pending epoch0；删除 trigger 后同 ID 重试，server revision 仍为1。父5b 的别名原件 finding 仍未关闭，在所属层另修。

父层同步到 ledger14e，repair965 实现／测试不变。父层承担有界索引复制修复与两条真实别名回归。本组合须另绑作者／CI及独立整合证据，不继承任一旧审查结论。

14e 父组合作者检查：repair10/core263、完整根检查、format/docs 通过；repair runtime／测试与965逐字一致。独立整合与准确组合 head CI 另核。
