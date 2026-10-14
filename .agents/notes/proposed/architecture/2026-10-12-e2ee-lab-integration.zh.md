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

原合成 device 模块七项导出已转为有类型的 Effect/公开 byte API，复用公开原生 signer/verifier。原四字段 JSON 可往返真实 Ed25519/X25519 fixture，返回导入结果前核对私钥与公钥绑定。实际公开 HPKE 和 SQLite credentials 验证导入设备、一次性证明及未入账设备不能绑定 Org。创建在错误/取消时等待两个原生生成器结算；显式信号测试只控制原生完成后的返回/错误，不改真实算法或随机数。原生 handle 由调用方拥有，WebCrypto 无 key close/清零 API；可导出字符串仅是合成 fixture，不是恢复库、平台安全存钥或捕获熵 replay 契约。完整 session/actors 仍需接入。 原 Ed/X 错配两项旧直接FAIL/新同probe PASS；owning8/type及整树core302/Lab71、format/docs/public boundary7018files/27manifests通过，60Lab SHA不变。固定head负控待完成。

纯 fingerprint 与有界 minimizer 保留原五项/两项导出，分开策略：精确 replay 比较原全部字段，缺失、JSON 丢失的 undefined、null 或 unavailable 观察明确报缺口；另一维 harness 错误不抹掉已测违约。shrink 保留原规则及精确已知触发事实，允许诊断账本数缩小并显示 partial；原触发事实未测则拒绝执行。Effect runner 串行、有预算、由调用方拥有，错误如实传播；回调前独立复制原 fingerprint。泛型 action 元素须已不可变并独立拥有，不能以浅拷贝数组声称拥有 action 内 bytes。旧 model 标签仅为兼容诊断，不是授权策略。这些是纯合成算法 probe，不代表完整 attack/repro 执行、序列化批准、捕获熵或 reseal。 四项原直接旧FAIL/新同probe PASS；owning10/type及本次整树core302/Lab80、format/docs/public boundary7020files/27manifests通过，62Lab SHA不变。首次6项循环静态错误保留，预算守卫等价修复；固定head负控待完成。

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

control 网关放行已定的 Recovery 例外：授权本人的新个人设备。候选筛选只绑定已存
凭据的签名者和操作种类；完整历史、当前成员实例、新设备持钥证明及 SDK CAS 仍由
公开 submission 验证。真实新鲜 possession/bearer HTTP、已发布 StreamsClient 与
原生 SQLite 用例确认：错误成员的持钥证明、R 禁止操作和坏签名不改变远端字节/尾游标，
撤权 R 被拒绝。这只是设备登记，不代表恢复库、备份、内容恢复或生产存钥完成。

manifest 补齐原 DemoSession 的全部方法及源成员指纹：含 constructor 的 31 个公开
入口和 12 个私有辅助方法。每项列拥有模块、尚缺的真实 session 组合或人类决定；模块
已有用例不等于对应 session 方法完成。明文 epoch JSON 不作为普通存钥方案迁回，旧
移除继续等待 D12。源字段和完整 actor/replay 组合仍是独立未完成项。

已有材料的事件比较覆盖全部 LabEvent 字段，包括 eventId、step。先比较可选 parent
原值再格式化诊断，缺失值不会等于字面字符串 "none"。这里只比较有类型的静态材料，
不验证 repro 格式、不执行 captured 动作/加密。eventSignature 仍为 actor/operation/
phase/status 的粗略诊断投影，不能作为精确 replay 相等证据。

原独立 reference-model 导出已迁到 ./reference-model。独立合成观察预测规则，不调用
core 决策函数产生期待值。待轮换拒绝新 seal；缺少 rotation/kind、pending 字节或游标
观察明确未测。旧 boolean 投影安全拒绝，不能证明两个未测运行一致。captureRefState
在测量 actor 执行前独立拥有事实行和集合；LedgerState 适配只映射元数据，不建立授权。
snapshot 辅助只预测局部 context/personal manager 资格，不证明签名/历史/信任已接纳。
八个纯 owning 用例不代表真实 actor/reference 对应或旧 Lab2 完成。

