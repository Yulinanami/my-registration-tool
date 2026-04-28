/**
 * GPTMail 网页爬虫模块
 * 通过 Playwright 从 mail.chatgpt.org.uk 获取临时邮箱并读取邮件
 */

class GptMailScraper {
  /**
   * @param {import('playwright').BrowserContext} context - Playwright 浏览器上下文
   * @param {import('winston').Logger} logger
   */
  constructor(context, logger) {
    this.context = context;
    this.logger = logger;
    this.page = null;
    this.currentEmail = null;
  }

  /**
   * 初始化：打开 GPTMail 页面
   */
  async init() {
    this.page = await this.context.newPage();
    await this.page.goto('https://mail.chatgpt.org.uk', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    // 等待邮箱地址加载
    await this.page.waitForSelector('#emailDisplay', { timeout: 15000 });
    // 关闭可能出现的公告弹窗
    await this._dismissPopups();
    this.currentEmail = await this._readCurrentEmail();
    this.logger.info(`[GPTMail] 初始化完成，当前邮箱: ${this.currentEmail}`);
    return this.currentEmail;
  }

  /**
   * 生成一个新的随机邮箱
   */
  async generateNewEmail() {
    this.logger.info('[GPTMail] 生成新的随机邮箱...');
    // 点击随机生成按钮
    const btn = this.page.locator('button[onclick="generateNewEmail()"]');
    if (await btn.count() > 0) {
      await btn.click();
    } else {
      // 备选：直接调用页面函数
      await this.page.evaluate(() => {
        if (typeof generateNewEmail === 'function') generateNewEmail();
      });
    }
    // 等待邮箱更新
    await this.page.waitForTimeout(2000);
    await this._dismissPopups();
    const oldEmail = this.currentEmail;
    this.currentEmail = await this._readCurrentEmail();
    // 如果邮箱没变，刷新页面重试
    if (this.currentEmail === oldEmail) {
      this.logger.info('[GPTMail] 邮箱未变，刷新页面...');
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.page.waitForSelector('#emailDisplay', { timeout: 15000 });
      await this._dismissPopups();
      this.currentEmail = await this._readCurrentEmail();
    }
    this.logger.info(`[GPTMail] 新邮箱: ${this.currentEmail}`);
    return this.currentEmail;
  }

  /**
   * 轮询等待来自 OpenAI 的验证邮件
   * @param {number} pollInterval - 轮询间隔 (ms)
   * @param {number} timeout - 超时 (ms)
   * @returns {Promise<{subject: string, from: string, body: string, html: string}|null>}
   */
  async waitForVerificationEmail(pollInterval = 3000, timeout = 120000) {
    this.logger.info(`[GPTMail] 开始轮询验证邮件，邮箱: ${this.currentEmail}，超时: ${timeout / 1000}s`);
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // 点刷新按钮
      await this._refreshInbox();
      await this.page.waitForTimeout(1500);

      // 检查邮件列表
      const emailItems = this.page.locator('ul#emailList > li');
      const count = await emailItems.count();

      if (count > 0) {
        // 遍历找 OpenAI 的邮件
        for (let i = 0; i < count; i++) {
          const item = emailItems.nth(i);
          const text = await item.textContent();
          if (text && (text.includes('OpenAI') || text.includes('openai') || text.includes('ChatGPT') || text.includes('verify'))) {
            this.logger.info(`[GPTMail] 找到验证邮件: ${text.trim().substring(0, 80)}`);
            // 点击打开邮件详情
            await item.click();
            await this.page.waitForTimeout(2000);
            // 读取邮件内容
            const emailData = await this._readEmailDetail();
            return emailData;
          }
        }
      }

      this.logger.info(`[GPTMail] 暂未收到验证邮件，${Math.round((Date.now() - startTime) / 1000)}s / ${timeout / 1000}s`);
      await this.page.waitForTimeout(pollInterval);
    }

    this.logger.warn(`[GPTMail] 验证邮件轮询超时 (${timeout / 1000}s)`);
    return null;
  }

