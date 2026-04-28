const { extractVerification } = require('./parser');

const RegisterResult = {
  SUCCESS: 'success',
  NEED_VERIFICATION: 'need_verification',
  DOMAIN_REJECTED: 'domain_rejected',
  CAPTCHA: 'captcha',
  PHONE_REQUIRED: 'phone_required',
  ALREADY_EXISTS: 'already_exists',
  RATE_LIMITED: 'rate_limited',
  UNKNOWN_ERROR: 'unknown_error',
};

const ERROR_SELECTORS = [
  '.error-message',
  '[role="alert"]',
  '.text-error',
  '.text-red',
  '.alert-error',
  '[data-testid*="error"]',
];

class Registrar {

  // 保存浏览器和日志
  constructor(context, config, logger) {
    this.context = context;
    this.config = config;
    this.logger = logger;
    this.page = null;
  }

  // 注册一个邮箱
  async register(email) {
    this.page = await this.context.newPage();

    try {
      this.logger.info(`[Registration] 开始注册: ${email}`);

      await this.page.goto('https://chatgpt.com/auth/login', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await this._waitForLoginPageReady();

      const cfUrl = this.page.url();
      this.logger.info(`[Registration] 页面加载完成，URL: ${cfUrl}`);
      if (await this._detectCloudflare()) {
        this.logger.warn('[Registration] 检测到 Cloudflare 挑战，等待通过...');
        const checks = Math.ceil(this.config.cloudflareMaxWaitMs / this.config.cloudflareCheckIntervalMs);
        for (let i = 0; i < checks; i++) {
          await this.page.waitForTimeout(this.config.cloudflareCheckIntervalMs);
          if (!(await this._detectCloudflare())) break;
        }
        if (await this._detectCloudflare()) {
          return { result: RegisterResult.CAPTCHA, message: 'Cloudflare 挑战未通过' };
        }
        this.logger.info('[Registration] Cloudflare 挑战已通过');
      }

      const curUrl = this.page.url();
      if (curUrl.includes('chatgpt.com')) {
        const signupClicked = await this._clickSignUp();
        if (!signupClicked) {
          return { result: RegisterResult.UNKNOWN_ERROR, message: '找不到注册按钮' };
        }
      }

      this.logger.info('[Registration] 等待注册表单...');
      try {
        await this.page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 20000 });
      } catch (e) {
        this.logger.error(`[Registration] 邮箱输入框未出现，URL: ${this.page.url()}`);
        return { result: RegisterResult.UNKNOWN_ERROR, message: '注册表单加载失败' };
      }

      const emailResult = await this._fillEmail(email);
      if (emailResult !== 'ok') {
        return { result: emailResult, message: `邮箱填写失败: ${emailResult}` };
      }

      const emailStatus = await this._checkEmailStatus();
      if (emailStatus !== 'ok') {
        return { result: emailStatus, message: `邮箱状态异常: ${emailStatus}` };
      }

      const passwordResult = await this._fillPassword();
      if (passwordResult !== 'ok') {
        return { result: passwordResult, message: `密码填写失败: ${passwordResult}` };
      }

      return await this._checkRegistrationStatus();

    } catch (error) {
      this.logger.error(`[Registration] 注册异常: ${error.message}`);
      return { result: RegisterResult.UNKNOWN_ERROR, message: error.message };
    }
  }

  // 处理邮件验证
  async handleVerification(emailData) {
    const verification = extractVerification(emailData);
    if (!verification) {
      return { result: RegisterResult.UNKNOWN_ERROR, message: '无法从邮件中提取验证信息' };
    }

    this.logger.info(`[Registration] 验证类型: ${verification.type}, 值: ${verification.value.substring(0, 80)}...`);

    if (verification.type === 'link') {
      return await this._handleVerificationLink(verification.value);
    } else if (verification.type === 'otp') {
      return await this._handleOTP(verification.value);
    }

    return { result: RegisterResult.UNKNOWN_ERROR, message: '未知验证类型' };
  }

  // 点击注册入口
  async _clickSignUp() {

    if (await this._isOnSignupForm()) {
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

    await this._closePageOverlay();
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
              await button.click({ timeout: 2000 });
            } catch (clickErr) {
              continue;
            }

            this.logger.info(`[Registration] 点击注册按钮: ${desc}，当前 URL: ${beforeUrl}`);
            const waitMs = Math.min(this.config.signUpClickCheckMs || 1200, Math.max(0, deadline - Date.now()));
            const clickResult = await this._waitForSignUpClickResult(beforeUrl, waitMs);
            if (clickResult === 'form') {
              return true;
            }
            if (clickResult === 'navigating') {
              return true;
            }
            this.logger.warn(`[Registration] 点击 ${desc} 后页面未变化，继续点击可用入口`);
          }
        } catch (e) {  }
      }

      if (await this._waitForSignupForm(250)) {
        return true;
      }

      const currentUrl = this.page.url();
      if (currentUrl.includes('auth.openai.com') && !currentUrl.includes('/auth/login')) {
        return true;
      }

      await this.page.waitForTimeout(250);
    }

    if (await this._waitForSignupForm(1000)) {
      this.logger.info('[Registration] 页面已自动跳转到注册表单');
      return true;
    }

    this.logger.error(`[Registration] 找不到注册按钮，当前 URL: ${this.page.url()}`);
    return false;
  }

  // 等待点击注册后的变化
  async _waitForSignUpClickResult(beforeUrl, timeoutMs) {
    let result = 'none';
    await this._waitUntil(async () => {
      if (await this._isOnSignupForm()) {
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
  async _closePageOverlay() {
    await this.page.keyboard.press('Escape').catch(() => {});
  }

  // 等待登录页可操作
  async _waitForLoginPageReady() {
    return await this._waitUntil(async () => {
      return await this._detectCloudflare() ||
        await this._isOnSignupForm() ||
        await this._hasSignUpEntry();
    }, this.config.signUpButtonTimeoutMs, 250);
  }

  // 判断是否有注册入口
  async _hasSignUpEntry() {
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
  async _isOnSignupForm() {
    return !!(await this._findEmailInput(0));
  }

  // 等待注册表单出现
  async _waitForSignupForm(timeoutMs) {
    return await this._waitUntil(async () => await this._isOnSignupForm(), timeoutMs, 250);
  }

  // 填写邮箱
  async _fillEmail(email) {
    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const filled = await this._fillEmailInput(email, attempt === 1 ? 5000 : 1200);
        if (!filled) {
          if (await this._findPasswordInput(500)) {
            return 'ok';
          }

          this.logger.warn('[Registration] 暂时找不到可填写的邮箱输入框，重新尝试');
          continue;
        }

        this.logger.info(`[Registration] 已输入邮箱: ${email}`);

        await this._waitForContinueButtonReady(5000);
        const clicked = await this._clickContinueButton();
        if (!clicked) {
          this.logger.error('[Registration] 找不到继续按钮');
          return RegisterResult.UNKNOWN_ERROR;
        }

        this.logger.info('[Registration] 已点击继续');

        const submitResult = await this._waitForEmailSubmitResult();
        if (submitResult === 'ok') {
          return 'ok';
        }
        if (submitResult === 'email_required') {
          this.logger.warn('[Registration] 页面清空了邮箱，重新填写');
          continue;
        }
        if (submitResult !== 'pending') {
          return submitResult;
        }

        const emailInput = await this._findEmailInput(500);
        if (!emailInput) {
          this.logger.warn('[Registration] 邮箱提交后正在跳转或重绘，未再强等邮箱框');
          continue;
        }
      }

      return RegisterResult.UNKNOWN_ERROR;
    } catch (error) {
      this.logger.error(`[Registration] 填写邮箱失败: ${error.message}`);
      return RegisterResult.UNKNOWN_ERROR;
    }
  }

  // 填入邮箱并确认没有被页面清空
  async _fillEmailInput(email, timeoutMs = 5000) {
    const emailInput = await this._findEmailInput(timeoutMs);
    if (!emailInput) {
      return false;
    }

    return await this._fillInputAndConfirm(emailInput, email, '邮箱');
  }

  // 填入内容并确认没有被页面清空
  async _fillInputAndConfirm(locator, value, label, options = {}) {
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
        await this._typeHumanLike(locator, text);
      }

      if (await this._waitForInputValue(locator, text, timeoutMs)) {
        return true;
      }

      this.logger.warn(`[Registration] ${label}输入后没有留在输入框内，重新填写`);
      await locator.fill(text).catch(() => {});
      if (await this._waitForInputValue(locator, text, 1000)) {
        return true;
      }
    }

    return false;
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

  // 查找邮箱输入框
  async _findEmailInput(timeoutMs = 5000) {
    const emailInput = this.page.locator('input[name="email"], input[type="email"], input[id="email"]');
    return await this._findVisibleLocator(emailInput, timeoutMs);
  }

  // 查找密码输入框
  async _findPasswordInput(timeoutMs = 0) {
    const pwdInput = this.page.locator('input[type="password"], input[name="new-password"], input[name="password"]');
    return await this._findVisibleLocator(pwdInput, timeoutMs);
  }

  // 等待邮箱提交结果
  async _waitForEmailSubmitResult() {
    let result = 'pending';
    await this._waitUntil(async () => {
      if (await this._findPasswordInput()) {
        result = 'ok';
        return true;
      }

      const errorText = await this._readFirstErrorText();
      const emailError = this._classifyEmailError(errorText);
      if (emailError) {
        result = emailError;
        return true;
      }

      if (await this._detectCaptcha()) {
        result = RegisterResult.CAPTCHA;
        return true;
      }

      return false;
    }, Math.min(this.config.passwordInputTimeoutMs || 10000, 10000), 250);

    return result;
  }

  // 点击继续按钮
  async _clickContinueButton() {
    const btn = await this._findContinueButton();
    if (!btn) {
      return false;
    }

    await btn.click();
    return true;
  }

  // 查找继续按钮
  async _findContinueButton() {
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
      if (this._shouldSkipButton(text)) {
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
      if (this._shouldSkipButton(text)) {
        continue;
      }
      if (await btn.isVisible() && await btn.isEnabled()) {
        return btn;
      }
    }

    return null;
  }

  // 判断按钮是否应该跳过
  _shouldSkipButton(text) {
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

  // 等待继续按钮可用
  async _waitForContinueButtonReady(timeoutMs) {
    return await this._waitUntil(async () => !!(await this._findContinueButton()), timeoutMs, 200);
  }

  // 读取页面错误文字
  async _readFirstErrorText(extraSelectors = []) {
    for (const sel of [...ERROR_SELECTORS, ...extraSelectors]) {
      const el = this.page.locator(sel);
      const visibleEl = await this._findVisibleLocator(el, 0);
      if (visibleEl) {
        return (await visibleEl.textContent()).trim().toLowerCase();
      }
    }

    return '';
  }

  // 判断邮箱提交后的错误类型
  _classifyEmailError(errorText) {
    if (!errorText) {
      return null;
    }

    if ((errorText.includes('email') && errorText.includes('required')) ||
        errorText.includes('email is required') ||
        errorText.includes('请输入邮箱')) {
      return 'email_required';
    }

    if (errorText.includes('not supported') || errorText.includes('不支持') ||
        errorText.includes('not accepted') || errorText.includes('无法使用') ||
        errorText.includes('invalid email') || errorText.includes('邮箱无效')) {
      return RegisterResult.DOMAIN_REJECTED;
    }

    if (errorText.includes('already') || errorText.includes('已注册') || errorText.includes('exists')) {
      return RegisterResult.ALREADY_EXISTS;
    }

    if (errorText.includes('rate limit') || errorText.includes('too many') || errorText.includes('频率')) {
      return RegisterResult.RATE_LIMITED;
    }

    if (this._isCreateAccountFailed(errorText)) {
      return RegisterResult.DOMAIN_REJECTED;
    }

    return null;
  }

  // 读取页面可见文字
  async _readVisibleBodyText() {
    try {
      return ((await this.page.locator('body').innerText({ timeout: 1000 })) || '').toLowerCase();
    } catch (e) {
      const text = await this.page.textContent('body').catch(() => '');
      return (text || '').toLowerCase();
    }
  }

  // 等到条件满足
  async _waitUntil(check, timeoutMs, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await check()) {
        return true;
      }

      await this.page.waitForTimeout(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    }

    return false;
  }

  // 等待输入值同步
  async _waitForInputValue(locator, expected, timeoutMs) {
    return await this._waitUntil(async () => {
      const value = await locator.inputValue().catch(() => '');
      return value === expected;
    }, timeoutMs, 150);
  }

  // 判断是否已经创建失败
  _isCreateAccountFailed(text) {
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
  _isPersonalInfoPage(url, lowerText) {
    return (url.includes('onboarding') ||
      url.includes('about_you') ||
      lowerText.includes('tell us about you') ||
      lowerText.includes('what should we call you') ||
      lowerText.includes("let's confirm your age") ||
      lowerText.includes('how old are you') ||
      lowerText.includes('full name') ||
      lowerText.includes('finish creating account') ||
      lowerText.includes('birthday') ||
      lowerText.includes('生日')) &&
      !url.includes('password');
  }

  // 检查邮箱是否可用
  async _checkEmailStatus() {
    try {
      const deadline = Date.now() + this.config.passwordInputTimeoutMs;
      let lastUrl = this.page.url();
      let lastErrorText = '';

      while (Date.now() <= deadline) {
        const url = this.page.url();
        lastUrl = url;

        if (await this._findPasswordInput()) {
          this.logger.info('[Registration] 密码输入框已出现，邮箱通过');
          return 'ok';
        }

        const errorText = await this._readFirstErrorText();

        if (errorText) {
          const emailError = this._classifyEmailError(errorText);
          if (emailError && emailError !== 'email_required') {
            this.logger.warn(`[Registration] 邮箱状态异常: ${errorText}`);
            return emailError;
          }
          if (emailError === 'email_required') {
            this.logger.warn('[Registration] 邮箱被页面清空，需要重新尝试');
            return RegisterResult.UNKNOWN_ERROR;
          }
          if (errorText !== lastErrorText) {
            this.logger.warn(`[Registration] 页面错误信息: ${errorText}`);
            lastErrorText = errorText;
          }
        }

        const lowerText = await this._readVisibleBodyText();
        if (this._isCreateAccountFailed(lowerText)) {
          this.logger.warn('[Registration] 创建账户失败（邮箱后页面检测）');
          return RegisterResult.DOMAIN_REJECTED;
        }

        if (lowerText.includes('your session has ended')) {
          this.logger.warn('[Registration] 会话已结束，重新尝试');
          return RegisterResult.UNKNOWN_ERROR;
        }

        if (await this._detectCaptcha()) {
          return RegisterResult.CAPTCHA;
        }

        await this.page.waitForTimeout(500);
      }

      this.logger.warn(`[Registration] 密码输入框未出现，当前 URL: ${lastUrl}`);
      return RegisterResult.UNKNOWN_ERROR;
    } catch (error) {
      this.logger.error(`[Registration] 检查邮箱状态异常: ${error.message}`);
      return RegisterResult.UNKNOWN_ERROR;
    }
  }

  // 填写密码
  async _fillPassword() {
    try {
      const pwdInput = await this._findPasswordInput(this.config.passwordInputTimeoutMs);
      if (!pwdInput) {
        this.logger.error('[Registration] 密码输入框未出现');
        return RegisterResult.UNKNOWN_ERROR;
      }

      const passwordFilled = await this._fillInputAndConfirm(pwdInput, this.config.password, '密码');
      if (!passwordFilled) {
        return RegisterResult.UNKNOWN_ERROR;
      }

      this.logger.info('[Registration] 已输入密码');

      await this._waitForPasswordReady();

      for (let i = 0; i < 2; i++) {
        const clicked = await this._clickContinueButton();
        if (!clicked) {
          this.logger.error('[Registration] 找不到密码提交按钮');
          return RegisterResult.UNKNOWN_ERROR;
        }
        this.logger.info('[Registration] 已提交密码');

        const submitStatus = await this._waitForPasswordSubmitResult();
        if (submitStatus === 'ok') {
          return 'ok';
        }
        if (submitStatus !== 'no_change') {
          return submitStatus;
        }

        if (i === 0) {
          const currentPassword = await pwdInput.inputValue().catch(() => '');
          if (currentPassword !== this.config.password) {
            this.logger.warn('[Registration] 页面清空了密码，重新填写');
            const refilled = await this._fillInputAndConfirm(pwdInput, this.config.password, '密码');
            if (!refilled) {
              return RegisterResult.UNKNOWN_ERROR;
            }
            await this._waitForPasswordReady();
          }
          this.logger.warn('[Registration] 密码提交后页面未变化，重试点击继续');
        }
      }

      this.logger.warn('[Registration] 密码提交后仍停留在密码页，重新尝试');
      return RegisterResult.UNKNOWN_ERROR;
    } catch (error) {
      this.logger.error(`[Registration] 填写密码失败: ${error.message}`);
      return RegisterResult.UNKNOWN_ERROR;
    }
  }

  // 等待密码页可以提交
  async _waitForPasswordReady() {
    return await this._waitUntil(async () => {
      const lowerText = await this._readVisibleBodyText();
      const submitBtn = await this._findContinueButton();
      if (submitBtn) {
        if (!lowerText.includes('at least 12 characters') || lowerText.includes('complete') || lowerText.includes('完成')) {
          return true;
        }
      }
      return false;
    }, 5000, 250);
  }

  // 等待密码提交后的页面变化
  async _waitForPasswordSubmitResult() {
    let result = 'no_change';
    await this._waitUntil(async () => {
      const url = this.page.url();
      const lowerText = await this._readVisibleBodyText();

      if (this._isCreateAccountFailed(lowerText)) {
        this.logger.warn('[Registration] 创建账户失败（密码提交后检测）');
        result = RegisterResult.DOMAIN_REJECTED;
        return true;
      }

      if (lowerText.includes('verify your email') || lowerText.includes('check your email') ||
          lowerText.includes('verification code') || lowerText.includes('enter code') ||
          lowerText.includes('we sent') || lowerText.includes('已发送') ||
          this._isPersonalInfoPage(url, lowerText) ||
          (url.includes('chatgpt.com') && !url.includes('auth') && !url.includes('login'))) {
        result = 'ok';
        return true;
      }

      if (!(await this._findPasswordInput())) {
        result = 'ok';
        return true;
      }

      return false;
    }, 5000, 300);

    return result;
  }

  // 检查注册结果
  async _checkRegistrationStatus() {
    try {
      const deadline = Date.now() + this.config.registrationStatusTimeoutMs;
      let lastUrl = this.page.url();

      while (Date.now() <= deadline) {
        const url = this.page.url();
        lastUrl = url;

        if (url.includes('chatgpt.com') && !url.includes('auth') && !url.includes('login')) {
          this.logger.info('[Registration] 注册成功（已进入主界面）');
          return { result: RegisterResult.SUCCESS, message: '注册成功' };
        }

        const errorText = await this._readFirstErrorText(['.c3b92929b']);

        if (errorText) {
          if (this._isCreateAccountFailed(errorText)) {
            this.logger.warn(`[Registration] 创建账户失败，需要换邮箱: ${errorText}`);
            return { result: RegisterResult.DOMAIN_REJECTED, message: `创建账户失败: ${errorText}` };
          }
        }

        const lowerText = await this._readVisibleBodyText();
        if (this._isCreateAccountFailed(lowerText)) {
          this.logger.warn('[Registration] 创建账户失败（全文检测），需要换邮箱');
          return { result: RegisterResult.DOMAIN_REJECTED, message: '创建账户失败，请重试' };
        }

        if (lowerText.includes('verify your email') || lowerText.includes('验证你的邮箱') ||
            lowerText.includes('check your email') || lowerText.includes('查看你的邮箱') ||
            lowerText.includes('check your inbox') || lowerText.includes('查看邮箱') ||
            lowerText.includes('we sent') || lowerText.includes('已发送') ||
            lowerText.includes('verification email') || lowerText.includes('验证邮件')) {
          this.logger.info('[Registration] 需要邮箱验证');
          return { result: RegisterResult.NEED_VERIFICATION, message: '需要邮箱验证' };
        }

        if (this._isPersonalInfoPage(url, lowerText)) {
          const fillSuccess = await this._fillPersonalInfo();
          if (!fillSuccess) {
            return { result: RegisterResult.DOMAIN_REJECTED, message: '个人信息提交失败 (unsupported_email)' };
          }
          return { result: RegisterResult.SUCCESS, message: '注册成功（已填写个人信息）' };
        }

        if (await this._detectCaptcha()) {
          return { result: RegisterResult.CAPTCHA, message: 'CAPTCHA 验证' };
        }

        if (lowerText.includes('phone number') || lowerText.includes('手机号') ||
            lowerText.includes('verify your phone') || lowerText.includes('验证你的手机')) {
          return { result: RegisterResult.PHONE_REQUIRED, message: '需要手机验证' };
        }

        if (Date.now() <= deadline) {
          await this.page.waitForTimeout(this.config.statusCheckIntervalMs);
        }
      }

      this.logger.warn(`[Registration] 注册状态不明确，URL: ${lastUrl}`);

      if (lastUrl.includes('password') || lastUrl.includes('create-account')) {
        this.logger.warn('[Registration] 仍在密码/创建账号页面，判定为创建账户失败');
        return { result: RegisterResult.DOMAIN_REJECTED, message: '创建账户失败（页面未跳转）' };
      }

      return { result: RegisterResult.NEED_VERIFICATION, message: '可能需要验证（状态不明确）' };
    } catch (error) {
      this.logger.error(`[Registration] 检查注册状态异常: ${error.message}`);
      return { result: RegisterResult.UNKNOWN_ERROR, message: error.message };
    }
  }

  // 打开验证链接
  async _handleVerificationLink(link) {
    try {
      this.logger.info(`[Registration] 打开验证链接: ${link.substring(0, 80)}...`);
      await this.page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this._waitForKnownAuthState(5000);

      const url = this.page.url();
      const lowerText = await this._readVisibleBodyText();

      if (this._isPersonalInfoPage(url, lowerText)) {
        const fillSuccess = await this._fillPersonalInfo();
        if (!fillSuccess) {
          return { result: RegisterResult.DOMAIN_REJECTED, message: '验证后个人信息提交失败 (unsupported_email)' };
        }
        return { result: RegisterResult.SUCCESS, message: '验证成功（已填写个人信息）' };
      }

      if (url.includes('chatgpt.com') && !url.includes('auth')) {
        return { result: RegisterResult.SUCCESS, message: '验证成功，已进入主界面' };
      }

      if (lowerText.includes('verified') || lowerText.includes('已验证') ||
          lowerText.includes('success') || lowerText.includes('成功') ||
          lowerText.includes('welcome') || lowerText.includes('欢迎')) {
        return { result: RegisterResult.SUCCESS, message: '验证成功' };
      }

      if (url.includes('about_you') || lowerText.includes('name') ||
          lowerText.includes('姓名') || lowerText.includes('tell us')) {
        const fillSuccess = await this._fillPersonalInfo();
        if (!fillSuccess) {
          return { result: RegisterResult.DOMAIN_REJECTED, message: '验证后个人信息提交失败 (unsupported_email)' };
        }
        return { result: RegisterResult.SUCCESS, message: '验证成功（已填写个人信息）' };
      }

      if (await this._detectCaptcha()) {
        return { result: RegisterResult.CAPTCHA, message: '验证页面出现 CAPTCHA' };
      }

      this.logger.warn(`[Registration] 验证后状态不明确，URL: ${url}`);
      return { result: RegisterResult.UNKNOWN_ERROR, message: '验证后状态不明确' };
    } catch (error) {
      this.logger.error(`[Registration] 验证链接处理失败: ${error.message}`);
      return { result: RegisterResult.UNKNOWN_ERROR, message: error.message };
    }
  }

  // 填写验证码
  async _handleOTP(otp) {
    try {
      this.logger.info(`[Registration] 输入 OTP: ${otp}`);
      const otpInput = await this._findOTPInput(5000);
      if (otpInput) {
        const otpFilled = await this._fillInputAndConfirm(otpInput, otp, 'OTP');
        if (!otpFilled) {
          return { result: RegisterResult.UNKNOWN_ERROR, message: 'OTP 输入后被页面清空' };
        }
        await this._waitForOTPReady(otpInput, otp);

        for (let i = 0; i < 2; i++) {
          const clicked = await this._clickContinueButton();
          if (!clicked) {
            return { result: RegisterResult.UNKNOWN_ERROR, message: '找不到 OTP 提交按钮' };
          }

          const submitStatus = await this._waitForOTPSubmitResult();
          if (submitStatus === 'ok') {
            break;
          }

          if (i === 0) {
            const currentOTP = await otpInput.inputValue().catch(() => '');
            if (currentOTP !== otp) {
              this.logger.warn('[Registration] 页面清空了 OTP，重新填写');
              const refilled = await this._fillInputAndConfirm(otpInput, otp, 'OTP');
              if (!refilled) {
                return { result: RegisterResult.UNKNOWN_ERROR, message: 'OTP 重新填写失败' };
              }
              await this._waitForOTPReady(otpInput, otp);
            }
            this.logger.warn('[Registration] OTP 提交后页面未变化，重试点击继续');
          } else {
            return { result: RegisterResult.UNKNOWN_ERROR, message: 'OTP 提交后页面未变化' };
          }
        }

        const url = this.page.url();
        const lowerText = await this._readVisibleBodyText();
        if (this._isPersonalInfoPage(url, lowerText)) {
          const fillSuccess = await this._fillPersonalInfo();
          if (!fillSuccess) {
            return { result: RegisterResult.DOMAIN_REJECTED, message: 'OTP 验证后个人信息提交失败 (unsupported_email)' };
          }
          return { result: RegisterResult.SUCCESS, message: 'OTP 验证成功（已填写个人信息）' };
        }

        if (url.includes('chatgpt.com') && !url.includes('auth')) {
          return { result: RegisterResult.SUCCESS, message: 'OTP 验证成功' };
        }

        const aboutYouError = await this._checkForAboutYouError();
        if (aboutYouError) {
          return { result: RegisterResult.DOMAIN_REJECTED, message: '验证过程中出错 (unsupported_email)' };
        }

        const finalUrl = this.page.url();
        if (finalUrl.includes('chatgpt.com') && !finalUrl.includes('auth')) {
          return { result: RegisterResult.SUCCESS, message: 'OTP 已提交，注册成功' };
        }
        if (finalUrl.includes('auth.openai.com')) {
          this.logger.warn(`[Registration] OTP 提交后仍在认证页面: ${finalUrl}`);
          return { result: RegisterResult.DOMAIN_REJECTED, message: 'OTP 提交后仍在认证页面' };
        }
        return { result: RegisterResult.SUCCESS, message: 'OTP 已提交' };
      }

      return { result: RegisterResult.UNKNOWN_ERROR, message: '找不到 OTP 输入框' };
    } catch (error) {
      this.logger.error(`[Registration] OTP 处理失败: ${error.message}`);
      return { result: RegisterResult.UNKNOWN_ERROR, message: error.message };
    }
  }

  // 查找验证码输入框
  async _findOTPInput(timeoutMs = 0) {
    const locators = [
      this.page.locator('input[name="code"], input[autocomplete="one-time-code"], input[name="otp"]'),
      this.page.locator('input[inputmode="numeric"], input[type="text"]'),
    ];
    const deadline = Date.now() + timeoutMs;

    while (true) {
      for (const locator of locators) {
        const input = await this._findVisibleLocator(locator, 0);
        if (input) {
          return input;
        }
      }

      if (Date.now() >= deadline) {
        return null;
      }

      await this.page.waitForTimeout(Math.min(200, Math.max(0, deadline - Date.now())));
    }
  }

  // 等待认证页面出现明确状态
  async _waitForKnownAuthState(timeoutMs) {
    return await this._waitUntil(async () => {
      const url = this.page.url();
      const lowerText = await this._readVisibleBodyText();
      return this._isPersonalInfoPage(url, lowerText) ||
        this._isCreateAccountFailed(lowerText) ||
        lowerText.includes('verified') ||
        lowerText.includes('success') ||
        lowerText.includes('welcome') ||
        (url.includes('chatgpt.com') && !url.includes('auth'));
    }, timeoutMs, 250);
  }

  // 等待 OTP 输入完成
  async _waitForOTPReady(otpInput, otp) {
    return await this._waitUntil(async () => {
      const value = await otpInput.inputValue().catch(() => '');
      const submitBtn = await this._findContinueButton();
      if (value.length >= otp.length && submitBtn) {
        return true;
      }
      return false;
    }, 5000, 250);
  }

  // 等待 OTP 提交后的页面变化
  async _waitForOTPSubmitResult() {
    let result = 'no_change';
    await this._waitUntil(async () => {
      const url = this.page.url();
      const lowerText = await this._readVisibleBodyText();

      if (this._isPersonalInfoPage(url, lowerText) ||
          (url.includes('chatgpt.com') && !url.includes('auth')) ||
          this._isCreateAccountFailed(lowerText)) {
        result = 'ok';
        return true;
      }

      if (!(await this._findOTPInput())) {
        result = 'ok';
        return true;
      }

      return false;
    }, 5000, 300);

    return result;
  }

  // 填写个人信息
  async _fillPersonalInfo() {
    try {
      this.logger.info('[Registration] 尝试填写个人信息...');
      await this._waitForPersonalInfoForm(5000);

      const nameInput = await this._findNameInput();
      if (nameInput) {
        const nameFilled = await this._fillInputAndConfirm(nameInput, this._getFullName(), '名字');
        if (!nameFilled) {
          return false;
        }
        this.logger.info('[Registration] 已填写名字');
      }

      const lastNameInput = this.page.locator('input[name="lastName"], input[name="last_name"]');
      const visibleLastNameInput = await this._findVisibleLocator(lastNameInput, 0);
      if (visibleLastNameInput) {
        const lastNameFilled = await this._fillInputAndConfirm(visibleLastNameInput, this.config.lastName, '姓');
        if (!lastNameFilled) {
          return false;
        }
        this.logger.info('[Registration] 已填写姓');
      }

      const ageFilled = await this._fillAge();
      if (!ageFilled) {
        await this._fillBirthdayFields();
        await this._fillBirthday();
      }

      await this._waitForPersonalInfoReady(5000);
      const clicked = await this._clickContinueButton();
      if (clicked) {
        this.logger.info('[Registration] 已提交个人信息');
      } else {
        this.logger.warn('[Registration] 找不到个人信息提交按钮');
        return false;
      }

      const refillResult = await this._refillPersonalInfoIfCleared();
      if (refillResult === 'submitted') {
        this.logger.info('[Registration] 个人信息被页面清空，已重新填写并提交');
      }

      const checks = Math.ceil(this.config.registrationStatusTimeoutMs / this.config.statusCheckIntervalMs);
      for (let i = 0; i < checks; i++) {
        await this._waitUntil(async () => {
          const url = this.page.url();
          if (url.includes('chatgpt.com') && !url.includes('auth') && !url.includes('login')) {
            return true;
          }

          return await this._checkForAboutYouError();
        }, this.config.statusCheckIntervalMs, 250);
        const url = this.page.url();

        if (url.includes('chatgpt.com') && !url.includes('auth') && !url.includes('login')) {
          this.logger.info(`[Registration] 个人信息提交成功，已跳转到: ${url}`);
          return true;
        }

        const errorDetected = await this._checkForAboutYouError();
        if (errorDetected) {
          return false;
        }
      }

      const finalUrl = this.page.url();
      if (finalUrl.includes('auth.openai.com') || finalUrl.includes('auth0')) {
        this.logger.warn(`[Registration] 个人信息提交后仍在认证页面，判定为失败，URL: ${finalUrl}`);
        return false;
      }

      this.logger.warn(`[Registration] 个人信息提交后状态不明确，URL: ${finalUrl}`);
      return false;
    } catch (error) {
      this.logger.warn(`[Registration] 填写个人信息失败: ${error.message}`);
      return false;
    }
  }

  // 等待个人信息表单出现
  async _waitForPersonalInfoForm(timeoutMs) {
    return await this._waitUntil(async () => {
      return !!(await this._findNameInput()) ||
        !!(await this._findAgeInput()) ||
        !!(await this._findBirthdayInput());
    }, timeoutMs, 250);
  }

  // 等待个人信息可以提交
  async _waitForPersonalInfoReady(timeoutMs) {
    return await this._waitUntil(async () => {
      const nameInput = await this._findNameInput();
      if (nameInput) {
        const value = await nameInput.inputValue().catch(() => '');
        if (!value.trim()) {
          return false;
        }
      }

      const ageInput = await this._findAgeInput();
      if (ageInput) {
        const value = await ageInput.inputValue().catch(() => '');
        if (!value.trim()) {
          return false;
        }
      }

      return !!(await this._findContinueButton());
    }, timeoutMs, 250);
  }

  // 如果个人信息被清空就重新填写
  async _refillPersonalInfoIfCleared() {
    const stillPersonalPage = this._isPersonalInfoPage(this.page.url(), await this._readVisibleBodyText());
    if (!stillPersonalPage) {
      return 'not_needed';
    }

    const nameInput = await this._findNameInput();
    const ageInput = await this._findAgeInput();
    const nameValue = nameInput ? await nameInput.inputValue().catch(() => '') : '';
    const ageValue = ageInput ? await ageInput.inputValue().catch(() => '') : '';

    const nameMissing = !!nameInput && !nameValue.trim();
    const ageMissing = !!ageInput && !ageValue.trim();
    if (!nameMissing && !ageMissing) {
      return 'not_needed';
    }

    if (nameMissing) {
      const nameFilled = await this._fillInputAndConfirm(nameInput, this._getFullName(), '名字');
      if (!nameFilled) {
        return 'failed';
      }
    }

    if (ageMissing) {
      const ageFilled = await this._fillAge();
      if (!ageFilled) {
        return 'failed';
      }
    }

    await this._waitForPersonalInfoReady(5000);
    const clicked = await this._clickContinueButton();
    return clicked ? 'submitted' : 'failed';
  }

  // 读取完整姓名
  _getFullName() {
    if (this.config.fullName) {
      return this.config.fullName;
    }

    return [this.config.firstName, this.config.lastName].filter(Boolean).join(' ') || 'John Doe';
  }

  // 查找姓名输入框
  async _findNameInput() {
    const locators = [
      this.page.getByLabel('Full name'),
      this.page.getByLabel('Name'),
      this.page.getByLabel('姓名'),
      this.page.locator('input[name="name"], input[name="firstName"], input[name="first_name"]'),
      this.page.locator('input[placeholder*="name" i], input[aria-label*="name" i]'),
      this.page.locator('input[placeholder*="姓名"], input[aria-label*="姓名"]'),
    ];

    for (const locator of locators) {
      const count = await locator.count();
      for (let i = 0; i < count; i++) {
        const input = locator.nth(i);
        if (await input.isVisible()) {
          return input;
        }
      }
    }

    return null;
  }

  // 填写年龄
  async _fillAge() {
    const ageInput = await this._findAgeInput();
    if (!ageInput) {
      return false;
    }

    try {
      const ageText = String(this.config.age || '25');
      const age = Number(ageText);
      const min = Number(await ageInput.getAttribute('min'));
      const max = Number(await ageInput.getAttribute('max'));
      if ((Number.isFinite(min) && age < min) || (Number.isFinite(max) && age > max)) {
        this.logger.warn(`[Registration] 年龄不在页面允许范围内: ${ageText}`);
        return false;
      }

      const ageFilled = await this._fillInputAndConfirm(ageInput, ageText, '年龄', {
        direct: true,
        noClick: true,
      });
      if (!ageFilled) {
        return false;
      }
      this.logger.info(`[Registration] 已填写年龄 (${ageText}岁)`);
      return true;
    } catch (ageErr) {
      this.logger.warn(`[Registration] 年龄填写跳过: ${ageErr.message.substring(0, 60)}`);
      return false;
    }
  }

  // 查找年龄输入框
  async _findAgeInput() {
    const locators = [
      this.page.locator('input[name="age"], input[placeholder*="age" i], input[aria-label*="age" i]'),
      this.page.locator('input[type="number"][min][max]'),
      this.page.locator('input[placeholder*="年龄"], input[aria-label*="年龄"]'),
      this.page.getByLabel('Age'),
      this.page.getByLabel('年龄'),
    ];

    for (const locator of locators) {
      const count = await locator.count();
      for (let i = 0; i < count; i++) {
        const input = locator.nth(i);
        if (await input.isVisible()) {
          return input;
        }
      }
    }

    return null;
  }

  // 填写生日下拉框
  async _fillBirthdayFields() {
    const monthSelect = this.page.locator('select[name*="month"], select[id*="month"]');
    const visibleMonthSelect = await this._findVisibleLocator(monthSelect, 0);
    if (visibleMonthSelect) {
      await visibleMonthSelect.selectOption({ index: 1 });
      this.logger.info('[Registration] 已选择月份');
    }

    const daySelect = this.page.locator('select[name*="day"], select[id*="day"]');
    const visibleDaySelect = await this._findVisibleLocator(daySelect, 0);
    if (visibleDaySelect) {
      await visibleDaySelect.selectOption({ index: 15 });
      this.logger.info('[Registration] 已选择日期');
    }

    const yearSelect = this.page.locator('select[name*="year"], select[id*="year"]');
    const visibleYearSelect = await this._findVisibleLocator(yearSelect, 0);
    if (visibleYearSelect) {
      await visibleYearSelect.selectOption(this.config.birthdayDate.slice(0, 4));
      this.logger.info('[Registration] 已选择年份');
    }
  }

  // 填写生日
  async _fillBirthday() {
    const birthdayInput = await this._findBirthdayInput();
    if (!birthdayInput) {
      this.logger.warn('[Registration] 未找到生日输入框');
      return false;
    }

    try {
      const typeAttr = await birthdayInput.getAttribute('type');
      await birthdayInput.click();

      if (typeAttr === 'date') {
        const filled = await this._fillInputAndConfirm(birthdayInput, this.config.birthdayDate, '生日', { direct: true });
        if (!filled) {
          return false;
        }
      } else {
        const filled = await this._fillInputAndConfirm(birthdayInput, this.config.birthdayText, '生日');
        if (!filled) {
          return false;
        }
      }

      this.logger.info(`[Registration] 已填写生日 (${typeAttr || 'text'})`);
      return true;
    } catch (bdErr) {
      this.logger.warn(`[Registration] 生日填写跳过: ${bdErr.message.substring(0, 60)}`);
      return false;
    }
  }

  // 查找生日输入框
  async _findBirthdayInput() {
    const locators = [
      this.page.getByLabel('Birthday'),
      this.page.getByLabel('生日'),
      this.page.locator('input[name="birthday"], input[name="birthdate"], input[name="dob"], input[type="date"]'),
      this.page.locator('input[name*="birth" i], input[id*="birth" i], input[placeholder*="birth" i], input[aria-label*="birth" i]'),
      this.page.locator('input[placeholder*="生日"], input[aria-label*="生日"]'),
    ];

    for (const locator of locators) {
      const count = await locator.count();
      for (let i = 0; i < count; i++) {
        const input = locator.nth(i);
        if (await input.isVisible()) {
          return input;
        }
      }
    }

    return null;
  }

  // 检查个人信息页错误
  async _checkForAboutYouError() {
    try {
      const url = this.page.url();
      const lowerText = await this._readVisibleBodyText();

      if (lowerText.includes('糟糕') || lowerText.includes('出错了') ||
          lowerText.includes('unsupported_email') || lowerText.includes('unsupported email') ||
          lowerText.includes('验证过程中出错') || this._isCreateAccountFailed(lowerText)) {
        this.logger.warn(`[Registration] 个人信息提交后出错 (unsupported_email)，URL: ${url}`);
        return true;
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  // 检查页面保护
  async _detectCloudflare() {
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
  async _detectCaptcha() {
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
  async _typeHumanLike(locator, text) {
    const minDelay = this.config.typingDelayMin ?? 50;
    const maxDelay = this.config.typingDelayMax ?? 150;
    const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

    if (locator.pressSequentially) {
      await locator.pressSequentially(text, { delay });
    } else {
      await locator.type(text, { delay });
    }
  }

  // 关闭页面
  async close() {
    if (this.page && !this.page.isClosed()) {
      await this.page.close();
    }
  }
}

module.exports = { Registrar, RegisterResult };
