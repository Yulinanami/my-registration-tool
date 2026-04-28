/**
 * ChatGPT 注册自动化模块
 * 使用 Playwright 自动完成 ChatGPT 邮箱+密码注册流程
 */

const { extractVerification } = require('./mail-parser');

/**
 * 注册结果枚举
 */
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

class ChatGPTRegister {
  /**
   * @param {import('playwright').BrowserContext} context
   * @param {object} config
   * @param {import('winston').Logger} logger
   */
  constructor(context, config, logger) {
    this.context = context;
    this.config = config;
    this.logger = logger;
    this.page = null;
  }

  /**
   * 执行注册流程
   * @param {string} email
   * @returns {Promise<{result: string, message: string}>}
   */
  async register(email) {
    this.page = await this.context.newPage();

    try {
      // Step 1: 导航到登录页
      this.logger.info(`[ChatGPT] 开始注册: ${email}`);
      await this.page.goto('https://chatgpt.com/auth/login', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await this._randomDelay(2000, 4000);

      // Step 2: 点击注册按钮
      const signupClicked = await this._clickSignUp();
      if (!signupClicked) {
        return { result: RegisterResult.UNKNOWN_ERROR, message: '找不到注册按钮' };
      }
      await this._randomDelay(2000, 4000);

      // 检查是否有 Cloudflare 挑战
      if (await this._detectCloudflare()) {
        this.logger.warn('[ChatGPT] 检测到 Cloudflare 挑战');
        // 等待一段时间看用户是否手动通过
        await this.page.waitForTimeout(10000);
        if (await this._detectCloudflare()) {
          return { result: RegisterResult.CAPTCHA, message: 'Cloudflare 挑战未通过' };
        }
      }

      // Step 3: 填入邮箱
      const emailResult = await this._fillEmail(email);
      if (emailResult !== 'ok') {
        return { result: emailResult, message: `邮箱填写阶段失败: ${emailResult}` };
      }
      await this._randomDelay(2000, 4000);

      // Step 4: 检查邮箱提交后的状态
      const emailStatus = await this._checkEmailStatus();
      if (emailStatus !== 'ok') {
        return { result: emailStatus, message: `邮箱被拒绝或其它错误: ${emailStatus}` };
      }

      // Step 5: 填入密码
      const passwordResult = await this._fillPassword();
      if (passwordResult !== 'ok') {
        return { result: passwordResult, message: `密码填写阶段失败: ${passwordResult}` };
      }
      await this._randomDelay(2000, 4000);

      // Step 6: 检查注册结果
      const registerStatus = await this._checkRegistrationStatus();
      return registerStatus;

    } catch (error) {
      this.logger.error(`[ChatGPT] 注册异常: ${error.message}`);
      return { result: RegisterResult.UNKNOWN_ERROR, message: error.message };
    }
  }

  /**
   * 处理邮箱验证（点击验证链接或填入 OTP）
   * @param {{subject: string, from: string, body: string, html: string}} emailData
   * @returns {Promise<{result: string, message: string}>}
   */
  async handleVerification(emailData) {
    const verification = extractVerification(emailData);
    if (!verification) {
      return { result: RegisterResult.UNKNOWN_ERROR, message: '无法从邮件中提取验证信息' };
    }

    this.logger.info(`[ChatGPT] 验证类型: ${verification.type}, 值: ${verification.value.substring(0, 80)}...`);

    if (verification.type === 'link') {
      return await this._handleVerificationLink(verification.value);
    } else if (verification.type === 'otp') {
      return await this._handleOTP(verification.value);
    }

    return { result: RegisterResult.UNKNOWN_ERROR, message: '未知验证类型' };
  }

  /**
   * 点击注册按钮
   */
  async _clickSignUp() {
    // 尝试多种注册按钮选择器
    const selectors = [
      'text=Sign up',
      'text=免费注册',
      'text=注册',
      'a:has-text("Sign up")',
      'a:has-text("免费注册")',
      'button:has-text("Sign up")',
      'button:has-text("免费注册")',
      '[data-testid="signup-button"]',
    ];

    for (const sel of selectors) {
      try {
        const el = this.page.locator(sel);
        if (await el.count() > 0 && await el.first().isVisible()) {
          await el.first().click();
          this.logger.info(`[ChatGPT] 点击注册按钮: ${sel}`);
          return true;
        }
      } catch (e) { /* 继续尝试 */ }
    }

    // 如果已经在注册页面（URL 包含 signup 或 create），也算成功
    const url = this.page.url();
    if (url.includes('signup') || url.includes('create') || url.includes('log-in-or-create')) {
      this.logger.info('[ChatGPT] 已在注册页面');
      return true;
    }

    this.logger.error('[ChatGPT] 找不到注册按钮');
    return false;
  }

  /**
   * 填入邮箱地址
   */
  async _fillEmail(email) {
    try {
      // 等待邮箱输入框
      const emailInput = this.page.locator('input[name="email"], input[type="email"], input[id="email"], input[autocomplete="email"]');
      await emailInput.first().waitFor({ state: 'visible', timeout: 15000 });

      // 清空并逐字输入（模拟人类）
      await emailInput.first().click();
      await emailInput.first().fill('');
      await this._typeHumanLike(emailInput.first(), email);

      this.logger.info(`[ChatGPT] 已输入邮箱: ${email}`);

      // 点击继续按钮
      await this._randomDelay(500, 1500);
      const continueBtn = this.page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("继续")');
      await continueBtn.first().click();

      this.logger.info('[ChatGPT] 已点击继续');
      return 'ok';
    } catch (error) {
      this.logger.error(`[ChatGPT] 填写邮箱失败: ${error.message}`);
      return RegisterResult.UNKNOWN_ERROR;
    }
  }

  /**
   * 检查邮箱提交后的状态
   */
  async _checkEmailStatus() {
    try {
      // 等待页面变化
      await this.page.waitForTimeout(3000);

      const url = this.page.url();
      const pageText = await this.page.textContent('body');
      const lowerText = pageText.toLowerCase();

      // 检查是否进入密码页面（成功）
      if (url.includes('password') || url.includes('create-account')) {
        this.logger.info('[ChatGPT] 邮箱通过，进入密码页面');
        return 'ok';
      }

      // 检查密码输入框是否出现
      const pwdInput = this.page.locator('input[type="password"]');
      if (await pwdInput.count() > 0 && await pwdInput.first().isVisible()) {
        this.logger.info('[ChatGPT] 密码输入框已出现');
        return 'ok';
      }

      // 检查各种错误
      if (lowerText.includes('not supported') || lowerText.includes('不支持') ||
          lowerText.includes('not accepted') || lowerText.includes('无法使用') ||
          lowerText.includes('invalid email') || lowerText.includes('邮箱无效') ||
          lowerText.includes('domain')) {
        this.logger.warn('[ChatGPT] 邮箱域名被拒绝');
        return RegisterResult.DOMAIN_REJECTED;
      }

      if (lowerText.includes('already') || lowerText.includes('已注册') || lowerText.includes('exists')) {
        this.logger.warn('[ChatGPT] 邮箱已注册');
        return RegisterResult.ALREADY_EXISTS;
      }

      if (lowerText.includes('captcha') || lowerText.includes('turnstile') || lowerText.includes('challenge')) {
        return RegisterResult.CAPTCHA;
      }

      if (lowerText.includes('rate limit') || lowerText.includes('too many') || lowerText.includes('频率限制')) {
        return RegisterResult.RATE_LIMITED;
      }

      // 再等一会儿看密码框是否出现
      try {
        await this.page.waitForSelector('input[type="password"]', { timeout: 10000 });
        return 'ok';
      } catch (e) {
        // 密码框没出现，看看当前页面状态
        this.logger.warn(`[ChatGPT] 未能确定邮箱状态，当前 URL: ${url}`);
        return RegisterResult.UNKNOWN_ERROR;
      }
    } catch (error) {
      this.logger.error(`[ChatGPT] 检查邮箱状态异常: ${error.message}`);
      return RegisterResult.UNKNOWN_ERROR;
    }
  }

  /**
   * 填入密码
   */
  async _fillPassword() {
    try {
      const pwdInput = this.page.locator('input[type="password"], input[name="new-password"], input[name="password"]');
      await pwdInput.first().waitFor({ state: 'visible', timeout: 10000 });

      await pwdInput.first().click();
      await pwdInput.first().fill('');
      await this._typeHumanLike(pwdInput.first(), this.config.chatgptPassword);

      this.logger.info('[ChatGPT] 已输入密码');

      await this._randomDelay(500, 1500);

      // 点击提交
      const submitBtn = this.page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("继续")');
      await submitBtn.first().click();
      this.logger.info('[ChatGPT] 已提交密码');

      return 'ok';
    } catch (error) {
      this.logger.error(`[ChatGPT] 填写密码失败: ${error.message}`);
      return RegisterResult.UNKNOWN_ERROR;
    }
  }

  /**
   * 检查注册提交后的状态
   */
  async _checkRegistrationStatus() {
    try {
      await this.page.waitForTimeout(5000);

      const url = this.page.url();
      const pageText = await this.page.textContent('body');
      const lowerText = pageText.toLowerCase();

      // 检查是否需要邮箱验证
      if (lowerText.includes('verify') || lowerText.includes('验证') ||
          lowerText.includes('check your email') || lowerText.includes('查看邮箱') ||
          lowerText.includes('sent') || lowerText.includes('已发送') ||
          lowerText.includes('confirmation') || lowerText.includes('确认')) {
        this.logger.info('[ChatGPT] 需要邮箱验证');
        return { result: RegisterResult.NEED_VERIFICATION, message: '需要邮箱验证' };
      }

      // 检查是否直接注册成功（跳到聊天页面或欢迎页面）
      if (url.includes('chatgpt.com') && !url.includes('auth') && !url.includes('login')) {
        this.logger.info('[ChatGPT] 注册成功（已进入主界面）');
        return { result: RegisterResult.SUCCESS, message: '注册成功' };
      }

      // 检查是否需要补充个人信息
      if (lowerText.includes('name') || lowerText.includes('birthday') ||
          lowerText.includes('姓名') || lowerText.includes('生日')) {
        // 尝试自动填写
        await this._fillPersonalInfo();
        return { result: RegisterResult.SUCCESS, message: '注册成功（已填写个人信息）' };
      }

      // 检查 CAPTCHA
      if (await this._detectCaptcha()) {
        return { result: RegisterResult.CAPTCHA, message: 'CAPTCHA 验证' };
      }

      // 检查手机验证
      if (lowerText.includes('phone') || lowerText.includes('手机') || lowerText.includes('sms')) {
        return { result: RegisterResult.PHONE_REQUIRED, message: '需要手机验证' };
      }

      this.logger.warn(`[ChatGPT] 注册状态不明确，URL: ${url}`);
      return { result: RegisterResult.NEED_VERIFICATION, message: '可能需要验证（状态不明确）' };
    } catch (error) {
      this.logger.error(`[ChatGPT] 检查注册状态异常: ${error.message}`);
      return { result: RegisterResult.UNKNOWN_ERROR, message: error.message };
    }
  }

  /**
   * 处理验证链接
   */
  async _handleVerificationLink(link) {
    try {
      this.logger.info(`[ChatGPT] 打开验证链接: ${link.substring(0, 80)}...`);
      // 在当前页面打开验证链接
      await this.page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(5000);

      const url = this.page.url();
      const pageText = await this.page.textContent('body');
      const lowerText = pageText.toLowerCase();

      // 检查验证结果
      if (url.includes('chatgpt.com') && !url.includes('auth')) {
        return { result: RegisterResult.SUCCESS, message: '验证成功，已进入主界面' };
      }

      if (lowerText.includes('verified') || lowerText.includes('已验证') ||
          lowerText.includes('success') || lowerText.includes('成功') ||
          lowerText.includes('welcome') || lowerText.includes('欢迎')) {
        return { result: RegisterResult.SUCCESS, message: '验证成功' };
      }

      // 可能需要填写个人信息
      if (lowerText.includes('name') || lowerText.includes('birthday') ||
          lowerText.includes('姓名') || lowerText.includes('生日')) {
        await this._fillPersonalInfo();
        return { result: RegisterResult.SUCCESS, message: '验证成功（已填写个人信息）' };
      }

      // 检查是否有 CAPTCHA
      if (await this._detectCaptcha()) {
        return { result: RegisterResult.CAPTCHA, message: '验证页面出现 CAPTCHA' };
      }

      this.logger.warn(`[ChatGPT] 验证后状态不明确，URL: ${url}`);
      return { result: RegisterResult.UNKNOWN_ERROR, message: '验证后状态不明确' };
    } catch (error) {
      this.logger.error(`[ChatGPT] 验证链接处理失败: ${error.message}`);
      return { result: RegisterResult.UNKNOWN_ERROR, message: error.message };
    }
  }

  /**
   * 处理 OTP 验证码
   */
  async _handleOTP(otp) {
    try {
      this.logger.info(`[ChatGPT] 输入 OTP: ${otp}`);
      // 查找 OTP 输入框
      const otpInput = this.page.locator('input[type="text"], input[name="code"], input[name="otp"], input[autocomplete="one-time-code"]');
      if (await otpInput.count() > 0) {
        await otpInput.first().click();
        await this._typeHumanLike(otpInput.first(), otp);
        await this._randomDelay(500, 1000);

        // 提交
        const submitBtn = this.page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("继续"), button:has-text("Verify"), button:has-text("验证")');
        if (await submitBtn.count() > 0) {
          await submitBtn.first().click();
        }

        await this.page.waitForTimeout(5000);

        const url = this.page.url();
        if (url.includes('chatgpt.com') && !url.includes('auth')) {
          return { result: RegisterResult.SUCCESS, message: 'OTP 验证成功' };
        }

        // 检查是否需要填写个人信息
        const pageText = await this.page.textContent('body');
        if (pageText.toLowerCase().includes('name') || pageText.toLowerCase().includes('birthday')) {
          await this._fillPersonalInfo();
          return { result: RegisterResult.SUCCESS, message: 'OTP 验证成功（已填写个人信息）' };
        }

        return { result: RegisterResult.SUCCESS, message: 'OTP 已提交' };
      }

      return { result: RegisterResult.UNKNOWN_ERROR, message: '找不到 OTP 输入框' };
    } catch (error) {
      this.logger.error(`[ChatGPT] OTP 处理失败: ${error.message}`);
      return { result: RegisterResult.UNKNOWN_ERROR, message: error.message };
    }
  }

  /**
   * 自动填写个人信息（姓名、生日）
   */
  async _fillPersonalInfo() {
    try {
      this.logger.info('[ChatGPT] 尝试填写个人信息...');

      // 填写姓名
      const nameInput = this.page.locator('input[name="name"], input[name="firstName"], input[name="first_name"], input[placeholder*="name"], input[placeholder*="姓名"]');
      if (await nameInput.count() > 0) {
        await nameInput.first().fill('');
        await this._typeHumanLike(nameInput.first(), 'John');
        this.logger.info('[ChatGPT] 已填写名字');
      }

      // 填写姓
      const lastNameInput = this.page.locator('input[name="lastName"], input[name="last_name"]');
      if (await lastNameInput.count() > 0) {
        await lastNameInput.first().fill('');
        await this._typeHumanLike(lastNameInput.first(), 'Doe');
        this.logger.info('[ChatGPT] 已填写姓');
      }

      // 填写生日
      const birthdayInput = this.page.locator('input[name="birthday"], input[name="birthdate"], input[name="dob"], input[type="date"]');
      if (await birthdayInput.count() > 0) {
        await birthdayInput.first().fill('2000-01-15');
        this.logger.info('[ChatGPT] 已填写生日');
      }

      // 点击继续
      await this._randomDelay(500, 1500);
      const continueBtn = this.page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("继续"), button:has-text("Agree"), button:has-text("同意")');
      if (await continueBtn.count() > 0) {
        await continueBtn.first().click();
        await this.page.waitForTimeout(3000);
      }
    } catch (error) {
      this.logger.warn(`[ChatGPT] 填写个人信息失败（非致命）: ${error.message}`);
    }
  }

  /**
   * 检测 Cloudflare Turnstile 或其它 CAPTCHA
   */
  async _detectCloudflare() {
    try {
      const cf = this.page.locator('iframe[src*="challenges.cloudflare.com"], #cf-challenge-running, .cf-turnstile');
      return await cf.count() > 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * 检测 CAPTCHA（包括 reCAPTCHA、hCaptcha 等）
   */
  async _detectCaptcha() {
    try {
      const captcha = this.page.locator(
        'iframe[src*="challenges.cloudflare.com"], ' +
        'iframe[src*="recaptcha"], ' +
        'iframe[src*="hcaptcha"], ' +
        '.cf-turnstile, ' +
        '.g-recaptcha, ' +
        '.h-captcha, ' +
        '#captcha-container'
      );
      return await captcha.count() > 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * 模拟人类输入（逐字输入带随机延迟）
   */
  async _typeHumanLike(locator, text) {
    const { typingDelayMin = 50, typingDelayMax = 150 } = this.config;
    for (const char of text) {
      await locator.type(char, { delay: 0 });
      const delay = Math.random() * (typingDelayMax - typingDelayMin) + typingDelayMin;
      await this.page.waitForTimeout(delay);
    }
  }

  /**
   * 随机延迟
   */
  async _randomDelay(min, max) {
    const delay = Math.random() * (max - min) + min;
    await this.page.waitForTimeout(delay);
  }

  /**
   * 获取页面
   */
  getPage() {
    return this.page;
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

module.exports = { ChatGPTRegister, RegisterResult };