  /**
   * 读取当前邮箱地址
   */
  async _readCurrentEmail() {
    try {
      const emailText = await this.page.locator('#emailDisplay').textContent();
      return emailText ? emailText.trim() : null;
    } catch (e) {
      this.logger.error(`[GPTMail] 读取邮箱地址失败: ${e.message}`);
      return null;
    }
  }

  /**
   * 刷新收件箱
   */
  async _refreshInbox() {
    try {
      const refreshBtn = this.page.locator('#refreshInboxBtn');
      if (await refreshBtn.count() > 0) {
        await refreshBtn.click();
      } else {
        // 备选：用其它可能的刷新按钮
        const altBtn = this.page.locator('button:has-text("刷新"), button:has-text("Refresh")');
        if (await altBtn.count() > 0) {
          await altBtn.first().click();
        }
      }
    } catch (e) {
      this.logger.warn(`[GPTMail] 刷新收件箱失败: ${e.message}`);
    }
  }

  /**
   * 读取邮件详情（弹窗/详情页中的内容）
   */
  async _readEmailDetail() {
    try {
      // 等待详情区域加载
      await this.page.waitForSelector('.email-detail-body, #emailDetailBody, .modal-body', { timeout: 5000 });

      let body = '';
      let html = '';
      let from = '';
      let subject = '';

      // 读取发件人
      try {
        const fromEl = this.page.locator('#modalFrom, .email-from, [class*="from"]');
        if (await fromEl.count() > 0) from = (await fromEl.first().textContent()).trim();
      } catch (e) { /* 忽略 */ }

      // 读取主题
      try {
        const subjectEl = this.page.locator('.email-detail-subject-wrap, #modalSubject, .email-subject');
        if (await subjectEl.count() > 0) subject = (await subjectEl.first().textContent()).trim();
      } catch (e) { /* 忽略 */ }

      // 读取正文（优先 HTML）
      try {
        const bodyEl = this.page.locator('.email-detail-body, #emailDetailBody');
        if (await bodyEl.count() > 0) {
          body = (await bodyEl.first().textContent()).trim();
          html = await bodyEl.first().innerHTML();
        }
      } catch (e) { /* 忽略 */ }

      // 如果正文在 iframe 里
      if (!body) {
        try {
          const iframe = this.page.frameLocator('.email-detail-body iframe, #emailFrame');
          body = await iframe.locator('body').textContent();
          html = await iframe.locator('body').innerHTML();
        } catch (e) { /* 忽略 */ }
      }

      return { subject, from, body, html };
    } catch (e) {
      this.logger.error(`[GPTMail] 读取邮件详情失败: ${e.message}`);
      return null;
    }
  }

  /**
   * 关闭弹窗（公告、Cookie 提示等）
   */
  async _dismissPopups() {
    try {
      // 常见关闭按钮
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
    } catch (e) {
      // 忽略弹窗关闭失败
    }
  }

  /**
   * 关闭邮件详情弹窗
   */
  async closeEmailDetail() {
    try {
      const closeBtn = this.page.locator('.modal .close, .modal .btn-close, button[data-bs-dismiss="modal"], button[data-dismiss="modal"]');
      if (await closeBtn.count() > 0 && await closeBtn.first().isVisible()) {
        await closeBtn.first().click();
        await this.page.waitForTimeout(500);
      }
    } catch (e) { /* 忽略 */ }
  }

  /**
   * 导航到指定邮箱的收件箱
   */
  async navigateToEmail(email) {
    this.currentEmail = email;
    await this.page.goto(`https://mail.chatgpt.org.uk/${email}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await this.page.waitForSelector('#emailDisplay', { timeout: 15000 });
    await this._dismissPopups();
    this.logger.info(`[GPTMail] 已导航到邮箱: ${email}`);
  }

  /**
   * 关闭页面
   */
  async close() {
    if (this.page && !this.page.isClosed()) {
      await this.page.close();
    }
  }
}

module.exports = { GptMailScraper };
