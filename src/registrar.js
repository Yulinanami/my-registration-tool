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
      await this.page.waitForTimeout(2000);

      const cfUrl = this.page.url();
      this.logger.info(`[Registration] 页面加载完成，URL: ${cfUrl}`);
      if (await this._detectCloudflare()) {
        this.logger.warn('[Registration] 检测到 Cloudflare 挑战，等待通过...');
        for (let i = 0; i < 30; i++) {
          await this.page.waitForTimeout(1000);
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
        await this.page.waitForTimeout(2000);
      }

      this.logger.info('[Registration] 等待注册表单...');
      try {
        await this.page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 20000 });
      } catch (e) {
        this.logger.error(`[Registration] 邮箱输入框未出现，URL: ${this.page.url()}`);
        return { result: RegisterResult.UNKNOWN_ERROR, message: '注册表单加载失败' };
      }
      await this._randomDelay(1000, 2000);

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
      await this._randomDelay(2000, 4000);

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

    const url = this.page.url();
    if (url.includes('auth.openai.com') || url.includes('log-in-or-create')) {
      this.logger.info('[Registration] 已在注册表单页');
      return true;
    }

    const buttonSelectors = [
      { selector: 'a:has-text("Sign up")', desc: 'Sign up link' },
      { selector: 'button:has-text("Sign up")', desc: 'Sign up button' },
      { selector: 'a:has-text("免费注册")', desc: '免费注册 link' },
      { selector: 'button:has-text("免费注册")', desc: '免费注册 button' },
      { selector: 'a:has-text("注册")', desc: '注册 link' },
    ];

    for (const { selector, desc } of buttonSelectors) {
      try {
        const el = this.page.locator(selector);
        const count = await el.count();
        if (count > 0) {
          const text = await el.first().textContent();
          if (text && (text.includes('Google') || text.includes('Apple') || text.includes('Microsoft'))) {
            continue;
          }
          if (await el.first().isVisible()) {
            try {
              await Promise.all([
                this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
                el.first().click(),
              ]);
            } catch (navErr) {
              await this.page.waitForTimeout(3000);
            }
            this.logger.info(`[Registration] 点击注册按钮: ${desc}，当前 URL: ${this.page.url()}`);
            return true;
          }
        }
      } catch (e) {  }
    }

    await this.page.waitForTimeout(3000);
    const newUrl = this.page.url();
    if (newUrl.includes('auth.openai.com') || newUrl.includes('log-in-or-create')) {
      this.logger.info('[Registration] 页面已自动跳转到注册表单');
      return true;
    }

    this.logger.error(`[Registration] 找不到注册按钮，当前 URL: ${newUrl}`);
    return false;
  }

  // 填写邮箱
  async _fillEmail(email) {
    try {
      const emailInput = this.page.locator('input[name="email"], input[type="email"], input[id="email"]');
      await emailInput.first().waitFor({ state: 'visible', timeout: 15000 });

      await emailInput.first().click();
      await emailInput.first().fill('');
      await this._typeHumanLike(emailInput.first(), email);

      this.logger.info(`[Registration] 已输入邮箱: ${email}`);

      await this._randomDelay(500, 1500);
      const clicked = await this._clickContinueButton();
      if (!clicked) {
        this.logger.error('[Registration] 找不到继续按钮');
        return RegisterResult.UNKNOWN_ERROR;
      }

      this.logger.info('[Registration] 已点击继续');
      return 'ok';
    } catch (error) {
      this.logger.error(`[Registration] 填写邮箱失败: ${error.message}`);
      return RegisterResult.UNKNOWN_ERROR;
    }
  }

  // 点击继续按钮
  async _clickContinueButton() {
    const targetTexts = [
      '继续',
      'Continue',
      '下一步',
      'Next',
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
      if (text.includes('Google') || text.includes('Apple') || text.includes('Microsoft') || text.includes('手机')) {
        continue;
      }
      if (targetTexts.includes(text) && await btn.isVisible() && await btn.isEnabled()) {
        await btn.click();
        return true;
      }
    }

    const submitBtn = this.page.locator('button[type="submit"]');
    const submitCount = await submitBtn.count();
    for (let i = 0; i < submitCount; i++) {
      const btn = submitBtn.nth(i);
      const text = (await btn.textContent() || '').trim();
      if (text.includes('Google') || text.includes('Apple') || text.includes('Microsoft') || text.includes('手机')) {
        continue;
      }
      if (await btn.isVisible() && await btn.isEnabled()) {
        await btn.click();
        return true;
      }
    }

    return false;
  }

  // 读取页面错误文字
  async _readFirstErrorText(extraSelectors = []) {
    for (const sel of [...ERROR_SELECTORS, ...extraSelectors]) {
      const el = this.page.locator(sel);
      if (await el.count() > 0 && await el.first().isVisible()) {
        return (await el.first().textContent()).trim().toLowerCase();
      }
    }

    return '';
  }

  // 检查邮箱是否可用
  async _checkEmailStatus() {
    try {
      await this.page.waitForTimeout(3000);

      const pwdInput = this.page.locator('input[type="password"]');
      if (await pwdInput.count() > 0 && await pwdInput.first().isVisible()) {
        this.logger.info('[Registration] 密码输入框已出现，邮箱通过');
        return 'ok';
      }

      const url = this.page.url();
      if (url.includes('password') || url.includes('create-account')) {
        this.logger.info('[Registration] 已进入密码/创建账号页面');
        return 'ok';
      }

      const errorText = await this._readFirstErrorText();

      if (errorText) {
        if (errorText.includes('not supported') || errorText.includes('不支持') ||
            errorText.includes('not accepted') || errorText.includes('无法使用') ||
            errorText.includes('invalid email') || errorText.includes('邮箱无效')) {
          this.logger.warn(`[Registration] 邮箱域名被拒绝: ${errorText}`);
          return RegisterResult.DOMAIN_REJECTED;
        }
        if (errorText.includes('already') || errorText.includes('已注册') || errorText.includes('exists')) {
          this.logger.warn(`[Registration] 邮箱已注册: ${errorText}`);
          return RegisterResult.ALREADY_EXISTS;
        }
        if (errorText.includes('rate limit') || errorText.includes('too many') || errorText.includes('频率')) {
          return RegisterResult.RATE_LIMITED;
        }
        this.logger.warn(`[Registration] 页面错误信息: ${errorText}`);
      }

      try {
        await this.page.waitForSelector('input[type="password"]', { timeout: 10000 });
        this.logger.info('[Registration] 密码输入框延迟出现，邮箱通过');
        return 'ok';
      } catch (e) {
        this.logger.warn(`[Registration] 未能确定邮箱状态，当前 URL: ${url}`);
        return RegisterResult.UNKNOWN_ERROR;
      }
    } catch (error) {
      this.logger.error(`[Registration] 检查邮箱状态异常: ${error.message}`);
      return RegisterResult.UNKNOWN_ERROR;
    }
  }

  // 填写密码
  async _fillPassword() {
    try {
      const pwdInput = this.page.locator('input[type="password"], input[name="new-password"], input[name="password"]');
      await pwdInput.first().waitFor({ state: 'visible', timeout: 10000 });

      await pwdInput.first().click();
      await pwdInput.first().fill('');
      await this._typeHumanLike(pwdInput.first(), this.config.password);

      this.logger.info('[Registration] 已输入密码');

      await this._randomDelay(500, 1500);

      const clicked = await this._clickContinueButton();
      if (!clicked) {
        this.logger.error('[Registration] 找不到密码提交按钮');
        return RegisterResult.UNKNOWN_ERROR;
      }
      this.logger.info('[Registration] 已提交密码');

      return 'ok';
    } catch (error) {
      this.logger.error(`[Registration] 填写密码失败: ${error.message}`);
      return RegisterResult.UNKNOWN_ERROR;
    }
  }

  // 检查注册结果
  async _checkRegistrationStatus() {
    try {
      await this.page.waitForTimeout(2000);

      const url = this.page.url();

      if (url.includes('chatgpt.com') && !url.includes('auth') && !url.includes('login')) {
        this.logger.info('[Registration] 注册成功（已进入主界面）');
        return { result: RegisterResult.SUCCESS, message: '注册成功' };
      }

      const errorText = await this._readFirstErrorText(['.c3b92929b']);

      if (errorText) {
        if (errorText.includes('sign up failed') || errorText.includes('创建帐户失败') ||
            errorText.includes('创建账户失败') || errorText.includes('registration failed')) {
          this.logger.warn(`[Registration] 创建账户失败，需要换邮箱: ${errorText}`);
          return { result: RegisterResult.DOMAIN_REJECTED, message: `创建账户失败: ${errorText}` };
        }
      }

      const pageText = await this.page.textContent('body');
      const lowerText = pageText.toLowerCase();
      if (lowerText.includes('sign up failed') || lowerText.includes('创建帐户失败') ||
          lowerText.includes('创建账户失败') || lowerText.includes('注册失败')) {
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

      if (url.includes('onboarding') || url.includes('about_you') ||
          lowerText.includes('tell us about you') ||
          lowerText.includes('what should we call you')) {
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

      this.logger.warn(`[Registration] 注册状态不明确，URL: ${url}`);

      if (url.includes('password') || url.includes('create-account')) {
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
      await this.page.waitForTimeout(2000);

      const url = this.page.url();
      const pageText = await this.page.textContent('body');
      const lowerText = pageText.toLowerCase();

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
      const otpInput = this.page.locator('input[type="text"], input[name="code"], input[name="otp"], input[autocomplete="one-time-code"]');
      if (await otpInput.count() > 0) {
        await otpInput.first().click();
        await this._typeHumanLike(otpInput.first(), otp);
        await this._randomDelay(500, 1000);

        const submitBtn = this.page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("继续"), button:has-text("Verify"), button:has-text("验证")');
        if (await submitBtn.count() > 0) {
          await submitBtn.first().click();
        }

        await this.page.waitForTimeout(2000);

        const url = this.page.url();
        if (url.includes('chatgpt.com') && !url.includes('auth')) {
          return { result: RegisterResult.SUCCESS, message: 'OTP 验证成功' };
        }

        const pageText = await this.page.textContent('body');
        const lowerText = pageText.toLowerCase();
        if (url.includes('about_you') || url.includes('onboarding') ||
            lowerText.includes('tell us') || lowerText.includes('name') ||
            lowerText.includes('what should we call')) {
          const fillSuccess = await this._fillPersonalInfo();
          if (!fillSuccess) {
            return { result: RegisterResult.DOMAIN_REJECTED, message: 'OTP 验证后个人信息提交失败 (unsupported_email)' };
          }
          return { result: RegisterResult.SUCCESS, message: 'OTP 验证成功（已填写个人信息）' };
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

  // 填写个人信息
  async _fillPersonalInfo() {
    try {
      this.logger.info('[Registration] 尝试填写个人信息...');
      await this.page.waitForTimeout(2000);

      const nameInput = this.page.locator('input[name="name"], input[name="firstName"], input[name="first_name"], input[placeholder*="name"], input[placeholder*="姓名"]');
      if (await nameInput.count() > 0 && await nameInput.first().isVisible()) {
        await nameInput.first().fill('');
        await this._typeHumanLike(nameInput.first(), 'John');
        this.logger.info('[Registration] 已填写名字');
      }

      const lastNameInput = this.page.locator('input[name="lastName"], input[name="last_name"]');
      if (await lastNameInput.count() > 0 && await lastNameInput.first().isVisible()) {
        await lastNameInput.first().fill('');
        await this._typeHumanLike(lastNameInput.first(), 'Doe');
        this.logger.info('[Registration] 已填写姓');
      }

      const monthSelect = this.page.locator('select[name*="month"], select[id*="month"]');
      if (await monthSelect.count() > 0 && await monthSelect.first().isVisible()) {
        await monthSelect.first().selectOption({ index: 1 });
        this.logger.info('[Registration] 已选择月份');
      }
      const daySelect = this.page.locator('select[name*="day"], select[id*="day"]');
      if (await daySelect.count() > 0 && await daySelect.first().isVisible()) {
        await daySelect.first().selectOption({ index: 15 });
        this.logger.info('[Registration] 已选择日期');
      }
      const yearSelect = this.page.locator('select[name*="year"], select[id*="year"]');
      if (await yearSelect.count() > 0 && await yearSelect.first().isVisible()) {
        await yearSelect.first().selectOption('2000');
        this.logger.info('[Registration] 已选择年份');
      }

      await this._fillBirthday();

      const ageInput = this.page.locator('input[name="age"], input[placeholder*="age"], input[placeholder*="年龄"]');
      if (await ageInput.count() > 0) {
        try {
          const ageEl = ageInput.first();
          if (await ageEl.isVisible()) {
            await ageEl.fill('');
            await this._typeHumanLike(ageEl, '25');
            this.logger.info('[Registration] 已填写年龄 (25岁)');
          }
        } catch (ageErr) {
          this.logger.warn(`[Registration] 年龄填写跳过: ${ageErr.message.substring(0, 60)}`);
        }
      }

      await this._randomDelay(500, 1500);
      const clicked = await this._clickContinueButton();
      if (clicked) {
        this.logger.info('[Registration] 已提交个人信息');
      }

      for (let i = 0; i < 15; i++) {
        await this.page.waitForTimeout(2000);
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

      return true;
    } catch (error) {
      this.logger.warn(`[Registration] 填写个人信息失败: ${error.message}`);
      return true;
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
        await birthdayInput.fill('2000-01-15');
      } else {
        await this.page.keyboard.press('Control+A');
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(100);
        await this._typeHumanLike(birthdayInput, '01/15/2000');
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
      const pageText = await this.page.textContent('body');
      const lowerText = pageText.toLowerCase();

      if (lowerText.includes('糟糕') || lowerText.includes('出错了') ||
          lowerText.includes('unsupported_email') || lowerText.includes('unsupported email') ||
          lowerText.includes('验证过程中出错') || lowerText.includes('something went wrong')) {
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

  // 等待一小段随机时间
  async _randomDelay(min, max) {
    const delay = Math.random() * (max - min) + min;
    await this.page.waitForTimeout(delay);
  }

  // 关闭页面
  async close() {
    if (this.page && !this.page.isClosed()) {
      await this.page.close();
    }
  }
}

module.exports = { Registrar, RegisterResult };
