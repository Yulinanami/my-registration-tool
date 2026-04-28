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

如需安装 Playwright 浏览器：

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
  "chromePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
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
| `chromePath` | 本地 Chrome 路径 | 系统默认路径 |

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
