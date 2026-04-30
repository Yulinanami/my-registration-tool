// 打开临时邮箱页面并读取验证邮件
const { extractVerification } = require('./parser');

class MailScraper {
  // 保存浏览器和日志
  constructor(context, logger, config = {}) {
    this.context = context;
    this.logger = logger;
    this.config = config;
    this.page = null;
    this.currentEmail = null;
  }

  // 打开邮箱页面 (主页，会自动分配新临时邮箱)
  async init() {
    this.page = await this.context.newPage();
    await this.page.goto('https://mail.chatgpt.org.uk', {
      waitUntil: 'domcontentloaded',
      timeout: this.config.mailPageTimeoutMs,
    });

    await this.page.waitForSelector('#emailDisplay', { timeout: this.config.mailEmailTimeoutMs });
    await this._dismissPopups();
    this.currentEmail = await this._waitForRealEmail();
    this.logger.info(`[Mail] 初始化完成，当前邮箱: ${this.currentEmail}`);

    return this.currentEmail;
  }

  // 打开指定邮箱的收件页 (用于登录检测时收 OTP)
  async initForEmail(email) {
    this.page = await this.context.newPage();
    // GPTMail 路由识别字面 @，encodeURIComponent 会把 @ 编成 %40 导致路由失败
    const url = `https://mail.chatgpt.org.uk/${email}`;
    this.logger.info(`[Mail] 打开收信页: ${url}`);
    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.config.mailPageTimeoutMs,
    });

    await this.page.waitForSelector('#emailDisplay', { timeout: this.config.mailEmailTimeoutMs });
    await this._dismissPopups();

    // 页面是渐进渲染（"79" -> "79d3..." -> 完整邮箱），先等到一个完整邮箱再比对
    const displayed = await this._waitForRealEmail();
    if (displayed && displayed.toLowerCase() === email.toLowerCase()) {
      this.currentEmail = displayed;
      this.logger.info(`[Mail] 初始化完成（指定邮箱），当前邮箱: ${this.currentEmail}`);
      return this.currentEmail;
    }

    this.logger.error(`[Mail] 收信页显示邮箱 (${displayed}) 与请求 (${email}) 不一致，路由失败`);
    throw new Error(`mail_page_wrong_mailbox: requested=${email} actual=${displayed}`);
  }

  // 等待验证邮件
  async waitForVerificationEmail(pollInterval = 3000, timeout = 120000) {
    this.logger.info(`[Mail] 开始等待验证邮件，邮箱: ${this.currentEmail}，超时: ${timeout / 1000}s`);
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const inboxTextBeforeRefresh = await this._readInboxText();
      await this._refreshInbox();
      await this._waitForInboxUpdate(inboxTextBeforeRefresh, this.config.mailRefreshWaitMs);

      const emailItems = this.page.locator('ul#emailList > li');
      const count = await emailItems.count();

      if (count > 0) {
        for (let i = 0; i < count; i++) {
          const item = emailItems.nth(i);
          const text = await item.textContent();
          if (text && (text.includes('OpenAI') || text.includes('openai') || text.includes('ChatGPT') || text.includes('verify'))) {
            this.logger.info(`[Mail] 找到验证邮件: ${text.trim().substring(0, 80)}`);
            await item.click();

            const emailData = await this._readEmailDetailWithRetry();
            if (emailData) {
              return emailData;
            }

            this.logger.warn('[Mail] 验证邮件内容还没加载完整，继续等待...');
          }
        }
      }

      this.logger.info(`[Mail] 暂未收到验证邮件，${Math.round((Date.now() - startTime) / 1000)}s / ${timeout / 1000}s`);
      await this.page.waitForTimeout(pollInterval);
    }

    this.logger.warn(`[Mail] 等待验证邮件超时 (${timeout / 1000}s)`);
    return null;
  }

  // 等待邮箱地址生成
  async _waitForRealEmail(timeout = this.config.mailEmailTimeoutMs) {
    const startTime = Date.now();
    let lastValidEmail = null;
    let stableCount = 0;

    while (Date.now() - startTime < timeout) {
      const text = await this._readCurrentEmail();
      if (this._isValidEmail(text)) {
        if (text === lastValidEmail) {
          stableCount += 1;
        } else {
          lastValidEmail = text;
          stableCount = 1;
        }

        if (stableCount >= 2) {
          return text;
        }
      } else {
        lastValidEmail = null;
        stableCount = 0;
      }
      this.logger.info(`[Mail] 等待邮箱生成... (当前: ${text})`);
      await this.page.waitForTimeout(this.config.mailEmailCheckIntervalMs);
    }

    const fallback = await this._readCurrentEmail();
    this.logger.warn(`[Mail] 等待邮箱超时，当前值: ${fallback}`);
    return this._isValidEmail(fallback) ? fallback : null;
  }

  // 判断邮箱地址是否完整
  _isValidEmail(email) {
    return /^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$/.test(email || '');
  }

  // 读取当前邮箱地址
  async _readCurrentEmail() {
    try {
      const emailText = await this.page.locator('#emailDisplay').textContent();
      return emailText ? emailText.trim() : null;
    } catch (e) {
      this.logger.error(`[Mail] 读取邮箱地址失败: ${e.message}`);
      return null;
    }
  }

  // 刷新收件箱
  async _refreshInbox() {
    try {
      await this._dismissPopups();

      const refreshBtn = this.page.locator('#refreshInboxBtn');
      const visibleRefreshBtn = await this._findVisibleLocator(refreshBtn, 0);
      if (visibleRefreshBtn) {
        await visibleRefreshBtn.click();
        return;
      }

      const altBtn = this.page.locator('button:has-text("刷新"), button:has-text("Refresh")');
      const visibleAltBtn = await this._findVisibleLocator(altBtn, 0);
      if (visibleAltBtn) {
        await visibleAltBtn.click();
      }
    } catch (e) {
      this.logger.warn(`[Mail] 刷新收件箱失败: ${e.message}`);
    }
  }

  // 重试读取邮件内容
  async _readEmailDetailWithRetry() {
    const retryCount = this.config.mailDetailRetryCount || 3;

    for (let i = 0; i < retryCount; i++) {
      const emailData = await this._readEmailDetail();
      if (emailData && (emailData.body || emailData.html) && extractVerification(emailData)) {
        return emailData;
      }

      if (i < retryCount - 1) {
        await this.page.waitForTimeout(this.config.mailDetailRetryDelayMs || 1000);
      }
    }

    return null;
  }

  // 读取收件箱文字
  async _readInboxText() {
    try {
      return (await this.page.locator('ul#emailList').textContent()) || '';
    } catch (e) {
      return '';
    }
  }

  // 等待收件箱刷新
  async _waitForInboxUpdate(beforeText, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const text = await this._readInboxText();
      if (text !== beforeText || /openai|chatgpt|verify|verification/i.test(text)) {
        return true;
      }
      await this.page.waitForTimeout(200);
    }

    return false;
  }

  // 读取邮件内容
  async _readEmailDetail() {
    try {
      await this.page.waitForSelector('.email-detail-body, #emailDetailBody, #emailFrame, #emailModal, .modal-body', { timeout: this.config.mailDetailTimeoutMs });

      let body = '';
      let html = '';
      let from = '';
      let subject = '';

      try {
        const fromEl = this.page.locator('#modalFrom, .email-from, [class*="from"]');
        const visibleFromEl = await this._findVisibleLocator(fromEl, 0);
        if (visibleFromEl) from = (await visibleFromEl.textContent()).trim();
      } catch (e) {}

      try {
        const subjectEl = this.page.locator('.email-detail-subject-wrap, #modalSubject, .email-subject');
        const visibleSubjectEl = await this._findVisibleLocator(subjectEl, 0);
        if (visibleSubjectEl) subject = (await visibleSubjectEl.textContent()).trim();
      } catch (e) {}

      try {
        const bodyEl = this.page.locator('.email-detail-body, #emailDetailBody');
        const visibleBodyEl = await this._findVisibleLocator(bodyEl, 0);
        if (visibleBodyEl) {
          body = (await visibleBodyEl.textContent()).trim();
          html = await visibleBodyEl.innerHTML();
        }
      } catch (e) {}

      if (!body) {
        try {
          const iframe = this.page.frameLocator('.email-detail-body iframe, #emailFrame');
          body = await iframe.locator('body').textContent();
          html = await iframe.locator('body').innerHTML();
        } catch (e) {}
      }

      return { subject, from, body, html };
    } catch (e) {
      this.logger.error(`[Mail] 读取邮件详情失败: ${e.message}`);
      return null;
    }
  }

  // 关闭弹窗
  async _dismissPopups() {
    try {
      const closeSelectors = [
        '.modal .close',
        '.modal .btn-close',
        'button[data-dismiss="modal"]',
        'button[data-bs-dismiss="modal"]',
        '.announcement-close',
        '#closeAnnouncement',
        '.swal2-close',
        'button:has-text("我知道了")',
        'button:has-text("关闭")',
        'button:has-text("Close")',
        'button:has-text("OK")',
        'button:has-text("Got it")',
      ];

      for (const sel of closeSelectors) {
        const btn = this.page.locator(sel);
        const visibleBtn = await this._findVisibleLocator(btn, 0);
        if (visibleBtn) {
          await visibleBtn.click();
          await visibleBtn.waitFor({ state: 'hidden', timeout: this.config.popupCloseDelayMs }).catch(() => {});
        }
      }
    } catch (e) {}
  }

  // 找到当前可见的元素
  async _findVisibleLocator(locator, timeoutMs = 0, intervalMs = 200) {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const item = locator.nth(i);
        if (await item.isVisible().catch(() => false)) {
          return item;
        }
      }

      if (Date.now() >= deadline) {
        return null;
      }

      await this.page.waitForTimeout(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    }
  }

  // 关闭邮箱页面
  async close() {
    if (this.page && !this.page.isClosed()) {
      await this.page.close();
    }
  }
}

module.exports = { MailScraper };
