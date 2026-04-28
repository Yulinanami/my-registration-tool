class MailScraper {
  // 保存浏览器和日志
  constructor(context, logger) {
    this.context = context;
    this.logger = logger;
    this.page = null;
    this.currentEmail = null;
  }

  // 打开邮箱页面
  async init() {
    this.page = await this.context.newPage();
    await this.page.goto('https://mail.chatgpt.org.uk', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await this.page.waitForSelector('#emailDisplay', { timeout: 15000 });
    await this._dismissPopups();
    this.currentEmail = await this._waitForRealEmail();
    this.logger.info(`[Mail] 初始化完成，当前邮箱: ${this.currentEmail}`);

    return this.currentEmail;
  }

  // 等待验证邮件
  async waitForVerificationEmail(pollInterval = 3000, timeout = 120000) {
    this.logger.info(`[Mail] 开始等待验证邮件，邮箱: ${this.currentEmail}，超时: ${timeout / 1000}s`);
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      await this._refreshInbox();
      await this.page.waitForTimeout(1500);

      const emailItems = this.page.locator('ul#emailList > li');
      const count = await emailItems.count();

      if (count > 0) {
        for (let i = 0; i < count; i++) {
          const item = emailItems.nth(i);
          const text = await item.textContent();
          if (text && (text.includes('OpenAI') || text.includes('openai') || text.includes('ChatGPT') || text.includes('verify'))) {
            this.logger.info(`[Mail] 找到验证邮件: ${text.trim().substring(0, 80)}`);
            await item.click();
            await this.page.waitForTimeout(2000);
            return await this._readEmailDetail();
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
  async _waitForRealEmail(timeout = 15000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const text = await this._readCurrentEmail();
      if (text && text.includes('@')) {
        return text;
      }
      this.logger.info(`[Mail] 等待邮箱生成... (当前: ${text})`);
      await this.page.waitForTimeout(1000);
    }

    const fallback = await this._readCurrentEmail();
    this.logger.warn(`[Mail] 等待邮箱超时，当前值: ${fallback}`);
    return fallback;
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
      if (await refreshBtn.count() > 0 && await refreshBtn.first().isVisible()) {
        await refreshBtn.first().click();
        return;
      }

      const altBtn = this.page.locator('button:has-text("刷新"), button:has-text("Refresh")');
      if (await altBtn.count() > 0 && await altBtn.first().isVisible()) {
        await altBtn.first().click();
      }
    } catch (e) {
      this.logger.warn(`[Mail] 刷新收件箱失败: ${e.message}`);
    }
  }

  // 读取邮件内容
  async _readEmailDetail() {
    try {
      await this.page.waitForSelector('.email-detail-body, #emailDetailBody, #emailFrame, #emailModal, .modal-body', { timeout: 5000 });

      let body = '';
      let html = '';
      let from = '';
      let subject = '';

      try {
        const fromEl = this.page.locator('#modalFrom, .email-from, [class*="from"]');
        if (await fromEl.count() > 0) from = (await fromEl.first().textContent()).trim();
      } catch (e) {}

      try {
        const subjectEl = this.page.locator('.email-detail-subject-wrap, #modalSubject, .email-subject');
        if (await subjectEl.count() > 0) subject = (await subjectEl.first().textContent()).trim();
      } catch (e) {}

      try {
        const bodyEl = this.page.locator('.email-detail-body, #emailDetailBody');
        if (await bodyEl.count() > 0) {
          body = (await bodyEl.first().textContent()).trim();
          html = await bodyEl.first().innerHTML();
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
        if (await btn.count() > 0 && await btn.first().isVisible()) {
          await btn.first().click();
          await this.page.waitForTimeout(500);
        }
      }
    } catch (e) {}
  }

  // 关闭邮箱页面
  async close() {
    if (this.page && !this.page.isClosed()) {
      await this.page.close();
    }
  }
}

module.exports = { MailScraper };
