# 公开 Lab 集成进行中

Status: proposed
Translation: current

[English](2026-10-12-e2ee-lab-integration.md)

## 摘要

原 Lab 消费旧 core API，并留下两项账本读取失败。迁移至公开模块与发布 SDK，
先完成持久账本、明确逻辑 permit 与 Scope 原生工作，再组合真实内容 SDK。
当前真实本地传输、SQLite 和另一个 OS 进程重开测试通过；原完整 host/actor、
重放和故障验收仍未完成。工作集中在一个集成分支，尚未形成 Lab Draft。

## 归属与边界

直接父层为 update binding #1496 `0418fd69e22d1eeba47553714473ec54762837ec`。
实际来源和目标包都是 `packages/e2ee-lab`。客户端消费公开 reader/feed，
无复制 verifier/store 或签名接受回调。独立选定的签名 checkpoint 不来自传输 offset。
串行读取将原始验证记录和游标以一个 SQLite 事务提交；Scope abort 并等待借用 SDK
读取，再关闭 owner。原 scheduler/稳定 schedule identity 迁至 `src/pure`，
无效操作返回明确 Result。runtime 要求显式 mode/time/fetch；Promise bridge
仅供 SDK/harness 回调，关闭先拒绝入口、abort、等待实际原生工作，再关闭 Effect owner。

## 证据与依赖

固定6de作者 Lab **24 项通过**，包 typecheck 和 focused lint 通过；
包含真实 Riverrun0.3.0、streams-client0.9.0、合成账户真实 Ed25519、SQLite 和 OS 重开；
重复记录的新 offset/旧页拒绝、SQLite IGNORE 回滚重试、logical permit 和原生清理。
最初 runtime no-wait 负控逃逸；加强真实 owner finalizer 顺序断言后，删除等待明确失败。
旧逃逸日志和新失败均保留，不把它称作原 Lab2 完整闭合。
历史 e677 root `pnpm check` Lab9/core296、格式/docs/boundary 通过单独保留；
固定6de完整 root pnpm check Lab24/core302、format、docs 和 public boundary 通过，
CI=true 非交互 frozen install 忽略 scripts 通过；此前无 TTY 中止日志保留。
root 检查开始与结束之间 Lab 文件指纹不变。没有继承历史结果为当前通过，
也未声明 WIP 的 CI/独立验收。

Riverrun 固定0.3.0，根 catalog 不变；包级 override 使用 SQLite13.0.3。
旧 lock 条目逐字保留，仅添加 Lab importer/Riverrun 和 override；历史 frozen install
忽略 scripts 通过。当前 direct SQLite import 已移至 dependencies，版本不变。
Lab/core 同一 Effect4.0.2。main 核对至987962e77022df6a800f4e889f124b51f6eb8056，
对应CI38151323459成功，与实际 stack bottom 的 core/Lab/spec 路径无交集。

## 真实内容、submission 与恢复组合

actor 消费公开 admission/signing 和未改 P09，无重复 genesis/proposal codec。
等待前复制命令，pending 时拒绝新签名，terminal 被消费前必须在真实持久 feed 中出现。
真实 SQLite IGNORE 揭露未提交 actor 将 Result 当布尔值；修为 Effect.fromResult，
保留旧失败和无 signer 的真实子进程恢复通过。P09 没有修改。

Promise provider 消费公开 binding，仅在实际 SDK 回调边界保留内部 Effect owner。
真实 Loro/Flock SDK 使用本地 Riverrun。每文档 SQLite 原子保存实际 native snapshot
和精确 cursor，并事务读回；SQL IGNORE 无法确认保存。另一 OS 进程重开 Loro/
cursor/protected epochs，不需要可用 signer。fixture AES 包装明确是合成能力，
不是生产安全存钥或算法选择。

SDK owner 保留 raw 单次操作，真实结束后才 SDK.close 和 Loro.free。
发布 SDK.close 本身不等待所有单次操作。no-wait 负控明确命中 closedEarly 断言，
非 timeout；断言失败时 finalizer 释放门，避免清理死锁。Flock0.4.3 没有公开
free/dispose，只关闭 SDK 订阅并丢引用，不读 private inner，不声称确定性 Wasm 释放。

新 Loro session 串行管理单文档操作，上传前保存本地编辑，失败只停该文档。
初始 WIP 在编辑后才创建 SDK，使 appendWriteOnly 成功但未上传本地队列；
真实远端内容断言失败。已修为创建并订阅 SDK 后再编辑，保留旧失败/新通过。
全历史恢复重载实际持久本地状态，保留本地编辑；整次 SDK pull 成功后才保存最终对。
恢复失败时旧持久对不变。

