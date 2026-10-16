# 原生 Workspace Repo 所有权

Status: proposed
Translation: current
PR: [#1607](https://github.com/LodyAI/Lody/pull/1607)

[English](2026-10-16-native-workspace-repo.md)

## 摘要

用户要求在[正式依赖升级](../../implemented/architecture/2026-10-16-streams-repo-release-adoption.zh.md)的同一个 PR 中接入原生消费者。CLI、renderer、预取 worker 和私有快捷指令 room 使用已发布的 Repo/SDK；一个 workspace Repo 拥有副本，现有 Promise API 经过唯一的废弃 facade。审查发现局部释放失败会截断清理链，并留下无法从正常获取入口恢复的隔离状态；现改为继续独立清理，并在下次获取时重试保留的 owner。包括 host 存储迁移和上层 Session/Turn 工作在内的 [WorkspaceData 设计](2026-10-14-workspace-data-services.zh.md)仍是提案。

## 职责与行为

- Workspace 在既有 SQLite 或 renderer IndexedDB 上拥有一个原生 Repo；消费者在子 Scope 中借用 Doc、Flock、room lease。打开缺失与创建业务身份不同；本地模式不请求云端。
- 原生 Streams transport 复用 token 服务和副本绑定 checkpoint；前台显式沿用同一存储的 Doc cursor，预取 worker 使用隔离副本和易失 cursor。peer baseline、服务端确认和本地持久化不能互相替代。
- CLI 目录读取和元数据确认在既有业务入口组合原生 Repo 操作，删除只有一个消费者的目录与权威对象、未使用的查询选项和兼容方法；保留身份规范化、删除过滤、排序与每次新的服务端确认。
- 本机 v7 客户端拥有 worker、期限和有界队列，含约 64 MiB 的字符串保留预算。分块输入必须完整且版本覆盖公告 frontier；普通写入不增加 join epoch。旧客户端仅作为测试 fixture 保留 host 协议兼容覆盖，没有产品导出或应用导入；原生客户端测试连接真实 v7 host。
- Legacy 房间投影包含实际路由与 attachment：缺席路由为 detached，即使新原生 detail ref 初始为 joining。首次同步等待跨越主动缺席，但实际已挂载路由失败会拒绝等待。
  房间句柄保留原生 RoomLease 及仍有消费者的 UI 状态视图；清单和 transport 快照直接读取原生 lease，本地房间记录只负责 purge 时释放借用 owner。删除未使用的聚合/等待结果 API 与平行 adapter/status 表。原生 reconnect 重试失败的 attach 并保留 SDK producer，替代应用层逐房间 rejoin 扫描；继续复刻完整旧订阅协议会重复这些 owner 和状态。

## 释放、恢复与因果交接

上游副本释放在取消订阅前提交并保存文档和元数据。失败会保留 `RepoReleaseFailed.retry` 及已接受的 I/O；再次获取有可能必须先成功完成旧释放，才能构建副本。SDK close 停止网络准入并等待已接受的工作，不代表发起一次新的服务端上传确认；单纯离线不能证明快捷指令 close 必然失败。

关闭先结束借用者再关闭 Repo，但一个 store 失败不能跳过其他 store、transport 清理、join 收尾或 Repo 关闭。Runtime 尝试这些独立步骤后统一报告错误；再次 dispose 会重试保留的 owner，且不重新允许新工作。RuntimeProvider 按 workspace 保留可重试关闭；一个关闭失败不阻塞其他 workspace，重开同一存储前先重试旧 owner。快捷指令根按数据库执行相同约束；runtime、远端、index 或 store 的失败不会跳过其他清理及 Repo 关闭，已经 disposed 的 runtime 仍能重试未完成的退休。Session lease 释放失败后仍使本机房间失效，私有保留重试 handle。cache/shortcut 下次 acquire 自动重试退休中的 owner。本次没有采纳“重试仍失败也重建”：这可能遗留 SDK producer，原生 Repo 本身也可能还需完成旧释放。持续的存储故障仍会明确失败，但恢复不再依赖外部显式解锁。

后台 stream 失败只输出不带 payload 的诊断，不再无限保留历史 Cause，也不会让后来成功的 destroy 报失败。Scope finalizer 只运行一次；小型 ownership helper 保留原生 retry owner，而不是假装重新关闭失败 Scope 能重试。日志不包含私有 Cause 或 grant。

CLI 与 renderer 在 transport 组合入口注册 SDK 快照诊断 observer。共享显式标量投影保留快照与请求关联、permission/auth/HEAD/export/encode/PUT 阶段、编码后正文长度、结果和单调时钟测得的阶段/工作流实际耗时。Native Repo 错误格式化同时保留 `abortKind`、`timeoutKind`、`uploadStage`，不转发私有 Cause、任意错误文本、正文、token、headers 或敏感 URL。普通 fetch 仍为 `total-only`：没有传输子阶段就保留未知，不把超时预算当作实际耗时。快照阶段使用 debug，失败使用 warn。保护内容已有 observer 继续组合，异步失败也隔离；日志或 observer 失败不改变上传、重试、授权及 local-only 组合。

配置保存保持本地优先。Writer 在提交本窗口编写的 Provider 行后记录待交接 token；只有该配置存在待交接写入时，probe 才等待指定本机 Machine Flock peer 的回执。没有待交接写入的启动、backstop、强制刷新不新增数据面依赖。确认只清除调用捕获的 token，不吞掉并发的新写入；未确认或超时返回失败响应并保留 token 供重试。取消或 dispose 阻止晚到回执启动进程；云 transport 和服务端权威不参与这次本机交接。

兼容层的写入屏障与连接撤销保留了 readiness 和已完成句柄表无法替代的两项保证。首次同步后再发生本地编辑，仍需要新的确认：`waitUntilSynced` 对 server 路由使用原生捕获版本的上传 ACK，对 peer 路由检查指定路由的协议回执。路由缺失、离线或不支持确认只使这次显式等待失败；首次同步 readiness 与本地优先写入不增加新门槛。即使借用者取消等待，有期限的上传 producer 仍由 native Repo 持有；取消不会退休其他借用者的副本。

Transport owner 在 adapter 构造或 native connect 前同步登记。移除会取消获取并关闭 owner Scope，由 native finalizer 撤销注册、等待已接受的连接工作。获取在 native 注册前与完成 lease 发布前均检查取消；移除与获取失败清理共享现有的串行 close，且仅当登记仍指向自身 owner 时删除。确认释放后才允许同名后继接入。关闭失败保留 native retry owner，下次同 id add 自动重试，兄弟 id 仍可用。生命周期原语是 Scope，登记表只持有 owner，不复制 native 状态。

本机 v7 拥塞恢复保留 1,024 个事件、默认 64 MiB 的队列上限。溢出只使该房间当前的屏障失败，包括已接受但尚未消费的 sync 事件。显式 reconnect 或物理连接 online 边会中断并等待旧消费者及其已接受的 Flock I/O，停止期限任务，再在同一个房间 Scope 中创建新队列和 worker。重置不完整分块、请求 id 和服务端 frontier 后，从保留的副本版本重新追赶。CRDT/lease 与状态引用不变，完成追赶才增加 epoch。等待被取消时移除自身回执，不退休共享副本。每个房间的原生 semaphore 将重启与 close 串行化，避免新消费者超越旧任务；关闭后不再准入恢复。这是局部生命周期边界，不是工作区 readiness 或写入 gate。各房间分别恢复，一个房间等待已接受的导入不延迟其他房间的追赶 worker。

## 验证与限制

真实 v7 host 测试分别在默认事件数上限、默认字节预算和注入的小字节预算下连续触发两次拥塞。经过 schema 校验的消息突发包含真实 Loro update 字节，当前等待会失败，独立房间仍可同步，随后原 Doc/Meta 副本恢复上下行写入。另用显式 gate 阻塞真实 Meta import，证明恢复会先等待已接受的不可中断 I/O，再替换消费者；期间兄弟房间仍能完成追赶 epoch。所属原生套件 11 项通过。本次修复的 Shared 全量 1,522 项、受影响 renderer 四组套件 89 项通过。在独立的 `a2f0911d` 工作树上，新增五项拥塞回归针对修复前实现均失败。根检查另有未改动的 SubagentTaskPanel 命令详情用例超时，所属套件单独复跑 19 项全部通过；将此结果与已知 SSH 凭据 fixture 失败分别记录，不把根检查报告为全绿。

真实 renderer SDK fixture 覆盖明文/保护快照成功、PUT 阻塞期间注入的 275 ms 实际耗时，以及经过 native Repo 错误格式化的 60 s 总上传超时。日志 sink 与异步 observer 抛错都不会使上传失败，也不会跳过已有 observer。CLI SQLite/SDK fixture 校验阶段记录，并将编码后字节数、request id 与真实 PUT 关联。投影排除诊断 DTO 中额外添加的私有字段，真实失败路径中的合成私有 payload 与 Cause 同样不进入日志；传输信息只记录 SDK 实际提供的证据。移除 observer 注册与三项错误分类后，回归 fixture 失败。

在 `a2f0911d`，诊断修订通过受影响组件 63 项与 CLI 专项 5 项，以及完整 workspace 类型/静态、格式、文档和边界检查。CLI 全量为 4,313 项通过、1 项跳过，另有此前已复现的 SSH `context_unreadable` fixture 失败，因此根 `pnpm check` 仍未全绿，也没有通过该命令跑完所有包的完整套件。脚本套件 58 项全部通过。

回归 fixture 使用真实 SDK，在 baseline 后阻塞上传 POST；另以显式连接暂停驱动真实 Streams transport。断言服务端收到的字节、native 清单移除与同 id 重连；其他 native 边界用例覆盖构造/connect 中取消、晚到完成与后继隔离、释放重试及未确认 peer 回执。这些是合成 HTTP fixture，不代表生产网络验收。

恢复 `d82fea54` 的 facade 后，两项真实回归 fixture 均失败。在 `95ee59f7`，根检查在沙箱内的脚本 fixture 停止，同一完整脚本套件在沙箱外通过；受影响的 CLI 套件与完整 Shared 套件也在沙箱外通过。

行为回归覆盖 cache/shortcut 释放失败后的自动恢复、共享副本、保存失败后原始字节保留、后台 observer 失败后正常关闭、workspace 清理的继续与重试、Session 释放失败后的本机房间失效，以及仅对待交接配置生效的 probe、取消和 dispose。原生 v7 host、旧 peer 兼容、快照与 Streams 套件分别保留协议覆盖；最终检查结果记录在 PR。
真实 native 集成还覆盖失败 attach 的重试、仅由 native 借用的房间清单、反复服务端确认与本地权威，以及原有四组晚到 reconnect 成功/失败和 waiter 重试下的关闭场景。waiter 超时后仍共享保留中的 native producer，新的触发边不会重复启动它。
Session 在 reconnect/readiness 阶段退休时，只取消自身借用的等待；持有同一房间和文档的另一个借用者仍然可用。

`df7de23d` 的完整 GitHub CI 和 Desktop E2E 通过；这是本次修订的基线，不是新修订的验收。未改动 SSH 凭据 fixture 的 `context_unreadable` 在精简前后均可于本地复现，因此不将本地 CLI 全量测试报告为全绿。本地测试不代表真实生产服务、浏览器进程崩溃或跨平台验收。Host 本机 server 所有权、SessionDocument wrapper cache、Session/Turn/dispatch、快捷指令 grant/发布、RPC、迁移 target 上传仍保留既有应用生命周期。PR 维持用户要求的同一接入单元；删除无消费者框架和产品重复实现，不再扩大迁移，也不修改尚在提案中的 WorkspaceData 设计。
