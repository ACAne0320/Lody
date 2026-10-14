# 公开 E2EE Lab（迁移中）

## 运行集中既有工作区场景

## 当前格式消费者

没有线上旧 E2EE 数据或 API 需要兼容。测试直接消费公开的 synthetic protector，删除旧 fixture 别名和布尔 reference 别名。write/send/retry 观察保留 allow/deny/unmeasured；当前 fingerprint 不再投影源原型的越权内容旧标签。SDK/HTTP Promise 回调仍通过有 owner 的 Effect 桥接，因为它们是真实外部 API，不是旧账本读者。

```sh
pnpm --filter @lody/e2ee-lab lab run /绝对路径/新输出目录
pnpm --filter @lody/e2ee-lab lab inspect /绝对路径/新输出目录/evidence.json
```

默认有限计划用真实子进程、challenge/bearer HTTP、public HPKE/SQLite/P09、已发布Loro/Flock SDK执行39个动作：实际SIGKILL/重开、签名control提交后丢ACK与原字节恢复、坏密文、单文档停止/持久对不推进、客户端完整历史恢复、SQLite ABORT。`evidence.json`记录实际源码/依赖指纹、原签名记录、服务端密文字节、调度、判定与未测范围；私有设备夹具导出只在IPC内存。`fixture/*-transport.jsonl`保存原始/投递保护字节，不记凭据。exit0仅表示已测动作契约通过，不表示三类安全维度/完整迁移全通过；exit2为测得违约/缺口，exit1为harness失败，exit64为CLI用法错误。自定义动作是≤256项JSON数组，未知动作/actor、访问器和必要观测缺失在作用前明确拒绝。SIGINT/TERM中断入口并等待actor终止；不提供精确字节重seal replay。

负向期待必须包含 `refusal: { tag, code }`。`inspect` 忽略自报 verdict，从记录的观察重新计算；这只是对不可信材料的一致性检查，不是认证证据或重新执行。真实进程场景的耗时仅作诊断，不是验收阈值。

`./join-session`先落盘/核验原签名加入意图再POST，丢回执不重签；unbound发现不授予收钥，Owner走public admission/P09并核对持久feed后ACK，新成员才启动key/content。

`./full-session`统一已入组control、receiver/distributor、installed protected keys和每文档Loro/Flock owner；重认证先等旧native操作结束。本地已知pin与当前网络点分开：合成进程桥把返回点与独立见证的签名原件核对，最多尝试两个外部已知重开点，不从SQL自选权限端点。Flock用显式单调逻辑时钟。最新installed钥的历史恢复消费public `./keys/host/history`，核验全链再持久保存/回读旧钥，不回开历史发送信封或candidate备份。夹具准备的是已经发布的完整前缀，不是产品创建或耐久新epoch publisher。历史可用时才可恢复，只停失败文档。

## 当前能力范围（本集中分支基于 2190d418，2026-10-14）

