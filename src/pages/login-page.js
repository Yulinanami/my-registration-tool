// 登录检测页面：判断账号是否还能登录
const { BasePage } = require('./base-page');

const LoginResult = {
  SUCCESS: 'success',
  ACCOUNT_DEACTIVATED: 'account_deactivated',
  SESSION_EXPIRED: 'session_expired',
  CAPTCHA: 'captcha',
  WRONG_CREDENTIALS: 'wrong_credentials',
  NEED_OTP: 'need_otp',
  TIMEOUT: 'timeout',
  UNKNOWN: 'unknown',
};

class LoginPage extends BasePage {
  // 登录入口
  async login(email, password) {
    await this.page.goto('https://chatgpt.com/auth/login', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // 等到 CF / 失效 / 表单 / Log in 入口 任一种状态
    const ready = await this.waitForLoginPageReady(20000);
    if (!ready) {
      const reason = await this.detectDeactivatedOrExpired();
      if (reason) {
        return { result: reason, message: reason };
      }
      return { result: LoginResult.UNKNOWN, message: `登录页未就绪 url=${this.page.url()}` };
    }

    if (await this.detectCloudflare()) {
      this.logger.warn('[Login] 检测到 Cloudflare，快速失败');
      return { result: LoginResult.CAPTCHA, message: 'cloudflare' };
    }

    const earlyReason = await this.detectDeactivatedOrExpired();
    if (earlyReason) {
      return { result: earlyReason, message: earlyReason };
    }

    // chatgpt.com 着陆页通常只有 Log in 按钮，需要点击才能跳转到真正的登录表单
    if (!(await this.goToLoginForm(20000))) {
      const reason = await this.detectDeactivatedOrExpired();
      if (reason) return { result: reason, message: reason };
      return { result: LoginResult.UNKNOWN, message: `无法进入登录表单 url=${this.page.url()}` };
    }

    // 填邮箱
    const emailInput = await this.findEmailInput(8000);
    if (!emailInput) {
      const reason = await this.detectDeactivatedOrExpired();
      return { result: reason || LoginResult.UNKNOWN, message: `邮箱输入框未出现 url=${this.page.url()}` };
    }
    const emailFilled = await this.fillInputAndConfirm(emailInput, email, '邮箱');
    if (!emailFilled) {
      return { result: LoginResult.UNKNOWN, message: '邮箱填写失败' };
    }
    if (!(await this.clickContinueButton(5000))) {
      return { result: LoginResult.UNKNOWN, message: '邮箱页找不到继续按钮' };
    }

    // 等下一页：密码框 / OTP 框 / OTP 提示文字 / 失效页 / 错误
    const branch = await this.detectAfterEmailSubmit(15000);
    if (branch.kind === 'timeout') {
      return { result: LoginResult.UNKNOWN, message: `邮箱提交后未进入预期页面 url=${this.page.url()}` };
    }
    if (branch.kind === 'deactivated') {
      return { result: branch.reason, message: branch.reason };
    }
    if (branch.kind === 'wrong_credentials') {
      return { result: LoginResult.WRONG_CREDENTIALS, message: branch.message || 'account not found' };
    }
    if (branch.kind === 'otp') {
      // passwordless 登录：直接进入 OTP 页，不需要填密码
      this.logger.info('[Login] 邮箱提交后直接进入 OTP 页（passwordless）');
      return { result: LoginResult.NEED_OTP, message: 'passwordless 登录，直接发验证码' };
    }

    // branch.kind === 'password'：进入密码页
    const pwdInput = await this.findPasswordInput(2000);
    if (!pwdInput) {
      return { result: LoginResult.UNKNOWN, message: '密码框定位失败' };
    }

    const pwdFilled = await this.fillInputAndConfirm(pwdInput, password, '密码');
    if (!pwdFilled) {
      return { result: LoginResult.UNKNOWN, message: '密码填写失败' };
    }
    if (!(await this.clickContinueButton(5000))) {
      return { result: LoginResult.UNKNOWN, message: '密码页找不到继续按钮' };
    }

    // 等待登录后页面状态：成功 / OTP / 失效 / 错误
    return await this.waitForLoginResult(45000);
  }

  // 邮箱提交后判断进入哪一类页面
  async detectAfterEmailSubmit(timeoutMs) {
    let result = { kind: 'timeout' };
    await this.waitUntil(async () => {
      const reason = await this.detectDeactivatedOrExpired();
      if (reason) {
        result = { kind: 'deactivated', reason };
        return true;
      }

      if (await this.findPasswordInput(0)) {
        result = { kind: 'password' };
        return true;
      }

      const otpInput = this.page.locator(
        'input[name="code"], input[autocomplete="one-time-code"], input[name="otp"]'
      );
      if ((await otpInput.count()) > 0 && (await this.findVisibleLocator(otpInput, 0))) {
        result = { kind: 'otp' };
        return true;
      }

      const text = await this.readVisibleBodyText();
      if (
        text.includes('verification code') ||
        text.includes('enter code') ||
        text.includes('check your email') ||
        text.includes('we sent') ||
        text.includes('verify your email') ||
        text.includes('我们已发送') ||
        text.includes('已发送验证码')
      ) {
        result = { kind: 'otp' };
        return true;
      }

      if (
        text.includes("couldn't find your account") ||
        text.includes('account not found') ||
        text.includes('找不到您的账号') ||
        text.includes('账号不存在')
      ) {
        result = { kind: 'wrong_credentials', message: text.substring(0, 80) };
        return true;
      }

      return false;
    }, timeoutMs, 300);

    return result;
  }

  // 等登录页可操作 (CF / 失效 / 表单 / Log in 入口 任一)
  async waitForLoginPageReady(timeoutMs) {
    return await this.waitUntil(async () => {
      if (await this.detectCloudflare()) return true;
      if (await this.detectDeactivatedOrExpired()) return true;
      if (await this.findEmailInput(0)) return true;
      if (await this.hasLoginEntry()) return true;
      return false;
    }, timeoutMs, 250);
  }

  // 是否有 Log in 入口按钮
  async hasLoginEntry() {
    const entries = this.page.locator(
      'button:has-text("Log in"), a:has-text("Log in"), button:has-text("登录"), a:has-text("登录")'
    );
    const count = await entries.count();
    for (let i = 0; i < count; i++) {
      const btn = entries.nth(i);
      if (!(await btn.isVisible().catch(() => false))) continue;
      const text = (await btn.textContent().catch(() => '')) || '';
      if (text.includes('Google') || text.includes('Apple') || text.includes('Microsoft')) continue;
      return true;
    }
    return false;
  }

  // 循环点击 Log in 入口直到登录表单出现
  async goToLoginForm(timeoutMs) {
    if (await this.findEmailInput(0)) return true;

    const entrySelectors = [
      'button:has-text("Log in")',
      'a:has-text("Log in")',
      'button:has-text("登录")',
      'a:has-text("登录")',
    ];

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const selector of entrySelectors) {
        const buttons = this.page.locator(selector);
        const count = await buttons.count();
        for (let i = 0; i < count; i++) {
          const btn = buttons.nth(i);
          if (!(await btn.isVisible().catch(() => false))) continue;
          const text = ((await btn.textContent().catch(() => '')) || '').trim();
          if (text.includes('Google') || text.includes('Apple') || text.includes('Microsoft')) continue;

          this.logger.info(`[Login] 点击登录入口: "${text}" 当前 URL: ${this.page.url()}`);
          try {
            await btn.click({ timeout: 2000 });
          } catch (e) {
            continue;
          }

          // 等表单出现或 URL 跳转
          const beforeUrl = this.page.url();
          const arrived = await this.waitUntil(async () => {
            if (await this.findEmailInput(0)) return true;
            if (await this.detectDeactivatedOrExpired()) return true;
            const url = this.page.url();
            if (url !== beforeUrl && url.includes('auth.openai.com')) return true;
            return false;
          }, 5000, 250);

          if (await this.findEmailInput(0)) return true;
          if (arrived && (await this.findEmailInput(3000))) return true;
        }
      }

      if (await this.findEmailInput(0)) return true;
      if (await this.detectDeactivatedOrExpired()) return false;
      await this.page.waitForTimeout(400);
    }

