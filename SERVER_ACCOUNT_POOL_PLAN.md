# 单机 Debian 账号池方案

## 1. 文档目的

这个文档记录账号池程序的当前状态、核心流程、部署方式和后续前端方案。

原则：

- 只保留对维护和后续开发有用的信息。
- 已实现的内容写清楚当前怎么运行。
- 未实现的内容只写方案和边界，不写过多细节。
- 复杂流程用总结，不堆长篇步骤。

## 2. 当前结论

项目已经从一次性注册工具，改成了单机账号池常驻进程。

当前第一版目标：

```text
始终维护 10 个明确可以登录的账号。
```

当前已经实现：

| 能力 | 状态 | 说明 |
|---|---|---|
| 根目录启动 | 已实现 | 直接运行 `node index.js` |
| SQLite 账号池 | 已实现 | 账号保存到 `data/accounts.sqlite` |
| 自动补齐 | 已实现 | active 少于目标数量时自动注册补齐 |
| 定时轮询 | 已实现 | 每 30 分钟检查一轮 |
| 登录检查 | 已实现 | 登录成功才保留账号 |
| 验证码登录 | 已实现 | 登录时需要 OTP 会从收信页获取 |
| 失效清理 | 已实现 | 先标记，整轮结束后统一删除 |
| 锁文件 | 已实现 | 防止多个进程同时运行 |
| 有窗口浏览器 | 已实现 | `headless: false`，Debian 可配合 Xvfb |

当前还没做：

| 能力 | 说明 |
|---|---|
| Express 后端 | 第二版给前端提供接口 |
| 前端页面 | 第二版展示账号、日志、配置 |
| 日志轮转 | 防止 `results/run.log` 长期过大 |
| SQLite 自动备份 | 防止数据库损坏后难恢复 |
| 单轮补号最大尝试次数 | 防止连续失败时一直注册 |

## 3. 当前整体流程

账号池每一轮按这个顺序运行：

```text
启动程序
-> 获取锁
-> 打开 SQLite
-> 启动 Chromium
-> 读取 active 账号
-> 逐个登录检查
-> 登录失败或不明确的账号标记 remove_pending
-> 本轮检查完成后统一删除 remove_pending
-> 统计 active 数量
-> 不足 10 个就注册补齐
-> 等待下一轮
```

这个流程类似垃圾回收：

```text
先标记不可用账号，再统一清理，最后补齐缺口。
```

## 4. 关键文件总结

| 文件 | 负责内容 |
|---|---|
| `index.js` | 程序入口、读取配置、启动浏览器、启动调度器 |
| `config.json` | 常改配置，比如目标数量、等待时间、名字、年龄 |
| `src/db/index.js` | 打开 SQLite，初始化数据库 |
| `src/db/schema.js` | 账号表结构和状态定义 |
| `src/scheduler/index.js` | 定时循环，每隔一段时间跑一轮 |
| `src/scheduler/round.js` | 单轮检查、清理、补齐的顺序控制 |
| `src/services/account-store.js` | 账号增删查改 |
| `src/services/account-checker.js` | 登录检查账号是否可用 |
| `src/services/account-pool.js` | 统计缺口并补齐账号 |
| `src/services/registrar-runner.js` | 单次注册流程，成功后写入 SQLite |
| `src/services/lock-file.js` | 防止重复运行 |
| `src/registrar.js` | 串联注册页面流程 |
| `src/pages/` | 各页面的具体操作 |
| `src/scraper.js` | 获取临时邮箱和验证码邮件 |
| `src/parser.js` | 从邮件里提取验证码或验证链接 |

## 5. SQLite 数据总结

数据库文件：

```text
data/accounts.sqlite
```

账号表核心字段：

| 字段 | 说明 |
|---|---|
| `email` | 账号邮箱 |
| `password` | 账号密码 |
| `status` | 当前状态 |
| `createdAt` | 创建时间 |
| `lastCheckedAt` | 上次检查时间 |
| `lastSuccessAt` | 上次成功登录时间 |
| `failReason` | 被移除或失败的原因 |
| `checkCount` | 检查次数 |
| `registerAttempt` | 注册时是本轮第几次尝试 |

主要状态：

| 状态 | 含义 |
|---|---|
| `active` | 明确可以登录的账号，计入 10 个目标数量 |
| `remove_pending` | 本轮检查失败，等待统一删除 |
| `checking` | 预留状态 |
| `registering` | 预留状态 |
| `failed_register` | 预留状态 |

当前规则：

```text
只统计 active。
只有明确登录成功的账号才保留。
其它情况全部移除，然后自动补齐。
```

## 6. 账号检查规则

账号是否可用，只看是否能登录成功。

不检查：

- 是否能发消息。
- 是否有额度。
- 是否有某个模型。
- 是否是 Plus。
- 聊天输入框是否可用。

检查结果处理：

| 页面或结果 | 处理 |
|---|---|
| 成功进入 ChatGPT 主页面 | 保留 `active` |
| 需要邮箱验证码，验证码提交后登录成功 | 保留 `active` |
| 密码错误 | 标记 `remove_pending` |
| 账号不存在 | 标记 `remove_pending` |
| 账号停用 | 标记 `remove_pending` |
| 验证码收不到或提交失败 | 标记 `remove_pending` |
| 页面超时、结构变化、Cloudflare | 标记 `remove_pending` |
| 结果不明确 | 标记 `remove_pending` |

取舍原因：

```text
账号池只保留明确能登录的账号。
不确定账号也删除，避免逻辑复杂，再靠自动补齐恢复到 10 个。
```

## 7. 已观察到的失效页面总结

### 7.1 账号停用

