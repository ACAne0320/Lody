# 公开 Lab 集成进行中

Status: proposed
Translation: current

[English](2026-10-12-e2ee-lab-integration.md)

## 摘要

把实际原 `packages/e2ee-lab` 迁到公开 core 与发布 SDK，保留可运行的持久化行为。
完整 host/actors、driver/replay/attacks/CLI 和故障验收未完成；先在同一分支集成，再建
一张完整 Draft。直接父层 #1496 `0418fd69e22d1eeba47553714473ec54762837ec`。
[逐项 manifest](../../../docs/e2ee-migration-manifest.json) 与
[provenance](../../../../packages/e2ee-lab/migration-provenance.json) 保留源 SHA、去向和
部分状态。不复制第二份 core、不注入签名放行、不迁私有产品资料、不用真实凭据或开启生产。

锁定 Effect4.0.2、streams-client0.9.0、streams-crdt0.16.2、Loro1.16.3、Flock0.4.3 和
源 Riverrun0.3.0。只新增 Lab importer、Riverrun package/snapshot 与已允许的包级
SQLite13.0.3 override；旧 lock 条目和根 Riverrun catalog 不变。禁用脚本 frozen install
通过。源仓和已有暂存的候选只读保留。

## 账本与权限

公开 reader/feed 拥有 genuine view；独立选定 checkpoint 不来自恶意 offset/header。
串行 SQLite 原子提交原始验证记录和游标。新 offset 重复旧记录、旧页面、SQL IGNORE 都
保留原持久化对。actor 捕获普通意图，消费公开 admission/signing 和不变 P09，pending
期间不新签名，实际 durable inclusion 后才消费终态。另一 OS 进程无可用 signer 也能
续交原 pending bytes。早先把 Result 当 boolean 的错误已修，旧失败和新通过分开保留。

genuine 策略先于读取当前 device/member/Org；structural fake 和恶意 wrapper 不选权限。
R 接收/修复密钥，不发送/写入/管理。inert join 收到不等于 admission。当前可信 checkpoint/
lostACK crash-gap 宿主组合未完成。原 createSpace 只在 metadata 存 genesis、建空 control；
loadControl prepend metadata genesis。公开 submission 要完整签名历史，待人选择 A初始化
control 写已验证原 genesis（建议），或 B仅 Lab metadata-prefix 传输并明确 cursor/lostACK
验证。协调推荐 A 不是批准；不改 merge P09，不在确认前实现依赖布局的 createSpace。

纯 verdict 要测量：未测基线/部分 unavailable 不能 pass，记录数量不认证历史。
新越权写入违反公开契约，合法已接纳历史不因作者撤权失效；insider freshness 假设明确。
每轮有界合成 trace 在预算检查前拥有字段，关闭后拒绝操作，返回不可变观察，不用全局
明文日志。真实 actor/attack 观察和永久不结算 native 的资源保留/恢复仍未完成。

## 资源归属

Scope 拒绝新操作、传 abort，等待实际 request/body、有限 ledger lookup 和原生 phase
结束，再关闭此前 SQLite/SDK。一个清理失败也必须等待其他子操作，失败原因保留。受控
忽略 abort gate 包裹真实工作，不是成功 mock SDK。旧 Promise bridge 仅用于 SDK/harness
回调。纯 scheduler 用类型化 Result、明确 logical permit 父链/time/mode/fetch，不默默
跳过缺失身份或提前放行后续 permit。有限 driver 按下一条身份/parent/occurrence
匹配、放行前检查预算。stop/interrupt 先关 gate 再中断，等待实际 native 结算，缺失/
多余记录明确失败。内部 JSON 计数不改 parent wire；拒绝分隔符标签是兼容限制，完整
动作/祖先/entropy replay 和 executor 待迁。

StreamsClient.close() 发布协议 EOF，不是 dispose；HTTP facade 无原生 dispose，Scope
只 abort 并等待请求，不发布 EOF。CRDT SyncClient.close() 是生命周期清理，但不会自动
等待所有单次操作；先等 raw、关订阅/SDK，再 Loro.free。Flock0.4.3 没公开 free/dispose，
关 SDK 后丢引用，不读 private internals，也不声称确定性 Wasm 释放。

