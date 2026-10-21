# 设备登录确认与 Better Auth 1.7

Status: implemented
Translation: current

[English](2026-10-22-device-login-confirmation.md)

## 摘要

设备页面以前只检查验证码查询是否成功，随后立即批准。用户若被诱导批准攻击者的验证码，就可能把账户会话交给该设备。Better Auth 1.7.12 提供经过核实的客户端和 scope；页面现在要求先查看信息，再明确批准或拒绝。此流程仍返回完整应用会话，显示 scope 不能让用户误以为会话权限受它限制。已部署云端和打包后的原生登录仍需单独验证。

## 决策与证据

[GHSA-q84f-53jg-9ppm](https://github.com/better-auth/better-auth/security/advisories/GHSA-q84f-53jg-9ppm) 首次修复于 1.7.0-rc.3；1.6 没有修复版本。此决定替代 [1.6 基线](2026-09-30-better-auth-1-6.md) 的版本选择，保留既有认证契约。core、API-key、Electron 同步固定到 1.7.12，utils 到 0.5.0。统一 Zod override 升到 4.5.4 以满足依赖。发布时间例外只包含此次安全升级所需的精确版本。

页面仅使用 `GET /api/auth/device` 返回的待批准请求，校验验证码与白名单内的 `lody-cli`，再选择可信的 Lody CLI 显示名称。scope 按原字符串展示，空值明确说明，并提醒公开 client id 不能证明设备归属。预填链接不会自动批准。批准和拒绝前重新查询；信息变化或网络失败都会清除确认。账户或会话变化会重建页面，迟到响应无法恢复确认。实际 1.7.12 源码按 user ID 绑定查看和决定权限，不能把较新的在线文档理解成此版本具有更强的同 session 限制。

保留 API-key 补丁，移除请求中的过期密钥扫描，保留显式清理端点。Electron 1.7.12 上游已经移除 Node 专属导入；新补丁仅保留常量时间 challenge 比较，不改变上游 S256 生成和验证码单次消费。

Convex 集成仍为 0.12.5，其 peer 范围声明为 Better Auth `<1.7.0`。为修复公告，本次升级越过了该官方兼容范围。使用云端的应用必须单独验证适配器与 schema；仅修改 peer 范围不能证明兼容。公共补丁保留 SDK 原有 discovery 文档，移除对 Better Auth 已删除 OIDC helper 的引用。这个 helper 从未注册为授权 provider，因此不是替换或删除实际启用的 provider。运行源码、生成声明和 schema 生成选项同步更新。client/react 入口、跨域 cookie、JWT 创建和 API-key 行为不变。托管适配器的原子操作和持久化 schema 仍由使用它的云端应用负责。重新生成 schema 时不能静默删除历史 OIDC 表。

Better Auth 1.7 将 device/user code 的唯一约束从字段标记移到了表级索引。SDK 补丁也识别单字段唯一索引并映射 `fieldName`；复合索引不能让其中每个字段都被当成唯一字段。创建和更新仍在原 Convex mutation 内检查索引唯一性。已有重复数据会拒绝查询，而不是选择首条记录。新重复错误包含 `Unique constraint`，以便官方验证码生成器执行有次数上限的碰撞重试。补丁不重写记录或表。回归覆盖真实 component API、两类验证码碰撞和历史重复记录。独立反证另覆盖字段重命名与复合索引。

公共审核：[LodyAI/Lody #1798](https://github.com/LodyAI/Lody/pull/1798)。

## 验证与发布边界

路由回归覆盖明确查看、批准、拒绝，异常或不可信响应，网络失败，请求信息变化，账户变化和迟到响应。Storybook 包含确认、空 scope、拒绝状态。仓库 `pnpm check`、最终全量类型检查与 lint、CLI 和 Electron 生产构建、冻结离线锁文件校验、文档检查均通过。最终认证专项共 68 项测试通过，覆盖 discovery 与原生/跨域会话契约。依赖审计没有 Better Auth 告警，其余历史告警不在本次范围内。本地测试或公告消失都不能证明真实账户 OAuth、跨域 cookie、打包后的 Electron/Capacitor 登录。

在使用方升级前保留旧补丁文件。先合并公共改动，再通过独立变更推进使用方子模块指针，最后合并匹配的私有集成；私有 feature PR 不夹带 gitlink。