特征：

```text
URL: https://auth.openai.com/email-verification
标题: Oops, an error occurred! - OpenAI
正文包含: account_deactivated
正文包含: An error occurred during authentication
```

处理：

```text
直接判定不可用，标记 remove_pending。
failReason 记录 account_deactivated。
```

### 7.2 会话过期

特征：

```text
URL: https://chatgpt.com/
页面有 ChatGPT 主界面背景
弹窗包含: Your session has expired
弹窗 id 或 data-testid 包含: modal-expired-session
```

说明：

```text
这不一定代表账号本身失效，只代表当前登录态过期。
```

当前处理：

```text
因为没有明确登录成功，所以不保留，标记 remove_pending。
```

## 8. 验证码登录流程

轮询登录时，如果页面要求邮箱验证码，复用注册时的收信逻辑。

收信页格式：

```text
https://mail.chatgpt.org.uk/{email}
```

简化流程：

```text
提交邮箱和密码
-> 页面要求 OTP
-> 打开对应邮箱页面
-> 等待验证码邮件
-> 提取 OTP
-> 回到登录页提交 OTP
-> 判断是否登录成功
```

失败处理：

| 情况 | 处理 |
|---|---|
| 收信页打不开 | 删除账号 |
| 验证码邮件超时 | 删除账号 |
| 邮件里没有 OTP | 删除账号 |
| OTP 提交失败 | 删除账号 |
| OTP 后登录成功 | 保留账号 |

## 9. 浏览器和 Cloudflare 策略

当前配置建议保持：

```json
{
  "headless": false
}
```

原因：

```text
有窗口 Chromium 比 headless 更不容易卡在 Cloudflare。
浏览器窗口不是给人工操作用的，只是为了让程序更稳定。
```

Cloudflare 处理原则：

- 检测到 Cloudflare 不要无限等。
- 注册时可以短时间等待通过。
- 登录检查时快速失败更合适。
- 当前账号或当前注册尝试失败后进入下一步。

## 10. Debian 部署总结

### 有桌面环境

```bash
node index.js
```

### 无桌面环境

```bash
xvfb-run -a node index.js
```

长期运行建议用 systemd：

- 开机自动启动。
- 崩溃自动拉起。
- 日志统一管理。

第一版不建议用 cron。

原因：

```text
cron 容易上一轮没跑完，下一轮又启动。
当前常驻进程自己控制轮询，更适合这个项目。
```

## 11. 当前配置总结

配置文件：

```text
config.json
```

常改配置：

| 配置项 | 说明 |
|---|---|
| `targetAccounts` | 目标账号数量，当前 10 |
| `checkIntervalMinutes` | 检查间隔，当前 30 分钟 |
| `headless` | 是否无窗口运行，建议 `false` |
| `password` | 注册默认密码 |
| `fullName` / `firstName` / `lastName` | 注册时填写的名字 |
| `age` / `birthdayText` / `birthdayDate` | 注册时填写的年龄或生日 |
| `typingDelayMin` / `typingDelayMax` | 自动输入速度 |
| `mailPollIntervalMs` / `mailPollTimeoutMs` | 等待邮件的间隔和超时 |
| `replenishDelayMs` | 每次补号之间的等待 |
| `accountStorePath` | SQLite 路径 |
| `lockFilePath` | 锁文件路径 |

后续建议新增或真正接入：

| 配置项 | 目的 |
|---|---|
| `maxRegisterAttemptsPerRound` | 限制单轮补号最大尝试次数 |
| `logMaxSize` | 控制日志轮转大小 |
| `backupIntervalMinutes` | 控制 SQLite 自动备份间隔 |
| `serverPort` | Express 后端端口 |

## 12. 后续前端和后端方案

如果以后加前端页面，不建议让前端直接读 SQLite。

推荐结构：

```text
前端页面 -> Express 接口 -> SQLite
账号池程序 -> SQLite
```

Express 负责：

- 读取账号列表。
- 读取账号统计。
- 读取日志。
- 读取和修改配置。
- 手动触发检查。
- 手动触发补齐。
- 手动删除账号。

建议接口：

| 接口 | 用途 |
|---|---|
| `GET /api/accounts` | 查看账号列表 |
| `GET /api/accounts/stats` | 查看数量统计 |
| `GET /api/logs` | 查看日志 |
| `GET /api/config` | 查看配置 |
| `POST /api/config` | 修改配置 |
| `POST /api/check-now` | 手动检查 |
| `POST /api/fill-now` | 手动补齐 |
| `DELETE /api/accounts/:id` | 删除账号 |

初期建议：

```text
Express 和账号池放在同一个 Node 进程。
```

后期如果页面和接口变复杂，再拆成两个进程。

## 13. 还需要补的点

| 优先级 | 项目 | 原因 |
|---|---|---|
| 高 | 单轮补号最大尝试次数 | 避免连续失败时一直注册 |
| 中 | SQLite 自动备份 | 防止数据库损坏后难恢复 |
| 中 | 日志轮转 | 防止 `results/run.log` 过大 |
| 中 | 更具体的失败原因 | 方便排查账号为什么被删 |
| 低 | Express 后端 | 给未来前端提供数据 |
| 低 | 前端页面 | 方便查看和手动操作 |

## 14. 当前维护建议

短期先不要继续大改结构。

建议顺序：

1. 先观察账号池长期运行是否稳定。
2. 如果补号失败过多，先加单轮最大尝试次数。
3. 如果日志变大，再加日志轮转。
4. 如果账号池稳定，再做 SQLite 备份。
5. 最后再做 Express 和前端页面。

当前重点：

```text
稳定运行优先，前端页面后置。
```
