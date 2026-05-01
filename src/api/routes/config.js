// GET /api/config — 读取当前 config.json
// PUT /api/config — 写入 config.json (需要重启生效)
const express = require('express');
const fs = require('fs');
const path = require('path');

const ALLOWED_KEYS = new Set([
  'password',
  'headless',
  'accountStorePath',
  'lockFilePath',
  'targetAccounts',
  'checkIntervalMinutes',
  'replenishDelayMs',
  'mailPollIntervalMs',
  'mailPollTimeoutMs',
  'maxRetries',
  'typingDelayMin',
  'typingDelayMax',
  'retryDelayMin',
  'retryDelayMax',
  'statusCheckIntervalMs',
  'signUpButtonTimeoutMs',
  'signUpClickCheckMs',
  'registrationStatusTimeoutMs',
  'cloudflareCheckIntervalMs',
  'cloudflareMaxWaitMs',
  'mailPageTimeoutMs',
  'mailEmailTimeoutMs',
  'mailEmailCheckIntervalMs',
  'mailRefreshWaitMs',
  'mailDetailTimeoutMs',
  'mailDetailRetryCount',
  'mailDetailRetryDelayMs',
  'popupCloseDelayMs',
  'passwordInputTimeoutMs',
  'fullName',
  'firstName',
  'lastName',
  'birthdayText',
  'birthdayDate',
  'age',
  'chromiumPath',
  'browserPath',
  'chromePath',
]);

function configRouter({ projectRoot, logger }) {
  const router = express.Router();
  const configPath = path.join(projectRoot, 'config.json');

  router.get('/', (req, res) => {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      // 屏蔽登录凭证 (auth 字段不允许通过 API 读出/写入)
      if (parsed.auth) delete parsed.auth;
      res.json({ config: parsed, path: configPath });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/', (req, res) => {
    const incoming = req.body || {};
    const filtered = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (ALLOWED_KEYS.has(key)) {
        filtered[key] = value;
      }
    }
    if (Object.keys(filtered).length === 0) {
      return res.status(400).json({ error: 'no_valid_keys' });
    }

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const current = JSON.parse(raw);
      const next = { ...current, ...filtered };
      fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
      logger.info(`[API] 配置已更新: ${Object.keys(filtered).join(', ')} (重启生效)`);
      res.json({ ok: true, updated: filtered, restartRequired: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { configRouter };
