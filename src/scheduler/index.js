// 定时调度：每 N 分钟跑一轮
const { runRound } = require('./round');

// 启动后立即跑一轮，再按间隔循环
async function startScheduler({ store, config, logger, getBrowser, shouldStop }) {
  const intervalMs = (config.checkIntervalMinutes || 30) * 60 * 1000;

  while (!shouldStop()) {
    const startedAt = Date.now();
    try {
      await runRound({ store, config, logger, getBrowser });
    } catch (e) {
      logger.error(`[Scheduler] 本轮异常: ${e.message}`);
      logger.error(e.stack);
    }

    if (shouldStop()) break;

    const elapsed = Date.now() - startedAt;
    const sleepMs = Math.max(intervalMs - elapsed, 0);
    const nextAt = new Date(Date.now() + sleepMs).toLocaleString();
    logger.info(`[Scheduler] 下一轮预计 ${nextAt} 开始 (等待 ${Math.round(sleepMs / 1000)}s)`);
    await sleepUntil(sleepMs, shouldStop);
  }

  logger.info('[Scheduler] 收到停止信号，调度结束');
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
