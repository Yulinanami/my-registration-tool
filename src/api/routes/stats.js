// GET /api/stats — 仪表板数据
const express = require('express');
const runtimeState = require('../runtime-state');

function statsRouter({ store, config }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const state = runtimeState.snapshot();
    const activeCount = store.countActive();
    const totalCount = store.listAll().length;
    res.json({
      target: config.targetAccounts,
      activeCount,
      totalCount,
      checkIntervalMinutes: config.checkIntervalMinutes,
      startedAt: state.startedAt,
      lastRoundStartedAt: state.lastRoundStartedAt,
      lastRoundEndedAt: state.lastRoundEndedAt,
      lastRoundStats: state.lastRoundStats,
      nextRoundAt: state.nextRoundAt,
      roundInProgress: state.roundInProgress,
      now: Date.now(),
    });
  });

  return router;
}

module.exports = { statsRouter };
