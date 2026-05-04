// GET /api/config — 读取当前 config.json (auth.password 屏蔽)
// PUT /api/config — 写入 config.json，立即触发重启
const express = require('express');
const fs = require('fs');
const path = require('path');

function configRouter({ projectRoot, logger, controller }) {
  const router = express.Router();
  const configPath = path.join(projectRoot, 'config.json');

  router.get('/', (req, res) => {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      // 屏蔽 auth.password，避免明文回传
      if (parsed.auth && typeof parsed.auth === 'object') {
        parsed.auth = { ...parsed.auth, password: '' };
      }
      res.json({ config: parsed, path: configPath });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/', (req, res) => {
    const incoming = req.body || {};
    if (typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'invalid_body' });
    }

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const current = JSON.parse(raw);

      // 合并：默认全字段透传 (浅合并)
      const next = { ...current, ...incoming };

      // 单独处理 auth：保护 username/password 不被空值/占位符覆盖
      if (incoming.auth && typeof incoming.auth === 'object') {
        const mergedAuth = { ...(current.auth || {}) };
        if (typeof incoming.auth.username === 'string' && incoming.auth.username.trim()) {
          mergedAuth.username = incoming.auth.username.trim();
        }
        if (
          typeof incoming.auth.password === 'string' &&
          incoming.auth.password
        ) {
          mergedAuth.password = incoming.auth.password;
        }
        next.auth = mergedAuth;
      }

      fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
      const changedKeys = Object.keys(incoming).filter((k) => k !== 'auth' || incoming.auth);
      logger.info(`[API] 配置已更新: ${changedKeys.join(', ')}`);

      // 先把响应发回去，再触发立即重启，避免打断前端保存请求
      const canRestart = controller && typeof controller.requestRestart === 'function';
      if (canRestart) {
        res.once('finish', () => {
          controller.requestRestart();
        });
      }
      res.json({ ok: true, restarting: !!canRestart, changedKeys });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { configRouter };
