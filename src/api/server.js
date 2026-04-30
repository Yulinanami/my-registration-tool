// Express HTTP 服务器
const express = require('express');
const path = require('path');
const fs = require('fs');
const { statsRouter } = require('./routes/stats');
const { accountsRouter } = require('./routes/accounts');
const { logsRouter } = require('./routes/logs');
const { configRouter } = require('./routes/config');
const { actionsRouter } = require('./routes/actions');

function createApp({ store, config, logger, controller, projectRoot }) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // 开发环境下允许跨域 (Vite dev server 在另一个端口)
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use('/api/stats', statsRouter({ store, config }));
  app.use('/api/accounts', accountsRouter({ store, logger }));
  app.use('/api/logs', logsRouter({ projectRoot }));
  app.use('/api/config', configRouter({ projectRoot, logger }));
  app.use('/api/actions', actionsRouter({ controller, logger }));

  // 静态托管前端构建产物 (生产模式)
  const webDist = path.join(projectRoot, 'web', 'dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    // SPA fallback
    app.get(/^\/(?!api).*/, (req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => {
      res.type('text/plain').send(
        '前端尚未构建 (web/dist 不存在)。\n' +
        '开发模式：在 web/ 下跑 `npm run dev`\n' +
        '生产模式：在 web/ 下跑 `npm run build`'
      );
    });
  }

  return app;
}

function startApiServer({ store, config, logger, controller, projectRoot, port = 3000, host = '127.0.0.1' }) {
  const app = createApp({ store, config, logger, controller, projectRoot });
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      logger.info(`[API] HTTP 服务监听 http://${host}:${port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

module.exports = { createApp, startApiServer };