最初 no-wait/body 测试漏掉 mutant，原日志不改；新版实际 owner-close 断言失败，无
Timeout，恢复后通过。负控失败也释放 gate/等待 raw，不用 sleep、调度运气、源码正则
断言或 mock-call-count。

## 凭据、元数据与 HTTP

合成 account、冻结 Lab v2 possession domain、60秒一次性 nonce、最长15分钟 token
只是 Lab 契约，不是生产身份/JWT，不改变普通容差或批准严格 B。真实 Ed proof 和当前
成员检查先于 Scope SQLite mint/invalidate/consume；同事务读回拒绝 IGNORE 和恢复 nonce
的 trigger。

bind-once 保留原 token/TTL，不授予 membership、不跨 Org 重绑。有限 genuine lookup
后重核落盘身份/期限/失效，再读回实际 UPDATE；同 Org 幂等。signed inert joins 固定每
requestID 原 signer、每 user 首个合成 account，两行同事务读回、重开重验，R 不提交。
Genesis registry 验原始 canonical 签名和 signer、拥有 bytes、拒绝腐坏、真实 OS 重开。
认证 genesis-only discovery 保留 unbound joiner；registry 仍是 private harness 注册，
不是完整 HTTP create-space 发布或当前可信权限。

实际 loopback 提供 health/challenge/credential/control-CAS、认证 mailbox7、joins、
genesis 和有限 SDK 读取。principal 只来自落盘 bearer/device/boundOrg，JSON 不选发送者。
公开 complete-prefix/control admission 固定 SDK CAS、给必需 ACK offset；恶意生命周期/
offset/auth headers 不转上游。SDK generic Authorization-header401 和缺 ACK header 的
旧失败保留；用实际 auth API/正确 ACK 后通过，不重做 P09。

有限 GET/HEAD control/loro/flock/bootstrap/latest/specific snapshot 固定本地源，限制
query/header/body。原生307只同 origin/Org/stream canonical offset 内解析，不转 Location。
body 留在 native lease，完成后复核 genuine 权限；读取期间真实签名撤销机器设备不推进
客户端持久游标。真实跨 origin/Org/stream 端点的 SQLite audit 未被访问。SDK0.9
putSnapshot 回显输入，用原生 HEAD opaque token 测未保护传输；0与原生20位 token
fixture 失败、把协议 close 当 lifecycle 的 typing 失败保留，不据此改协议。

原 HostMeta SQL-only 探针复现凭据/nonce、joins/首 account、genesis、binding 被忽略的
写入；使用 unchecked 合成 DTO/issuer bytes，不是假装完整 HTTP/生产身份漏洞。源
8f409412…不变。旧 Lab machine/R notes 与 public personal-only comparisonNote 冲突，
待人选择 A保留 personal-only+未独立确认 host observations，或 B另定 machine inert DTO；
R 不发送。协调者推荐 A 不等于 human approval，也不自动独立确认。

原有密钥轮次还覆盖真实签名的合成 epoch1 记录、Owner 实际分发、新 HTTP 凭据和 OS 子进程只安装 key1。公开历史恢复从已安装钥和认证历史包取得 key0；父端检查实际 SQLite 行从 [1] 变为 [0,1]、承诺一致、原密文 frame 和安装回执。同一合法 epoch2 提案 Owner 可准备、R 被拒绝，R 仍不能发送。完整签名历史由 fixture 独立固定；这不代表 control-stream 发布、持久生产换代发布器、备份完成或恢复库格式。父端不向子进程提供旧钥。 本次整树 core302/Lab67、format/docs/public boundary7017files/27manifests 通过，59Lab输入SHA不变；固定head负控和完整actor/轮换验收仍待完成。

## 密钥、原生内容与恢复

