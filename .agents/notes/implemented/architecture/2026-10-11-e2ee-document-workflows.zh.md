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

## 快照作者与异步输入补齐

文档认证／打开现消费 L1b 身份查询：真正完整历史保留原 actor／member；经过资格确认的背书快照中，已撤销设备的防重放事实只返回明确 device-only／missing-history-context。新封装仍要求当前权限，不恢复撤销作者的写权限。封装等待前捕获 scope／plaintext／additional data／signer／lookup，通过 acquireUseRelease 擦除自有明文，并要求最终真正 view 延续首次已知前缀；v0 wire／算法未改。直接父为 mailbox #1472 ad4aed943928be69b0013445c2a38d86c7907fbe。

固定 13ddba9823cbe51d0ff92e87c59ac9d1d206e6cf 的独立副本复现三项失败：快照已撤销作者不能打开旧文档、查询等待期间修改明文改变加密结果、后次前缀回退仍封装。原源文件／review 证据不改，另保留 old-fail／new-pass；覆盖真实签名快照与 Ed25519／AEAD、撤销后的新封装拒绝、坏签名、Deferred 控制输入及 capability 修改、真正账本回退。这仅是库的文档行为，不是 SDK／host 准入、生产信任来源或 Lab 验收。

L2c 最终代码树：core 201/201 与 typecheck、native Git／本地 IPC 完整 root check、格式／文档／公共边界通过。作者 union 明确区分，原完整历史断言先确认 member；无生产消费者或 wire 变更。

L2c Draft: [#1474](https://github.com/LodyAI/Lody/pull/1474).

已同步 #1472 的 6ed759f1c9081d2758311fde9bd5147e650e5df2 单页修复；组合 core 202/202 与 typecheck 通过，内容实现及四项回归未改。先前独立 READY 仅绑定其记录的 4319f6c0 head，新组合须限定复核。

父同页一致性修复同步：直接纳入 mailbox 58cbd49c6869f28d09efb60d3b9a7ec10243e93a。content 实现和四项行为回归未变。准确组合 core203／typecheck／完整根 check 及根 format 通过；前 b270 组合的独立审查不改绑到此新 head。
