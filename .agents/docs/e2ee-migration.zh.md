# E2EE 核心与 Lab 迁移

[English](e2ee-migration.md)

这次把公开库、协议草案和可运行的本地 Lab 收敛到一套实现，不开启产品 E2EE，不迁生产数据，不发布包，也不代表原生存钥或全平台验收。[白皮书](../../specs/e2ee/whitepaper.zh.md)描述拟采用的架构；其中独立包实现指固定来源原型，只有对应公共层验证完成后才算本仓实现。

## 来源与归属

[逐文件 manifest](e2ee-migration-manifest.json)记录源 SHA-256、目标、状态和层次。“已迁”表示已有公共功能归属，不是原样复制或整个源模块验收；“需迁并修复”包含尚未实施；“旧方案淘汰”保留固定来源作历史；“待明确决定”需要协议或产品结论。目标路径是计划归属，不假称文件已存在。

- 公共基线：`984c35c5b30600d68abec1ec3e585eca73bcd4f0`，含 HPKE [#1432](https://github.com/LodyAI/Lody/pull/1432)。
- 原 core：`f1bc0c52649c21d2e9b620fe3558874c40545e38`。
- 候选：`bd5a9c1ec71ed7fa8085e51faec4f1e8dbe985b8`；暂存补丁 SHA-256 `4c36a1e507f2e7bcc55e9e88906ffe2b617e9d9c9aed55ab5e76745bd4d7ee71`；未暂存 diff 为空。原仓和候选只读。
- 公共包实际解析的 Effect 是 **4.0.2**，与 root lock/catalog 一致。原型另设 v4 catalog，不是升级或新增另一套 runtime 的理由。
- 实际 Lab 为 `packages/e2ee-lab`：本地 HTTP/SQLite Riverrun 宿主、诚实 Loro/Flock 客户端、调度、攻击能力入口、重放包、合成 fixtures 和崩溃子进程。两份固定来源都有该包。“可玩教程”有草案，但两份固定树都未找到相应应用源码。来源 independent-demo note 明确记录：`packages/e2ee-demo` 在宿主/session 覆盖迁到 Lab 后已删除；旧启动命令不是可运行的迁移命令。

仅迁设计源中明确适合公开的白皮书和权限文本，移除内部计划与证据链接。私有决策记录、实施计划、生产配置和对话不复制；指纹只标识约束版本。

## 栈与共享文件

每层只相对直接父分支。准确 branch/head/base 与验证记录写在该层 Draft PR；末层另验整组 diff 和测试树。层次可按独立审查的风险继续拆分。

| 层  | 职责                                               | 共享归属与依赖                                                                                                     |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| L0  | 双语公开架构、协议来源、完整清单                   | Spec 保持 draft，不推断批准。                                                                                      |
| L1  | 认证账本快照、核对、历史作者授权                   | 扩展已有 `src/ledger` records/policy/replay、不透明 verified view 和严格签名验证器；拒绝注入验证器和任意状态构造。 |
| L2  | 签名、内容、文档钥工作流和 SDK provider            | 复用 `src/crypto`、v0 域及公共字节类型，消费已发布 SDK。                                                           |
| L3  | 宿主快照准入、准确位置和客户端文档恢复             | 可信调用方提供上下文/AAD；先持久保存再推进游标；单文档失败不扩大到其它文档。                                       |
| L4  | epoch 信封/历史、换代、持久信箱、安装报告和修复    | 固定 HPKE；原始 pending/outbox 字节；显式有限轮次；D12 格式与永久丢失备份单独等决定。                              |
| L5  | 已定恢复授权和清理契约                             | 每工作区独立 R、一文件方向；库/文件编码、包装、并发和保留未定。                                                    |
| L6  | Lab 集成、本地宿主、重放、fixtures、命令与故障验收 | 消费新公共 core 和 registry SDK；不复制 core，不恢复旧两步移除，不保留未发布 tarball。                             |

`package.json`、root lock/catalog、导出、README/AGENTS 由首次消费的层逐步更新。Node 存储独立子入口，不从 portable root 偷带原生存钥或 runtime。fixtures 属于行为测试的模块；Lab 管合成存储和进程资源，core 管协议。

初次远端核验时，[#1433](https://github.com/LodyAI/Lody/pull/1433) SDK 准备为 `08aec8c69f4e0cffbfb8be9e9f67d27b0a30062f`，[#1434](https://github.com/LodyAI/Lody/pull/1434) submission 为 `f11f1451c095e47a10226ca1824c1b8b66e7a087`，两项仍开放。继续由原作者负责，依赖部分等实际 main，不复制未合代码；开始相关实现前再核状态。

文档 Draft 前再次核验：#1433 已合入 `37cadfbcb0fa2183a98ccf041ba3820a8945b28e`，main 为上面的实际基线，#1434 仍开放且 head 为 `54b16340c28a59e29bade3bf4d275d812f549c21`。文档底层跟随实际 main；依赖 submission 的实现仍等落地。

平台存钥、私有云端账本/投影/JWT/信箱、Web/手机组合、上游发布和生产期限执行分别列关联工作线，不能表示为一个公共 Git 栈。

```mermaid
flowchart LR
  A[L0 Documents] --> B[L1 Ledger trust]
  B --> C[L2 Content]
  C --> D[L3 Snapshot recovery]
  D --> E[L4 Key distribution]
  E --> F[L5 Settled recovery]
  F --> G[L6 Lab acceptance]
  X[Atomic format / vault / permanent-loss decisions] -. scoped gates .-> E
  X -. scoped gates .-> F
```

## 未决项

- 严格期限 B：不新增 claim，不改普通 60 秒容差。
- 恢复库格式、包装、身份/版本绑定、并发和保留。旧共用 R/文件原型不等于批准的新格式。
- 提交后、发钥前发布设备永久丢失的新钥备份与取回；重启不能验收永久丢失。
- D12 原子移除编码/版本/旧 reader 拒绝。拒绝旧 tag2 单独移除，未确认前不自创字段。
- 本人撤设备后的换代调度、基本机器操作清单及其它新发现的协议冲突交给其决策归属；不阻塞独立快照/内容工作。

已定：每工作区独立 R、客户端恢复坏快照、单文档停止同步、优先原生安全存钥但不改算法、本地草稿可靠保存、生产 E2EE 关闭。

## 已复现的原型失败

只在冻结的独立副本用合成密钥和本地 socket 运行，源候选不是测试工作树。

```sh
pnpm --filter @lody/e2ee-core exec vitest run test/review2-a.test.ts test/review2-c-delivery.test.ts test/review2-c-rotation.test.ts test/review2-e-api-boundary.test.ts
pnpm --filter @lody/e2ee-lab exec vitest run test/review2-b-sync.test.ts
```

首次独立复现：核心 **7 失败 / 5 通过**；Lab **2 失败 / 12 通过**。这是选定审查套件，不是全仓总数。每层保留原 fail 与等价新行为 pass 证据。

| 复现                                   | 归属                  | 要求                                                   |
| -------------------------------------- | --------------------- | ------------------------------------------------------ |
| 反射构造伪造 LedgerView                | L1                    | 公共闭包 view 已拒绝构造；用真实导出入口验证同类攻击。 |
| 注入总返回成功的签名验证器             | L1                    | 授权创建实际运行固定验证器，不信注入成功。             |
| Admin 签快照却让 Owner 没有个人/R 设备 | L1                    | 导入检查状态可达条件。                                 |
| journal 替换背书者变为 Owner           | L1 + #1434            | 重开必须独立保留信任，不从 journal 授权。              |
| 重复信封撑满读取上限，全部投递停止     | L4                    | 有界可继续分页与准确游标。                             |
| 第 4097 个信封撞永久 outbox 上限       | L4                    | 有界持久 pending/result 生命周期，不能永久累计。       |
| 发布者发钥前永久丢失当前钥             | L4 + 备份决定         | 保持未解决，重启不能替代。                             |
| 后续 offset 重复已提交控制记录被接受   | L6 + ledger transport | 拒绝且状态/游标不推进。                                |
| 回退页让持久游标后退                   | L6 + ledger transport | 拒绝并保留已保存状态/游标。                            |

冻结副本完整复跑：core **574 过 / 7 败 / 1 跳过**；确定性 Lab **182 过 / 2 败**，排除外部模型套件。九项失败均与上表一致。公共 submission 实际归属为 `src/submission/index.ts` 和 `src/submission/sqlite.ts`；候选 transport framing 待该契约落地后适配。

L3 另复现、修复已知快照 continuationOffset 替换。删除测试、缺导出或禁用应迁功能都不能冒充修复。

## 验收与资源归属

core 返回惰性 Effect；应用/Lab 管 Scope、创建、取消、等待和有界且等待完成的关闭。Promise 边界将取消传给可取消操作；原生不可取消工作结束后再清临时秘密。`Result.gen` 提前失败不会执行生成器 `finally`，用外层普通 `try/finally` 或 Effect scoped resource 清理。

Lab 使用真实 HTTP/SQLite 持久化、进程重开、双端 Loro/Flock/Repo SDK、保存屏障、解密/导入/保存失败不推进游标、文档隔离及坏快照客户端恢复。受控传输故障和合成存钥明确为测试边界。外部模型探索是可选项，与确定性 CI 分开，不读取真实密钥。SIGKILL 不等于断电或设备永久丢失。

整栈尚未完成。清单迁入不表示其中实现已迁；本次不自动 Ready、merge、deploy 或 publish。

当前实施基线：三项前置均已落地。submission #1434 合入为 `7c58cabe1d05f132b7133a52b45a16b79274ea6a`；L0 已纳入实际 main `984c35c5b30600d68abec1ec3e585eca73bcd4f0`。L1a 先迁历史作者、已签名 epoch 事实与当前内容权限查询，不改 wire；快照格式与旧客户端兼容另行讨论。
