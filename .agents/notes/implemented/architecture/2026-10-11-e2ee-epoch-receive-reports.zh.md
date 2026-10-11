# 接收者持久安装与原报告有限重试

Status: implemented
Translation: current

[English](2026-10-11-e2ee-epoch-receive-reports.md)

## 摘要

保护后的安装密钥层仍缺原型接收工作流和可重开恢复的原签名报告队列。本层通过真实当前信封／HPKE／commitment 门，以及签名前实际保护保存／回读，迁入这部分。保留来源和原件，以有限轮次推进；不恢复整份 JSON 任务展开、phase 自称可信或虚假的已报告持钥。

## 责任

直接父为 #1480 的 ec6a02f97aea1445a89ee1bc5a4d72e38f1bf9ee。[契约](../../../../packages/e2ee-core/src/keys/RECEIVE.md)与[provenance](../../../../packages/e2ee-core/src/keys/receive-provenance.json)拥有细节。host 初始化一次固定保护／存储、原生句柄、signer 与 transport；普通调用不能传入假成功的持久化回调。即使本地已有正确 key，Verify／Install 仍须真实打开本来源。原签名队列重试不重签；任务／报告不赋予账本权限，也不能替代实际保护持钥。

发送者撤销后重试已排队声明，保留原 flush 契约；打开新信封仍须当前资格。只有真实 epoch／接收者变化能结束任务，repair revision 仍是服务器 hint。有限 keyset hint 支持保留失败项并继续后续任务。本地 ACK 历史不是当前持钥或远端持久化证明。失败／取消及不确定写保留原件；不静默替换无法读取的保护原件。

## 证据与余项

所属测试用真实密码、SQLite 与公开 mailbox 准入：签名前实际读盘；丢 ACK 后重开且 signer 不可用时仍重试原件；保护失败恢复；伪造 Install phase／既有正确 key 不能掩盖坏密文；本地丢钥与新 repair revision；精确已验证本地发布；101 个旧 revision 阻塞声明及后续当前投递；发送者／接收者撤销；显式信号控制捕获及关闭后的迟到拒绝；独立进程经明确 RPC 桥投递原报告。该桥和合成保护器均明示边界，非 HTTP／SDK／原生存钥验收。

发送者发现／当前 epoch 分发、持久 requestRepair 协调及 fetch 装配仍归原来源，不把整模块标已迁。SDK／HTTP／Lab 和九项原 core／Lab 失败去向仍由[manifest](../../../docs/e2ee-migration-manifest.json)分别拥有。不改 HPKE／P09，不开启生产，不访问真实 keychain，不加入恢复文件／包装策略或 D12 格式。全部保持 Draft。

作者最终直接父组合：receive11／core230、包 typecheck、根 format／docs 与使用本机 Git／本地 IPC 的完整根 `pnpm check` 通过。早期 MTS generic／fixture 类型／lint 错误及一次 Buffer／Uint8Array 表示差异断言失败另行保留；修正同字节比较，不改实现、不删撤销覆盖。作者结果非独立审查或完整 Lab／产品验收。
