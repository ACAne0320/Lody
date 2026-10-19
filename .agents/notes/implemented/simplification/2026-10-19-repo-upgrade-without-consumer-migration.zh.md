# 保留 Repo 升级，撤回 workspace 消费者迁移

Status: implemented
Translation: current

[English](2026-10-19-repo-upgrade-without-consumer-migration.md)

## 摘要

#1607 将正式依赖升级与大范围 workspace 同步重写一起合入。维护者要求撤回这次重写，以及在其之上添加的额外代码。产品消费者恢复已发布的 Promise Repo 和 transport API，同时保留 Repo 0.23.2、CRDT 0.19.0、Client 0.12.0 和 Effect 4.0.2。堆叠的 Session residency 内核和接入也一并删除。这恢复原先的所有权行为，不宣称解决原有的 GC 竞态。

## 范围与决策

以 `8e6521a80`（#1607）及其父提交为参照，选择性应用到当前代码。CLI manager/目录读取、renderer store、预取 worker、快捷指令同步和本地 v7 客户端恢复原先 API。删除原生 workspace facade、lease、恢复机制及专用测试；Promise 客户端回到产品源码，保留真实协议、持久化和同步覆盖。

同时撤回明确堆叠在 #1607 上的 #1669/#1670（`4e285b850`、`450595e07`）Session residency，以及用于补偿原生 transport 创建 Stream 默认值变化的 #1680（`9d611b0d9`）。恢复的 Promise transport 本来就会创建缺失 Stream。后来的通知消费者恢复普通缓存文档访问。删除 #1666 针对原生观察者事件合并的专用测试，保留其独立的自动归档重试行为。

保留 SDK 升级所需的 RPC append 超时兼容调整，以及声明导出需要的公开 `RepoStreamsErrorContext` 类型。保留后续 0.23.1/0.23.2 升级，锁文件不变。原生 presence、token、本地 writer、Turn 失败释放修复、Roost 输入恢复和通知功能承担独立职责，继续保留。

## 所有权与限制

既有 workspace 启动、房间加入、缓存卸载、重连和关闭入口触发恢复后的 Promise 工作流。原先的 Repo/transport 与应用 owner 再次负责持久化和订阅。恢复其既有取消、交接和失败行为，不再叠加原生释放重试或隔离状态。局部等待不能作为服务端确认或持久化回执。撤回 residency 后，缓存 Session 不再受它保护以避免并发 GC；原有竞态需要在恢复后的所有权下另行处理。

[原生所有权记录](../../proposed/architecture/2026-10-16-native-workspace-repo.zh.md)与 [Session residency 记录](../../proposed/architecture/2026-10-17-session-residency.zh.md)保留当时实现及验证历史，不是当前消费者合同。[纯升级记录](../architecture/2026-10-16-streams-repo-release-adoption.zh.md)仍解释保留的依赖升级。

## 验证

冻结安装、全仓类型检查、格式化、类型感知 lint、Effect lint、58 项脚本测试和仓库边界检查通过。CLI 定向测试 467 项通过，renderer 同步/runtime/action 测试 308 项通过，RPC 153 项通过、3 项既定跳过。此前被沙箱阻塞的两组 Shared 监听测试现已全部通过，共 14 项。Shared 声明生成与文档检查通过，文档保留 69 个警告。

完整根应用测试链仍在运行，交付前会将最终结果记录到 PR。生产服务、设备恢复和打包验收未验证。