实际 Riverrun0.3.0 在非零 offset PUT snapshot 后推进 earliest_offset。
公开历史读返回 gone，SDK 恢复回到同一个坏快照。真实测试区分历史可读时恢复成功，
历史不可读时保持 document-stopped/原游标，其他文档仍继续。
不得重置宿主 SQL offset 或删除快照制造恢复成功。
上游带授权的历史保留/读取 API 与可信宿主历史入口归属是需提前协调的契约缺口，
这里没有发明新 header/offset wire。

纯 replay 比较仅消费已记录合成 fixture，不提供熵源或重新 seal。除原始受保护请求/
响应字节，还比较 frame 的 actor/operation/phase/resource。原 multipart 改写不完整消息，
多段短 boundary 又触发越界；保留原4通过/新增2失败，修完整边界与精确容量后6通过。
完整 replay/driver/host 未完成，不复制原 driver 跳过缺失 identity、提前放行后续 permit 的启发式。

## genuine 策略与 HTTP 密钥消费者

本增量添加 genuine 账本 stream 策略检查及 Scope 邮箱 HTTP 适配器。
R 可接收/修复，不能发送/管理/写入；当前成员和 credential/request Org 独立检查。
结构伪造 view、恶意 opaque 值方法在读取可见账本状态前被拒绝。
这不代表 challenge/bearer 认证、最新 checkpoint 选择、固定 CAS 或内容/快照准入，
完整诚实 host 仍需要接入这些检查。

邮箱响应限制 body、canonical 偶数 hex、安全 slot/revision 数值和十进制 page。
Scope 保留实际 fetch 和响应体工作，包括忽略 abort 的读取，再关闭较早 owner。
公开 HPKE、SQLite 分发/接收和安装报告轮次经过真实 loopback HTTP。
篡改签名后存钥为空、状态不变；随后原始帧正常安装、读回并报告。
重开后 Recovery 保留结果且不能安排发送。会话认证/AES 包装仍是合成边界；
该轮次同进程重开存储，不等于 OS 重开/真实存钥验收。最初 fixture 两设备复用
X25519 公钥被公开准入拒绝；修正为独立设备 pair，没有改协议。

当前 owning **30 项**及包 typecheck 通过。固定 `6de46b5d` 检查点已有完整
root Lab24/core302、format/docs/boundary 证据，不能继承为本增量通过。
当前完整 root pnpm check Lab30/core302、format/docs/public boundary 通过，
Lab 输入指纹在检查开始/结束不变。最初当前检查发现邮箱3项静态错误，
修复后重复检查完整通过。尚无 Lab Draft 或整 Lab 独立验收。

固定02f检查点的新响应体测试最初让 no-wait 负控逃逸；正向通过不算该失败验收。
适配器现可接收明确转交的可选原生 transport close 能力，获取时捕获，
等待实际 fetch/body 结束后关闭一次；global fetch 无原生 lease 可关。
合成 lease 在实际 close 时记录响应体是否完成，新负控5ms明确命中
transportClosedEarly 断言，无 timeout，恢复后通过。失败门由 finalizer 释放，
无固定 microtask drain 或 sleep。旧逃逸及新失败日志保留。
当前同计数suite/typecheck及原生lease完整 root pnpmcheck Lab30/core302
通过，Lab输入SHA不变；format/docs/public boundary通过。

## 凭证/control/HTTP 增量（作者 WIP）

新增凭证 owner 与 loopback HTTP/control 组合消费公开签名、genuine 账本和
submission API。合成 account 标签及冻结 Lab 持有消息/nonce/token TTL 只属于
测试契约，不代表生产身份、JWT claim、普通容差变化或严格期限 B 获批。
SQLite mint 与 nonce 消费必须读回；SQL IGNORE 不能返回未保存的凭证，trigger
恢复 nonce 时拒绝本次消费。另两个原 HostMeta SQL 边界探针复现这两项旧失败，
源 SHA 仍为 8f40941246e5745b441aaaf0bdc93f5e8b994656b24eea7f58b1229d63ee28c3。
这些不是原完整宿主回归或原 Lab2 闭合。

control 消费公开完整前缀准入和 SDK 固定 CAS，不重做 P09。HTTP 检查落盘 bearer、
精确 Org/path、单个有限 frame 与持有证明；恶意 offset/生命周期头不能进入 SDK。
checkpoint 由独立 harness 输入提供。workspace 注册/checkpoint 崩溃间隙持久化、
joins、notes、密钥/内容路由及启动流程仍未完成，不恢复通用 proxy 或快照 wire。

