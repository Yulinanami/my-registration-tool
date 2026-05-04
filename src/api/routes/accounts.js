// GET /api/accounts — 列表
// POST /api/accounts/:id/used — 标记邮箱已使用
// DELETE /api/accounts/:id — 删除账号
const express = require('express');

function accountsRouter({ store, logger }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ accounts: store.listAll() });
  });

  router.post('/:id/used', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'invalid_id' });
    }
    const account = store.findById(id);
    if (!account) {
      return res.status(404).json({ error: 'not_found' });
    }
    const updated = store.markUsed(id);
    logger.info(`[API] 标记邮箱已使用 id=${id}, email=${account.email}`);
    res.json({ ok: true, account: updated || account });
  });

  router.delete('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'invalid_id' });
    }
    const account = store.findById(id);
    if (!account) {
      return res.status(404).json({ error: 'not_found' });
    }
    store.deleteById(id);
    logger.info(`[API] 手动删除账号 id=${id}, email=${account.email}`);
    res.json({ ok: true, deleted: account });
  });

  return router;
}

module.exports = { accountsRouter };
