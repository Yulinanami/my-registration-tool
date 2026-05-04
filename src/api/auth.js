// 登录认证：固定账号密码 + 持久化 token (跨重启保留)
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const tokens = new Set();
let tokensFile = null;

const INSTANCE_ID = crypto.randomBytes(8).toString('hex');

// 启动时配置：指定 token 持久化文件
function configureAuth({ tokensPath } = {}) {
  tokensFile = tokensPath || null;
  tokens.clear();
  if (!tokensFile || !fs.existsSync(tokensFile)) return;
  try {
    const arr = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
    if (Array.isArray(arr)) {
      for (const t of arr) {
        if (typeof t === 'string') tokens.add(t);
      }
    }
  } catch (e) {}
}

function persistTokens() {
  if (!tokensFile) return;
  try {
    fs.mkdirSync(path.dirname(tokensFile), { recursive: true });
    fs.writeFileSync(tokensFile, JSON.stringify([...tokens]), 'utf-8');
  } catch (e) {}
}

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
    persistTokens();
    logger.info(`[Auth] 登录成功: ${username}`);
    res.json({ ok: true, token });
  });

  // 退出
  router.post('/logout', (req, res) => {
    const token = extractToken(req);
    if (token && tokens.delete(token)) {
      persistTokens();
    }
    res.json({ ok: true });
  });

  // 校验当前 token 是否有效 (前端进入页面时调用)
  router.get('/me', (req, res) => {
    const token = extractToken(req);
    if (token && tokens.has(token)) {
      return res.json({ ok: true, username: expectedUser, instanceId: INSTANCE_ID });
    }
    res.status(401).json({ error: 'unauthorized', instanceId: INSTANCE_ID });
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

module.exports = { authRouter, requireAuth, configureAuth };
