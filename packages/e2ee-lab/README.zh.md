# 公开 E2EE Lab

[English](README.md)

这是消费公开 `@lody/e2ee-core` 导出和已发布 SDK 的私有合成 Lab，使用真实
loopback HTTP、SQLite、HPKE、Loro/Flock 和 OS 进程。迁移尚未完成，
此包不启用生产 E2EE。E2EE 尚未上线，旧数据、账本和 API 兼容不在范围内。

## 运行

使用仓库支持的 Node 和固定 pnpm，在独立 checkout 初始化公开 submodule，
按冻结 lockfile 安装。依赖版本以 [package.json](package.json) 和根 lockfile 为准。

```sh
pnpm install --frozen-lockfile
pnpm --filter @lody/e2ee-lab typecheck
pnpm --filter @lody/e2ee-lab test
pnpm --filter @lody/e2ee-lab lab run /absolute/new-output-directory
pnpm --filter @lody/e2ee-lab lab run /absolute/another-new-directory actions.json
pnpm --filter @lody/e2ee-lab lab inspect /absolute/new-output-directory/evidence.json
```

`run` 要求输出目录尚不存在。默认计划执行 39 个动作；自定义计划是最多 256 个
动作的 JSON 数组。不支持的动作和访问器在执行前失败；缺少必需观察也明确失败。
SIGINT/TERM 先停止接收新工作，再等待真实子进程终止。

失败预期必须指定精确拒绝原因，例如：

```json
{ "ok": false, "refusal": { "tag": "LabContentError", "code": "decrypt_failed" } }
```

无关的有类型失败、defect 或无类型错误都属于测试设施失败。
每项 ok/outcome/text/持久状态不变检查保留自己的结论；某项通过不能覆盖
另一项已测违规或缺失测量。

| 退出码 | 含义 |
| --- | --- |
| 0 | 已测动作契约通过 |
| 1 | 测试设施失败 |
| 2 | 已测违规或覆盖缺口 |
| 64 | CLI 用法无效 |

`evidence.json` 保存实际载入源码/依赖的哈希、原始签名记录、受保护传输字节、
调度、观察及覆盖缺口。其引用的 `fixture/*-transport.jsonl` 仅含受保护协议流量，
不含凭据；设备私密导出只留在 IPC 内存。`inspect` 根据记录的观察重新计算结论，
不信任已存 verdict；它不认证文件来源，也不重新执行场景。耗时仅作诊断。

## 入口与资源归属

| 入口 | 职责 |
| --- | --- |
| `./workspace-session`、`./full-session` | 已获准的现有 control/P09、身份、密钥和逐文档资源；重新认证先关闭旧 owner |
| `./join-session` | 持久化原签名加入申请，丢回执后重试；真实获准后再普通启动 |
| `./key-round` | 一轮有限修复/接收/报告/分发；明确保留阻塞任务和各页游标 |
| `./content-session`、`src/platform/flock-session.ts` | Loro/Flock 适配，共用文档生命周期及原生状态/游标原子存储 |
| `./host`、`./http-identity` | 合成 challenge/bearer HTTP、签名 genesis 发现、加入、mailbox 及有界控制/内容传输 |
| `./driver`、`./actions`、`./scenarios` | 原生 Effect 放行、有限动作、真实进程崩溃及测量证据 |
| `./snapshot-cache`、`./reference-model`、`./replay` | 重验账本快照字节、独立预期及静态材料比较 |

receiver 拥有唯一的受保护已安装密钥存储；distributor 和完整会话借用它的
`installedEpochKeys`，不重复打开存储 owner。原生阶段直接组合 Effect。
`LabCallbackRunner` 仅承接真实 Node/SDK Promise 回调；未接通的攻击钩子和
Promise-phase API 已删除。父事件身份使用 JSON tuple；replay 精确比较 parent 和 occurrence。

## 权限、持久化与关闭

现有会话要求已发布完整签名控制前缀（含原 genesis），并独立提供本地与网络
checkpoint。发现元数据、SQL 行、offset 和 IPC 观察不能选择信任依据；
私有 IPC 返回的位置必须与独立见证的原签名记录核对。
账本读取或 SQLite 写入失败时，已验证历史和游标一起保留；P09 重试原签名字节，
只有持久 feed 已验证包含结果后才 ACK。

已存凭据绑定真实设备和 Org，JSON 不能选择发送者。Recovery 设备可以接收、
修复、授权自己的新个人设备，但不能发送 epoch 信封或写内容。
当前发送资格与合法历史内容认证分别检查。加入回执没有授权效力。
快照缓存每次按调用方固定的资格重验；具备资格本身不代表快照已获准或当前权限成立。

每个文档把原生状态与精确 SDK 游标原子提交。导入、保存或恢复失败只停止该文档，
保留先前的持久状态对。全历史恢复要求历史仍可读取，不重置宿主 offset，
也不删除快照。Flock 使用明确的单调逻辑时钟。

关闭先停止接收新工作、abort 请求，再等待真实原始工作与响应体结束，
最后关闭此前的存储/原生 owner。并发 close 调用共享完成结果，包括清理失败。
`StreamsClient.close()` 会发布协议 EOF，不能用于资源释放。
CRDT SDK close 不等待全部单次操作：先等原始工作，再关订阅/SDK，最后 free Loro。
Flock 没有公开确定性 free/dispose；实际结束后丢弃引用。
abort 本身不证明工作已停止，也不保证原生关闭时间有界。

## 尚未完成的边界

- 可恢复工作区创建，以及独立取得并持久保存的宿主 checkpoint。
- 受保护内容快照的位置/格式、资格及保留历史读取 API。
- 持久新 epoch/成员移除发布者、候选密钥备份策略及恢复库。
- 精确熵/密文字节重建、其余原始 actor/攻击场景及保密性测量。
- 比较 note 的权威、严格 freshness B、原生存钥和产品接线。

受限 A 仅覆盖可信初始化时保护已安装密钥。已知密钥 AES protector 和可导出设备
都是合成 fixture，不代表 OS 存钥、候选备份或 B 历史发送者信封恢复。
测试、远端 CI、独立审查和产品验收分别成立，不能互相替代。
参见[清单](../../.agents/docs/e2ee-migration-manifest.json)、
[组合 Note](../../.agents/notes/proposed/architecture/2026-10-12-e2ee-lab-integration.zh.md)
及[来源记录](migration-provenance.json)。完整旧 checkpoint 流水保留于
[Git 5ab9394](https://github.com/LodyAI/Lody/blob/5ab9394392a3577a76b14ab0552c33f755b3ce48/packages/e2ee-lab/README.zh.md)。
