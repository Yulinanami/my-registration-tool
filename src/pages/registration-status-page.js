// 判断注册提交后的页面状态
const { BasePage } = require('./base-page');
const { RegisterResult } = require('../register-result');

class RegistrationStatusPage extends BasePage {
  // 保存个人信息页
  constructor(page, config, logger, personalInfoPage) {
    super(page, config, logger);
    this.personalInfoPage = personalInfoPage;
  }

  // 检查注册结果
  async check() {
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

        const errorText = await this.readFirstErrorText(['.c3b92929b']);
        if (errorText && this.isCreateAccountFailed(errorText)) {
          this.logger.warn(`[Registration] 创建账户失败，需要换邮箱: ${errorText}`);
          return { result: RegisterResult.DOMAIN_REJECTED, message: `创建账户失败: ${errorText}` };
        }

        const lowerText = await this.readVisibleBodyText();
        if (this.isCreateAccountFailed(lowerText)) {
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

        if (this.isPersonalInfoPage(url, lowerText)) {
          const fillSuccess = await this.personalInfoPage.fill();
          if (!fillSuccess) {
            return { result: RegisterResult.DOMAIN_REJECTED, message: '个人信息提交失败 (unsupported_email)' };
          }
          return { result: RegisterResult.SUCCESS, message: '注册成功（已填写个人信息）' };
        }

        if (await this.detectCaptcha()) {
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
}

module.exports = { RegistrationStatusPage };
