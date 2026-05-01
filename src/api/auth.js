// 登录认证：固定账号密码 + 内存 token
const express = require('express');
const crypto = require('crypto');

// 进程内 token 集合 (重启后失效)
const tokens = new Set();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 字符串恒定时间比较，防止时序攻击
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function authRouter({ config, logger }) {
  const router = express.Router();
  const expectedUser = (config.auth && config.auth.username) || 'admin';
  const expectedPass = config.auth && config.auth.password;

  if (!expectedPass) {
    logger.warn('[Auth] config.auth.password 未设置，登录将无法通过');
  }

  // 登录
  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'missing_credentials' });
    }
    if (!expectedPass) {
      return res.status(500).json({ error: 'auth_not_configured' });
    }

    const userOk = safeEqual(username, expectedUser);
    const passOk = safeEqual(password, expectedPass);
    if (!userOk || !passOk) {
      logger.warn(`[Auth] 登录失败: username=${username}`);
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const token = generateToken();
    tokens.add(token);
    logger.info(`[Auth] 登录成功: ${username}`);
    res.json({ ok: true, token });
  });

  // 退出
  router.post('/logout', (req, res) => {
    const token = extractToken(req);
    if (token) tokens.delete(token);
    res.json({ ok: true });
  });

  // 校验当前 token 是否有效 (前端进入页面时调用)
  router.get('/me', (req, res) => {
    const token = extractToken(req);
    if (token && tokens.has(token)) {
      return res.json({ ok: true, username: expectedUser });
    }
    res.status(401).json({ error: 'unauthorized' });
  });

  return router;
}

function extractToken(req) {
  const header = req.headers['authorization'];
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// 中间件：要求请求带有效 token
function requireAuth() {
  return (req, res, next) => {
    const token = extractToken(req);
    if (!token || !tokens.has(token)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  };
}

module.exports = { authRouter, requireAuth };
