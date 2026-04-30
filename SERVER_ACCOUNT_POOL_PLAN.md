# 单机 Debian 账号池方案

## 目标

把当前一次性注册工具改成单机常驻任务，始终维护固定数量的可用账号。

第一版只考虑一台机器运行，不考虑云端、多机器或复杂远程管理。

目标数量固定为 10 个：

- 有效账号少于 10 个时，自动注册补齐。
- 定时检查已有账号是否还能登录。
- 失效账号直接从账号池里去掉。
- 所有过程都要有日志，方便排查为什么减少或补号失败。

## 不做的事情

第一版不要做太复杂：

- 不做 Web 管理后台。
- 不做数据库集群。
- 不做多机器并发注册。
- 不做复杂告警系统。
- 不做云端特殊部署。
- 不做远程可视化管理。
- 不做前后端分离。

## 当前项目情况

现在项目是一次性流程：

1. 启动程序。
2. 输入要注册的数量。
3. 生成邮箱。
4. 注册账号。
5. 验证邮箱。
6. 成功后写入 `emails.txt`。

当前缺少这些能力：

- 不知道账号当前是否有效。
- 没有账号状态字段。
- 没有定时检查。
- 没有自动补齐到固定数量。
- 没有登录检测流程。
- 没有防止多个进程同时运行的锁。

## 建议后的整体流程

程序启动后执行：

1. 读取账号数据文件。
2. 统计状态为 `active` 的账号数量。
3. 如果少于 10 个，调用现有注册流程补齐。
4. 每 30 分钟开始一轮完整检查，依次登录检查当前 10 个账号。
5. 检查成功的账号保持 `active`。
6. 没有明确登录成功的账号先标记为待删除。
7. 本轮 10 个账号全部检查完后，统一去掉被标记的账号。
8. 根据缺失数量调用现有注册流程补齐。
9. 循环执行。

这个流程类似 JavaScript 垃圾回收：

```text
先标记不可用账号，再统一清理，最后补齐缺口。
```

## 建议目录结构

第一版建议技术栈定为：

```text
运行：Node.js
浏览器：Playwright
数据库：SQLite
```

选择原因：

- Node.js 可以继续复用现有注册流程。
- Playwright 继续负责注册和登录检查。
- SQLite 适合单机部署，文件简单，后续也方便读取和展示。

建议后续逐步调整成这个结构：

```text
index.js                         程序入口
config.json                      配置文件
data/accounts.sqlite             账号池数据库
results/run.log                  运行日志

src/db/                          SQLite 初始化和读写
src/scheduler/                   定时轮询任务
src/services/account-store.js    账号数据读写
src/services/account-checker.js  检查账号是否还能登录
src/services/account-pool.js     维护账号数量
src/services/lock-file.js        防止重复运行
src/registrar.js                 现有注册主流程
src/pages/...                    现有页面操作
```

Fastify API 和 Vue 管理页面放到第二版再做，第一版不引入。

## 账号数据格式

建议不要再只用 `emails.txt` 保存成功账号。

账号池直接使用 SQLite，方便保存、查询和后续展示可用账号列表。

建议数据库文件：

```text
data/accounts.sqlite
```

建议账号表 `accounts`：

| 字段 | 说明 |
|---|---|
| id | 自增 ID |
| email | 邮箱 |
| password | 密码 |
| status | 当前状态 |
| createdAt | 创建时间 |
| lastCheckedAt | 上次检查时间 |
| lastSuccessAt | 上次确认可用时间 |
| failReason | 失败原因 |
| checkCount | 检查次数 |
| registerAttempt | 注册时是第几次尝试 |

建议增加索引：

```text
email 唯一索引
status 普通索引
lastCheckedAt 普通索引
```

状态建议：

| 状态 | 含义 |
|---|---|
| active | 当前可用 |
| checking | 正在检查 |
| remove_pending | 本轮检查后准备删除 |
| registering | 正在注册 |
| failed_register | 注册失败 |

说明：

- `active` 才计入 10 个目标账号。
- 账号检查时只要没有明确登录成功，先标记为 `remove_pending`。
- 一轮检查结束后，再统一从 SQLite 里删除 `remove_pending`。
- 不再保存 `unknown`、`session_expired`、`invalid`，这样逻辑更简单。
- 正常情况下 `accounts` 表里只保留明确可登录的账号。

## 账号补齐策略

固定目标数量：10 个。

补齐逻辑：

1. 读取 SQLite 里的 `accounts` 表。
2. 只统计 `active` 账号。
3. 如果 `active` 数量大于等于 10，不注册新账号。
4. 如果 `active` 数量小于 10，计算缺口。
5. 缺多少注册多少，但要设置单轮最大尝试次数。
6. 注册成功后写入 SQLite，状态为 `active`。
7. 注册失败只记录日志，不影响已有账号。

