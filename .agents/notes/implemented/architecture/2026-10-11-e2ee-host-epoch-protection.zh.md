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

## 用户批准 A（2026-10-12）

用户批准受限A：已验证并安装的EpochKey可经可信宿主初始化时注入的protector持久保存，原生存钥优先。复用此port/store，不批准普通调用回调/export或新包装/账本/信箱domain。全部context放在受保护字节内，不依赖独立可改SQLite metadata。core借出有界scratch直至native实际结束，再清零己方副本；adapter可留副本，JS不保证彻底擦除。成功open的opaque key移交调用者；失败仍由原操作持有并释放。新投递继续检查当前发送者；已合法安装的历史钥可在原发送者撤销后cold-reopen，这不是B历史信封恢复。

现有platform host-keys只有public identity创建/读取，没有认证的对称保护能力。现有Electron safeStorage字符串路径缺少已审查的全载荷完整性/backend失败adapter，开发路径还可明文，未在此接入。合格adapter须认证整个固定payload、拒绝不安全/不可用存储、保留未知写结果原件并等待实际操作。此处不宣称原生/Keychain/全平台验收，不另选算法。[Electron官方API](https://www.electronjs.org/docs/latest/api/safe-storage)说明平台安全差异及Linux basic_text回退；这是具体组合缺口，不是断言所有native后端都不安全。

扩展真实SQLite owning用例：原发送者撤销后在另一个OS进程cold-reopen。protector明确synthetic；当前接收资格和独立genuine历史仍必须。安装context journal/readback/固定报告队列由后续receiver层负责，复用既有receive/HPKE/P09，不以旧Installed标签代替。D12 wire、SDK snapshot header、vault/新钥备份策略、严格B与生产启用仍未批准；L2c保持独立。

CI固定夹具修正（2026-10-13）：顺序执行后#1480准确CI38349549813在500次去重用例仍耗32087ms而超30秒；紧接着原则验证5秒也失败，红日志保留。源码对照定位：本早层每次put都通过f.ledger重新验证同一份未变化的真实签名历史，#1487已有已审的genuine verified view提前捕获优化。将该既有优化带回本早层：固定夹具只验证一次相同历史，但全部500次公开put及每次真实信封验签、数据/断言仍保留；其他动态撤销授权夹具不变。撤回未推送45秒预算方案，原30秒/其余5秒/协议60秒/未批准严格B均不改。Vitest3.2.4 afterEach早于onTestFinished，在删除文件前显式取消并等待该用例Effect，让SQLite清理完成，不留超时任务影响下一用例。不是生产验证缓存或新权限语义，仍需新准确CI。

深度审查修正：先认证view来源、Org和已知连续前缀并记录观察，再判断epoch存在和收件资格。未知epoch不再丢掉真实撤销；复制view不能建立pin。保护存储独立保留验证知识，在同步UPDATE边界重查内存，短事务必须changes=1并有界准确读回Org/recipient/head/count。ABORT/IGNORE/head或context改写返回失败并回滚，不允许同一对象回退或假称读钥持久成功。失败写入不承诺跨进程记忆；仅成功落盘的pin用独立OS子进程验证。真实高位view重试可成功，发送者撤销后本地已安装旧钥仍可恢复，不放宽新信封发送资格。所属14项/类型通过，真实SQLite/OS子进程与明确synthetic保护；原独立5fail/1pass保留，这些是作者证据，独立增量待完成。
