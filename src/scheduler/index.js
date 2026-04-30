// 定时调度：每 N 分钟跑一轮 + 暴露手动触发接口
const { runRound } = require('./round');
const { replenish } = require('../services/account-pool');
const runtimeState = require('../api/runtime-state');

// 启动调度器，返回主循环 Promise 和供 API 调用的 controller
function startScheduler({ store, config, logger, getBrowser, shouldStop }) {
  const intervalMs = (config.checkIntervalMinutes || 30) * 60 * 1000;
  runtimeState.setStarted();

  // 全局互斥：同时只能一个 round 或 replenish 在跑
  let busy = null;

  async function tryRunExclusive(name, fn) {
    if (busy) {
      const err = new Error(`scheduler_busy:${busy}`);
      err.code = 'BUSY';
      err.busyType = busy;
      throw err;
    }
    busy = name;
    try {
      return await fn();
    } finally {
      busy = null;
    }
  }

  async function doRound() {
    runtimeState.setRoundStart();
    try {
      const stats = await runRound({ store, config, logger, getBrowser });
      runtimeState.setRoundEnd(stats);
      return stats;
    } catch (e) {
      runtimeState.setRoundEnd({ error: e.message });
      throw e;
    }
  }

  // 暴露给 API 用
  const controller = {
    triggerRound: () =>
      tryRunExclusive('manual-round', () => {
        logger.info('[Scheduler] 收到手动触发：检查 + 清理 + 补齐');
        return doRound();
      }),
    triggerReplenish: () =>
      tryRunExclusive('manual-replenish', () => {
        logger.info('[Scheduler] 收到手动触发：仅补齐');
        return replenish({ store, config, logger, getBrowser });
      }),
    isBusy: () => !!busy,
    getBusyType: () => busy,
  };

  // 主循环
  const mainLoopPromise = (async () => {
    while (!shouldStop()) {
      const startedAt = Date.now();
      try {
        await tryRunExclusive('auto-round', doRound);
      } catch (e) {
        if (e.code === 'BUSY') {
          logger.warn(`[Scheduler] 自动轮跳过：手动任务正在执行 (${e.busyType})`);
        } else {
          logger.error(`[Scheduler] 本轮异常: ${e.message}`);
          logger.error(e.stack);
        }
      }

      if (shouldStop()) break;

      const elapsed = Date.now() - startedAt;
      const sleepMs = Math.max(intervalMs - elapsed, 0);
      const nextAt = Date.now() + sleepMs;
      runtimeState.setNextRoundAt(nextAt);
      logger.info(`[Scheduler] 下一轮预计 ${new Date(nextAt).toLocaleString()} 开始 (等待 ${Math.round(sleepMs / 1000)}s)`);
      await sleepUntil(sleepMs, shouldStop);
    }
    logger.info('[Scheduler] 收到停止信号，调度结束');
  })();

  return { mainLoopPromise, controller };
}

// 可中断的 sleep
function sleepUntil(totalMs, shouldStop) {
  return new Promise((resolve) => {
    const stepMs = 1000;
    const deadline = Date.now() + totalMs;
    const tick = () => {
      if (shouldStop() || Date.now() >= deadline) {
        resolve();
        return;
      }
      setTimeout(tick, Math.min(stepMs, Math.max(deadline - Date.now(), 0)));
    };
    tick();
  });
}

module.exports = { startScheduler };
