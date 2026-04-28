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
  "typingDelayMin": 50,
  "typingDelayMax": 150,
  "chromiumPath": "C:\\Program Files\\Chromium\\Application\\chrome.exe"
}
```

| 参数名 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `password` | 注册时使用的密码 | `qwerasdfzxcv` |
| `headless` | 是否隐藏浏览器窗口 | `false` |
| `mailPollIntervalMs` | 查看验证邮件的间隔 | `3000` |
| `mailPollTimeoutMs` | 等待验证邮件的最长时间 | `120000` |
| `maxRetries` | 最多尝试次数 | `20` |
| `typingDelayMin` | 每个字最短等待时间 | `50` |
| `typingDelayMax` | 每个字最长等待时间 | `150` |
| `chromiumPath` | 自定义 Chromium 路径，可不填 | 自动查找 |

## 运行

交互输入数量：

```bash
npm start
```

直接指定数量：

```bash
node src/index.js 3
```

## 项目结构

- `src/index.js`: 程序入口和整体流程。
- `src/registrar.js`: 注册页面处理。
- `src/scraper.js`: 临时邮箱页面处理。
- `src/parser.js`: 验证邮件内容读取。
- `config.json`: 运行配置。
- `emails.txt`: 成功账号输出。
- `results/run.log`: 运行日志。