共享操作 owner 等待每个子操作，即使另一个 finalizer 失败也继续清理，最后保留
失败原因。runtime 测试使用真实 SQLite/SDK 生命周期，清理错误注入边界明确。
fresh 1087 加 7 文件 SHA overlay 的 Lab36 通过；删去子操作等待命中真实 Riverrun
closedEarly 断言（非超时），恢复后通过。新增真实 HTTP 测试通过，当前所属 37 项；
最终 SDK ACK 整树 pnpm check 通过 core302/Lab37，Lab 输入 SHA 始终一致；根 format/docs/public boundary 通过。未改 CLI 的继承 Git helper 失败保留；仅测试子进程移除 GIT_EXEC_PATH 后 focused6 与完整整树通过。commit 后再做固定 head 独立复跑。冻结 1087 Lab30 不覆盖新增文件。

实际发布 StreamsClient 通过 auth API 消费 HTTP CAS，成功 ACK 带必需的 Stream-Next-Offset。初始合成 consumer 错把 bearer 放普通 headers（SDK 会移除），其 401 只记 fixture 错误。改用正确 auth 后，缺 ACK header 的旧失败与修复后通过分别保留。

## 认证 mailbox 增量（dd718 后 WIP）

真实 loopback 宿主为原七项 mailbox 操作绑定落盘 bearer 的设备和 bound Org，
JSON 不选择 principal。crypto/资格/存储/report/repair 准入继续由公开 SQLite
宿主完成，不复制 core，也不绕过验收。合成 fixture 的原生凭证请求与完整响应体
明确由 Scope 保留。真实 HPKE/保存/读回/report 轮次改走 challenge/bearer HTTP，
保留篡改不安装/不报告与 R 重开不发送原断言。R bearer 即使提交真实 owner 签名帧
并在 JSON 冒充 owner 仍被拒绝。R 修复自身接收 slot 仅推进一次版本，同 ID 重试
不再推进。HTTP401 映射 adapter unauthorized。宿主保留 512 字节 envelope/report、
8192 字节 publication 和既有任意有限 repair ID，不增加 wire、生产身份或严格 B。
focused5/typecheck 与当前整树 core302/Lab37 通过，Lab 输入 SHA 至 format 后保持一致，docs/public boundary 通过。首次 DTO consistent-return 静态失败保留，并补失败闭合分支。fresh dd718 加 5 文件 overlay 的 37 项通过；JSON principal 负控返回 200 而应为 403，命中明确断言非超时，恢复后通过。commit 后再做固定 head 复跑；无独立整 Lab 审查/CI 验收。

下一步 joins/宿主元数据另有两项只读原 SQL 复现：join insert 被忽略仍返回
成功但没有行；首次 user/account 绑定被忽略，后来不同合成 account 可认领同一
user ID。探针明确使用未校验合成 DTO，只针对 HostMeta 存储，不是完整 HTTP/
签名准入或产品身份结论。源 SHA 不变。迁移需在同一事务内读回 request 与 binding
两行再确认；下方增量已实现存储读回和真实认证 joins 路由，完整 host 组合仍待完成。

## join 元数据/HTTP 增量（fba88 后 WIP）

公开 joinRequestSigningBytes/verifySignature 绑定原全部字段和 Org。真实 unbound
外来设备 challenge/bearer 可提交无权威效力的签名申请，仅 genuine 当前成员能读。
不自动准入账本，不新增期限或产品身份。R 不管理包括拒绝提交 join。保持原同 ID
signer 和首次合成 user/account 归属；同事务保存并读回 request/binding。忽略任一
insert 时拒绝并回滚两者；已有绑定/签名缺失或篡改报 corrupt，不能重新认领。
实际文件重开验证；坏证明400、冲突409、未授权403沿用原 Lab 语义。初次外来设备
fixture 误请求 Org-bound token，被正确拒绝；改真实 unbound 签发，未改成员准入。
该失败仅是 fixture 证据。

有限账本读取获得 Scope abort signal，保留到实际完成。测试观察真实 SQLite
close/open，调用真正原生 close 并在 finally 恢复观察器，不伪造成功或数调用。
显式忽略 abort 的借用阶段再走实际发布 SDK 读取，结束前不得释放 SQLite/Riverrun。
负控破坏拥有关系时 finally 也等待 raw 工作，避免测试自身留下悬挂任务。
所属5组和关联HTTP/HPKE/SDK7/type/static通过；fresh fba88 加六项声明的自有 overlay 完整42通过；移除 native lookup 保留触发真实更早 owner 关闭断言，移除 SQL 读回触发 ignored insert 错误确认断言，均非超时且恢复后通过。本轮完整 root 检查 core302/Lab42 通过。首次 root 在未改 CLI recursive Git 的 context_unreadable 中断，尚未跑到 core/Lab，原失败保留；原 CLI 单独6项通过，仅对子检查进程去除 GIT_EXEC_PATH 并以 /usr/bin Git 优先后完整 root 通过，未修改源码/用例/全局 Git 配置。本轮固定head/CI/独立
验收尚待完成。workspace/checkpoint crash-gap、notes、content/keys-stream 归属、
完整诚实actors/driver/replay/CLI/原Lab2仍未完成；人类协议门不变。

