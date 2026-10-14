# E2EE 仅支持当前格式

Status: implemented
Translation: current

[English](2026-10-14-e2ee-current-formats-only.md)

## 摘要

E2EE 尚未上线，没有线上旧账本、旧日志需要维护。用户于 2026-10-14 明确取消兼容和旧数据迁移范围。每个入口只支持当前格式；删除无用的 Lab 别名和旧报告投影，淘汰清单中仅为兼容而保留的源任务。正常账本历史、代次密钥恢复和当前存储重开仍须保留。本决定不实现或批准任何待定的新协议。

## 职责与核对结果

core 核对没有发现旧数据导入、schema 升级、多版本解码或旧客户端后备路径。SQLite owner 只创建空专用存储，或要求精确匹配的 application/schema ID。record、snapshot、content 与 envelope 解码器各只接纳一套受支持格式，不支持的输入直接拒绝。现有 v0/v1 用途域代表当前协议；删除或重编号会改变认证字节，不是删除兼容。

manifest 误将源 ledger/compat.ts、pure/legacy-error.ts 和 JSON pure/journal-codec.ts 继续列作待迁；现在无目标地淘汰，保留来源指纹。提交耐久性继续由当前 P09 SQLite 实现负责，快照权限仍须独立信任；源原型 JSON 存储不再是恢复需求。

Lab 删除三个无消费者的布尔 reference 投影和 synthetic protector 的 fixture 重导出。测试改用 allow/deny/unmeasured 与显式公开 synthetic protector。fingerprint 删除源原型的越权内容 outside-model 投影及无用旧报告字段；当前判定仍保留未测量事实与实际违约。没有用新的别名或数据转换替代它们。

## 范围边界

- 保留完整／增量验证、历史作者归属、回退／分叉拒绝、pending／report 原字节重试及原生资源所有权。即使只有一种格式，首次上线后也需要这些能力。
- 保留认证的代次历史：从较新的已安装钥恢复较旧钥属于当前历史共享功能，不是旧格式读者；其独立产品批准边界不变。
- 保留不改写输入的外来格式／schema 拒绝。这是输入验证，不是兼容支持。
- 保留已登记的 SDK／HTTP 回调桥接；已发布 SDK 真实要求 Promise 回调，不涉及打开或导入旧账本。
- 淘汰尚未实现的 metadata-only／补 genesis 前缀兼容替代。当前公开 P09 已要求包含原签名 genesis 的完整 control 历史；可续做创建／checkpoint 耐久性仍未完成。
- 从未批准的 D12 草案中删除旧 reader、双格式与 capability pin 互操作要求。最终原子操作／快照编码、授权和独立新鲜度仍须审阅；不实现新 tag／用途域。

公开 foundation 草案及白皮书现在明确只支持当前格式，不再要求保留旧实验 reader。原 source／design／candidate 及其指纹未动。vault、备份、严格 B 与生产存钥等其它草案决定保持原状态。

## 验证

原 reference 权限用例改用三态 API，保留角色、待轮换、未知观察和原字节重试断言。真实 Loro／Flock、HPKE、SQLite 和 OS 子进程用例直接使用同一公开 synthetic protector。验证与准确 head 记录在现有 [#1557](https://github.com/LodyAI/Lody/pull/1557) 交付中；本清理不新增 PR，不合入或启用 E2EE。

## 删除的重复路径

继续扫描后删除无消费者的内存钥缓存、仅member作者查询包装和未使用标识／快照helper。历史作者统一使用已有member/device-only结果。假钥、撤权、回退／分叉和关闭断言转由真实保护存储验证；找不到行而未查询账本时，不声称已观察新账本。

接收、分发与installed-history借用同一个接收器持有的存储，不再重复打开三份数据库。能力仍是host专用opaque钥；借用操作结束后owner才关闭。完整context、实际读回和native lease保留。

内容认证／解密复用同一份已解析自有frame。seal保留signVerified已经完成的原消息验签，去掉第二次整帧验签。AEAD、固定签名者、输入捕获和await前后权限／prefix检查均保留。

Lab删除未接通pause/resume/permit-next、freeze/intercept、start-log和Promise-phase。真实SQL／HTTP／密文故障仍由执行器承担。phase parent和调度状态只有原生Effect路径。固定Scope的LabCallbackRunner只供真实Node／SDK回调：host HTTP、SDK保护及fetch响应回调是具名消费者；关闭拒绝新任务并等待cleanup，聚合cause仍保留。删除泛型Layer初始化和未用runner方法。gate注册先于同步通知，driver先保留原typed failure再关闭其他gate。

当前文档／manifest不再重复中间检查点、实时PR pin及来源／目标hash表。全部380项源SHA与原导出清单仍在manifest，实际运行hash由evidence模块记录。Git5ab9394392a3577a76b14ab0552c33f755b3ce48与固定报告保留历史证据。当前Lab父身份改用JSON三元组，不保留旧分隔符读取分支。本次不增加协议wire／算法、产品接线或协议批准。
