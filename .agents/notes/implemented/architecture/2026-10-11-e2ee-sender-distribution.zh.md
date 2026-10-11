# 已验证目标发现与持久化发送协调

Status: implemented
Translation: current

[English](2026-10-11-e2ee-sender-distribution.md)

## 摘要

原发送流程仍缺少公共目标发现和可重开的投递协调，无法只靠现有接收者完成迁移。组合现有 receiver、protected-key 与 outbox，只增加独立索引 task/result journal。资格和终态来自真实已验证账本；远端 revision 仅触发同原件重试。本层投递已提交、已保护的当前密钥，不选择候选密钥备份或恢复格式。

## 决策与证据

直接父为SDK #1491 `f82f8634743d5bc4dd8858cf6867b91d80c221ba`。当前行为由[模块契约](../../../../packages/e2ee-core/src/keys/DISTRIBUTION.md)说明，来源指纹保留原key-distribution模块；不导入旧整块JSON schema。host初始化继续沿用已定的原生保护边界。

每个revision有独立本地task，旧结果与确认保留；outbox delivery ID不变，始终保留首次原始密文。远端status不能创建Obsolete／Revoked／Observed权威。投递前后均通过实际当前账本与固定签名／envelope检查，receiver的持久化观察记住真实撤销。DML之后比较全部保留的标量task字段，后续trigger不能暗改旧已确认结果。

作者owning用真实签名／HPKE、三种注册接收设备、公共mailbox、实际protected save/reload、SQLite、genesis发布者报告重建和真实recipient安装。丢读回后重开时禁止任何新签名，原件仍成功。另一真实OS进程重开相同key／outbox／task／report文件，不持有可用signer，继续投递并flush原发布者报告。实际IGNORE／rewrite终态trigger保留Pending，去除故障后同原件重试成功。合成protector与本地参考mailbox是明确测试边界，不算原生平台／后端验收。

初次类型检查暴露裸number未经过EpochNumber验证、测试改写只读signer；改为实际验证与新借用signer。后来Recovery测试误选kind1（machine），保留失败后纠正为kind2并断言真实已验证state.kind，没有改变权限规则。owning9／core296、package typecheck、完整根检查、format/docs/public boundary通过；当前head独立审查与准确新CI另记。

候选备份／永久丢失、D12、恢复vault编码、SDK保护快照offset、Lab回放随机源仍未定。本层不代表全部迁移完成、生产组合、密钥创建、数据库迁移、发布或部署。
