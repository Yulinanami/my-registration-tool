// 检查账号是否还能登录
const { LoginPage, LoginResult } = require('../pages/login-page');
const { MailScraper } = require('../scraper');
const { extractVerification } = require('../parser');

const PER_ACCOUNT_TIMEOUT_MS = 90 * 1000;

// 给一个 promise 套超时
function withTimeout(promise, ms, onTimeoutMessage) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(onTimeoutMessage)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// 单账号登录检查
async function checkOne({ browser, account, config, logger }) {
  logger.info(`[Checker] 检查账号: ${account.email} (id=${account.id})`);

  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 720 },
  });

  let page = null;
  let mailContext = null;
  let scraper = null;

  try {
    return await withTimeout(
      (async () => {
        page = await context.newPage();
        const loginPage = new LoginPage(page, config, logger);
        const loginResult = await loginPage.login(account.email, account.password);
        logger.info(`[Checker] 登录初步结果: ${loginResult.result} - ${loginResult.message || ''}`);

        if (loginResult.result === LoginResult.SUCCESS) {
          return { ok: true, reason: null };
        }

        if (loginResult.result !== LoginResult.NEED_OTP) {
          return { ok: false, reason: loginResult.result };
        }

        // 需要 OTP，去收信页拿验证码
        mailContext = await browser.newContext({
          locale: 'zh-CN',
          viewport: { width: 1280, height: 720 },
        });
        scraper = new MailScraper(mailContext, logger, config);

        const mailPage = await mailContext.newPage();
        const mailUrl = `https://mail.chatgpt.org.uk/${encodeURIComponent(account.email)}`;
        try {
          await mailPage.goto(mailUrl, {
            waitUntil: 'domcontentloaded',
            timeout: config.mailPageTimeoutMs,
          });
        } catch (e) {
          logger.warn(`[Checker] 打开收信页失败: ${e.message}`);
          return { ok: false, reason: 'mail_page_unreachable' };
        }
        await mailPage.close().catch(() => {});

        // 用 scraper.init 走它的查找邮箱地址 + 弹窗清理流程，再等验证邮件
        try {
          await scraper.init();
        } catch (e) {
          logger.warn(`[Checker] 收信页初始化失败: ${e.message}`);
          return { ok: false, reason: 'mail_page_init_failed' };
        }

        const emailData = await scraper.waitForVerificationEmail(
          config.mailPollIntervalMs,
          Math.min(config.mailPollTimeoutMs, 60000)
        );
        if (!emailData) {
          return { ok: false, reason: 'mail_timeout' };
        }

        const verification = extractVerification(emailData);
        if (!verification || verification.type !== 'otp') {
          return { ok: false, reason: 'no_otp_in_mail' };
        }

        const otpResult = await loginPage.submitOTP(verification.value);
        logger.info(`[Checker] OTP 提交结果: ${otpResult.result} - ${otpResult.message || ''}`);
        if (otpResult.result === LoginResult.SUCCESS) {
          return { ok: true, reason: null };
        }
        return { ok: false, reason: otpResult.result };
      })(),
      PER_ACCOUNT_TIMEOUT_MS,
      'check_timeout'
    );
  } catch (error) {
    logger.warn(`[Checker] 检查异常: ${error.message}`);
    return { ok: false, reason: error.message === 'check_timeout' ? 'timeout' : `error:${error.message}` };
  } finally {
    if (scraper) {
      try { await scraper.close(); } catch (e) {}
    }
    if (mailContext) {
      try { await mailContext.close(); } catch (e) {}
    }
    try { await context.close(); } catch (e) {}
  }
}

// 检查一批账号，按存储行为更新数据库
async function checkAccounts({ accounts, store, getBrowser, config, logger }) {
  let kept = 0;
  let marked = 0;
  for (const account of accounts) {
    const browser = await getBrowser();
    const result = await checkOne({ browser, account, config, logger });
    if (result.ok) {
      store.markActiveSuccess(account.id);
      kept++;
      logger.info(`[Checker] 保留 ${account.email}`);
    } else {
      store.markRemovePending(account.id, result.reason);
      marked++;
      logger.warn(`[Checker] 标记移除 ${account.email}: ${result.reason}`);
    }
  }
  return { kept, marked };
}

module.exports = { checkOne, checkAccounts };
