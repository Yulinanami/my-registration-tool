// 处理密码输入和提交后的结果
const { BasePage } = require('./base-page');
const { RegisterResult } = require('../register-result');

class PasswordPage extends BasePage {
  // 填写密码
  async fill() {
    try {
      const pwdInput = await this.findPasswordInput(this.config.passwordInputTimeoutMs);
      if (!pwdInput) {
        this.logger.error('[Registration] 密码输入框未出现');
        return RegisterResult.UNKNOWN_ERROR;
      }

      const passwordFilled = await this.fillInputAndConfirm(pwdInput, this.config.password, '密码');
      if (!passwordFilled) {
        return RegisterResult.UNKNOWN_ERROR;
      }

      this.logger.info('[Registration] 已输入密码');

      await this.waitForReady();

      for (let i = 0; i < 2; i++) {
        const clicked = await this.clickContinueButton();
        if (!clicked) {
          this.logger.error('[Registration] 找不到密码提交按钮');
          return RegisterResult.UNKNOWN_ERROR;
        }
        this.logger.info('[Registration] 已提交密码');

        const submitStatus = await this.waitForSubmitResult();
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
            const refilled = await this.fillInputAndConfirm(pwdInput, this.config.password, '密码');
            if (!refilled) {
              return RegisterResult.UNKNOWN_ERROR;
            }
            await this.waitForReady();
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
  async waitForReady() {
    return await this.waitUntil(async () => {
      const lowerText = await this.readVisibleBodyText();
      const submitBtn = await this.findContinueButton();
      if (submitBtn) {
        if (!lowerText.includes('at least 12 characters') || lowerText.includes('complete') || lowerText.includes('完成')) {
          return true;
        }
      }
      return false;
    }, 5000, 250);
  }

  // 等待密码提交后的页面变化
  async waitForSubmitResult() {
    let result = 'no_change';
    await this.waitUntil(async () => {
      const url = this.page.url();
      const lowerText = await this.readVisibleBodyText();

      if (this.isCreateAccountFailed(lowerText)) {
        this.logger.warn('[Registration] 创建账户失败（密码提交后检测）');
        result = RegisterResult.DOMAIN_REJECTED;
        return true;
      }

      if (lowerText.includes('verify your email') || lowerText.includes('check your email') ||
          lowerText.includes('verification code') || lowerText.includes('enter code') ||
          lowerText.includes('we sent') || lowerText.includes('已发送') ||
          this.isPersonalInfoPage(url, lowerText) ||
          (url.includes('chatgpt.com') && !url.includes('auth') && !url.includes('login'))) {
        result = 'ok';
        return true;
      }

      if (!(await this.findPasswordInput())) {
        result = 'ok';
        return true;
      }

      return false;
    }, 5000, 300);

    return result;
  }
}

module.exports = { PasswordPage };
