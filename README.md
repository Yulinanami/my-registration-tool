# 自动注册工具

一款基于 Playwright 的高自动化账号注册辅助工具，集成了临时邮箱获取、自动注册流程模拟及验证邮件智能轮询功能。

---

## 核心特性

- **智能浏览器管理**：自动检测系统环境，优先调用本地 Chrome 浏览器；若环境缺失，支持自动下载 Playwright 内核，确保“开箱即用”。
- **全自动注册链路**：从临时邮箱获取、目标网站表单填充到验证邮件提取，实现全流程自动化闭环。
- **验证邮件智能轮询**：实时监控收件箱，自动解析验证链接或 OTP 验证码，快速完成邮箱校验。
- **抗检测优化**：模拟人类输入行为（随机打字延迟、随机步进延迟），并自动处理 Cloudflare Turnstile 等常见人机挑战。
- **断线自动重连**：运行过程中若浏览器意外关闭，系统将自动触发重连机制，保证批量注册任务不中断。

---

## 环境要求

- **Node.js**: v16.0.0 或更高版本
- **依赖管理**: npm 或 yarn
- **核心库**: Playwright, Winston

---

## 快速开始

### 1. 安装依赖
在项目根目录下执行以下命令安装必要组件：
```bash
npm install
```

### 2. 配置参数
修改根目录下的 `config.json` 文件，根据您的需求调整参数：
```json
{
  "chatgptPassword": "您的预设密码",
  "headless": false,
  "maxRetries": 20,
  "mailPollTimeoutMs": 120000,
  "chromePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
}
```

### 3. 运行程序
执行主入口脚本并按照控制台提示输入需要注册的数量：
```bash
node src/index.js
```

---

## 配置项详细说明 (config.json)

| 参数名 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `chatgptPassword` | 注册时统一使用的账号密码 | `qwerasdfzxcv` |
| `headless` | 是否开启无头模式（建议调试时设为 false） | `false` |
| `mailPollIntervalMs` | 轮询验证邮件的间隔时间 (ms) | `3000` |
| `mailPollTimeoutMs` | 等待验证邮件的最大时长 (ms) | `120000` |
| `maxRetries` | 单次任务的最大重试次数 | `20` |
| `chromePath` | 指定本地 Chrome 浏览器的绝对路径 | 系统默认路径 |

---

## 项目结构

- `src/index.js`: 程序主入口，负责整体逻辑调度。
- `src/chatgpt-register.js`: ChatGPT 注册逻辑核心类。
- `src/gptmail-scraper.js`: 临时邮箱网页端爬虫与轮询模块。
- `src/mail-parser.js`: 验证邮件内容解析工具。
- `results/`: 存放运行日志 (`run.log`)。
- `emails.txt`: 注册成功后的邮箱与密码汇总文件。

---

## 注意事项

1. **IP 质量**: 注册成功率高度依赖于您的代理 IP 质量。
2. **频率限制**: 请勿短时间内发起过高频率的注册请求，建议在 `config.json` 中适当调大延迟参数。
3. **法律声明**: 本工具仅供技术研究与学习使用，请遵守相关服务条款。
