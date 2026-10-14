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

作者扩展存储故障测试后发现 13ce5dac 漏查记录 INSERT：忽略或改写记录时，元数据仍可成功写入并推进位置。旧 head 两项失败保留；修复逐条实际 changes／原字节读回，并在同事务检查实际记录总数与 bytes，不只检查元数据。14 项拥有测试包含新增 IGNORE/TAMPER 原件回归，失败回滚记录和位置。另同步继承的 receive 目标指纹为原审查 4134109a 的实际源码 hash，保留初次提取 hash；其运行源码未改，不沿用旧 fingerprint 为当前匹配。

本次修复最终作者检查：owning14/core248、package typecheck、完整 root `pnpm check`、format/docs/public boundary 通过。原 13ce5dac 两项失败与修复后通过分列保存，尚待新 head 的独立增量与准确 CI，不关闭原 Lab2。

原 reviewer 在 dd297541 复验发现：后续 INSERT 或 metadata 触发器可同长改写已检查记录，原 P1 未关闭。第二次修复在所有 DML 结束后、同事务提交前，按已验证启动历史和本后缀的私有原件列表逐位置核对完整原字节；之后没有 DML。仅事务成功才更新内存 view／原件列表。新增 later／meta／existing 同长改写回归在旧 dd 实际失败，新 owning17 通过，失败保持内存与磁盘原状态并可重试。原 reviewer 脚本只复制到作者目录、重定向 imports，三个场景实际 rollback／真实 OS child 重开／同 handle 重试通过，旧审查证据未修改；作者结果不能代替独立关闭依据。

第二次修复最终作者检查：owning17/core251、package typecheck、完整 root `pnpm check`、format/docs/public boundary 通过。三个原脚本复制后的失败保持／重开／同 handle 重试通过。旧 dd297541 的 NOT READY 不改写；新精确 head 的独立增量和 CI 分列等待核验，不关闭原 Lab2。

输入原件归属修复：5b 调用输入数组的 `.map`，自定义方法可返回借用字节，accept 后外部修改仍污染私有 expected originals。改为读取有界数字索引并构造全新 typed array，复制不调用输入数组方法／iterator；验证、写入、最终历史比较使用同一组自有原件。两条实际回归准确5b均失败：外部改写会拒绝合法续页；metadata trigger 同长破坏旧历史却假成功推进。修复 owning19／typecheck 通过；复制的独立 trigger 反例现返回 corrupt，保持 count2／cursor2，真实子进程重开成功。旧证据不改写，新独立复验／CI 分列。

输入原件修复最终作者检查：feed19/core253、package typecheck、完整 root `pnpm check`、format/docs 检查通过。复制的独立反例还验证失败后真实子进程重开原历史；删除 trigger 后同 handle 重试并再次子进程重开通过。这不提前升级独立审查／CI，也不关闭源 Lab2。

## 外部审查修复

写入后的最终元数据检查包含固定 genesis 原字节。AFTER UPDATE 改写 genesis 会在提交前回滚记录、元数据及内存推进。reader transport 错误保留 SDK 原始 cause 供本地诊断；消费者须投影安全字段，不应记录任意原生 cause。未改变权限或 wire。
