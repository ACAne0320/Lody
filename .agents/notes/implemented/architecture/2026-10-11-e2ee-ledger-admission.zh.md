# 公共入组同意与父点相对的账本命令

Status: implemented
Translation: current

[English](2026-10-11-e2ee-ledger-admission.md)

## 摘要

原型的入组／设备证明和普通命令转换尚未进入已硬化公共库，Lab 仍依赖旧 engine 入口。本层保留既有签名域，把类型化命令接入真正 view／证明／权限检查，另提供仅产出字节的 v1 创立记录工作流。等待前捕获借用 capability 和字段，固定验签检查所有 signer 输出。它不替代账户认证、持久存钥、发布，也不实现待定原子移除／换代。

## 归属与边界

直接父为内容补齐 #1474，b270bc8594f764b11b5dff99cc698973b8cdc4ca。[入组契约](../../../../packages/e2ee-core/src/ledger/ADMISSION.md) 与 [provenance](../../../../packages/e2ee-core/src/ledger/admission-provenance.json) 记录来源和责任。入组同意保留 nullable expiry 与原 user／device／request 绑定，可信 host 仍须认证账户归属、检查到期。设备持钥证明绑定精确 Org／member／kind，不能替代准入权限；不接收可注入成功的 verifier。

普通命令转换复用现有私有 prepared registry 和真实前序状态策略，覆盖已定五类命令；运行时拒绝旧 RemoveMember，不恢复 tag2。原文始终相对父点：只签一次，既有持久 submission 重试原字节。不顺带增加换代调度／存钥、D12 新格式、期限 B 或恢复库决定。

创立记录借用真正不透明初始钥和现有 signer，按既定 epoch-zero 不包含 genesis 的规则计算承诺，签公共字段并验证完整创立规则。仅返回 producer 字节；发布前初始钥须已由调用方持久保留。本层不生成密钥，不导出私钥／对称钥字节、不引新保护回调，也不宣称 endpoint／账户信任或持久性；native signer 归属与等待清理保持原样。跨平台 helper 不创建 Runtime 或 I/O。

## 证据与未完部分

所属账本套件使用真实 Ed25519 和独立已知承诺向量，比较独立编码的精确创立／准入字节，检查真实权限／状态；拒绝坏签名、假初始钥、重放／Org／member／kind 改绑、假 view、无权限／未知／旧命令及竞争父记录。Deferred 修改输入后，捕获的原证明仍可准入；坏 signer 输出、非法 kind／expiry 明确失败。普通撤销转换复用记录权限检查，专门新集成随最终套件记录。

这是创立／同意／命令的库行为，不是完整 LedgerClient transport 重开、远端发布、平台存钥、备份、SDK 或 Lab 验收。原 core7／Lab2 证据及所有决策门由 [manifest](../../../docs/e2ee-migration-manifest.json) 保留；未改既有 submission／HPKE，整栈保持 Draft。

作者验证的直接父组合：core 210/210、包 typecheck、使用本机 Git 与本地 IPC 的完整根 `pnpm check`、根 format 与 docs check 均通过。前次 209 项运行在父邮箱回归测试之前，另行保留；两次均非独立审查或 Lab 验收。
