# 全历史账本读取与原子持久化位置

Status: implemented
Translation: current

[English](2026-10-11-e2ee-ledger-feed.md)

## 摘要

源 Lab 的已知 hash 跳过逻辑会接受出现在新位置的已提交记录，旧页面还可能回退持久游标。本层把全历史读取与 journal 子集改成公共显式入口，保留 #1434 submission 与认证快照各自归属。直接父层为 #1482 `4134109a76739d8b36ff5a8a1209e37e16518703`，不沿用其审查结论，也不把原 Lab 失败标成已关闭。

## 归属与选择

[入口契约](../../../../packages/e2ee-core/src/ledger/FEED.md) 和[源指纹](../../../../packages/e2ee-core/src/ledger/feed-provenance.json)记录实现。信任来自调用方固定的 genesis 与独立选择的精确 head/count；远端 offset 和页尾声明不是信任来源。只允许首次绑定一次精确 genesis；每条后续记录都经过真实 view 的完整校验，不跳过已知记录或未知快照前缀。重复、回退或不完整页面失败时，不改变已验证状态与位置。

保留 u32be 长度帧和 v1 域。读取能力直接匹配实际发布 streams-client0.9 的结构，不复制 SDK，也不把 SDK 加进密码库依赖。Scope 负责 AbortSignal，并保留、等待原始请求结算，先关闭本 Scope 再销毁借用的 SDK 所有者。分页限制是本地资源限制。上游 SDK 已经缓冲 HTTP 返回体，本层不能声称限制 SDK 内部的内存分配。不响应 abort 且永不结算的请求不能被宣称已停止，组合方须配置传输期限。

专用 SQLite 全审计 journal 在重开时按独立固定终点重放真实签名历史。同一事务写入原后缀、head/count 与不透明位置，并读回元数据。ABORT 或忽略写入会一起回滚记录和位置；竞争的旧 handle 失败。本地保存预算超限时保留历史，不删除或推进游标。旧整块 JSON 持久化不照搬、也不自动导入。快照压缩／启动、原 Lab 消费方和 submission CAS 适配器仍由后续层负责。

## 证据与边界

Owning12 覆盖原帧、真实签名、初始绑定、重复／回退、独立终点、真实 SQLite ABORT/IGNORE、重开、竞争旧 handle、预算保留、Scope 关闭和分段帧。entered／abort／release 明确信号证明取消会等待忽略 abort 的借用 Promise，不靠睡眠或调度运气。断言前释放测试 Promise，避免断言失败妨碍清理。

另有作者证据使用安装的 registry streams-client0.9，通过合成本机 HTTP 服务读取；重复和旧页面不改变实际 SQLite 位置，真实 OS 子进程重开后验证相同 head/count/位置。这是实际 SDK／HTTP／进程证据，但服务明确为合成测试边界，不代表部署服务或原 Lab2 验收。源 Lab2 的旧失败脚本与日志只读保留，待实际迁移 Lab 路径重跑后才能关闭。

未修改 P09／HPKE，未定义新 wire/tag/header、全局最新证明、权限快照启动、原生存钥、恢复格式、D12 或生产开关。[逐项 manifest](../../../docs/e2ee-migration-manifest.json)保留部分覆盖与未完成归属。所有层保持 Draft，独立审查由主协调安排。早期原型的 ES2022 Promise helper／Fiber poll API 错误作为 harness 失败单列，修正 API 后保留原取消断言。

作者最终检查：owning12/core246、package typecheck、完整 root `pnpm check`、format/docs/public boundary 通过。早期静态检查的控制字符 regex 与测试变量遮蔽已修正，旧失败日志保留，不放松测试。实际 SDK／HTTP／子进程脚本和日志由作者证据目录单独保留；不是独立审查或完整 Lab 验收。
