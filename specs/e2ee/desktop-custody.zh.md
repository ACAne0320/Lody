# 桌面 E2EE 密钥保管

Status: draft
Translation: current

[English](desktop-custody.md)

## 主进程拥有者

Electron 主进程在组合时显式创建 core 保护能力。随机 256 位 KEK 由真实异步 safeStorage 加密，保存为私有文件，不复用现有账号 cookie 字符串路径。本模块不注册启动调用、IPC 或启用产品 E2EE；Web／移动／CLI 保管仍不可用。

safeStorage 不可用时拒绝；Linux basic_text、未知或不可用钥匙串后端均拒绝，绝不落明文备用文件。设备签名／加密私钥、已安装 epoch 载荷和换代候选载荷用 XChaCha20-Poly1305 与每次安全随机的 24 字节 nonce 加密。AAD 绑定用途及原有完整 Org／recipient／epoch／commitment；候选另绑定原签名记录，设备绑定 Org、真实公钥对及 personal／machine 类型。R 秘密不经过设备持久化路径。

## 持久化与清理

完整加密文件原子发布，保留第一个原件；旧原件损坏或上下文不符时拒绝而不替换。重开经 safeStorage 解出 KEK，并核对设备公私钥绑定。safeStorage 返回 `shouldReEncrypt` 时，重新包裹同一把 KEK，验证新包裹后原子发布，再读回并解包核对。锁只覆盖初始化时这次替换；并发初始化明确拒绝。最终验证前保留旧加密包裹，失败时恢复，返回 `rewrap-failed`，不静默继续。中断替换或回滚失败可能留下锁和加密原件，须显式恢复；后续初始化拒绝，不抢占疑似旧锁、不自行选择备份、不删除密钥材料。文件权限私有，不持久化或记录明文钥。Scope 关闭先拒绝新操作，等待真实原生操作结算，再清零己方 KEK；不承诺原生句柄或 JS 字符串确定性清零。

## 验收范围

所属测试使用真实原生密码学、文件、OS 子进程重开，以及合成认证 safeStorage 边界，验证后端拒绝、篡改／AAD 拒绝、磁盘无生成秘密及实际关闭等待。这不是已访问系统钥匙串的证明；产品启用前须在支持的桌面系统上用打包 Electron 验证真实 safeStorage。
