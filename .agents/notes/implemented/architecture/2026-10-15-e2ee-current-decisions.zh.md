# 当前公开 E2EE 决策

Status: implemented
Translation: current

[English](2026-10-15-e2ee-current-decisions.md)

## 摘要

尚未上线的 E2EE 栈几乎为每次提取、修复和父同步都增加了一份 Note，大量内容重复模块合同或记录过时的验证计数。本文只合并仍能解释当前实现选择的理由；具体行为归模块 README，来源去向归 manifest。未定协议和产品决定继续保留在[独立提案导航](../../proposed/architecture/2026-10-15-e2ee-open-contracts.zh.md)，不因文档合并获得批准。

## 只保留当前格式

没有需要迁移的已部署 E2EE 账本或存储。每个入口只支持一种当前格式，不保留旧 reader、别名、JSON 导入、双解码或 schema 升级。当前 v0/v1 名称属于被认证的协议域，不能当作旧版本随意改名。正常重开、已验证历史、历史作者、后向 epoch 钥恢复和原字节重试仍是当前需求；旧仓导出清单不要求恢复废弃 API 或另一套 core。

## 信任与权限

权限只由一套已登记 genuine view 重放/规则产生。SQL、传输 offset、ACK、报告和服务器 revision 都不能选择账本权限。合法历史签名不赋予当前写入或发钥权。Snapshot 背书需要独立的同位置资格，或真正合资格 view 创建的私有 token；只有签名证据或比较相等的 notes 不能产生该信任。不能伪造未知的 snapshot 前缀 hash，也不能猜测缺失的用户归属。异步工作后重新核对当前权限与已知前缀。

具体 Streams adapter 返回同次验证产生的 genuine view，Lab control 直接复用；通用 remote 的 records 仍由 P09 独立验证。共享路由筛查只覆盖实际读取/control，mailbox 和内容写入保留各自真正的准入路径。

## 已安装密钥保护

受限批准只覆盖经验证的 installed EpochKey：可信宿主在初始化时一次绑定 protector，普通调用者持有不透明钥。保护载荷必须认证完整 purpose/Org/recipient/epoch/commitment/key。Adapter 能复制明文，因此这是信任边界，不是 OS 隔离或完全清除保证。已安装钥可在原发送者撤销后重开，新信封仍必须有当前合资格发送者。该批准不包含历史信封恢复、候选备份、vault 格式、installed-history 产品范围或真实平台保管。现有 identity port 和 safeStorage 字符串路径不是已验收的原生保护 adapter。

## 持久化与生命周期

首次签名记录、密文、报告或 repair ID 先持久化再发送；重试原件，不静默重签、重新加密或 rebase。CAS 不降级为无条件 append。成功前读回最终行与上下文；磁盘 phase、远端 hint 都不能证明安装、持钥或权限。显式确认保留原件并释放活动分发容量，磁盘历史仍可增长。索引存储替代整块 JSON 持久化。

Lab 会话及进程/CLI 命令接通稳定 ID repair、各阶段独立分页和三类结果/确认。
调用者决定何时已消费结果；密钥轮次不自动确认或丢弃结果。首屏阻塞后可继续后页，
无需换 ID 或新增队列 owner。接收任务只有一个待安装 Install 阶段：每次重试仍打开
原密文、保护保存/读回后才签报告并排队，省去保存前的冗余 phase UPDATE。
本地 receiver schema2 直接拒绝已不支持的 schema1，无迁移；协议认证域不变。

一个 receiver 拥有 installed-key 存储，分发和历史消费者借用它。Owner 先拒绝新工作，中止可停止的操作，等待真实 native/SDK/body 结束，再释放数据库和原生资源。Promise 桥只用于实际 SDK/Node 回调。StreamsClient.close 发布协议 EOF，不是释放资源；SDK close 也不自动等待所有操作。自有临时数组在真实结束后清理，借用句柄和运行时内部副本有各自生命周期。HTTP 关闭先中止传入 body，再等待回调；Scope 逆序清理不能让中止操作排在它等待的 body 后面。有界 body 读取在既有 lease 内共用一个内部 helper；EOF 释放 reader，未读完则等待 cancel，并确保释放锁。

## 验证开销

分批原生 Ed25519 验证仍执行同一套纯权限规则，保留严格规范子群和 scalar 检查。私有有界缓存只保留精确数学验证成功，不缓存角色或新鲜度；原生后端故障属于测试设施/后端失败。内部不可变结构共享数据，公开检查仍返回独立结果；feed 重开仍完整验证历史，是 O(N)。