./key-round 实现一次有限 centralKeyRound 应用编排：已存在的 scoped 公开 distributor
负责 repair、接收恢复/拉取、报告、当前 epoch 对账、投递恢复及最终报告/结果。各阶段
捕获并借用公开方法，调用者须等 Effect 结束后再关闭拥有者。失败不伪造 next/结果，
blocked tasks 和各页游标显式保留。已有真实 HTTP/SQLite/HPKE/OS-child 用例改为消费
该模块，覆盖 Owner epoch0/1、重开的 Recovery；坏 envelope/安装失败中止这一轮，
原生 key/task/report 状态保留。这里只是单页有限编排，不代表完整自动翻页、启动/重新
认证/账本 bootstrap facade、生产发布者/备份策略或新增原生取消保证。

源 session 清单另列全部 29 个声明字段及 constructor 的私有 options 属性。普通
原始 epoch-key Map 与重复验签缓存由公开拥有者替代；合成攻击钥 fixture 仍有明确
独立去向。字段清单不等于完整诚实 actor 状态或原四个 crash 注入场景已完成。

./http-identity 将真实合成 possession/bearer 凭据获取从测试 helper 移成模块：持有
有界响应 body 的原生租约、await 前捕获 signer、调用公开固定 verifier 验证 proof，
核对 response 的 account/device/Org 与 token/time 格式，拒绝跨来源 bearer 请求、
redirect 和关闭后请求。SDK 的 Promise fetch 端口借用 identity signal，完整请求/body
等待仍由调用方拥有；无嵌套 Effect runner、无新 JWT claim/容差/严格 B。真实 HTTP 与
OS-child 密钥用例直接消费它。改写回执/超预算 stream 明确是 transport 测试插桩，
不是产品存钥或永不结束 native 的有界关闭保证。完整 startup/reauth/adoption facade
和可信持久 checkpoint 获取仍未完成。

已认证 ./http-identity discoverGenesis 消费现有元数据路由，响应体上限20KiB
（记录仍限8KiB）。它检查请求哈希、genesis记录类型及公开账本真实签名，仅返回
独立拥有的原始记录。未绑定workspace的joiner仍可发现。坏存储和敌意元数据拒绝；
响应不提供当前权限、持久checkpoint、控制流发布或Genesis布局选择。

已认证submitJoin/listJoins消费现有签名候选信箱：复制并核Org签名、sender、true回执与唯一ID。列表256KiB预算超出即整次失败，不是分页/静默截断；宿主当前权限不变。回执待审且可能于保存后丢失，重试原签名申请，不生成新ID/期限/自动批准，不代表完整session。

[未批准契约提案](2026-10-12-e2ee-unsettled-contracts.zh.md)。

./workspace-session openLabExistingWorkspace组合已获准的合成身份、已认证原Genesis、
实际发布StreamsClient和公开账本actor。它要求现有完整签名控制流，并独立提供本地重开/
网络checkpoint；元数据不提供这些信任。启动失败在父资源存活时先关子Scope；显式close、
父层与失败清理共享完成结果，先停native fetch再等原CAS、最后关SQLite，不发布SDK EOF。
真实HTTP/CAS owning用例验证失败后重试、持久确认、OS子进程重开同一文件及游标。
fixture checkpoint来自独立拥有的原历史；宿主持久checkpoint/lostACK崩溃窗口仍未完工。
不保证永不settle的native关闭，不选择createSpace布局、不完成密钥/内容启动或整个DemoSession。

同一组合会话现接两条原生故障流：当前游标处重复已提交记录，以及忽略该游标、从-1
返回旧前缀。用例核对实际响应字节，两者均拒绝推进，SQLite全部历史/元数据行、内存
view及游标保留。另一同时存活且独立文件的客户端仍可用；原客户端同handle重试前，
新OS子进程先重开所保留的完整对。这是旧Lab2两项失败语义在既有工作区consumer中的
对应验证，不是原完整宿主/actor套件或已关闭的迁移缺口。

独立客户端现使用另外真实生成的个人设备，经真实PoP和既有签名CAS登记；原生凭据行明确包含两台设备。其合成四字段fixture只交给0600私有子进程文件，经公开device模块导入；子进程返回实际导入签名公钥及保留head/cursor。这些可导出的测试fixture不选择存钥、恢复库或发布者备份语义。