真实公开 HPKE/distributor/receiver、SQLite install/readback/report 与实际 challenge/bearer
mailbox 组合。坏帧不安装/不报告，原帧安装报告；重开后 Recovery 不发送，own-slot repair
revision 只进一次，同 ID 幂等。保留512字节 envelope/report、8192 publication、原1–256字符
repairID。AES wrapping/account 合成，部分纯传输单元明确预认证；有限密钥轮次把真实被忽略的安装保留在 Install，保护 key 表为空、无终态，关父 receiver
owner。实际 OS 子进程重开原 task/合成设备、解密 HPKE、保存读回，用新 challenge/bearer
报告；父端比实际 SQLite 原 frame bytes/Reported，保留原 R不发送/own-slot repair 覆盖。
不是完整 epoch 轮换/原生custody；device 导出只是合成 file0600，不是恢复库格式。
首次 child open 因公钥不可导出失败：锁 HPKE 序列化公钥绑定 recipient，修正公钥可导出、
私钥仍不可导出，不改算法/core，旧失败保留。owning/交集13/type 与 freshe574+三SHAoverlay
Lab52通过；跳过实际 install/report 都命中缺 Reported 直接断言，无Timeout，恢复通过。
本次整树 core302/Lab52、format/docs/public boundary7011files/27manifests通过，
53Lab输入SHA不变；fixed-head/CI/独立证据待完成。旧 fixture 重用 X25519 被公开 admission 拒绝，修成
不同 pair，不改协议。

公开 header3 update binding 消费实际 Loro/Flock SDK；每文档 SQLite 原子保存 native
snapshot/file 和 exact cursor，同事务读回，save/import 失败保留原对。Loro 和现在 Flock
真实 OS 子进程重开状态/游标/保护 epoch file，无可用 signer，保留旧字段并解密新的独立
更新。实际 Loro SDK 同 Org/resource 不同 model 保护帧被 Flock 子进程拒绝，两项持久值均不变。移除 native-file restore 丢旧字段；
断开重开 key read 导致实际 SDK missing_read_key，均非 Timeout，恢复通过。复用原 owning
内容 suite/child script，不复制 core、不选择生产 wrapping。

Scope Loro session 先订阅再 native edit，先保存再上传，失败只停本文件。旧 WIP 编辑后
才建 SDK，append 成功但远端无内容；真实断言失败保留，修订构造顺序。全历史恢复保留本地
编辑，整次 pull 成功才提交最终对。Riverrun0.3.0 非零 snapshot PUT 推进 earliest_offset，
公开历史 gone、SDK 又读同坏快照。历史可读时恢复通过，不可读时停文件、不推进原对；
不 reset host SQL 或删快照。认证 retained-history API 与可信 host history 路径待协调。
受保护 snapshot wire/offset/发布和完整 Flock recovery/live 仍未完成。

纯 replay 仅比较记录的 inert 合成 fixture，包含 actor/operation/phase/resource 和保护
request/response bytes；无 entropy/reseal/full driver。原 multipart 短边界分配/不完整帧失败
已保守修复，旧4pass/2fail和新6pass保留。完整原 fixtures/replay/attacks/CLI 未闭合。

## 验证与未完成项

固定285289有限读取整树 core302/Lab52、format/docs/public boundary7010files/27manifests
通过，52Lab输入字节不变；固定无 overlay Lab52、body/origin/post-authority 三负控命中
直接行为失败，无 Timeout，恢复通过。首次 root control-character 正则失败改等价字符码，
旧日志保留。Flock 进程扩展当前 WIP：owning4/type、fresh285289+两个SHAoverlay Lab52 通过，
本次整树 core302/Lab52、format/public boundary7010files/27manifests 通过，52LabSHA不变。
整理 Note 首次漏 Abstract/摘要 标题，docs失败保留，补双语标题再跑 docs。
fixed-head/CI/独立证据分开；旧 checkpoint 报告/日志原字节，不沿用 Ready。

旧 CLI 继承 Git helper context 失败保留；只检查子进程去 GIT_EXEC_PATH、/usr/bin 优先后
原 owning6/整树通过，无 source/global Git 改动，不宣称证明根因。实际 main987962e…
无所属交集，1432/1433/1434 已 merge 祖先，不复制；原组合 CI取消不算后继CI成功，SDK准备
不是生产保护器。主协调做独立审查，不派模型自审。

继续 create-space 发布/binding/current-checkpoint crash-gap、内容写/live、完整诚实actors/
rotation/跨进程密钥轮次、Flock恢复/session、scheduler driver、attack capabilities、原
fixtures/replay/CLI、原Lab2/完整故障矩阵，再建一张整合 Lab Draft。严格B、vault格式/包装/
并发/保留、永久publisher新钥backup、D12原子移除wire、snapshot/history、entropy、notes
仍待人决定，不阻塞可独立工作。生产启用、原生custody、整栈CI/审查、全平台验收分别未完成。
