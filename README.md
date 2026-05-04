# 账号池守护工具

基于 Playwright 的账号池守护进程：自动注册、定时轮询登录检测、失效剔除、自动补齐，并附带带登录鉴权的 Web 管理界面。

## 功能

- **账号池守护**：常驻进程持续把可用账号维持到目标数量
- **定时轮询**：每隔可配置的间隔登录每个账号验证可用性，失效自动从池中删除
- **自动补齐**：池子不足时自动注册新账号补满
- **Web 管理界面**：仪表板、账号列表、运行日志、配置编辑、手动触发
- **登录鉴权**：固定账号密码 + 进程内 token，避免泄露
- **单实例锁**：lock 文件 + PID 校验，防止重复启动
- **优雅退出**：SIGINT/SIGTERM 收到后等当前任务结束再退出

## 技术栈

- 后端：Node.js + Playwright + Express 5 + better-sqlite3 + winston
- 前端：Vue 3 + TypeScript + Vite + Naive UI + Pinia 风格的 axios 客户端

## 安装

```bash
# 后端依赖
npm install

# 前端依赖
cd web && npm install && cd ..
```

如系统里没有 Chromium 内核，可让 Playwright 装一个：

```bash
npm run install-browser
```

启动时会按下面顺序找可用 Chromium 内核：

1. `config.json` 里的 `chromiumPath`
2. 用 `where` / `which` 查找 Chrome、Edge、Brave、Opera、Vivaldi、Chromium
3. Windows 注册表里的浏览器路径
4. 系统常见安装位置
5. Playwright 自带 Chromium

## 配置

配置文件 `config.json`，常用字段：

| 字段 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `password` | 注册新账号时使用的密码 | `qwerasdfzxcv` |
| `headless` | 是否隐藏浏览器窗口 | `false` |
| `accountStorePath` | SQLite 数据库路径 | `data/accounts.sqlite` |
| `lockFilePath` | 单实例锁文件路径 | `runtime/app.lock` |
| `apiHost` / `apiPort` | HTTP 服务监听地址和端口 | `127.0.0.1` / `3000` |
| `auth.username` / `auth.password` | Web 管理界面登录账号密码 | `admin` / 强随机密码 |
| `targetAccounts` | 池子要维持的账号数量 | `10` |
| `checkIntervalMinutes` | 轮询检查间隔（分钟） | `30` |
| `maxRetries` | 单轮注册失败上限 | `20` |
| `replenishDelayMs` | 注册之间的间隔 | `3000` |

其余字段（输入延迟、超时、邮箱页相关）见 `config.json`，一般无需调整。

> **重要**：`auth.password` 不会通过 `/api/config` 明文返回；可在前端配置页修改，保存后自动重启生效。

## 本机启动

```bash
npm run web:build
npm start
```

访问 `http://127.0.0.1:3000`

保存配置后的自动重启由 `index.js` 内置守护逻辑处理。

---

## 部署到 Linux 服务器

### 0. 环境检查

```bash
# 更新源
sudo apt update
```

```bash
# 检查必要环境
command -v git >/dev/null 2>&1 || sudo apt install -y git
command -v curl >/dev/null 2>&1 || sudo apt install -y curl ca-certificates

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi

git --version
node -v
npm -v
```

### 1. 克隆项目

```bash
cd ~
git clone https://github.com/Yulinanami/my-registration-tool
cd my-registration-tool
```

### 2. 安装依赖

```bash
sudo apt install -y build-essential python3 make g++ xvfb nginx openssl libnspr4 libnss3
npm install
cd web && npm install && cd ..
sudo npx playwright install-deps chromium
npm run install-browser
npm run web:build
```

### 3. 配置 `config.json`

编辑 `config.json`，至少确认：

```bash
nano ~/my-registration-tool/config.json
```

```json
{
  "headless": false,
  "apiHost": "127.0.0.1",
  "apiPort": 3000,
  "auth": {
    "username": "admin",
    "password": "<强密码>"
  }
}
```

`password` 请改成你自己的强密码。

### 4. 配置 systemd

```bash
sudo tee /etc/systemd/system/my-registration-tool.service >/dev/null <<'EOF'
[Unit]
Description=My Registration Tool
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<SSH用户名>
WorkingDirectory=/home/<SSH用户名>/my-registration-tool
Environment=NODE_ENV=production
ExecStart=/usr/bin/xvfb-run -a /usr/bin/npm start
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable my-registration-tool
sudo systemctl restart my-registration-tool
```

### 5. 配置 Nginx

```bash
sudo tee /etc/nginx/sites-available/my-registration-tool >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name <域名>;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
        proxy_send_timeout 300;
    }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/my-registration-tool /etc/nginx/sites-enabled/my-registration-tool
sudo nginx -t
sudo systemctl reload nginx
```

把 `<域名>` 的 A 记录指向这台 VPS 的 IP；如果你用了 Cloudflare，先把代理关掉（灰云）再签证书。

### 6. 申请 HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <域名> -n --agree-tos --register-unsafely-without-email --redirect
```

## 项目结构

```
.
├── index.js                      主进程逻辑
├── config.json                   运行配置
├── src/
│   ├── api/                      HTTP 服务
│   │   ├── server.js             Express 装配
│   │   ├── auth.js               登录鉴权 + 中间件
│   │   ├── runtime-state.js      运行时状态（轮次时间等）
│   │   └── routes/               业务路由
│   ├── db/                       SQLite (better-sqlite3)
│   ├── scheduler/                调度器（轮询 + 补齐）
│   ├── services/                 账号存储、注册、检查、补齐、锁
│   ├── pages/                    Playwright 页面对象
│   ├── registrar.js              注册流程
│   ├── scraper.js                临时邮箱
│   └── parser.js                 验证邮件解析
├── web/                          前端 (Vue 3 + TS)
│   ├── src/
│   │   ├── App.vue
│   │   ├── router.ts
│   │   ├── api/                  axios 客户端 + 类型
│   │   ├── views/                登录、仪表板、账号、日志、配置
│   │   └── utils/
│   └── vite.config.ts
├── data/                         SQLite 数据库（.gitignore）
├── runtime/                      锁文件（.gitignore）
└── results/run.log               运行日志（.gitignore）
```
