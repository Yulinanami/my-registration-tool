// POST /api/actions/round — 手动触发一轮 (检查 + 清理 + 补齐)
// POST /api/actions/replenish — 仅触发补齐
const express = require('express');

function actionsRouter({ controller, logger }) {
  const router = express.Router();

  router.post('/round', async (req, res) => {
    if (controller.isBusy()) {
      return res.status(409).json({
        error: 'busy',
        busyType: controller.getBusyType(),
      });
    }
    // 后台跑，立即返回 (任务可能跑很久)
    controller
      .triggerRound()
      .then((stats) => logger.info(`[API] 手动 round 完成: ${JSON.stringify(stats)}`))
      .catch((e) => logger.error(`[API] 手动 round 失败: ${e.message}`));
    res.json({ ok: true, accepted: true, kind: 'round' });
  });

  router.post('/replenish', async (req, res) => {
    if (controller.isBusy()) {
      return res.status(409).json({
        error: 'busy',
        busyType: controller.getBusyType(),
      });
    }
    controller
      .triggerReplenish()
      .then((stats) => logger.info(`[API] 手动 replenish 完成: ${JSON.stringify(stats)}`))
      .catch((e) => logger.error(`[API] 手动 replenish 失败: ${e.message}`));
    res.json({ ok: true, accepted: true, kind: 'replenish' });
  });

  return router;
}

module.exports = { actionsRouter };