只有完整基线审计、精确无触发器 schema、外部写入标记未变，才允许索引最终读回。Schema、触发器或其他连接变化仍走完整比较；计数不能产生信任。最终检查位于最后一次 DML 后，省去之前的重复读回。这些条件和缓存仍须接受必要性审查。Lab 的120秒看门狗是测试设施边界，不是性能通过线或严格 B；成功清理资源后才写最终证据。执行与 inspect 共用动作语义和观察汇总，不让非法计划经不同检查路径变成通过证据。

## 模块与验证边界

[Core](../../../../packages/e2ee-core/README.md) 拥有协议基础，[Lab](../../../../packages/e2ee-lab/README.zh.md) 用发布 SDK、合成保护、真实 SQLite/HTTP 和进程故障消费这些入口；它不是产品组装或真实 Keychain 验收。[Manifest](../../../docs/e2ee-migration-manifest.json) 保留来源 SHA、去向及未完成项。作者测试、独立审查、准确 head CI 与生产验收分别归属。

按切片累计的进度 Note 直接移除，不再复制一份仓库内归档。原文固定保存在 [15d35f75 历史](https://github.com/LodyAI/Lody/tree/15d35f75cd702f9d8846a73f03636ce4afce1d80/.agents/notes)。本次合并本身不改变协议批准或运行行为。

## 补齐本地发布与显式快照消费者

旧库的本地换代流程通过独立初始化的 candidate protector 迁入，不扩张受限 installed-key A。
受保护候选和原签名先落盘、实际读回，再调用 P09；丢回执或重开继续原件。
真实承诺和 installed 保存/重读完成后才返回 Committed；显式确认仍保留历史原件。
Publisher 借用 installed 读钥时不持有 control actor 的许可，因为读钥会刷新同一 actor。
完整会话拥有关闭流程；文档按当前代加密并在异步签名后重新核对。
独立备份与发布设备永久丢失政策继续保留为提案。

快照消费者现在接收显式独立合资格的签名起点，只保存其原字节、真实 suffix 和游标。
每次重开重新提供资格。认证工作区在原生认证前捕获资格，可不读 genesis 前缀而启动读取。
Offset 和 SQL 不选择权限，P09 写入仍验证全历史。这不改变 snapshot wire 或资格规则，
也不代表生产信任取得已完成。


## 当前原子移除与内容快照补齐

当前 tag8 由 Owner 的 personal 设备签成一条记录，同时移除目标并启用新代。
复用原候选与 P09，保留退役成员／设备事实和历史，发钥只面向剩余设备。现行快照
授权状态已能表达同一后态，不增加旧端 capability 协商或第二 decoder。该编码仍为
实验实现，关联 Spec 保持 draft，供互操作与安全审查。

内容 header4 在 provider header 内携带有界规范续读位置，因此已发布 SDK AAD、
内容签名和 AEAD 都认证该位置。update 保留原 header3 字节；移位、model、purpose、
签名或 AEAD 错误不推进持久状态。宿主在 native 验签前后核当前写权／epoch及提交者。
快照还须跨重试保留已接纳原件身份和当前位置；单独调用 Riverrun PUT 不满足该契约。
生产历史保留／信任来源与严格 B 仍单独待定。Lab 明示 SDK 上传方法带 internal 标记。

已入账 R→本人 personal 消费者复用公开 proof/P09/HTTP/HPKE，不增加同义 service。
个人设备刷新的比较 note 仍须调用方给出真实独立信道取得的精确 tuple，宿主观察
不能自行升级为确认。代码结构评估建议保留领域目录，只拆过大的 rotation／receive／
distribution 中纯规则、流程和平台存储；本次没有移动文件或执行架构重构。


## 当前创建与重现消费者

客户端先持久保存唯一签名 genesis，再发 HTTP。宿主实际把它作为 control 首帧创建，完整
签名读回确认后才发布持久观察位置；远端已写而本地 checkpoint 未保存时，不重签即可恢复。
重开仍需独立最小 pin，宿主观察不是客户端的新鲜度来源。registry 与 P09 保持既有 owner。

动作 replay 比较新执行的实际结果、精确拒绝／故障事实及每轮内部持久关系；原字节读取
pack 通过调用方合资格历史和取钥能力重验、解密原密文。不替换全局熵，也不承诺新密文相同。
缩减先重现同一具体失败，再为候选建立新的真实资源。有限攻击能力不接触正常客户端私有
路径／密钥；缺少测量仍明确未测。

完整 Lab 宿主在每次授权前刷新真实 control。新 genuine 观察写盘失败后保留对象内的单调观察底线，
拒绝 current/checkpoint 和旧前缀，保存成功后再继续；重开仍另给独立最小 pin。离线编辑只
持久化原生状态／旧游标，发布由现有 SDK 按当前 epoch 处理，不新增 outbox。有限攻击计划
只获得真实响应控制能力，未知／设施错误不能替代具体拒绝测量；独立比较确认不从宿主猜测。
