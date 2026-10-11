# Host epoch 保护与接收者密钥持久保留

Status: implemented
Translation: current

[English](2026-10-11-e2ee-host-epoch-protection.md)

## 摘要

原接收者 keyring 使用 Lab 明文 JSON，旧 opt-in 保护账本则混合旧 wire 与发布候选。已定的 host-only 保护方向需要明确能力边界，并支持不依赖发送者仍有效的冷重开。本层通过一次初始化的可信原生能力和独立索引存储迁入接收者密钥保留；不复制旧 schema，也不选择原生算法。

## 决策与责任

普通消费者继续使用 opaque EpochKey；只有 host entry 在初始化时接收一次 protect/unprotect。回调可以复制秘密，因此是可信 composition，而非操作系统隔离保证。将本地用途／Org／接收者／epoch／commitment／key 整体认证保护，原生调用后再次检查真实当前权限并重算 commitment。原生算法和实际平台存钥仍在外部。现有[foundation Spec](../../../../specs/e2ee-foundations.md)拥有这项重要边界并保持 draft；方向已定不表示整份修订文字已获批准。

[契约](../../../../packages/e2ee-core/src/keys/HOST-PROTECTION.md)与[provenance](../../../../packages/e2ee-core/src/keys/host-provenance.json)区分各来源部分。安装密钥存储与发布候选准备、发布设备永久丢失、恢复库／文件格式及安装报告队列分开。原候选状态不导入。写入／回读失败保留不确定性；不宣称已报告安装，不静默替换／删除受保护原件。

## 证据与边界

合成认证保护测试使用真实签名视图、SQLite 与独立进程重开。真实不同 Org 即使 commitment zero 相同也不能移植 blob；用途、接收者、epoch、commitment 和 key 篡改失败。显式信号控制取消和 Scope 关闭，原生工作结束后清理明文。外部文件保留、插入失败、回读失败／原件保留、撤销和重开后权限回退均 fail closed。保护器明确为 mock 原生边界。不涉及真实 keychain／密钥、IPC、产品装配、生产 E2EE、报告队列、SDK／Lab 完成或全平台验收。

直接父为 #1479 的 f7dc8e53b1f5a10f11d3eeebab3a292c3fc3023b。作者验证：protection8／core219、包 typecheck、根 format、docs check 及使用本机 Git／本地 IPC 的完整根 check 通过。测试调用实际新公开 host subentry。新进程重开保护存储，原发送者随后撤销仍不妨碍当前接收者冷恢复；接收者撤销及持久回退 pin 仍拒绝访问。这是作者结果，非独立审查／原生平台验收。
