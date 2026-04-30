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

    // 等登录表单或 CF 出现
    const ready = await this.waitForLoginFormReady(20000);
    if (!ready) {
      const deactivatedReason = await this.detectDeactivatedOrExpired();
      if (deactivatedReason) {
        return { result: deactivatedReason, message: deactivatedReason };
      }
      return { result: LoginResult.UNKNOWN, message: '登录页未就绪' };
    }

    if (await this.detectCloudflare()) {
      this.logger.warn('[Login] 检测到 Cloudflare，快速失败');
      return { result: LoginResult.CAPTCHA, message: 'cloudflare' };
    }

    // 部分场景登录页直接显示 Continue 入口而非表单，先点入口
    await this.clickLoginEntryIfPresent();

    // 填邮箱
    const emailInput = await this.findEmailInput(15000);
    if (!emailInput) {
      const reason = await this.detectDeactivatedOrExpired();
      return { result: reason || LoginResult.UNKNOWN, message: '找不到邮箱输入框' };
    }
    const emailFilled = await this.fillInputAndConfirm(emailInput, email, '邮箱');
    if (!emailFilled) {
      return { result: LoginResult.UNKNOWN, message: '邮箱填写失败' };
    }
    if (!(await this.clickContinueButton(5000))) {
      return { result: LoginResult.UNKNOWN, message: '邮箱页找不到继续按钮' };
    }

    // 等密码框出现 / 或者出现错误页
    const reachedPwd = await this.waitUntil(async () => {
      if (await this.findPasswordInput(0)) return true;
      if (await this.detectDeactivatedOrExpired()) return true;
      const text = await this.readVisibleBodyText();
      if (text.includes("couldn't find your account") || text.includes('account not found')) return true;
      return false;
    }, 15000, 300);

    if (!reachedPwd) {
      const reason = await this.detectDeactivatedOrExpired();
      return { result: reason || LoginResult.UNKNOWN, message: '邮箱提交后未进入密码页' };
    }

    const deactReason = await this.detectDeactivatedOrExpired();
    if (deactReason) {
      return { result: deactReason, message: deactReason };
    }

    const pwdInput = await this.findPasswordInput(2000);
    if (!pwdInput) {
      const text = await this.readVisibleBodyText();
      if (text.includes('account not found') || text.includes("couldn't find your account")) {
        return { result: LoginResult.WRONG_CREDENTIALS, message: 'account not found' };
      }
      return { result: LoginResult.UNKNOWN, message: '密码框未出现' };
    }

    // 填密码
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

  // 等登录页可操作
  async waitForLoginFormReady(timeoutMs) {
    return await this.waitUntil(async () => {
      if (await this.detectCloudflare()) return true;
      if (await this.detectDeactivatedOrExpired()) return true;
      if (await this.findEmailInput(0)) return true;
      // 登录页有时只显示一个 Log in 入口
      const loginEntry = this.page.locator('button:has-text("Log in"), a:has-text("Log in"), button:has-text("登录")');
      if (await this.findVisibleLocator(loginEntry, 0)) return true;
      return false;
    }, timeoutMs, 250);
  }

  // 如果当前是登录入口而不是表单，先点击进入
  async clickLoginEntryIfPresent() {
    if (await this.findEmailInput(0)) return;
    const entries = this.page.locator(
      'button:has-text("Log in"), a:has-text("Log in"), button:has-text("登录"), a:has-text("登录")'
    );
    const btn = await this.findVisibleLocator(entries, 0);
    if (btn) {
      try {
        await btn.click({ timeout: 2000 });
        await this.waitUntil(async () => !!(await this.findEmailInput(0)), 5000, 250);
      } catch (e) {}
    }
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

    if (!(await this.clickContinueButton(5000))) {
      // 有些页面是输入完自动提交，等一下
      await this.page.waitForTimeout(500);
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
