# Durable 上传预算与快照调度

Status: proposed
Translation: current

[English](2026-10-15-durable-upload-budgets.md)

## 摘要

Durable POST 和快照 PUT 原本使用十秒请求期限，但旧名称容易让人误以为它只计算建连。较大的正常上传可能耗尽期限，快照等待 HTTP 时还会占住房间的串行队列。SDK 修改把 token 和 durable 请求预算分开，并在队列内将不可变快照字节与准确的续读 offset 一起取出，再释放队列。Lody 显式选择有界预算，记录安全的快照阶段信息，保留请求身份与类型化取消证据。本地合成验证不代表生产事故原因已确定，也不代表修复已交付到真实客户端；正式接入依赖 SDK 和 Repo 发布。

## 归属与决定

公开 `LodyAI/Lody` 仓库负责 CLI 配置与共享诊断投影。`loro-dev/loro-streams` 负责请求计时、token 获取、CRDT 快照捕获、编码和 HTTP 调度。`loro-dev/loro-repo` 负责这两层之间的安全错误字段投影。产品源码保留在公开仓库；私有组合需要另外接入已经合并的公开 revision。

旧 `connectTimeoutMs` 覆盖控制请求直到响应头返回的过程，包含 dispatcher 排队，并非只测 TCP 建连。新 SDK API 将 `authTimeoutMs` 与 `uploadTimeoutMs` 分开，后者限制请求调度、正文上传和等待响应头。Lody 提议 token 获取十秒、durable POST/PUT 六十秒，保留原控制与读取期限。这是有上限的总预算，不是随上传进度重置的空闲超时，也不保证所有大文档都能在该期限内完成。

统一增加通用建连默认值也会延长无关控制操作，而且仍会占住房间队列。禁用快照或修改 gap/debounce 只能减少部分工作，没有修正请求边界。因此选择在源库保留原快照阈值，仅在检查完整性和捕获快照字节及其准确 offset 时占用串行队列。编码和 PUT 使用这个不可变组合，在队列外执行。单一上传 owner 防止跨房间代际的快照重叠；append producer epoch、重试字节与 cursor 落盘屏障仍由原模块负责。

## 安全诊断

`snapshotUpload.onDiagnostic` 覆盖 permission、auth、HEAD、export、encode 和 PUT。每条事件包含新生成的快照身份、阶段耗时与单调时钟计算的流程总耗时。请求事件还包含独立生成的 request ID、配置预算、HTTP 状态和已知的编码后正文长度。request ID 通过 `X-Request-ID` 发送，可与保留该 header 的 Gateway 核对。这些身份既不能认证设备，也不能证明请求已经到达后端。

Lody 共享投影显式选择字段，保留类型化 source、operation、请求 phase、`abortKind`、实际耗时和安全 offset/request 标记，不序列化正文、token、headers、原始 URL、任意异常或 cause。普通文件日志已经采集 debug：成功阶段使用 debug，失败使用 warn。auth 失败与已尝试 PUT 分开。正文完成但响应丢失时，远端结果未知；本地超时不能证明数据没有保存。

## 依赖与验证状态

独立公开工作区起点为 `a06a69f3e96eec68751ebd4df1d050cbbc4f1cea`，lockfile 固定 CRDT 0.17.0、其传递依赖 Client 0.10.0 和 Repo 0.22.0。本次开始时实际查询到的正式 npm 版本是 CRDT 0.18.0、Client 0.11.0 和 Repo 0.22.0，它们尚不包含本次修改。SDK 源码工作从正式 main `cbed6ade64382afe34bd696b636f5ac007aa2346` 开始；独立 Repo 投影从 `8e25f7e6963f147751d4d137519ca8c2e0b1c285` 开始。

正式接入必须等真实发布存在后，再更新 catalog、lockfile 与精确 release-age 例外。可以在一次性验证 checkout 中使用有 hash 和源码出处的本地产物，但不能将其当成已发布版本，也不能提交为产品依赖。

源库修改已建立正式非 Draft PR：[Streams #422](https://github.com/loro-dev/loro-streams/pull/422)，最终 head `05a58718cc4d4ad3bc357ab94df1522ffa82dbfc`；[Repo #151](https://github.com/loro-dev/loro-repo/pull/151)，head `ef84de8bc6d0db869c3c94aa74e9fcc99aed4d95`。两个精确 head 的 CI 均通过。Repo 通过完整检查（505 项通过，17 项原有跳过）、构建与打包检查。其三个新增公开边界用例在未修改的 base 上失败，字段投影修改后通过。

同一组合成 native-fetch 测试运行于正式 SDK base 和发布标签源码 `f81e6037c245d07f8e89849cafbf7c75e4369766`（Client 0.10.0 / CRDT 0.17.0）。两个旧源码各有四项上传取消直接断言失败、三项同房间阻塞 watchdog 失败，后者是测试运行器超时，并非类型化断言失败。新 19 项套件使用真实 Loro/Flock、自有 loopback、显式 gate 与虚拟请求时钟通过，覆盖请求排队、缓慢但有效的上传、停滞、auth/HEAD/PUT 错误、响应丢失、快照不可变字节与 offset、重试身份、append/cursor 进展、编码中关闭，以及旧 PUT 仍在进行时重连。延迟 Flock 导出用例防止安全检查意外消费待上传更新。

一次性 Lody 组合在最终源码产物下通过完整根 `pnpm check` 与 `pnpm format`，其中 CLI 4,266 项、components 5,343 项、shared 1,507 项和 Electron 220 项通过。定向 shared 81 项与相关 CLI 50 项也通过。第一次 Electron 测试在等待缺失二进制下载；仅向一次性 clone 复制匹配的 44.7.0 包缓存后，重新执行的完整检查通过，没有启动 app。公开工作区没有 `check:affected` 脚本。文档检查保留六处指向未初始化、已排除 Kimi/Pi 模块的既有链接，改动文档没有错误，未涉及受 SHA 保护的主题。

本地产物 hash 与精确源码 revision 保留在仓库外。这不是冻结安装可执行文件测试。虚拟期限不测量真实上行吞吐；合成快照服务关闭连接，因此代理和连接复用行为仍未验证。本任务不包含生产诊断、网络负载、部署、替换客户端或代理调整。
