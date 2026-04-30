// 维护账号数量：读 SQLite -> 算缺口 -> 调用注册补齐
const { registerOne } = require('./registrar-runner');

// 等待固定时长
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 补齐到 targetAccounts 个 active 账号
// getBrowser: 返回当前浏览器实例的回调，调用方负责重启浏览器
async function replenish({ store, config, logger, getBrowser }) {
  const target = config.targetAccounts;
  let active = store.countActive();
  logger.info(`[Pool] 当前 active 账号: ${active}/${target}`);

  if (active >= target) {
    logger.info('[Pool] 账号数量已达标，无需补齐');
    return { added: 0, attempts: 0 };
  }

  let added = 0;
  let attempts = 0;
  while (active < target) {
    attempts++;
    const browser = await getBrowser();
    const ok = await registerOne(browser, config, logger, attempts, store);
    if (ok) {
      added++;
      active = store.countActive();
      logger.info(`[Pool] 补齐进度: ${active}/${target}`);
    } else {
      logger.warn(`[Pool] 第 ${attempts} 次注册失败`);
    }

    if (active < target) {
      await delay(config.replenishDelayMs || 3000);
    }
  }

  logger.info(`[Pool] 本轮补齐完成: 新增 ${added}, 尝试 ${attempts}`);
  return { added, attempts };
}

module.exports = { replenish };
