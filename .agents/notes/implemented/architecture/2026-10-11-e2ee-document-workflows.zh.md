# 已验证账本上的签名文档工作流

Status: implemented
Translation: current

[English](2026-10-11-e2ee-document-workflows.md)

## 摘要

将原型可注入的内容权限/验证器与裸密钥调用，改为使用已合入的私有已验证视图和上下文绑定加密。已定的四种文档用途复用 v0 编码、固定签名验证、准入历史与 HKDF/AEAD，不复制另一套加密实现。撤销作者的旧签名仍可认证；当前 Guest、Recovery 或被撤销设备不能加密新文档内容。

## 决定与归属

直接父层为[历史事实](2026-10-11-e2ee-historical-facts.zh.md)，head `946965a7fd3ccc10c6a18f41f8f54a38c74232a3`。可信调用方给出上下文，不能从包或 URL 推断。加密前和签名等待后均查询已验证账本权限；服务端仍须独立检查最终接纳权限。历史签名、当前权限与 AEAD 有效性分别验证。不改字节、域或算法，不批准期限、原子移除、恢复库或新钥备份提案。

明确的 `./content` 与 `./signing` 入口分别拥有文档叶密钥/工作流和借用的 signer。权限创建不接受可注入验证器；文档密钥用私有 WeakMap 及上下文绑定，导入/导出对称叶密钥拥有副本，不能导出设备私钥。输入在 Effect 执行时读取，完成前调用方负责保持其输入稳定。原语临时密钥清理继续使用普通 try/finally，不依赖 Result.gen 的 generator-finally。原生签名等待不可取消操作结束，借用密钥句柄与 Effect 执行由应用拥有。没有新增 runtime、后台进程、原生存储或生产开关。

本层仅部分迁入内容模块。非文档用途/机器操作范围、账本命令准备与签名、epoch 历史/commitment 验证、SDK provider、接纳与 Lab 仍在[清单](../../../docs/e2ee-migration-manifest.json)由后续层拥有。未导出功能不计作原失败修复；快照格式决定独立保留。

## 证据与限制

现有 crypto 套件验证真实 Node/WebCrypto 签名和加密、上下文绑定的密钥副本、不同用途/AAD、撤销作者历史、错误上下文、伪造视图/密钥、错误注入签名、有效签名下的坏密文、原生失败清理与等待签名期间撤销。取消测试明确先发送中断请求，再释放完成门；早期测试调度竞争的失败日志保留，未放宽行为断言。[来源指纹](../../../../packages/e2ee-core/src/content/provenance.json)记录输入与调整。

这些测试不代表产品启用、真实平台安全存钥、内容持久重试、永久设备丢失恢复或最终整栈/Lab 验收。验证与 CI 只对应本层精确 Draft head。

验证：包测试 140/140、类型检查通过；完整 `env -u GIT_EXEC_PATH PATH="/usr/bin:$PATH" pnpm check`、根格式、相对直接父层的文档检查及公开边界通过。保留早期 lint/native Git 失败日志；未改 Git 测试源码/断言，仅用系统 Git 环境后该套 6/6 通过。实际 SDK 0.16.2 的 provider 没有 AbortSignal 参数，后续桥接须拥有进行中的 Effect/native 操作并等待关闭。快照 offset 的服务端接纳绑定需独立格式决定，不能沿用只把 offset 藏在密文的方案。

Draft: [#1442](https://github.com/LodyAI/Lody/pull/1442).
