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
      this.logger.info(`[ChatGPT] 开始注册: ${email}`);

      // Step 1: 导航到登录页
      await this.page.goto('https://chatgpt.com/auth/login', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      // 等待页面稳定（Cloudflare 等）
      await this.page.waitForTimeout(5000);

      // 检查并等待 Cloudflare 挑战
      const cfUrl = this.page.url();
      this.logger.info(`[ChatGPT] 页面加载完成，URL: ${cfUrl}`);
      if (await this._detectCloudflare()) {
        this.logger.warn('[ChatGPT] 检测到 Cloudflare 挑战，等待通过...');
        for (let i = 0; i < 30; i++) {
          await this.page.waitForTimeout(1000);
          if (!(await this._detectCloudflare())) break;
        }
        if (await this._detectCloudflare()) {
          return { result: RegisterResult.CAPTCHA, message: 'Cloudflare 挑战未通过' };
        }
        this.logger.info('[ChatGPT] Cloudflare 挑战已通过');
      }

      // Step 2: 如果还在 chatgpt.com 入口页，点击注册
      const curUrl = this.page.url();
      if (curUrl.includes('chatgpt.com')) {
        const signupClicked = await this._clickSignUp();
        if (!signupClicked) {
          return { result: RegisterResult.UNKNOWN_ERROR, message: '找不到注册按钮' };
        }
        // 等待导航完成
        await this.page.waitForTimeout(5000);
      }

      // Step 3: 等待邮箱输入框出现
      this.logger.info('[ChatGPT] 等待注册表单...');
      try {
        await this.page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 20000 });
      } catch (e) {
        this.logger.error(`[ChatGPT] 邮箱输入框未出现，URL: ${this.page.url()}`);
        return { result: RegisterResult.UNKNOWN_ERROR, message: '注册表单加载失败' };
      }
      await this._randomDelay(1000, 2000);

      // Step 4: 填入邮箱
      const emailResult = await this._fillEmail(email);
      if (emailResult !== 'ok') {
        return { result: emailResult, message: `邮箱填写失败: ${emailResult}` };
      }

      // Step 5: 检查邮箱状态
      const emailStatus = await this._checkEmailStatus();
      if (emailStatus !== 'ok') {
        return { result: emailStatus, message: `邮箱状态异常: ${emailStatus}` };
      }

      // Step 6: 填入密码
      const passwordResult = await this._fillPassword();
      if (passwordResult !== 'ok') {
        return { result: passwordResult, message: `密码填写失败: ${passwordResult}` };
      }
      await this._randomDelay(2000, 4000);

      // Step 7: 检查注册结果
      return await this._checkRegistrationStatus();

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
    // ChatGPT 入口页面结构：
    // chatgpt.com/auth/login → 显示"登录"和"免费注册"两个按钮
    // 或直接显示 auth.openai.com 的登录/注册表单

    // 如果已经在 auth.openai.com 的表单页，直接返回成功
    const url = this.page.url();
    if (url.includes('auth.openai.com') || url.includes('log-in-or-create')) {
      this.logger.info('[ChatGPT] 已在注册表单页');
      return true;
    }

    // 精确匹配入口页的注册按钮（按优先级）
    const buttonSelectors = [
      // 英文版
      { selector: 'a:has-text("Sign up")', desc: 'Sign up link' },
      { selector: 'button:has-text("Sign up")', desc: 'Sign up button' },
      // 中文版
      { selector: 'a:has-text("免费注册")', desc: '免费注册 link' },
      { selector: 'button:has-text("免费注册")', desc: '免费注册 button' },
      { selector: 'a:has-text("注册")', desc: '注册 link' },
    ];

    for (const { selector, desc } of buttonSelectors) {
      try {
        const el = this.page.locator(selector);
        const count = await el.count();
        if (count > 0) {
          // 确保不是 Google/Apple SSO 按钮
          const text = await el.first().textContent();
          if (text && (text.includes('Google') || text.includes('Apple') || text.includes('Microsoft'))) {
            continue; // 跳过 SSO 按钮
          }
          if (await el.first().isVisible()) {
            // 用 Promise.all 确保点击后等导航完成
            try {
              await Promise.all([
                this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
                el.first().click(),
              ]);
            } catch (navErr) {
              // 导航可能已完成或没触发
              await this.page.waitForTimeout(3000);
            }
            this.logger.info(`[ChatGPT] 点击注册按钮: ${desc}，当前 URL: ${this.page.url()}`);
            return true;
          }
        }
      } catch (e) { /* 继续尝试 */ }
    }

    // 等一下看页面是否自动跳转到了注册表单
    await this.page.waitForTimeout(3000);
    const newUrl = this.page.url();
    if (newUrl.includes('auth.openai.com') || newUrl.includes('log-in-or-create')) {
      this.logger.info('[ChatGPT] 页面已自动跳转到注册表单');
      return true;
    }

    this.logger.error(`[ChatGPT] 找不到注册按钮，当前 URL: ${newUrl}`);
    return false;
  }

  /**
   * 填入邮箱地址
   */
  async _fillEmail(email) {
    try {
      // 等待邮箱输入框
      const emailInput = this.page.locator('input[name="email"], input[type="email"], input[id="email"]');
      await emailInput.first().waitFor({ state: 'visible', timeout: 15000 });

      // 清空并逐字输入（模拟人类）
      await emailInput.first().click();
      await emailInput.first().fill('');
      await this._typeHumanLike(emailInput.first(), email);

      this.logger.info(`[ChatGPT] 已输入邮箱: ${email}`);

      // 点击继续按钮（精确匹配，排除 Google/Apple/手机 SSO 按钮）
      await this._randomDelay(500, 1500);
      const clicked = await this._clickContinueButton();
      if (!clicked) {
        this.logger.error('[ChatGPT] 找不到继续按钮');
        return RegisterResult.UNKNOWN_ERROR;
      }

      this.logger.info('[ChatGPT] 已点击继续');
      return 'ok';
    } catch (error) {
      this.logger.error(`[ChatGPT] 填写邮箱失败: ${error.message}`);
      return RegisterResult.UNKNOWN_ERROR;
    }
  }

  /**
   * 精确点击"继续"提交按钮（排除 SSO 按钮）
   */
  async _clickContinueButton() {
    // 优先使用 type=submit 的按钮
    const submitBtn = this.page.locator('button[type="submit"]');
    if (await submitBtn.count() > 0 && await submitBtn.first().isVisible()) {
      await submitBtn.first().click();
      return true;
    }

    // 其次：遍历所有按钮，找只包含"继续"/"Continue"但不包含 SSO 文字的
    const allButtons = this.page.locator('button');
    const count = await allButtons.count();
    for (let i = 0; i < count; i++) {
      const btn = allButtons.nth(i);
      const text = (await btn.textContent() || '').trim();
      // 跳过 SSO 按钮
      if (text.includes('Google') || text.includes('Apple') || text.includes('Microsoft') || text.includes('手机')) {
        continue;
      }
      // 匹配纯粹的"继续"或"Continue"按钮
      if ((text === '继续' || text === 'Continue' || text === '下一步' || text === 'Next') && await btn.isVisible()) {
        await btn.click();
        return true;
      }
    }

    return false;
  }

  /**
   * 检查邮箱提交后的状态
   */
  async _checkEmailStatus() {
    try {
      // 先等待页面变化
      await this.page.waitForTimeout(3000);

      // 最可靠的判断：密码输入框是否已出现
      const pwdInput = this.page.locator('input[type="password"]');
      if (await pwdInput.count() > 0 && await pwdInput.first().isVisible()) {
        this.logger.info('[ChatGPT] 密码输入框已出现，邮箱通过');
        return 'ok';
      }

      // 其次检查 URL
      const url = this.page.url();
      if (url.includes('password') || url.includes('create-account')) {
        this.logger.info('[ChatGPT] 已进入密码/创建账号页面');
        return 'ok';
      }

      // 检查页面是否有明确的错误信息
      const errorSelectors = [
        '.error-message',
        '[role="alert"]',
        '.text-error',
        '.text-red',
        '.alert-error',
        '[data-testid*="error"]',
      ];
      let errorText = '';
      for (const sel of errorSelectors) {
        const el = this.page.locator(sel);
        if (await el.count() > 0 && await el.first().isVisible()) {
          errorText = (await el.first().textContent()).trim().toLowerCase();
          break;
        }
      }

      if (errorText) {
        if (errorText.includes('not supported') || errorText.includes('不支持') ||
            errorText.includes('not accepted') || errorText.includes('无法使用') ||
            errorText.includes('invalid email') || errorText.includes('邮箱无效')) {
          this.logger.warn(`[ChatGPT] 邮箱域名被拒绝: ${errorText}`);
          return RegisterResult.DOMAIN_REJECTED;
        }
        if (errorText.includes('already') || errorText.includes('已注册') || errorText.includes('exists')) {
          this.logger.warn(`[ChatGPT] 邮箱已注册: ${errorText}`);
          return RegisterResult.ALREADY_EXISTS;
        }
        if (errorText.includes('rate limit') || errorText.includes('too many') || errorText.includes('频率')) {
          return RegisterResult.RATE_LIMITED;
        }
        this.logger.warn(`[ChatGPT] 页面错误信息: ${errorText}`);
      }

      // 再等一会儿看密码框是否出现
      try {
        await this.page.waitForSelector('input[type="password"]', { timeout: 10000 });
        this.logger.info('[ChatGPT] 密码输入框延迟出现，邮箱通过');
        return 'ok';
      } catch (e) {
        // 密码框没出现
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

      // 点击提交（使用精确匹配）
      const clicked = await this._clickContinueButton();
      if (!clicked) {
        this.logger.error('[ChatGPT] 找不到密码提交按钮');
        return RegisterResult.UNKNOWN_ERROR;
      }
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

      // 检查是否直接注册成功（跳到聊天页面或欢迎页面）
      if (url.includes('chatgpt.com') && !url.includes('auth') && !url.includes('login')) {
        this.logger.info('[ChatGPT] 注册成功（已进入主界面）');
        return { result: RegisterResult.SUCCESS, message: '注册成功' };
      }

      // 检查页面上的错误提示（针对性扫描错误元素）
      const errorSelectors = [
        '.error-message',
        '[role="alert"]',
        '.text-error',
        '.text-red',
        '.alert-error',
        '[data-testid*="error"]',
        '.c3b92929b',  // OpenAI auth 页面的错误 class
      ];
      let errorText = '';
      for (const sel of errorSelectors) {
        const el = this.page.locator(sel);
        if (await el.count() > 0 && await el.first().isVisible()) {
          errorText = (await el.first().textContent()).trim().toLowerCase();
          break;
        }
      }

      if (errorText) {
        if (errorText.includes('sign up failed') || errorText.includes('创建帐户失败') ||
            errorText.includes('创建账户失败') || errorText.includes('registration failed')) {
          this.logger.warn(`[ChatGPT] 创建账户失败，需要换邮箱: ${errorText}`);
          return { result: RegisterResult.DOMAIN_REJECTED, message: `创建账户失败: ${errorText}` };
        }
      }

      // 也用全文检测（有时错误不在标准 alert 元素中）
      const pageText = await this.page.textContent('body');
      const lowerText = pageText.toLowerCase();
      if (lowerText.includes('sign up failed') || lowerText.includes('创建帐户失败') ||
          lowerText.includes('创建账户失败') || lowerText.includes('注册失败')) {
        this.logger.warn('[ChatGPT] 创建账户失败（全文检测），需要换邮箱');
        return { result: RegisterResult.DOMAIN_REJECTED, message: '创建账户失败，请重试' };
      }

      // 检查是否需要邮箱验证
      if (lowerText.includes('verify your email') || lowerText.includes('验证你的邮箱') ||
          lowerText.includes('check your email') || lowerText.includes('查看你的邮箱') ||
          lowerText.includes('check your inbox') || lowerText.includes('查看邮箱') ||
          lowerText.includes('we sent') || lowerText.includes('已发送') ||
          lowerText.includes('verification email') || lowerText.includes('验证邮件')) {
        this.logger.info('[ChatGPT] 需要邮箱验证');
        return { result: RegisterResult.NEED_VERIFICATION, message: '需要邮箱验证' };
      }

      // 检查是否需要补充个人信息
      if (url.includes('onboarding') || url.includes('about_you') ||
          lowerText.includes('tell us about you') ||
          lowerText.includes('what should we call you')) {
        const fillSuccess = await this._fillPersonalInfo();
        if (!fillSuccess) {
          return { result: RegisterResult.DOMAIN_REJECTED, message: '个人信息提交失败 (unsupported_email)' };
        }
        return { result: RegisterResult.SUCCESS, message: '注册成功（已填写个人信息）' };
      }

      // 检查 CAPTCHA
      if (await this._detectCaptcha()) {
        return { result: RegisterResult.CAPTCHA, message: 'CAPTCHA 验证' };
      }

      // 检查手机验证
      if (lowerText.includes('phone number') || lowerText.includes('手机号') ||
          lowerText.includes('verify your phone') || lowerText.includes('验证你的手机')) {
        return { result: RegisterResult.PHONE_REQUIRED, message: '需要手机验证' };
      }

      this.logger.warn(`[ChatGPT] 注册状态不明确，URL: ${url}`);

      // 如果 URL 仍在密码页面或创建账号页面，说明注册失败了
      if (url.includes('password') || url.includes('create-account')) {
        this.logger.warn('[ChatGPT] 仍在密码/创建账号页面，判定为创建账户失败');
        return { result: RegisterResult.DOMAIN_REJECTED, message: '创建账户失败（页面未跳转）' };
      }

      // 其它情况默认假设可能需要验证
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
      if (url.includes('about_you') || lowerText.includes('name') ||
          lowerText.includes('姓名') || lowerText.includes('tell us')) {
        const fillSuccess = await this._fillPersonalInfo();
        if (!fillSuccess) {
          return { result: RegisterResult.DOMAIN_REJECTED, message: '验证后个人信息提交失败 (unsupported_email)' };
        }
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

        // 检查是否需要填写个人信息（about_you 页面）
        const pageText = await this.page.textContent('body');
        const lowerText = pageText.toLowerCase();
        if (url.includes('about_you') || url.includes('onboarding') ||
            lowerText.includes('tell us') || lowerText.includes('name') ||
            lowerText.includes('what should we call')) {
          const fillSuccess = await this._fillPersonalInfo();
          if (!fillSuccess) {
            // 出现 unsupported_email 错误，需要换邮箱
            return { result: RegisterResult.DOMAIN_REJECTED, message: 'OTP 验证后个人信息提交失败 (unsupported_email)' };
          }
          return { result: RegisterResult.SUCCESS, message: 'OTP 验证成功（已填写个人信息）' };
        }

        // 检查是否已出现 unsupported_email 错误
        const aboutYouError = await this._checkForAboutYouError();
        if (aboutYouError) {
          return { result: RegisterResult.DOMAIN_REJECTED, message: '验证过程中出错 (unsupported_email)' };
        }

        // 最终 URL 验证：只有到了 chatgpt.com 才算真成功
        const finalUrl = this.page.url();
        if (finalUrl.includes('chatgpt.com') && !finalUrl.includes('auth')) {
          return { result: RegisterResult.SUCCESS, message: 'OTP 已提交，注册成功' };
        }
        // 仍在 auth 页面 = 有问题
        if (finalUrl.includes('auth.openai.com')) {
          this.logger.warn(`[ChatGPT] OTP 提交后仍在认证页面: ${finalUrl}`);
          return { result: RegisterResult.DOMAIN_REJECTED, message: 'OTP 提交后仍在认证页面' };
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
   * 自动填写个人信息（名字、年龄）
   * @returns {Promise<boolean>} true=成功，false=出现错误需要换邮箱
   */
  async _fillPersonalInfo() {
    try {
      this.logger.info('[ChatGPT] 尝试填写个人信息...');
      await this.page.waitForTimeout(2000);

      // 填写名字（各种可能的 name 属性）
      const nameInput = this.page.locator('input[name="name"], input[name="firstName"], input[name="first_name"], input[placeholder*="name"], input[placeholder*="姓名"]');
      if (await nameInput.count() > 0 && await nameInput.first().isVisible()) {
        await nameInput.first().fill('');
        await this._typeHumanLike(nameInput.first(), 'John');
        this.logger.info('[ChatGPT] 已填写名字');
      }

      // 填写姓
      const lastNameInput = this.page.locator('input[name="lastName"], input[name="last_name"]');
      if (await lastNameInput.count() > 0 && await lastNameInput.first().isVisible()) {
        await lastNameInput.first().fill('');
        await this._typeHumanLike(lastNameInput.first(), 'Doe');
        this.logger.info('[ChatGPT] 已填写姓');
      }

      // 填写年龄/生日（可能是 select 下拉或 input）
      // 先尝试 select 下拉（月/日/年）
      const monthSelect = this.page.locator('select[name*="month"], select[id*="month"]');
      if (await monthSelect.count() > 0 && await monthSelect.first().isVisible()) {
        await monthSelect.first().selectOption({ index: 1 }); // 1月
        this.logger.info('[ChatGPT] 已选择月份');
      }
      const daySelect = this.page.locator('select[name*="day"], select[id*="day"]');
      if (await daySelect.count() > 0 && await daySelect.first().isVisible()) {
        await daySelect.first().selectOption({ index: 15 }); // 15日
        this.logger.info('[ChatGPT] 已选择日期');
      }
      const yearSelect = this.page.locator('select[name*="year"], select[id*="year"]');
      if (await yearSelect.count() > 0 && await yearSelect.first().isVisible()) {
        await yearSelect.first().selectOption('2000');
        this.logger.info('[ChatGPT] 已选择年份');
      }

      // 再尝试 input 生日（如果有）
      const birthdayInput = this.page.locator('input[name="birthday"], input[name="birthdate"], input[name="dob"], input[type="date"]');
      if (await birthdayInput.count() > 0) {
        try {
          const bdEl = birthdayInput.first();
          if (await bdEl.isVisible()) {
            const typeAttr = await bdEl.getAttribute('type');
            if (typeAttr === 'date') {
              await bdEl.fill('2000-01-15');
            } else {
              await bdEl.click();
              // 清除已有的输入
              await this.page.keyboard.press('Control+A');
              await this.page.keyboard.press('Backspace');
              await this.page.waitForTimeout(100);
              // 模拟键盘逐个输入 MM/DD/YYYY
              await this._typeHumanLike(bdEl, '01/15/2000');
            }
            this.logger.info(`[ChatGPT] 已填写生日 (${typeAttr || 'text'})`);
          }
        } catch (bdErr) {
          this.logger.warn(`[ChatGPT] 生日填写跳过: ${bdErr.message.substring(0, 60)}`);
        }
      }

      // 尝试单一年龄输入框 (如果是直接问 "Age")
      const ageInput = this.page.locator('input[name="age"], input[placeholder*="age"], input[placeholder*="年龄"]');
      if (await ageInput.count() > 0) {
        try {
          const ageEl = ageInput.first();
          if (await ageEl.isVisible()) {
            await ageEl.fill('');
            await this._typeHumanLike(ageEl, '25');
            this.logger.info('[ChatGPT] 已填写年龄 (25岁)');
          }
        } catch (ageErr) {
          this.logger.warn(`[ChatGPT] 年龄填写跳过: ${ageErr.message.substring(0, 60)}`);
        }
      }

      // 点击继续/提交
      await this._randomDelay(500, 1500);
      const clicked = await this._clickContinueButton();
      if (clicked) {
        this.logger.info('[ChatGPT] 已提交个人信息');
      }

      // 多次轮询检查结果（最多 30 秒）
      for (let i = 0; i < 15; i++) {
        await this.page.waitForTimeout(2000);
        const url = this.page.url();

        // 真正成功：已跳到 ChatGPT 主页面
        if (url.includes('chatgpt.com') && !url.includes('auth') && !url.includes('login')) {
          this.logger.info(`[ChatGPT] 个人信息提交成功，已跳转到: ${url}`);
          return true;
        }

        // 出现错误页面
        const errorDetected = await this._checkForAboutYouError();
        if (errorDetected) {
          return false; // 失败，需要换邮箱
        }
      }

      // 30 秒后仍在 auth 页面 = 失败
      const finalUrl = this.page.url();
      if (finalUrl.includes('auth.openai.com') || finalUrl.includes('auth0')) {
        this.logger.warn(`[ChatGPT] 个人信息提交后仍在认证页面，判定为失败，URL: ${finalUrl}`);
        return false;
      }

      return true; // 到了其它页面，可能成功
    } catch (error) {
      this.logger.warn(`[ChatGPT] 填写个人信息失败: ${error.message}`);
      return true; // 非致命错误，继续
    }
  }

  /**
   * 检测 about_you 页面提交后的错误
   * 截图：auth.openai.com/about_you → "糟糕，出错了！验证过程中出错 (unsupported_email)"
   */
  async _checkForAboutYouError() {
    try {
      const url = this.page.url();
      const pageText = await this.page.textContent('body');
      const lowerText = pageText.toLowerCase();

      // 检测中文错误
      if (lowerText.includes('糟糕') || lowerText.includes('出错了') ||
          lowerText.includes('unsupported_email') || lowerText.includes('unsupported email') ||
          lowerText.includes('验证过程中出错') || lowerText.includes('something went wrong')) {
        this.logger.warn(`[ChatGPT] 个人信息提交后出错 (unsupported_email)，URL: ${url}`);
        return true;
      }

      return false;
    } catch (e) {
      return false;
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