建议限制：

| 配置项 | 建议值 | 说明 |
|---|---:|---|
| targetAccounts | 10 | 目标有效账号数 |
| maxRegisterAttemptsPerRound | 20 | 单轮最多注册尝试 |
| replenishDelayMs | 3000 | 每次补号间隔 |
| retryDelayMin | 沿用现有配置 | 失败后最小等待 |
| retryDelayMax | 沿用现有配置 | 失败后最大等待 |

## 登录检查策略

新增一个登录检测流程，专门判断账号是否还能登录。

账号有效标准：

```text
只要登录成功，就算 active。
不要求继续确认聊天输入框、套餐、额度或模型是否可用。
```

检查流程：

1. 打开登录页。
2. 输入账号邮箱。
3. 输入密码。
4. 如果页面要求邮箱验证码，打开该账号对应的收信页面获取验证码。
5. 输入验证码。
6. 判断登录后的页面状态。
7. 根据页面结果更新账号状态。

判断结果只分成两类：

| 检查结果 | 处理方式 |
|---|---|
| 登录成功 | 保持 `active` |
| 没有明确登录成功 | 标记为 `remove_pending`，本轮结束后统一删除 |

### 验证码登录策略

轮询登录时不要假设输入密码后一定直接进入 ChatGPT。

实际流程可能会要求输入邮箱验证码，这时复用注册时的收信逻辑：

```text
https://mail.chatgpt.org.uk/{email}
```

处理流程：

1. 密码提交后，判断是否进入验证码页面。
2. 如果需要验证码，按邮箱拼出收信页面地址。
3. 等待验证码邮件出现。
4. 提取验证码。
5. 回到登录页面填写验证码。
6. 再判断是否登录成功。

建议复用现有注册验证码代码，不要重新写一套完全独立的收信逻辑。

验证码登录失败时的处理：

| 情况 | 处理方式 |
|---|---|
| 验证码邮件超时 | 标记为 `remove_pending` |
| 验证码错误 | 标记为 `remove_pending` |
| 收信页面打不开 | 标记为 `remove_pending` |
| 收到验证码并登录成功 | 保持 `active` |

原因：

```text
账号池只保留明确能登录成功的账号。
验证码流程走不通，也不能算可用账号。
```

明确失效的情况：

- 密码错误。
- 账号不存在。
- 账号被禁用。
- 页面明确提示无法登录。
- 页面明确出现 `account_deactivated`。

这些情况也标记为待删除：

- 网络超时。
- 页面加载失败。
- 验证码邮件获取失败。
- 验证码提交失败。
- 临时风控。
- 登录页结构变化。
- 页面只提示会话过期。

原因：

```text
目标是只保留明确能登录的账号。
不确定的账号也不保留，用重新补号来降低复杂度。
```

补齐时只统计：

```text
status === "active"
```

所以只要检查没有得到明确登录成功，就会让有效账号数量下降，并触发补齐。

### 标记清理策略

一轮检查分成三个阶段：

1. 标记阶段：
   - 每 30 分钟开始。
   - 依次检查当前账号池里最多 10 个 `active` 账号。
   - 能登录的继续保持 `active`。
   - 不能明确登录成功的先标记为 `remove_pending`。

2. 清理阶段：
   - 本轮账号全部检查完后开始。
   - 从 SQLite 里统一删除 `remove_pending` 账号。
   - 日志记录移除了哪些账号和原因。

3. 补齐阶段：
   - 重新统计 `active` 数量。
   - 少几个就注册几个。
   - 注册成功的账号写入 SQLite，状态为 `active`。

### 检查隔离策略

每次检查账号都使用新的浏览器上下文。

原因：

- 避免不同账号之间串登录状态。
- 检查完成后立即关闭上下文。
- 不复用上一个账号的 cookie、localStorage 或页面缓存。

### 补齐失败策略

补齐账号时不要无限重试。

建议：

- 单轮最多尝试 `maxRegisterAttemptsPerRound` 次。
- 如果一轮没有补齐，等待下一轮定时任务再继续。
- 避免服务器长时间卡在注册流程里。

## 已观察到的失效页面结构

以下结论来自本地保存的两个页面文件：

```text
C:\Users\asus\Downloads\ChatGPT.html
C:\Users\asus\Downloads\Oops, an error occurred! - OpenAI.html
```

### 会话过期页面

页面地址：

```text
https://chatgpt.com/
```

页面里有完整的 ChatGPT 主界面，但中央弹出登录过期弹窗。

关键结构：

