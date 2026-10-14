# 公开 Lab 组合与剩余边界

Status: proposed
Translation: current

[English](2026-10-12-e2ee-lab-integration.md)

## 摘要

原 Lab 依赖原型实现，累计进度记录也掩盖了当前行为。公开 Lab 现组合公开 core
和已发布 SDK，提供现有工作区会话、有限真实进程动作及 CLI 证据。
当前格式的消费者共享资源 owner，只保留一条原生 Effect 编排路径。
genesis/epoch/快照/恢复库发布者及完整原场景验收仍未完成，不代表生产 E2EE。

## 范围与决定

没有已部署的 E2EE 数据或 API 需要兼容。metadata 前补 genesis、废弃别名、
易失密钥缓存、重复保护存储 owner，以及未接通的 pause/intercept/freeze/start-log
和 Promise-phase 路径已移除。当前格式重开、原字节重试、历史作者认证与向后密钥
恢复仍须保留。[仅支持当前格式决定](../../implemented/simplification/2026-10-14-e2ee-current-formats-only.zh.md)
记录此次简化；权限与协议批准状态不变。

[README](../../../../packages/e2ee-lab/README.zh.md) 说明命令和入口；
[清单](../../../docs/e2ee-migration-manifest.json) 保留原来源的处理归属；
[来源记录](../../../../packages/e2ee-lab/migration-provenance.json) 链接来源与逐次执行身份。
完整 checkpoint 文本和早期证据保留于
[Git 5ab9394](https://github.com/LodyAI/Lody/blob/5ab9394392a3577a76b14ab0552c33f755b3ce48/.agents/notes/proposed/architecture/2026-10-12-e2ee-lab-integration.zh.md)。
相关交付为 [#1526](https://github.com/LodyAI/Lody/pull/1526)、
[#1557](https://github.com/LodyAI/Lody/pull/1557)，实时检查结果另行归属。

## 组合、权限与资源归属

`openLabWorkspaceSession` 拥有已获准的 control/P09、认证身份、receiver/distributor
和两种原生文档。只有 receiver 打开受保护的已安装密钥存储；distributor 和
已安装历史组合借用 `installedEpochKeys`。Loro/Flock 共用文档引擎，导入、保存
或恢复失败只停止该文档，保留原持久状态/游标。

控制流已包含原签名 genesis。本地重开位置和网络 pin 是独立输入，发现元数据、
SQL 和 offset 不能选择信任依据。私有 IPC 观察须与独立见证的原记录核验。
加入申请在 POST 前持久保存；丢回执后重试原签名，获准成为成员后才启动密钥/内容。
Recovery 可以接收、修复、授权自己的新个人设备，但不能发送密钥或写内容。
历史内容认证不授予当前发送资格。

原生流程组合 Effect 阶段，`LabCallbackRunner` 只承接真实 Node/SDK 回调。
父事件身份使用 JSON tuple；replay 精确比较 parent 和 occurrence，不保留旧分隔符限制。
关闭先停止接收新工作、abort，再等真实请求/响应体/CAS 结束，最后释放此前资源。
并发 close 共享完成结果和清理失败原因。StreamsClient close 会发布 EOF，
不能用于资源释放；CRDT SDK close 本身也不等待所有单次操作。
先等原始工作，再关 SDK/订阅，最后 free Loro 或丢弃 Flock 引用。

## 证据与限制

所属用例覆盖真实 HTTP/HPKE/SQLite、两种 SDK、OS SIGKILL/重开、丢 ACK 后原字节
恢复、错误 offset 账本拒绝、文档隔离及持久状态对保留。原生清理用例保留晚到工作、
并发关闭和 defect 边界；这些覆盖不代表完整原 Lab 验收。

`run` 执行有界 JSON 动作，`ok: false` 必须指定精确 refusal tag/code。
无类型、defect 和无关失败仍是测试设施错误。组合检查逐项保留测量，再取最差结论。
`inspect` 重算不可信观察，不认证文件，也不重新运行。provider 独立保留测试设施
失败信号，实际 SDK 结束后再检查，防止 SDK 统一错误码掩盖问题。
逐次执行的源码/依赖哈希标识实际运行树；作者测试、准确 head CI、独立发现和
产品验收必须分别说明，不能互相替代。

## 剩余协议与平台工作

| 主题 | 保留的边界 |
| --- | --- |
| Genesis/control | control record0 含完整签名 genesis；可恢复创建、宿主持久 checkpoint/丢 ACK 崩溃闭合未完成 |
| 内容快照 | 认证的续接位置、独立固定的当前个人 Owner/Admin 资格仍需最终编码/审查，发布者/bootstrap 阻塞 |
| D12 | 原子移除/新 epoch 原则已定；tag8/snapshot-v2/capability 提案未批准，禁止 tag2 降级或拆成两次 CAS |
| 恢复库 | 直接 file-secret 派生与草案 master/index 方案待选；逐项替换/保留退役备份保证与 Passkey 分开处理 |
| 候选备份 | 发布前可读备份与明确接受紧急丢失风险的选择待定，候选/轮换/恢复发布者阻塞 |
| Replay 熵 | 保留原签名/加密字节与安全随机首次 seal；带标签测试熵须明确批准，不覆盖全局 crypto |
| 比较 note | 宿主 note 无授权效力，仍需外部完整 tuple/真实 peer；全 Member 签名 note 须新增 wire/domain |
| 严格 freshness B | 普通60秒容差保持，严格时间来源和失败语义另行批准 |

受限 A 已批准，仅保护可信初始化后的已验证安装密钥。Lab protector 使用已知密钥
AES，不提供原生存钥；恢复只读取已安装原件，不打开历史发送者信封。
候选备份、恢复库、D12、受保护快照和生产保护不在该批准内。
保留历史读取 API、原生平台保护和私有产品接线仍由外部工作负责。
测试通过或适配器已经实现，都不批准这些决定。