    return !!(await this.findEmailInput(0));
  }

  // 检测页面是否明确表示账号已停用或会话过期
  async detectDeactivatedOrExpired() {
    try {
      const url = this.page.url();
      const title = (await this.page.title().catch(() => '')) || '';
      const text = await this.readVisibleBodyText();

      if (text.includes('account_deactivated')) {
        return LoginResult.ACCOUNT_DEACTIVATED;
      }
      if (
        (title.toLowerCase().includes('oops') || text.includes('oops, an error occurred')) &&
        text.includes('authentication')
      ) {
        return LoginResult.ACCOUNT_DEACTIVATED;
      }
      if (url.includes('email-verification') && (text.includes('error') || text.includes('try again'))) {
        const expiredModal = this.page.locator('#modal-expired-session, [data-testid="modal-expired-session"]');
        if ((await expiredModal.count()) > 0) {
          return LoginResult.SESSION_EXPIRED;
        }
      }

      const expiredModal = this.page.locator('#modal-expired-session, [data-testid="modal-expired-session"]');
      if ((await expiredModal.count()) > 0) {
        return LoginResult.SESSION_EXPIRED;
      }
      if (text.includes('your session has expired') || text.includes('session has expired')) {
        return LoginResult.SESSION_EXPIRED;
      }
    } catch (e) {}
    return null;
  }

  // 等待登录后的最终页面状态
  async waitForLoginResult(timeoutMs) {
    let finalResult = { result: LoginResult.TIMEOUT, message: '登录超时' };
    await this.waitUntil(async () => {
      const url = this.page.url();
      const text = await this.readVisibleBodyText();

      const deact = await this.detectDeactivatedOrExpired();
      if (deact) {
        finalResult = { result: deact, message: deact };
        return true;
      }

      // 进入主界面 = 登录成功
      if (url.includes('chatgpt.com') && !url.includes('auth') && !url.includes('login')) {
        finalResult = { result: LoginResult.SUCCESS, message: '已进入主界面' };
        return true;
      }

      // OTP 页面
      const otpInput = this.page.locator('input[name="code"], input[autocomplete="one-time-code"], input[name="otp"]');
      if ((await otpInput.count()) > 0 && (await this.findVisibleLocator(otpInput, 0))) {
        finalResult = { result: LoginResult.NEED_OTP, message: '需要邮箱验证码' };
        return true;
      }
      if (
        text.includes('verification code') ||
        text.includes('enter code') ||
        text.includes('check your email') ||
        text.includes('we sent') ||
        text.includes('verify your email')
      ) {
        finalResult = { result: LoginResult.NEED_OTP, message: '需要邮箱验证码' };
        return true;
      }

      if (
        text.includes('wrong password') ||
        text.includes('incorrect password') ||
        text.includes('密码错误') ||
        text.includes("couldn't find your account") ||
        text.includes('account not found')
      ) {
        finalResult = { result: LoginResult.WRONG_CREDENTIALS, message: text.substring(0, 80) };
        return true;
      }

      if (await this.detectCaptcha()) {
        finalResult = { result: LoginResult.CAPTCHA, message: 'captcha during login' };
        return true;
      }

      return false;
    }, timeoutMs, 400);

    return finalResult;
  }

  // 输入 OTP 验证码
  async submitOTP(code) {
    const otpInput = await this.findOTPInput(8000);
    if (!otpInput) {
      return { result: LoginResult.UNKNOWN, message: 'OTP 输入框未出现' };
    }

    const filled = await this.fillInputAndConfirm(otpInput, code, 'OTP');
    if (!filled) {
      return { result: LoginResult.UNKNOWN, message: 'OTP 填写失败' };
    }

    const beforeUrl = this.page.url();
    if (!(await this.clickContinueButton(5000))) {
      // 有些 OTP 输入是自动提交，没有按钮也不算异常
      await this.page.waitForTimeout(500);
    }

    // 先等到 OTP 提交真正生效（OTP 框消失或 URL 变化或失效页），再判最终结果
    const submitted = await this.waitUntil(async () => {
      if (await this.detectDeactivatedOrExpired()) return true;
      if (this.page.url() !== beforeUrl) return true;
      if (!(await this.findOTPInput(0))) return true;
      return false;
    }, 15000, 400);

    if (!submitted) {
      return { result: LoginResult.UNKNOWN, message: 'OTP 提交后页面无响应' };
    }

    return await this.waitForLoginResult(45000);
  }

  async findOTPInput(timeoutMs = 0) {
    const locators = [
      this.page.locator('input[name="code"], input[autocomplete="one-time-code"], input[name="otp"]'),
      this.page.locator('input[inputmode="numeric"]'),
    ];
    const deadline = Date.now() + timeoutMs;
    while (true) {
      for (const locator of locators) {
        const input = await this.findVisibleLocator(locator, 0);
        if (input) return input;
      }
      if (Date.now() >= deadline) return null;
      if (this.page.isClosed()) return null;
      await this.page.waitForTimeout(Math.min(300, Math.max(0, deadline - Date.now())));
    }
  }
}

module.exports = { LoginPage, LoginResult };