```html
<div id="modal-expired-session"
     data-testid="modal-expired-session"
     data-ignore-for-page-load="true">
  <div role="dialog" data-state="open">
    <h2>Your session has expired</h2>
    <div>Please log in again to continue using the app.</div>
    <button>Log in</button>
  </div>
</div>
```

判断关键词：

```text
modal-expired-session
Your session has expired
Please log in again to continue using the app.
```

处理方式：

```text
不保留。
直接从 SQLite 删除。
```

原因：

```text
这个页面只说明当前浏览器登录态过期，不代表账号本身失效。
```

### 账号停用页面

页面地址：

```text
https://auth.openai.com/email-verification
```

页面标题：

```text
Oops, an error occurred! - OpenAI
```

关键结构：

```html
<h1>
  <span>Oops, an error occurred!</span>
</h1>

<div>
  An error occurred during authentication (account_deactivated). Please try again.
</div>

<button data-dd-action-name="Try again">Try again</button>
```

判断关键词：

```text
account_deactivated
An error occurred during authentication
Oops, an error occurred!
```

处理方式：

```text
可以直接判定为失效。
从 SQLite 里删除。
日志里记录 failReason = account_deactivated。
```

原因：

```text
account_deactivated 是明确账号停用信号，不是网络波动或普通登录态过期。
```

### 建议判断优先级

登录检查时按下面顺序判断：

1. 页面正文包含 `account_deactivated`。
   - 结果：直接移除账号
   - 原因：账号已停用。

2. 页面标题或正文包含 `Oops, an error occurred!`，同时正文包含 `authentication` 和 `account_deactivated`。
   - 结果：直接移除账号
   - 原因：账号认证时被判定停用。

3. 页面包含 `modal-expired-session` 或 `Your session has expired`。
   - 结果：直接移除账号
   - 原因：没有明确登录成功。

4. 页面出现验证码、Cloudflare、网络超时、页面加载异常。
   - 结果：直接移除账号
   - 原因：没有明确登录成功。

5. 登录流程返回成功。
   - 结果：`active`

## 定时轮询策略

每 30 分钟开始一轮完整检查。

每轮检查当前账号池里的 10 个 `active` 账号。

建议配置：

| 配置项 | 建议值 | 说明 |
|---|---:|---|
| checkIntervalMinutes | 30 | 每 30 分钟开始一轮检查 |
| targetAccounts | 10 | 每轮最多检查 10 个有效账号 |

每轮流程：

```text
检查 10 个 active 账号
-> 标记不能登录的账号
-> 检查完成后统一删除被标记账号
-> 按缺失数量注册补齐
-> 等待下一轮
```

## 定时任务运行方式

第一版用常驻 Node 进程。

本机开发或临时运行时直接执行：

```bash
node index.js
```

需要长期运行时再交给 systemd 管理。

### systemd 常驻服务

适合长期运行。

优点：

- 开机自动启动。
- 程序崩溃后自动拉起。
- 日志可以统一管理。

第一版不使用 cron。

原因：

- cron 容易出现上一轮没跑完，下一轮又启动的问题。
- 常驻进程自己控制 30 分钟轮询，更容易管理状态。
- 日志和锁文件也更简单。

## Debian 浏览器运行方式

注册流程在 Debian 上也建议使用有窗口模式：

```json
{
  "headless": false
}
```

这里的浏览器窗口不是给人看的，也不是人工操作入口。

它的作用只有一个：

```text
让 Chromium 按正常有窗口浏览器运行，减少 headless 触发 Cloudflare 后卡死的情况。
```

### Debian 有桌面环境

如果 Debian 本身有桌面环境，可以直接运行：

```bash
node index.js
```

### Debian 无桌面环境

如果 Debian 是纯命令行环境，使用 Xvfb 提供虚拟窗口：

```bash
xvfb-run -a node index.js
```

配置仍然保持：

```json
{
  "headless": false
}
```

正式运行不需要 VNC，也不需要人盯着浏览器。

VNC 或 noVNC 只作为排查问题时的临时调试工具，不作为第一版正式依赖。

### Cloudflare 处理原则

如果运行中出现 Cloudflare：

1. 不要长时间卡住等待。
2. 记录日志。
3. 当前注册尝试直接失败。
4. 进入下一次尝试或下一轮补齐。

程序不要把 Cloudflare 页面当成普通登录页继续找按钮，否则会出现长时间等待和误判。

## 防止重复运行

必须加锁。

原因：

如果两个进程同时运行，可能会同时判断账号不足，然后重复注册，导致数据乱掉。

建议：

- 启动时创建 `runtime/app.lock`。
- 正常退出时删除锁。
- 如果发现锁存在，先判断旧进程是否还活着。
- 如果旧进程不存在，再清理旧锁。

## 数据写入安全

