// 串联注册流程里的各个页面步骤
const { extractVerification } = require('./parser');
const { RegisterResult } = require('./register-result');
const { SignUpPage } = require('./pages/sign-up-page');
const { EmailPage } = require('./pages/email-page');
const { PasswordPage } = require('./pages/password-page');
const { PersonalInfoPage } = require('./pages/personal-info-page');
const { RegistrationStatusPage } = require('./pages/registration-status-page');
const { VerificationPage } = require('./pages/verification-page');

class Registrar {
  // 保存浏览器和日志
  constructor(context, config, logger) {
    this.context = context;
    this.config = config;
    this.logger = logger;
    this.page = null;
    this.pages = null;
  }

  // 注册一个邮箱
  async register(email) {
    this.page = await this.context.newPage();
    this.pages = this.createPages();

    try {
      this.logger.info(`[Registration] 开始注册: ${email}`);

      await this.page.goto('https://chatgpt.com/auth/login', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await this.pages.signUp.waitForLoginPageReady();

      const cfUrl = this.page.url();
      this.logger.info(`[Registration] 页面加载完成，URL: ${cfUrl}`);
      if (await this.pages.signUp.detectCloudflare()) {
        const cloudflareResult = await this.waitForCloudflare();
        if (cloudflareResult) {
          return cloudflareResult;
        }
      }

      const curUrl = this.page.url();
      if (curUrl.includes('chatgpt.com')) {
        const signupClicked = await this.pages.signUp.clickSignUp();
        if (!signupClicked) {
          return { result: RegisterResult.UNKNOWN_ERROR, message: '找不到注册按钮' };
        }
      }

      this.logger.info('[Registration] 等待注册表单...');
      const signupFormReady = await this.pages.signUp.waitForSignupForm(20000);
      if (!signupFormReady) {
        this.logger.error(`[Registration] 邮箱输入框未出现，URL: ${this.page.url()}`);
        return { result: RegisterResult.UNKNOWN_ERROR, message: '注册表单加载失败' };
      }

      const emailResult = await this.pages.email.fill(email);
      if (emailResult !== 'ok') {
        return { result: emailResult, message: `邮箱填写失败: ${emailResult}` };
      }

      const passwordResult = await this.pages.password.fill();
      if (passwordResult !== 'ok') {
        return { result: passwordResult, message: `密码填写失败: ${passwordResult}` };
      }

      return await this.pages.status.check();
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

    if (!this.pages) {
      this.pages = this.createPages();
    }

    const verificationPage = this.pages.verification;
    if (verification.type === 'link') {
      return await verificationPage.handleLink(verification.value);
    }
    if (verification.type === 'otp') {
      return await verificationPage.handleOTP(verification.value);
    }

    return { result: RegisterResult.UNKNOWN_ERROR, message: '未知验证类型' };
  }

  // 创建页面处理器
  createPages() {
    const personalInfo = new PersonalInfoPage(this.page, this.config, this.logger);
    return {
      signUp: new SignUpPage(this.page, this.config, this.logger),
      email: new EmailPage(this.page, this.config, this.logger),
      password: new PasswordPage(this.page, this.config, this.logger),
      personalInfo,
      status: new RegistrationStatusPage(this.page, this.config, this.logger, personalInfo),
      verification: new VerificationPage(this.page, this.config, this.logger, personalInfo),
    };
  }

  // 等待页面保护通过
  async waitForCloudflare() {
    this.logger.warn('[Registration] 检测到 Cloudflare 挑战，等待通过...');
    const checks = Math.ceil(this.config.cloudflareMaxWaitMs / this.config.cloudflareCheckIntervalMs);
    for (let i = 0; i < checks; i++) {
      await this.page.waitForTimeout(this.config.cloudflareCheckIntervalMs);
      if (!(await this.pages.signUp.detectCloudflare())) break;
    }
    if (await this.pages.signUp.detectCloudflare()) {
      return { result: RegisterResult.CAPTCHA, message: 'Cloudflare 挑战未通过' };
    }
    this.logger.info('[Registration] Cloudflare 挑战已通过');
    return null;
  }

  // 关闭页面
  async close() {
    if (this.page && !this.page.isClosed()) {
      await this.page.close();
    }
  }
}

module.exports = { Registrar, RegisterResult };
