// 单次注册流程：获取邮箱 -> 注册 -> 处理验证 -> 写入 SQLite
const { MailScraper } = require('../scraper');
const { Registrar, RegisterResult } = require('../registrar');

async function registerOne(browser, config, logger, attemptNum, store) {
  logger.info(`\n${'='.repeat(60)}`);
  logger.info(`开始第 ${attemptNum} 次尝试注册`);
  logger.info('='.repeat(60));

  const mailContext = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1280, height: 720 },
  });

  const scraper = new MailScraper(mailContext, logger, config);
  let email = null;
  let success = false;

  try {
    email = await scraper.init();
    if (!email) {
      logger.error('无法获取邮箱');
      return false;
    }
    logger.info(`获取到临时邮箱: ${email}`);

    let siteContext = null;
    let registrar = null;

    try {
      siteContext = await browser.newContext({
        locale: 'en-US',
        viewport: { width: 1280, height: 720 },
      });

      registrar = new Registrar(siteContext, config, logger);

      const regResult = await registrar.register(email);
      logger.info(`注册结果: ${regResult.result} - ${regResult.message}`);

      if (regResult.result === RegisterResult.NEED_VERIFICATION) {
        logger.info('等待验证邮件...');
        const emailData = await scraper.waitForVerificationEmail(
          config.mailPollIntervalMs,
          config.mailPollTimeoutMs
        );

        if (emailData) {
          logger.info(`收到验证邮件: ${emailData.subject || '(无标题)'}`);
          const verifyResult = await registrar.handleVerification(emailData);
          logger.info(`验证结果: ${verifyResult.result} - ${verifyResult.message}`);

          if (verifyResult.result === RegisterResult.SUCCESS) {
            success = true;
          }
        } else {
          logger.warn('验证邮件等待超时');
        }
      } else if (regResult.result === RegisterResult.SUCCESS) {
        success = true;
      }
    } finally {
      if (registrar) {
        try { await registrar.close(); } catch (e) {}
      }
      if (siteContext) {
        try { await siteContext.close(); } catch (e) {}
      }
    }

    if (success) {
      logger.info(`\n注册成功，邮箱: ${email}, 密码: ${config.password}`);
      try {
        const id = store.insertActive({ email, password: config.password, registerAttempt: attemptNum });
        logger.info(`已写入 SQLite，账号 id=${id}`);
      } catch (e) {
        logger.error(`写入 SQLite 失败: ${e.message}`);
      }
    }

    return success;
  } catch (error) {
    logger.error(`注册过程异常: ${error.message}`);
    return false;
  } finally {
    try { await scraper.close(); } catch (e) {}
    try { await mailContext.close(); } catch (e) {}
  }
}

module.exports = { registerOne };