SQLite 自带事务能力，账号状态更新和删除都应该放在事务里。

建议：

1. 所有账号状态变更都使用事务。
2. 一轮检查的标记和清理分成两个步骤。
3. 清理 `remove_pending` 前先写日志。
4. 定期备份数据库文件。
5. 后续前端只读查询时，不直接修改账号状态。

建议文件：

```text
data/accounts.sqlite
data/accounts.sqlite.bak
```

## 配置建议

`config.json` 建议新增这些配置：

| 配置项 | 建议值 | 说明 |
|---|---:|---|
| mode | pool | 运行模式 |
| targetAccounts | 10 | 固定账号数量 |
| headless | false | 使用有窗口模式，Debian 上通过 Xvfb 提供虚拟窗口 |
| checkIntervalMinutes | 30 | 每 30 分钟开始一轮完整检查 |
| maxRegisterAttemptsPerRound | 20 | 单轮补号最大尝试 |
| accountStorePath | data/accounts.sqlite | 账号池数据库 |
| lockFilePath | runtime/app.lock | 锁文件 |
| cloudflareFastFail | true | 发现 Cloudflare 时快速失败，不长时间卡住 |

## 日志建议

继续使用现有 `results/run.log`。

新增这些日志关键点：

- 当前有效账号数量。
- 本轮检查了哪些账号。
- 哪些账号被判定失效并移除。
- 为什么判定失效。
- 本轮需要补几个账号。
- 补号成功几个。
- 补号失败原因。
- 下一轮检查时间。

## 第一版实现步骤

### 第一步：改账号保存格式

目标：从 `emails.txt` 过渡到 SQLite。

任务：

- 注册成功后写入 `data/accounts.sqlite`。
- 保留 `emails.txt` 作为兼容输出。
- 新账号状态写成 `active`。

### 第二步：增加账号池管理

目标：知道当前有多少可用账号。

任务：

- 读取账号列表。
- 统计 `active` 数量。
- 少于 10 个时调用现有注册流程补齐。

### 第三步：增加登录检测

目标：判断账号是否还可用。

任务：

- 新增登录检测页面流程。
- 登录成功则保持 `active`。
- 没有明确登录成功则从账号池移除。

### 第四步：增加定时轮询

目标：程序长期运行。

任务：

- 启动后先补齐一次。
- 每隔固定时间检查一批账号。
- 检查完后再次判断是否需要补齐。

### 第五步：增加锁文件

目标：避免多个程序同时运行。

任务：

- 启动时检查锁。
- 退出时释放锁。
- 异常退出后能恢复。

### 第六步：部署到 Debian

目标：稳定后台运行。

任务：

- 保持 `headless: false`。
- 无桌面服务器使用 `xvfb-run -a node index.js`。
- 安装 Chromium 依赖。
- 用 systemd 管理进程。
- 设置日志目录权限。

## 风险点

| 风险 | 处理方式 |
|---|---|
| 登录页结构变化 | 登录检测单独拆文件，方便修 |
| 网络波动导致账号被删 | 接受这个取舍，用自动补齐降低复杂度 |
| 程序重复运行 | 加锁文件 |
| 账号文件损坏 | 原子写入和备份 |
| 补号连续失败 | 限制单轮最大尝试次数 |
| 服务器没有图形界面 | 使用 Xvfb 提供虚拟窗口，仍然保持 `headless: false` |
| 浏览器依赖缺失 | 使用 Playwright 安装依赖 |
| Cloudflare 页面导致卡死 | 发现后快速失败，记录日志并进入下一次尝试 |

## 最小可用版本标准

完成后应该满足：

- 启动后自动补齐到 10 个账号。
- 每隔固定时间检查账号状态。
- 失效账号会被直接移出账号池。
- 有效账号少于 10 个会自动补齐。
- 程序重启后能继续读取已有状态。
- 日志能看清每次检查和补号原因。

## 改动量评估

整体属于中等改动。

不用重写注册流程，但要新增账号池和登录检查。

预计改动重点：

| 模块 | 改动量 |
|---|---|
| 注册流程复用 | 小 |
| 账号保存格式 | 中 |
| 登录检测流程 | 中到偏大 |
| 定时任务 | 中 |
| Debian 部署 | 小 |
| 日志和异常处理 | 中 |

建议分两版做：

### 第一版

- 固定维护 10 个账号。
- 支持账号状态保存。
- 支持自动登录检测。
- 支持自动补齐。
- 没有明确登录成功的账号直接移除。
- 加定时轮询。
- 加锁文件和备份。

### 第二版

- 增加 Fastify API。
- 增加 Vue 管理页面。
- 优化日志轮转。
- 视情况增加更完整的运行状态展示。
