// 处理邮箱输入和提交后的结果
const { BasePage } = require('./base-page');
const { RegisterResult } = require('../register-result');

class EmailPage extends BasePage {
  // 填写邮箱
  async fill(email) {
    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const filled = await this.fillEmailInput(email, attempt === 1 ? 5000 : 1200);
        if (!filled) {
          if (await this.findPasswordInput(500)) {
            return 'ok';
          }

          this.logger.warn('[Registration] 暂时找不到可填写的邮箱输入框，重新尝试');
          continue;
        }

        this.logger.info(`[Registration] 已输入邮箱: ${email}`);

        const clicked = await this.clickContinueButton(5000);
        if (!clicked) {
          this.logger.error('[Registration] 找不到继续按钮');
          return RegisterResult.UNKNOWN_ERROR;
        }

        this.logger.info('[Registration] 已点击继续');

        const submitResult = await this.waitForSubmitResult();
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

        const emailInput = await this.findEmailInput(500);
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
  async fillEmailInput(email, timeoutMs = 5000) {
    const emailInput = await this.findEmailInput(timeoutMs);
    if (!emailInput) {
      return false;
    }

    return await this.fillInputAndConfirm(emailInput, email, '邮箱');
  }

  // 等待邮箱提交结果
  async waitForSubmitResult() {
    let result = 'pending';
    await this.waitUntil(async () => {
      if (await this.findPasswordInput()) {
        result = 'ok';
        return true;
      }

      const errorText = await this.readFirstErrorText();
      const emailError = this.classifyEmailError(errorText);
      if (emailError) {
        result = emailError;
        return true;
      }

      if (await this.detectCaptcha()) {
        result = RegisterResult.CAPTCHA;
        return true;
      }

      return false;
    }, Math.min(this.config.passwordInputTimeoutMs || 10000, 10000), 250);

    return result;
  }

  // 判断邮箱提交后的错误类型
  classifyEmailError(errorText) {
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

    if (this.isCreateAccountFailed(errorText)) {
      return RegisterResult.DOMAIN_REJECTED;
    }

    return null;
  }
}

module.exports = { EmailPage };
