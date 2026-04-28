# 自动注册工具

基于 Playwright 的账号注册辅助工具，负责获取临时邮箱、填写注册表单、等待验证邮件，并把成功账号写入 `emails.txt`。

## 功能

- 自动打开浏览器并执行注册流程。
- 自动读取临时邮箱和验证邮件。
- 支持验证链接和六位验证码。
- 浏览器断开后会重新启动。
- 运行日志写入 `results/run.log`。

## 安装

```bash
npm install
```

如需安装 Playwright Chromium 内核：

```bash
npm run install-browser
```

## 浏览器说明

程序只使用 Chromium 内核，不会使用 Firefox 或 WebKit。启动时会尽量使用用户电脑里已有的 Chromium 内核浏览器，按顺序尝试：

1. `config.json` 里的 `chromiumPath`
2. 用 `where` 查找 Chrome、Edge、Brave、Opera、Vivaldi、Chromium
3. Windows 注册表里的浏览器路径
4. 系统常见安装位置里的浏览器路径
5. Playwright 自带 Chromium

Chrome、Edge、Brave、Opera、Vivaldi 都是 Chromium 内核，所以可以直接使用，不需要额外下载内核。

如果以上方式都找不到可用内核，程序才会提示安装 Playwright Chromium 内核。安装命令：

```bash
npm run install-browser
```

## 配置

配置文件是 `config.json`：

```json
{
  "password": "qwerasdfzxcv",
  "headless": false,
  "mailPollIntervalMs": 3000,
  "mailPollTimeoutMs": 120000,
  "maxRetries": 20,
  "typingDelayMin": 15,
  "typingDelayMax": 40,
  "retryDelayMin": 800,
  "retryDelayMax": 1500,
  "statusCheckIntervalMs": 1500,
  "signUpButtonTimeoutMs": 10000,
  "registrationStatusTimeoutMs": 15000,
  "cloudflareCheckIntervalMs": 1000,
  "cloudflareMaxWaitMs": 30000,
  "mailPageTimeoutMs": 30000,
  "mailEmailTimeoutMs": 15000,
  "mailEmailCheckIntervalMs": 1000,
  "mailRefreshWaitMs": 800,
  "mailDetailTimeoutMs": 5000,
  "mailDetailRetryCount": 3,
  "mailDetailRetryDelayMs": 1000,
  "popupCloseDelayMs": 200,
  "passwordInputTimeoutMs": 20000,
  "fullName": "John Doe",
  "firstName": "John",
  "lastName": "Doe",
  "birthdayText": "01/15/2000",
  "birthdayDate": "2000-01-15",
  "age": "25",
  "chromiumPath": "C:\\Program Files\\Chromium\\Application\\chrome.exe"
}
```

| 参数名 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `password` | 注册时使用的密码 | `qwerasdfzxcv` |
| `headless` | 是否隐藏浏览器窗口 | `false` |
| `maxRetries` | 最多尝试次数 | `20` |
| `typingDelayMin` / `typingDelayMax` | 每个字的输入间隔 | `15` / `40` |
| `retryDelayMin` / `retryDelayMax` | 失败重试前的等待 | `800` / `1500` |
| `statusCheckIntervalMs` | 检查注册结果的间隔 | `1500` |
| `signUpButtonTimeoutMs` | 等待注册入口打开的上限 | `10000` |
| `registrationStatusTimeoutMs` | 提交密码后等待结果的上限 | `15000` |
| `cloudflareCheckIntervalMs` / `cloudflareMaxWaitMs` | 等待页面保护的间隔和上限 | `1000` / `30000` |
| `mailPollIntervalMs` / `mailPollTimeoutMs` | 查看验证邮件的间隔和上限 | `3000` / `120000` |
| `mailPageTimeoutMs` / `mailEmailTimeoutMs` | 邮箱页面和邮箱地址等待上限 | `30000` / `15000` |
| `mailRefreshWaitMs` / `mailDetailTimeoutMs` | 邮箱刷新和读取详情等待 | `800` / `5000` |
| `mailDetailRetryCount` / `mailDetailRetryDelayMs` | 邮件正文没加载出来时的重试 | `3` / `1000` |
| `popupCloseDelayMs` | 关闭弹窗后的等待 | `200` |
| `passwordInputTimeoutMs` | 等待密码框的上限 | `20000` |
| `fullName` | 自动填写的完整姓名 | `John Doe` |
| `firstName` / `lastName` | 没有 `fullName` 时拼成姓名 | `John` / `Doe` |
| `birthdayText` / `birthdayDate` | 文本生日和日期框生日 | `01/15/2000` / `2000-01-15` |
| `age` | 自动填写的年龄 | `25` |
| `chromiumPath` | 自定义 Chromium 路径，可不填 | 自动查找 |

## 运行

交互输入数量：

```bash
npm start
```

直接指定数量：

```bash
node index.js 3
```

## 项目结构

- `index.js`: 程序入口和整体流程。
- `src/registrar.js`: 注册页面处理。
- `src/scraper.js`: 临时邮箱页面处理。
- `src/parser.js`: 验证邮件内容读取。
- `config.json`: 运行配置。
- `emails.txt`: 成功账号输出。
- `results/run.log`: 运行日志。
