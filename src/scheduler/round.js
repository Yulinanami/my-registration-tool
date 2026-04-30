// 单轮检查：标记 -> 清理 -> 补齐
const { checkAccounts } = require('../services/account-checker');
const { replenish } = require('../services/account-pool');

async function runRound({ store, config, logger, getBrowser }) {
  logger.info('\n========== 开始新一轮检查 ==========');

  // 标记阶段
  const accounts = store.listActive();
  logger.info(`[Round] 当前 active 账号: ${accounts.length}`);

  let checkStats = { kept: 0, marked: 0 };
  if (accounts.length > 0) {
    checkStats = await checkAccounts({ accounts, store, getBrowser, config, logger });
    logger.info(`[Round] 检查完成: 保留 ${checkStats.kept}, 标记 ${checkStats.marked}`);
  } else {
    logger.info('[Round] 暂无 active 账号，跳过检查阶段');
  }

  // 清理阶段
  const removed = store.purgeRemovePending();
  if (removed.length > 0) {
    logger.info(`[Round] 清理 ${removed.length} 个失效账号:`);
    for (const acc of removed) {
      logger.info(`  - ${acc.email} (reason=${acc.failReason})`);
    }
  }

  // 补齐阶段
  const replenishStats = await replenish({ store, config, logger, getBrowser });

  logger.info(
    `========== 本轮结束 (检查 ${accounts.length}, 保留 ${checkStats.kept}, ` +
    `移除 ${removed.length}, 新增 ${replenishStats.added}) ==========\n`
  );

  return { checked: accounts.length, ...checkStats, removed: removed.length, ...replenishStats };
}

module.exports = { runRound };