./snapshot-cache用真实SQLite保存v1签名快照字节，只按独立选择的Org/head/count/endorser
索引；每次复制并用另行提供的完整资格经公开snapshot入口重验。SQL不提供role/member/
head背书，也不选择新peer。返回view仍为endorsed-snapshot，不等于全量审计/最新状态。
保存只追加、事务回读，SQLIGNORE/坏触发器回滚，同handle可重试；一Org缓存损坏不影响另一Org。
OS-child用独立合成pin重开，无需当时有管理员在线。生产pin来源/持久资格保管、suffix/offset
bootstrap和完整恢复仍未完工；不是vault或protectedcontent新wire，也不改变现行v1背书者可说谎的信任边界。

restoreLabLedgerFromCacheOrHistory只接受独立选择的精确endpoint与genuine view。
缺失/损坏/旧位置的可选缓存走实际全历史owner；无效pin/closed/defect不静默转换。
同Org/head自称Owner确有真实signature evidence，仍不能替换独立peer。客户端用真实SDK
全历史恢复；native SQLite metadata触发器失败保留原records/view/cursor，原handle重试后
提交新完整对。结构克隆full-view在读字段前被公开provenance拒绝。这里只恢复权限历史，
不是完整R/vault/key或protectedcontent快照恢复。

用户已批准受限A（2026-10-12）：可信宿主一次注入保护，原生优先；复用公开keyring/receiver并绑定完整payload。./synthetic-protection现承接原固定AES-GCM合成fixture，不提供真实OS存钥。OS子进程在实际报告signer处、protected save/reload后硬退出；Install/source/原blob保留，无报告或远端installed，正常重开用同原blob完成。另一installed-only子进程在原发送者撤销后读keys0/1，不导入HPKE私钥且不调用网络，未加入B历史信封恢复。D12/header/vault/备份/严格B/生产门仍待定。platform身份port缺对称保护，现Electron字符串存储缺已审查的全payload完整性/backend失败adapter；明确该组合缺口，不擅选新算法。

## 关闭竞争修复

独立c33审查发现第二次Scope.close不等待已开始的子清理，真实SQLite／Riverrun提前释放。每个操作现在只有一次不可中断的关闭completion，保留完整Exit／Cause；父关闭和操作释放等待同一结果。准入检查和登记仍同步完成。真实SQLite／SDK的oldfail／newpass及成功／defect交错补入所属runtime套件。复制原探针时，测试门须在父关闭进入后释放，而非等父关闭返回后释放，以免正确等待的新实现被测试门自身卡住；原失败断言保留。

准确c33 CI四项5000ms超时，独立92通过。本地受影响12项通过，两worker时四项目标约0.7／0.7／1.7／2.9秒。这不能证明Linux成本或将超时归因于关闭竞争。Lab文件改为串行，减少同时native／Wasm／进程启动竞争；5秒限制和全部真实断言保留。仍须准确新CI确认，否则继续记阻塞。c33 Desktop smoke实际6场景／40步通过，不等Lab或生产验收。

CI3006保留关闭修复但仍红：串行后Flock3096ms／gateway3320ms通过，两个含四次进程启动的用例仍超过5秒。本地key／workspace为2852／1712ms；已完成的Linux native对照约4至5倍成本，整项估计13／8秒。仅这两项既有OS进程集成用例采用有限15／10秒预算；全部断言及关闭竞争／其它测试5秒保留。native-child日志记录真实settlement耗时，仅诊断不作时间断言；新CI须核验估计并定位剩余等待。这是成本预算估计，不能证明所有超时根因都是CPU。旧红CI不改。

依赖组合修正（2026-10-13）：两处streams-crdt条目都由本Lab整合引入，因此只修#1526，已同步父层head不再变动。core SDK测试和Lab依赖明确钉main已有0.17.0，复用main发布包的完整client0.10.0依赖图；直接使用的streams-client仍0.9.0，Effect4.0.2不变。包级明确版本避免旧catalog条目与GitHub合并树的main0.17 catalog错配，不改其他包catalog。保留旧0.16.2解析记录供当前冻结父链其他包使用；与main组合后两处引用一致。运行源码/wire无变化，已验证同一0.17实际依赖core302/Lab94证据可复用；新准确CI和独立组合增量仍分列。

