// 处理登录页里的注册入口
const { BasePage } = require('./base-page');

class SignUpPage extends BasePage {
  // 点击注册入口
  async clickSignUp() {
    if (await this.isOnSignupForm()) {
      this.logger.info('[Registration] 已在注册表单页');
      return true;
    }

    const buttonSelectors = [
      { selector: 'button:has-text("Sign up for free")', desc: 'Sign up for free button' },
      { selector: 'a:has-text("Sign up")', desc: 'Sign up link' },
      { selector: 'button:has-text("Sign up")', desc: 'Sign up button' },
      { selector: 'a:has-text("免费注册")', desc: '免费注册 link' },
      { selector: 'button:has-text("免费注册")', desc: '免费注册 button' },
      { selector: 'a:has-text("注册")', desc: '注册 link' },
    ];

    await this.closePageOverlay();
    const deadline = Date.now() + this.config.signUpButtonTimeoutMs;

    while (Date.now() <= deadline) {
      for (const { selector, desc } of buttonSelectors) {
        try {
          const el = this.page.locator(selector);
          const count = await el.count();
          for (let i = 0; i < count; i++) {
            const button = el.nth(i);
            if (!(await button.isVisible().catch(() => false))) {
              continue;
            }

            const text = await button.textContent();
            if (text && (text.includes('Google') || text.includes('Apple') || text.includes('Microsoft'))) {
              continue;
            }

            const beforeUrl = this.page.url();
            try {
              await button.click({ timeout: 3500 });
            } catch (clickErr) {
              continue;
            }

            this.logger.info(`[Registration] 点击注册按钮: ${desc}，当前 URL: ${beforeUrl}`);
            const waitMs = Math.min(this.config.signUpClickCheckMs || 1200, Math.max(0, deadline - Date.now()));
            const clickResult = await this.waitForSignUpClickResult(beforeUrl, waitMs);
            if (clickResult === 'form' || clickResult === 'navigating') {
              return true;
            }
            this.logger.warn(`[Registration] 点击 ${desc} 后页面未变化，继续点击可用入口`);
          }
        } catch (e) {}
      }

      if (await this.waitForSignupForm(250)) {
        return true;
      }

      const currentUrl = this.page.url();
      if (currentUrl.includes('auth.openai.com') && !currentUrl.includes('/auth/login')) {
        return true;
      }

      await this.page.waitForTimeout(250);
    }

    if (await this.waitForSignupForm(1000)) {
      this.logger.info('[Registration] 页面已自动跳转到注册表单');
      return true;
    }

    this.logger.error(`[Registration] 找不到注册按钮，当前 URL: ${this.page.url()}`);
    return false;
  }

  // 等待点击注册后的变化
  async waitForSignUpClickResult(beforeUrl, timeoutMs) {
    let result = 'none';
    await this.waitUntil(async () => {
      if (await this.isOnSignupForm()) {
        result = 'form';
        return true;
      }

      const url = this.page.url();
      if (url !== beforeUrl && (url.includes('auth.openai.com') || !url.includes('/auth/login'))) {
        result = 'navigating';
        return true;
      }

      return false;
    }, timeoutMs, 150);

    return result;
  }

  // 关闭页面上方的浮层
  async closePageOverlay() {
    await this.page.keyboard.press('Escape').catch(() => {});
  }

  // 等待登录页可操作
  async waitForLoginPageReady() {
    return await this.waitUntil(async () => {
      return await this.detectCloudflare() ||
        await this.isOnSignupForm() ||
        await this.hasSignUpEntry();
    }, this.config.signUpButtonTimeoutMs, 250);
  }

  // 判断是否有注册入口
  async hasSignUpEntry() {
    const entries = this.page.locator(
      'button:has-text("Sign up for free"), ' +
      'button:has-text("Sign up"), ' +
      'a:has-text("Sign up"), ' +
      'button:has-text("免费注册"), ' +
      'a:has-text("免费注册"), ' +
      'a:has-text("注册")'
    );
    const count = await entries.count();
    for (let i = 0; i < count; i++) {
      if (await entries.nth(i).isVisible()) {
        return true;
      }
    }

    return false;
  }

  // 判断是否已经打开注册表单
  async isOnSignupForm() {
    return !!(await this.findEmailInput(0));
  }

  // 等待注册表单出现
  async waitForSignupForm(timeoutMs) {
    return await this.waitUntil(async () => await this.isOnSignupForm(), timeoutMs, 250);
  }
}

module.exports = { SignUpPage };
