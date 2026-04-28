// 提供各个页面都会用到的基础操作
const ERROR_SELECTORS = [
  '.error-message',
  '[role="alert"]',
  '.text-error',
  '.text-red',
  '.alert-error',
  '[data-testid*="error"]',
];

class BasePage {
  // 保存页面和配置
  constructor(page, config, logger) {
    this.page = page;
    this.config = config;
    this.logger = logger;
  }

  // 等到条件满足
  async waitUntil(check, timeoutMs, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await check()) {
        return true;
      }

      if (this.page.isClosed()) return false;
      await this.page.waitForTimeout(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    }

    return false;
  }

  // 找到当前可见的元素
  async findVisibleLocator(locator, timeoutMs = 0, intervalMs = 200) {
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

      if (this.page.isClosed()) return null;
      await this.page.waitForTimeout(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    }
  }

  // 填入内容并确认没有被页面清空
  async fillInputAndConfirm(locator, value, label, options = {}) {
    const text = String(value || '');
    const timeoutMs = options.timeoutMs || 3000;

    for (let attempt = 1; attempt <= 2; attempt++) {
      await locator.waitFor({ state: 'visible', timeout: timeoutMs });
      if (!options.noClick) {
        await locator.click({ timeout: timeoutMs });
      }
      await locator.fill('');

      if (options.direct) {
        await locator.fill(text);
      } else {
        await this.typeHumanLike(locator, text);
      }

      if (await this.waitForInputValue(locator, text, timeoutMs)) {
        return true;
      }

      this.logger.warn(`[Registration] ${label}输入后没有留在输入框内，重新填写`);
      await locator.fill(text).catch(() => {});
      if (await this.waitForInputValue(locator, text, 1000)) {
        return true;
      }
    }

    return false;
  }

  // 等待输入值同步
  async waitForInputValue(locator, expected, timeoutMs) {
    return await this.waitUntil(async () => {
      const value = await locator.inputValue().catch(() => '');
      return value === expected;
    }, timeoutMs, 150);
  }

  // 查找邮箱输入框
  async findEmailInput(timeoutMs = 5000) {
    const emailInput = this.page.locator('input[name="email"], input[type="email"], input[id="email"]');
    return await this.findVisibleLocator(emailInput, timeoutMs);
  }

  // 查找密码输入框
  async findPasswordInput(timeoutMs = 0) {
    const pwdInput = this.page.locator('input[type="password"], input[name="new-password"], input[name="password"]');
    return await this.findVisibleLocator(pwdInput, timeoutMs);
  }

  // 点击继续按钮
  async clickContinueButton(timeoutMs = 0) {
    let btn = null;
    if (timeoutMs > 0) {
      await this.waitUntil(async () => {
        btn = await this.findContinueButton();
        return !!btn;
      }, timeoutMs, 200);
    } else {
      btn = await this.findContinueButton();
    }

    if (!btn) {
      return false;
    }

    await btn.click();
    return true;
  }

  // 查找继续按钮
  async findContinueButton() {
    const targetTexts = [
      '继续',
      'Continue',
      '下一步',
      'Next',
      'Verify',
      '验证',
      'Finish creating account',
      'Create account',
      '完成创建账号',
      '完成创建账户',
      '创建账号',
      '创建账户',
    ];
    const allButtons = this.page.locator('button');
    const count = await allButtons.count();
    for (let i = 0; i < count; i++) {
      const btn = allButtons.nth(i);
      const text = (await btn.textContent() || '').trim();
      if (this.shouldSkipButton(text)) {
        continue;
      }
      if (targetTexts.includes(text) && await btn.isVisible() && await btn.isEnabled()) {
        return btn;
      }
    }

    const submitBtn = this.page.locator('button[type="submit"]');
    const submitCount = await submitBtn.count();
    for (let i = 0; i < submitCount; i++) {
      const btn = submitBtn.nth(i);
      const text = (await btn.textContent() || '').trim();
      if (this.shouldSkipButton(text)) {
        continue;
      }
      if (await btn.isVisible() && await btn.isEnabled()) {
        return btn;
      }
    }

    return null;
  }

  // 判断按钮是否应该跳过
  shouldSkipButton(text) {
    const lowerText = (text || '').toLowerCase();
    return text.includes('Google') ||
      text.includes('Apple') ||
      text.includes('Microsoft') ||
      text.includes('手机') ||
      lowerText.includes('phone') ||
      lowerText.includes('resend') ||
      text.includes('重新发送') ||
      lowerText.includes('show password');
  }

  // 读取页面错误文字
  async readFirstErrorText(extraSelectors = []) {
    for (const sel of [...ERROR_SELECTORS, ...extraSelectors]) {
      const el = this.page.locator(sel);
      const visibleEl = await this.findVisibleLocator(el, 0);
      if (visibleEl) {
        return (await visibleEl.textContent()).trim().toLowerCase();
      }
    }

    return '';
  }

  // 读取页面可见文字
  async readVisibleBodyText() {
    try {
      return ((await this.page.locator('body').innerText({ timeout: 1000 })) || '').toLowerCase();
    } catch (e) {
      const text = await this.page.textContent('body').catch(() => '');
      return (text || '').toLowerCase();
    }
  }

  // 判断是否已经创建失败
  isCreateAccountFailed(text) {
    if (!text) {
      return false;
    }

    return text.includes('failed to create account') ||
      text.includes('sign up failed') ||
      text.includes('registration failed') ||
      text.includes('please try again') ||
      text.includes('something went wrong') ||
      text.includes('创建帐户失败') ||
      text.includes('创建账户失败') ||
      text.includes('注册失败');
  }

  // 判断是否到了个人信息页
  isPersonalInfoPage(url, lowerText) {
    return (url.includes('onboarding') ||
      url.includes('about_you') ||
      url.includes('about-you') ||
      lowerText.includes('tell us about you') ||
      lowerText.includes('tell us') ||
      lowerText.includes('what should we call you') ||
      lowerText.includes("let's confirm your age") ||
      lowerText.includes('how old are you') ||
      lowerText.includes('name') ||
      lowerText.includes('姓名') ||
      lowerText.includes('full name') ||
      lowerText.includes('finish creating account') ||
      lowerText.includes('birthday') ||
      lowerText.includes('生日')) &&
      !url.includes('password');
  }

  // 检查页面保护
  async detectCloudflare() {
    try {
      const cf = this.page.locator(
        'iframe[src*="challenges.cloudflare.com"], ' +
        '#cf-challenge-running, ' +
        '.cf-turnstile, ' +
        'input[name="cf-turnstile-response"], ' +
        '[id^="cf-chl-widget"]'
      );
      if (await cf.count() > 0) {
        return true;
      }

      const title = await this.page.title();
      return title.includes('请稍候') || title.toLowerCase().includes('just a moment');
    } catch (e) {
      return false;
    }
  }

  // 检查人机验证
  async detectCaptcha() {
    try {
      const captcha = this.page.locator(
        'iframe[src*="challenges.cloudflare.com"], ' +
        'iframe[src*="recaptcha"], ' +
        'iframe[src*="hcaptcha"], ' +
        '.cf-turnstile, ' +
        '.g-recaptcha, ' +
        '.h-captcha, ' +
        'input[name="cf-turnstile-response"], ' +
        '[id^="cf-chl-widget"], ' +
        '#captcha-container'
      );
      return await captcha.count() > 0;
    } catch (e) {
      return false;
    }
  }

  // 慢慢输入文字
  async typeHumanLike(locator, text) {
    const minDelay = this.config.typingDelayMin ?? 50;
    const maxDelay = this.config.typingDelayMax ?? 150;
    const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

    if (locator.pressSequentially) {
      await locator.pressSequentially(text, { delay });
    } else {
      await locator.type(text, { delay });
    }
  }
}

module.exports = { BasePage };