CI 预算修正：key-distribution 夹具在 HTTP/接收/repair 查询中重复验证不变签名历史。现在复用真实验证的 view；仅在该私有只追加夹具新增记录后完整验证新历史。保留 epoch1、发送者撤销断言及独立 OS 子进程验证，全部 HPKE/HTTP/SQLite/报告/repair 步骤和原 15 秒限制不变。连接当前 core 的本地对照从 2757ms 到 1718ms。这是作者夹具证据，不是原生存钥或永久计时保证。父层带有失败信封定位，供明确的持久定向 repair 使用，不自动跳过。


## 2026-10-14 集中交付：待 human 决定（全部 proposed）

受限 A 已批准并继续沿用：只持久保存已合法安装 EpochKey，可信宿主初始化注入 protector；不是未发布 candidate、vault 或原信封历史资格授权。

| 决定 | 推荐 | 替代 / 兼容与代价 | 不选择时阻塞 |
|---|---|---|---|
| G：genesis/control 布局 | 原签名 genesis 是 control 第0条；registry仅作原件发现缓存，host创建须幂等恢复 | 旧 metadata-only 不能作为完整审计起点；旧布局需显式迁移/拒绝，不能自动猜 | 新建workspace；既有已发布full-prefix+外部pin session不阻塞 |
| S：内容snapshot与资格/信任 | 新认证header绑定真实续读位置摘要，独立pin当前Owner/Admin personal资格；旧header仅历史读取，禁止新接纳；坏snapshot客户端回完整历史 | 升级格式会拒绝旧publisher；仅按header4继续接纳保留位置替换风险，不推荐；历史API不可用须失败且保留cursor | protected snapshot publisher/admission/bootstrap；完整资格批准引用仍缺 |
| D：D12兼容 | 沿现有atomic-removal提案tag8+snapshot-v2 required tags/独立能力pin，单条CAS移除+换代 | 旧端明确拒绝v2/tag8；不能降级tag2两步。需成套升级旧端 | 原子移除producer，不重复决定原子原则 |
| V：vault/恢复 | 一文件秘密直接派生每workspace独立R的包装钥，逐条CAS、先读回验证新备份再撤旧、默认保留退役备份 | 现draft另有独立master V+index包装方案，需选定并改draft；直接派生更简单，换文件秘密需重包各条目；Passkey包装另审 | Recovery设置/跨设备vault恢复；受限A本地installed-key恢复不阻塞 |
| K：新钥备份与紧急例外 | 正常发布前完成独立可读的candidate备份；没有备份时不提交 | 允许用户明确确认永久丢失风险后紧急移除可更快撤权，但publisher随后永久丢失会丢新内容；不能预发给未生效普通设备 | 耐久新epoch candidate/rotate/resume/genesis发布；已提交K配送不阻塞 |
| R：replay entropy | 保存原签名/密文字节与真实观测，原件重放；首次seal仍安全随机 | 测试专用label entropy是另一显式能力，不改global crypto；同seed不能假称可再生同密文 | 精确seal再生成replay；有限动作执行/证据包不阻塞 |
| N：notes资格 | host notes仅inert观察DTO；独立确认仍外部完整tuple+实际peer，不让host代选确认者 | 开放所有Member签新comparison-note需新wire/domain，暂不推荐 | 新签名note producer；现raw比较/外部确认不阻塞 |
| B：严格期限 | 保持普通60秒容差；严格B单独批准可信时源/超时行为后再启用 | 默认严格会影响离线/高延迟；不得本次偷加claim | strictB新鲜度能力，不阻塞普通已有契约 |

这张表不是批准。只有可定位human答复覆盖的行才可实施对应语义；不获答复继续完成外部pin既有workspace、实际动作执行和CLI。native平台protector、可信历史保留API及生产接线是平台/上游关联工作，不用synthetic证据冒充完成。

## 集中既有工作区交付（2026-10-14）

