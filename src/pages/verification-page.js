// 处理邮箱验证码和验证链接
const { BasePage } = require('./base-page');
const { RegisterResult } = require('../register-result');

class VerificationPage extends BasePage {
  // 保存个人信息页
  constructor(page, config, logger, personalInfoPage) {
    super(page, config, logger);
    this.personalInfoPage = personalInfoPage;
  }

  // 打开验证链接
  async handleLink(link) {
    try {
      this.logger.info(`[Registration] 打开验证链接: ${link.substring(0, 80)}...`);
      await this.page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.waitForKnownAuthState(5000);

      const url = this.page.url();
      const lowerText = await this.readVisibleBodyText();

      if (this.isPersonalInfoPage(url, lowerText)) {
        const fillSuccess = await this.personalInfoPage.fill();
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

      if (await this.detectCaptcha()) {
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
  async handleOTP(otp) {
    try {
      this.logger.info(`[Registration] 输入 OTP: ${otp}`);
      const otpInput = await this.findOTPInput(5000);
      if (otpInput) {
        const otpFilled = await this.fillInputAndConfirm(otpInput, otp, 'OTP');
        if (!otpFilled) {
          return { result: RegisterResult.UNKNOWN_ERROR, message: 'OTP 输入后被页面清空' };
        }
        await this.waitForOTPReady(otpInput, otp);

        for (let i = 0; i < 2; i++) {
          const clicked = await this.clickContinueButton();
          if (!clicked) {
            return { result: RegisterResult.UNKNOWN_ERROR, message: '找不到 OTP 提交按钮' };
          }

          const submitStatus = await this.waitForOTPSubmitResult();
          if (submitStatus === 'ok') {
            break;
          }

          if (i === 0) {
            const currentOTP = await otpInput.inputValue().catch(() => '');
            if (currentOTP !== otp) {
              this.logger.warn('[Registration] 页面清空了 OTP，重新填写');
              const refilled = await this.fillInputAndConfirm(otpInput, otp, 'OTP');
              if (!refilled) {
                return { result: RegisterResult.UNKNOWN_ERROR, message: 'OTP 重新填写失败' };
              }
              await this.waitForOTPReady(otpInput, otp);
            }
            this.logger.warn('[Registration] OTP 提交后页面未变化，重试点击继续');
          } else {
            return { result: RegisterResult.UNKNOWN_ERROR, message: 'OTP 提交后页面未变化' };
          }
        }

        const url = this.page.url();
        const lowerText = await this.readVisibleBodyText();
        if (this.isPersonalInfoPage(url, lowerText)) {
          const fillSuccess = await this.personalInfoPage.fill();
          if (!fillSuccess) {
            return { result: RegisterResult.DOMAIN_REJECTED, message: 'OTP 验证后个人信息提交失败 (unsupported_email)' };
          }
          return { result: RegisterResult.SUCCESS, message: 'OTP 验证成功（已填写个人信息）' };
        }

        if (url.includes('chatgpt.com') && !url.includes('auth')) {
          return { result: RegisterResult.SUCCESS, message: 'OTP 验证成功' };
        }

        const aboutYouError = await this.personalInfoPage.checkError();
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
  async findOTPInput(timeoutMs = 0) {
    const locators = [
      this.page.locator('input[name="code"], input[autocomplete="one-time-code"], input[name="otp"]'),
      this.page.locator('input[inputmode="numeric"], input[type="text"]'),
    ];
    const deadline = Date.now() + timeoutMs;

    while (true) {
      for (const locator of locators) {
        const input = await this.findVisibleLocator(locator, 0);
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
  async waitForKnownAuthState(timeoutMs) {
    return await this.waitUntil(async () => {
      const url = this.page.url();
      const lowerText = await this.readVisibleBodyText();
      return this.isPersonalInfoPage(url, lowerText) ||
        this.isCreateAccountFailed(lowerText) ||
        lowerText.includes('verified') ||
        lowerText.includes('success') ||
        lowerText.includes('welcome') ||
        (url.includes('chatgpt.com') && !url.includes('auth'));
    }, timeoutMs, 250);
  }

  // 等待 OTP 输入完成
  async waitForOTPReady(otpInput, otp) {
    return await this.waitUntil(async () => {
      const value = await otpInput.inputValue().catch(() => '');
      const submitBtn = await this.findContinueButton();
      if (value.length >= otp.length && submitBtn) {
        return true;
      }
      return false;
    }, 5000, 250);
  }

  // 等待 OTP 提交后的页面变化
  async waitForOTPSubmitResult() {
    let result = 'no_change';
    await this.waitUntil(async () => {
      const url = this.page.url();
      const lowerText = await this.readVisibleBodyText();

      if (this.isPersonalInfoPage(url, lowerText) ||
          (url.includes('chatgpt.com') && !url.includes('auth')) ||
          this.isCreateAccountFailed(lowerText)) {
        result = 'ok';
        return true;
      }

      if (!(await this.findOTPInput())) {
        result = 'ok';
        return true;
      }

      return false;
    }, 5000, 300);

    return result;
  }
}

module.exports = { VerificationPage };
