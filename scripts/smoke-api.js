// 临时烟雾测试：脱离浏览器和调度器，单独验证 Express 路由
const path = require('path');
const winston = require('winston');
const { getDatabase } = require('../src/db');
const { AccountStore } = require('../src/services/account-store');
const { startApiServer } = require('../src/api/server');
const runtimeState = require('../src/api/runtime-state');

const PROJECT_ROOT = path.resolve(__dirname, '..');

async function main() {
  const logger = winston.createLogger({
    transports: [new winston.transports.Console({ format: winston.format.simple() })],
  });

  const db = getDatabase(path.join(PROJECT_ROOT, 'data', 'accounts.sqlite'));
  const store = new AccountStore(db);
  const config = require(path.join(PROJECT_ROOT, 'config.json'));

  // mock controller
  const controller = {
    triggerRound: async () => ({ ok: true, dryRun: true }),
    triggerReplenish: async () => ({ ok: true, dryRun: true }),
    isBusy: () => false,
    getBusyType: () => null,
  };

  runtimeState.setStarted();

  const server = await startApiServer({
    store, config, logger, controller, projectRoot: PROJECT_ROOT,
    host: '127.0.0.1', port: 3001,
  });

  const base = 'http://127.0.0.1:3001';

  // 先登录拿 token
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: config.auth?.username || 'admin',
      password: config.auth?.password,
    }),
  });
  const loginJson = await loginRes.json();
  console.log(`POST /api/auth/login -> ${loginRes.status} (token: ${loginJson.token ? 'received' : 'missing'})`);
  const authHeader = loginJson.token ? { Authorization: `Bearer ${loginJson.token}` } : {};

  const tests = [
    { method: 'GET', url: `${base}/api/stats` },
    { method: 'GET', url: `${base}/api/accounts` },
    { method: 'GET', url: `${base}/api/logs?lines=5` },
    { method: 'GET', url: `${base}/api/config` },
    { method: 'POST', url: `${base}/api/actions/round` },
  ];

  for (const t of tests) {
    const res = await fetch(t.url, { method: t.method, headers: authHeader });
    const text = await res.text();
    console.log(`${t.method} ${t.url} -> ${res.status} ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
  }

  // 再测一遍：不带 token 应该 401
  const unauth = await fetch(`${base}/api/stats`);
  console.log(`GET /api/stats (no token) -> ${unauth.status} (期望 401)`);

  await new Promise((resolve) => server.close(resolve));
  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