本分支完成无争议消费者，不另造core。`openLabWorkspaceSession`统一既有入组control/P09、installed protected keys、receiver/distributor、每文档Loro/Flock生命周期；两种真实native模型共用一个文档引擎，失败只停止该文档。host消费public当前写入准入核验released header3，历史作者认证不授予新写权限；拒绝snapshot/旧header，不引入新wire/domain。gate/phase/dispose自有编排用Effect；废弃Promise方法限SDK回调边界。

有限JSON动作执行器启动真实OS worker、持久写文档、实际kill actor、注入真实密文/SQLite/ACK故障并消费真实观测。CLI run/inspect生成有界合成证据：实际加载源码/依赖SHA、原签名账本、保护wire原件。它不再生成首次seal字节，不宣称原完整replay。真实control CAS后丢响应保留原P09字节，硬重开恢复同字节，feed持久核对后才允许显式ACK。本地已知pin与当前网络点分开；私有IPC点仍与独立见证的签名原件核对，重开最多尝试已知local点和当前external点，不从SQL自选端点。生产独立权限来源的取得/耐久性仍归平台。

作者证据：39动作涉及HPKE安装/报告、两真实SDK模型、SIGKILL/重开、坏密文、单文档隔离、native状态/cursor摘要保留、完整历史恢复、SQLite ABORT、原记录ACK恢复。负控实际删除SQL文档后独立进程重开，判定直接测出耐久丢失，不是超时。初次IGNORE夹具重试完全相同的已落盘状态，是合法幂等；改夹具为ABORT，不改持久成功契约。初次native phase测试错用了Effect yield API，释放信号没发导致超时；保留为harness错误，不计安全负控。日常所属测试复用准确已装依赖，最终组合frozen/root/build/smoke及远端CI在交接中独立归属，不重开旧P1矩阵。

原core7/Lab2逐案去向只维护在manifest：六项core已有替代；永久丢失换代仍受阻；两个Lab offset行为补完整session消费者、真实SQL保留和独立OS重开回归。源指纹和登记不变。淘汰旧JSON/Team/MLS/类，不淘汰必要能力；旧验签worker pool只是未移植的可选性能优化，不恢复注入式权威；文档/cursor同SQLite事务，不重建旧分文件cursor。

上面的八项表全部proposed。受限A已批准，不重复问；只覆盖installed EpochKey持久保护，不覆盖candidate/vault/B历史发送信封或生产持钥。native protector、可信保留历史API和私有产品接线为平台/上游关联工作。代码与测试不自动批准任何协议。


补充已定消费者：unbound签名加入意图有独立Lab SQL原件journal，丢回执/重开保留原件；真实admission/P09生效后才启动普通receiver/content，入组前mailbox实际拒绝。public installed-history初始化借用原保护store，完整链核验后才保存/回读各旧钥，退出清理所拥有的临时opaque钥。真实已签坏packet不产生旧钥部分落盘，SQL ABORT明确失败，显式重试恢复原commitment；真实观测先于缺失epoch拒绝，随后旧view被拒。不创建candidate保护/vault或历史信封B。

## #1557 联合判定修复（2026-10-14）

独立F1为Lab验收判定缺口，非密码学绕过/线上损坏：同一步text错误的violation被后续相同SQL摘要的pass覆盖。现在保留ok/outcome/text/unchangedFrom各自checks，再用worstVerdict聚合；失败、未测量及harness错误不能被通过结果擦掉。outcome要求成功响应，因此预期ok=false同时要求outcome的矛盾计划在执行前拒绝。

原reviewer反例复制到作者自有证据目录，原断言旧fail/新pass；真实OS/HPKE/HTTP/SQLite补text错+持久对相同、text正确+真实编辑改变持久对、两者正确三对照。另验证ok/outcome、失败响应和无期待时unavailable分类。首次同步回复分类夹具触发driver external-permit，保留为非目标夹具错误；改为实际IPC的异步边界。39步预算与全部断言不变，旧P1/未批准协议不重开。本修复由协调独立增量复验，作者验证不自行关闭独立finding。准确head/base、日志与CI归属放交接，不因链接更新实现head。