## 剩余工作

原完整 host/gateway、actors、投递/轮换组合、Flock 进程重开/恢复/live session、
driver、攻击能力、捕获 replay、fixtures 和 CLI 尚未完成，再独立复验原 Lab2。
快照 wire/offset、保留历史入口、replay 熵、严格期限 B、恢复库、D12、
永久丢失发布设备仍待决定。整栈 CI/独立验收尚未完成，无生产 E2EE、原生存钥或部署。

## Workspace genesis 元数据（当前 WIP）

公开 canonical decode/replay 与真实签名验证原始 genesis 和认证后的原 signer；
每次读取重核已存行。同事务读回检测 ignored insert，不覆盖坏行。实际 SQLite
文件经另一 OS 进程重开验证。原认证 genesis 发现保留 unbound joiner 访问，
但不返回当前 endpoint/view。注册仍是私有 harness API，stream 发布、凭证绑定、
当前独立 checkpoint/crash-gap 组合未完成。所属3组及关联HTTP/joins/HPKE10/type
通过。只读原 HostMeta SQL ignored-space 复现返回却没有行，使用未验证合成字节，
严格限 storage，不是 HTTP/签名验收。当前完整 root core302/Lab45 通过；固定head/CI/独立验收仍待完成。

比较记录发布资格需人类对齐：旧 Lab 允许当前 machine/R 上传 notes，而公开
comparisonNote 仅 personal。提案选项为沿当前 personal 契约且宿主观察仍未确认，
或另行明确 machine 的无权威观察契约；两者都不允许 R 发送。未改 core/Spec，
不自动把宿主记录变成独立确认。

## 凭证绑定（当前 WIP）

保持原 bind-once token、TTL 及每路由当前鉴权。genuine 账本查询后重核已存
身份、到期和失效，真实 SQL UPDATE 读回确认。异 Org 重绑拒绝，同 Org 重试
保留原 token/到期。实际 ignored UPDATE、查询中到期/失效、假 view 与文件重开
已有覆盖。有限查询收到 abort 并保留到实际结束；扩展现有真实 SQLite/Riverrun
关闭顺序测试覆盖 join 和 credential，未复制新测试或移除原行为。关联11/type/
static及完整 root core302/Lab47 通过；固定head/CI/独立验收待完成。原 HostMeta
ignored binding UPDATE 静默返回但未绑定，只读 SQL-only 复现和 source SHA 保留。HTTP create-space 绑定组合仍未完成。

## 有限认证 SDK 读取

读取消费公开 genuine-view 策略和实际发布 SDK；固定 loopback 上游和严格 query/
path/header 边界，调用者不能选择上游或权限。原生 latest snapshot307 只在同
origin/Org/stream canonical offset 内解析，不转发 Location。有限响应体留在 raw
lease 直到完成，再复核当前权限。响应期间真实签名撤销机器设备后，不推进客户端
持久历史/游标。原生 body gate 明示为包裹实际 HTTP bytes 的受控边界，不是成功 mock SDK。

新增五组和完整 Lab52 通过。fresh eb6f 加五项 SHA 明示代码 overlay 通过52；移除
body 等待、redirect origin 绑定、读取后权限复核均命中直接行为断言失败，无 timeout，
恢复后通过。整树 core302/Lab52、format/docs/public boundary7010files/27manifests 通过，
全部52 Lab 输入 SHA 始终不变。首次 root 拒绝三处 control-character 正则；改显式字符码
保持同一边界，失败日志保留。fixed-head/CI/独立证据分别记录，原 Lab2/full host/actors 未完成。

StreamsClient.close() 发布 EOF，与 CRDT SyncClient.close() 生命周期不同；HTTP facade
无 dispose，Scope 只 abort+wait，不调用协议 close。SDK0.9 putSnapshot 回显输入
offset，不是标准化服务端 ACK；未保护传输 fixture 使用实际 HEAD opaque token。
这不决定受保护快照 header/offset/发布。保留早先 0 与原生20位 token fixture 失败，
以及类型检查拒绝将协议 close 用作生命周期能力的失败。人决策、锁版本、普通容差不变。
