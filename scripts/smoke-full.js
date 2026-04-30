// 完整集成烟雾测试：起 Express + 静态托管，验证前端 dist 和 API 都通
const path = require('path');
const winston = require('winston');
const { getDatabase } = require('../src/db');
const { AccountStore } = require('../src/services/account-store');
const { startApiServer } = require('../src/api/server');

const PROJECT_ROOT = path.resolve(__dirname, '..');

async function main() {
  const logger = winston.createLogger({
    transports: [new winston.transports.Console({ format: winston.format.simple() })],
  });

  const config = require(path.join(PROJECT_ROOT, 'config.json'));
  const db = getDatabase(path.join(PROJECT_ROOT, 'data', 'accounts.sqlite'));
  const store = new AccountStore(db);

  const controller = {
    triggerRound: async () => ({ ok: true, dryRun: true }),
    triggerReplenish: async () => ({ ok: true, dryRun: true }),
    isBusy: () => false,
    getBusyType: () => null,
  };

  const server = await startApiServer({
    store, config, logger, controller, projectRoot: PROJECT_ROOT,
    host: '127.0.0.1', port: 3002,
  });

  const base = 'http://127.0.0.1:3002';
  const tests = [
    { method: 'GET', url: `${base}/`, expectContent: 'index' },
    { method: 'GET', url: `${base}/dashboard`, expectContent: 'index' },
    { method: 'GET', url: `${base}/api/stats` },
    { method: 'GET', url: `${base}/api/accounts` },
  ];

  let pass = 0;
  let fail = 0;
  for (const t of tests) {
    const res = await fetch(t.url, { method: t.method });
    const text = await res.text();
    const status = res.status === 200 ? 'PASS' : 'FAIL';
    if (res.status === 200) pass++; else fail++;
    console.log(`${status} ${t.method} ${t.url} -> ${res.status} (${text.length} bytes)`);
  }

  console.log(`\n${pass} pass, ${fail} fail`);

  await new Promise((resolve) => server.close(resolve));
  db.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