Lab 已有 Draft [#1526](https://github.com/LodyAI/Lody/pull/1526)。下文的“尚无 Lab PR”、早期测试数量与分阶段待办属于历史进展，不能作为当前总状态。迁移尚未整体完成；逐文件状态不是功能完成率，目标路径存在也不是行为等价证明。

| 能力 | 当前实现 | 剩余边界 |
| --- | --- | --- |
| 权限、历史作者、账本签名与提交 | public ledger / admission / submission 与 SDK CAS | 外部可信 checkpoint 的取得及持久管理不能由 SQL 或 offset 替代 |
| 内容 | content 工作流、header3 update binding、真实 Loro/Flock 消费 | protected snapshot 发布、位置绑定与完整恢复未完成 |
| 密钥 | history、HPKE envelope、outbox、mailbox、receiver、repair、distributor、受限 A | 新 epoch 的耐久发布/备份策略、vault 与生产 protector 未完成；合成 E7 测试不是完整 publisher |
| Lab | 认证、joins、原 genesis 读取、外部pin既有workspace共同生命周期、header3 host写入、有限key round、真实OS actor/动作/硬退出/故障、CLI证据与判定 | genesis/新epoch/snapshot/vault producer及entropy相关原件replay/场景仍有决定或上游门槛；不称原完整Lab完成 |

旧格式或旧类被淘汰，不意味着它承载的能力可以丢弃；epoch/history publisher 等必须分别登记行为替代或明确剩余责任。受限 A 批准不覆盖 vault、备份、D12、严格 B 或历史发送者信封恢复。本说明不改变任何协议或批准状态。


这个可运行、private 的 workspace 消费公开 `@lody/e2ee-core` 和实际发布 SDK：
streams-client 0.9.0、streams-crdt 0.17.0、Loro 1.16.3、Flock 0.4.3、
SQLite Riverrun 0.3.0，以及根锁定的 Effect 4.0.2。不保留另一套复制 core。

独立 checkout 使用仓库支持的 Node 和固定 pnpm，初始化公开 submodules、
执行 `pnpm install --frozen-lockfile` 后，从根目录运行：

```sh
pnpm --filter @lody/e2ee-lab typecheck
pnpm --filter @lody/e2ee-lab test
```

测试启动真实 loopback Riverrun，使用自动分配端口、合成账户和临时 SQLite。
不安装全局工具，不接入托管产品、生产数据库或真实密钥，不启用生产 E2EE。

账本客户端独立选定签名 checkpoint，通过公开模块验证，串行成对保存原始记录和游标。
actor 消费公开 admission/signing 和未改动的 P09 submission recovery；
真实 feed 落盘失败时不能消费 terminal 结果。另一个 OS 进程重开真实文件，
无需可用 signer 即可恢复原始签名记录。

内容 provider 消费公开 header3 update binding；真实 Loro/Flock SDK 执行加密、
解密和原生状态导入。每文档独立 SQLite 文件，以事务和读回将实际原生状态与精确
SDK 游标一起保存；失败保留旧的持久化对。Loro/Flock 在另一 OS 进程重开文档、游标和
受保护 epoch store。AES 包装能力明确是合成 fixture，不是原生安全存钥或生产算法决策。

`makeLabLoroSession` 管理串行操作、每次新建的 SDK 与真实 Loro 文档。
SDK 必须先订阅再编辑，本地状态先保存再上传。失败只停该文档。
显式全历史恢复保留持久化本地编辑，整次 SDK 拉取成功后才提交状态和游标，
不删除或修改宿主快照。Riverrun 0.3.0 在非零 offset 发布快照会推进
`earliest_offset`，旧前缀从公开历史接口不可读。只有历史仍可读时恢复成功；
否则保持失败，不推进持久化对。历史保留/读取 API 与宿主归属仍需协调，不能报恢复完成。

Scope 关闭入口、abort 请求、等待真实 SDK 原生操作结束，再关闭 SDK/存储并释放
真实 Loro owner。CRDT SyncClient.close() 本身不会等待所有单次操作。
StreamsClient.close() 是发布协议 EOF，HTTP facade 没有原生 dispose；Scope 只 abort
并等待请求，不在清理中发布 EOF。
Flock 0.4.3 没有公开的确定性 free/dispose；关闭 SDK 订阅、丢弃引用，不访问私有
实现，不声称确定性释放 Wasm 分配。permit runtime 要求显式 mode/time/fetch，
已弃用的 Promise bridge 仅用于 SDK 回调；纯 scheduler 使用类型化 Result。

原有密钥轮次还覆盖真实签名的合成 epoch1 记录、Owner 实际分发、新 HTTP 凭据和 OS 子进程只安装 key1。公开历史恢复从已安装钥和认证历史包取得 key0；父端检查实际 SQLite 行从 [1] 变为 [0,1]、承诺一致、原密文 frame 和安装回执。同一合法 epoch2 提案 Owner 可准备、R 被拒绝，R 仍不能发送。完整签名历史由 fixture 独立固定；这不代表 control-stream 发布、持久生产换代发布器、备份完成或恢复库格式。父端不向子进程提供旧钥。

原合成 device 模块七项导出已转为有类型的 Effect/公开 byte API，复用公开原生 signer/verifier。原四字段 JSON 可往返真实 Ed25519/X25519 fixture，返回导入结果前核对私钥与公钥绑定。实际公开 HPKE 和 SQLite credentials 验证导入设备、一次性证明及未入账设备不能绑定 Org。创建在错误/取消时等待两个原生生成器结算；显式信号测试只控制原生完成后的返回/错误，不改真实算法或随机数。原生 handle 由调用方拥有，WebCrypto 无 key close/清零 API；可导出字符串仅是合成 fixture，不是恢复库、平台安全存钥或捕获熵 replay 契约。完整 session/actors 仍需接入。

纯 fingerprint 与有界 minimizer 保留原五项/两项导出，分开策略：精确 replay 比较原全部字段，缺失、JSON 丢失的 undefined、null 或 unavailable 观察明确报缺口；另一维 harness 错误不抹掉已测违约。shrink 保留原规则及精确已知触发事实，允许诊断账本数缩小并显示 partial；原触发事实未测则拒绝执行。Effect runner 串行、有预算、由调用方拥有，错误如实传播；回调前独立复制原 fingerprint。泛型 action 元素须已不可变并独立拥有，不能以浅拷贝数组声称拥有 action 内 bytes。旧 model 标签仅为兼容诊断，不是授权策略。这些是纯合成算法 probe，不代表完整 attack/repro 执行、序列化批准、捕获熵或 reseal。

`authorizeLabStream` 先通过公开 core 检查 genuine 账本，再读取当前成员，
绑定 credential/request Org，拒绝 R 发送或内容写入。它只做策略检查，
不代表凭据认证、固定 CAS 或 payload 准入。`makeLabMailboxRemote` 通过 HTTP
消费公开接收/分发接口，限制 JSON/hex/page 大小，关闭时 abort 并等待完整响应体。
可选原生 transport lease 明确转交，实际工作结束后才 close；global fetch 不需 close。
真实 HPKE 投递、SQLite 保存/读回/报告经过此适配器；篡改帧不安装也不报告，
重开后 R 仍不能发送。传输单元 fixture 的预认证合成会话和 AES 包装是明确的 mock
边界；全部宿主路由认证、完整轮换/actor 组合仍未完成。该密钥轮次在同一 OS 进程内
重开存储，不代表跨进程密钥轮次验收。

mailbox 宿主当前通过真实 challenge/bearer HTTP 提供原七项操作，只绑定落盘
设备与 bound Org，消费公开 SQLite mailbox；JSON 不能选择 sender。envelope/
report 保留公开 512 字节限制，local-publication 记录保留 8192 字节，repair ID
保留已有 1–256 字符契约，不发明新 ID 格式。真实 HPKE 轮次经过此路由，包括 R
不能发送、修复自身接收 slot 的重试幂等。账户身份与 AES 包装仍是合成 fixture；
部分传输单元 fixture 仍明确预认证。这不代表完整 host/rotation 组合或跨进程 epoch 轮换验收。

scoped 凭证 owner 保留冻结 Lab v2 持有消息、60 秒单次 nonce 和最多 15 分钟
合成 token TTL。真实 Ed25519 证明、genuine 当前 Org 成员和 SQLite 事务读回
都是必要条件。account 只是测试标签，不增加 JWT claim、不改普通容差，也不代表
严格生产期限 B。loopback HTTP host 当前提供 health、challenge、credential 和
control append-CAS；检查精确路径、有限 JSON/单记录 body 和已落盘 bearer。
公开 submission 完整验证独立选定前缀并固定 SDK CAS，请求的生命周期/offset/auth
头没有上游转发入口。workspace 注册/checkpoint 持久化、其余 metadata、内容写入/live
订阅及 CLI 仍未完成；索引密钥投递消费公开 mailbox。共享操作 Scope 关闭时 abort、打断并等待所有子操作，
某个清理失败也不能跳过其他操作，再关闭此前的 SQLite/SDK owner。

join mailbox 消费公开请求签名/验证。真实 unbound 外来设备可提交无权威效力的
申请，只有 genuine 当前成员能读队列；收到申请不授予成员资格，也不改变期限策略。
同一 request ID 仅原 signer 可替换；首次合成 user/account 关联保持固定。SQLite
两个行须在同一事务读回，复用前重核已存请求与绑定。R 不能提交 join 申请。
借用账本读取接收 abort signal，并保留到实际结束；显式忽略 abort 的借用测试观察
真实 SQLite close/open 与 Riverrun 关闭顺序。完整宿主组合仍未完成。

原完整 host/gateway、诚实 actors、密钥投递/轮换组合、Flock 完整恢复/live
session、完整 schedule executor、攻击能力、捕获 replay、原 fixtures 和 CLI/启动流程
尚未完成。当前 52 个测试不代表原 Lab2 失败闭合或原故障矩阵完成。
快照 wire/offset、replay 熵、严格期限 B、恢复库、D12、发布设备永久丢失仍是待决项。
原生存钥、生产 E2EE、整栈独立审查、CI 和产品验收各自独立。
参见[完整清单](../../.agents/docs/e2ee-migration-manifest.json)和
[所属 Note](../../.agents/notes/proposed/architecture/2026-10-12-e2ee-lab-integration.zh.md)。

workspace registry 只保存实际公开签名验证过的原始 genesis 与原 signer，并在同一
事务读回；被忽略写入和坏存储拒绝确认，另一 OS 进程重开真实文件后重验。
认证 genesis 发现保留 unbound joiner 的访问，仅返回原始 genesis。metadata API
是私有 harness 注册，不代表完成 HTTP create-space 发布、当前可信端点、存钥或
crash-gap 恢复。

凭证绑定保持原 bind-once token 与原到期时间，不续期、不授予成员资格。有限
当前账本查询之后重核已存身份/到期/失效，再读回真实 SQLite UPDATE。借用查询
收到 abort 并保留至实际结束。宿主 create-space/stream 发布组合仍未完成。

`makeLabStreamReader` 通过落盘 bearer 提供有限 GET/HEAD control/loro/flock 读取和
实际 SDK bootstrap/latest/specific snapshot。上游固定 loopback，不转发调用者 URL/
headers；latest 重定向只允许同 origin/Org/stream。有限响应体和允许的 SDK headers
在同一个原生 lease 中完成，传输前后都复核 genuine 当前权限。读取期间真实签名撤销
不会推进公开 feed 的持久游标。这里的快照只是未保护的不透明传输 fixture，不代表
受保护快照契约。SDK0.9 putSnapshot 回显输入 offset，测试使用原生 HEAD 返回的
opaque token。完整受保护快照发布/恢复仍未完成。

Flock 子进程没有可用 signer，保留旧字段并用落盘保护密钥解密新的独立更新；实际 Loro SDK
生成同 Org/resource 的不同 model 保护帧写入 Flock 后，子进程拒绝、原 native file/游标
不变。这是有限进程重开证据，完整 Flock session/recovery/live 未完成。

有限密钥轮次现在保留真实安装失败的 Install 任务，关父 receiver owner 后由 OS 子进程重开：
导入合成 X25519 设备、解密原 HPKE frame、保护 epoch 保存/读回，用新真实 challenge/bearer
发送报告。父端验证实际 Reported、原 frame bytes 和 R 不发送。此重开私钥句柄不可导出，
HPKE recipient 绑定需序列化的公钥可导出；不是生产 custody/恢复库格式/完整 epoch 轮换。

`driveLabPermits` 消费有 Scope 的 manual runtime，拥有一次有限 permit 执行的取消和
实际 native 结算。record 放行最早可运行请求；replay 只放行下一条身份、父事件和
occurrence 都匹配的记录。预算在每次放行前检查。完成或调用者明确 stop 时报告缺失/
多余事件，等待不提前消费后面的记录。调用者取消先关闭 gate，再中断不可中断借用。
不引入默认 watchdog 或协议期限。内部计数键用 JSON tuple，记录中的 parent 字符串
不改；此入口拒绝带 `|` 的标签，避免不同父事件三元组混淆，这是明确兼容限制。
start/attack/persist/crash 动作、完整祖先/entropy 格式及 captured executor 仍未完成，
不能算完整 replay 验收。

纯 judge 区分缺测、部分覆盖和 pass。默认基线未测，记录数量不能认证历史。真正无写权
者的新内容被接受判 violation；合法已接纳历史在作者撤权后仍可读，明确的 insider
freshness 模型假设另列。`makeLabContentTrace` 为每轮 Scope 提供有界的私有合成写入
事实，先拥有字段再检查预算，返回不可变快照；clear/close 不影响另一轮，关闭后拒绝写入
和观察。它是有类型的测试观察，不是攻击者可见日志、权限服务或原生存钥。真实 actors/
attack 测量组合仍待迁入。

control 网关放行已定的 Recovery 例外：授权本人的新个人设备。候选筛选只绑定已存
凭据的签名者和操作种类；完整历史、当前成员实例、新设备持钥证明及 SDK CAS 仍由
公开 submission 验证。真实新鲜 possession/bearer HTTP、已发布 StreamsClient 与
原生 SQLite 用例确认：错误成员的持钥证明、R 禁止操作和坏签名不改变远端字节/尾游标，
撤权 R 被拒绝。这只是设备登记，不代表恢复库、备份、内容恢复或生产存钥完成。

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

操作释放和父关闭共享真实子清理completion，包含失败原因。Lab每次执行一个测试文件，仍保留默认5秒用例预算；成本对照后的四进程集成例外为key15秒／workspace10秒；native／独立进程验证保持真实。准确head CI与固定版本独立finding分别报告。
