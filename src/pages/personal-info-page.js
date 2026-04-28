// 处理名字、年龄和生日填写
const { BasePage } = require('./base-page');

class PersonalInfoPage extends BasePage {
  // 填写个人信息
  async fill() {
    try {
      this.logger.info('[Registration] 尝试填写个人信息...');
      await this.waitForForm(5000);

      const nameInput = await this.findNameInput();
      if (nameInput) {
        const nameFilled = await this.fillInputAndConfirm(nameInput, this.getFullName(), '名字');
        if (!nameFilled) {
          return false;
        }
        this.logger.info('[Registration] 已填写名字');
      }

      const lastNameInput = this.page.locator('input[name="lastName"], input[name="last_name"]');
      const visibleLastNameInput = await this.findVisibleLocator(lastNameInput, 0);
      if (visibleLastNameInput) {
        const lastNameFilled = await this.fillInputAndConfirm(visibleLastNameInput, this.config.lastName, '姓');
        if (!lastNameFilled) {
          return false;
        }
        this.logger.info('[Registration] 已填写姓');
      }

      const ageFilled = await this.fillAge();
      if (!ageFilled) {
        await this.fillBirthdayFields();
        await this.fillBirthday();
      }

      await this.waitForReady(5000);
      const clicked = await this.clickContinueButton();
      if (clicked) {
        this.logger.info('[Registration] 已提交个人信息');
      } else {
        this.logger.warn('[Registration] 找不到个人信息提交按钮');
        return false;
      }

      const refillResult = await this.refillIfCleared();
      if (refillResult === 'submitted') {
        this.logger.info('[Registration] 个人信息被页面清空，已重新填写并提交');
      }

      const checks = Math.ceil(this.config.registrationStatusTimeoutMs / this.config.statusCheckIntervalMs);
      for (let i = 0; i < checks; i++) {
        await this.waitUntil(async () => {
          const url = this.page.url();
          if (url.includes('chatgpt.com') && !url.includes('auth') && !url.includes('login')) {
            return true;
          }

          return await this.checkError();
        }, this.config.statusCheckIntervalMs, 250);
        const url = this.page.url();

        if (url.includes('chatgpt.com') && !url.includes('auth') && !url.includes('login')) {
          this.logger.info(`[Registration] 个人信息提交成功，已跳转到: ${url}`);
          return true;
        }

        const errorDetected = await this.checkError();
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
  async waitForForm(timeoutMs) {
    return await this.waitUntil(async () => {
      return !!(await this.findNameInput()) ||
        !!(await this.findAgeInput()) ||
        !!(await this.findBirthdayInput());
    }, timeoutMs, 250);
  }

  // 等待个人信息可以提交
  async waitForReady(timeoutMs) {
    return await this.waitUntil(async () => {
      const nameInput = await this.findNameInput();
      if (nameInput) {
        const value = await nameInput.inputValue().catch(() => '');
        if (!value.trim()) {
          return false;
        }
      }

      const ageInput = await this.findAgeInput();
      if (ageInput) {
        const value = await ageInput.inputValue().catch(() => '');
        if (!value.trim()) {
          return false;
        }
      }

      return !!(await this.findContinueButton());
    }, timeoutMs, 250);
  }

  // 如果个人信息被清空就重新填写
  async refillIfCleared() {
    const stillPersonalPage = this.isPersonalInfoPage(this.page.url(), await this.readVisibleBodyText());
    if (!stillPersonalPage) {
      return 'not_needed';
    }

    const nameInput = await this.findNameInput();
    const ageInput = await this.findAgeInput();
    const nameValue = nameInput ? await nameInput.inputValue().catch(() => '') : '';
    const ageValue = ageInput ? await ageInput.inputValue().catch(() => '') : '';

    const nameMissing = !!nameInput && !nameValue.trim();
    const ageMissing = !!ageInput && !ageValue.trim();
    if (!nameMissing && !ageMissing) {
      return 'not_needed';
    }

    if (nameMissing) {
      const nameFilled = await this.fillInputAndConfirm(nameInput, this.getFullName(), '名字');
      if (!nameFilled) {
        return 'failed';
      }
    }

    if (ageMissing) {
      const ageFilled = await this.fillAge();
      if (!ageFilled) {
        return 'failed';
      }
    }

    await this.waitForReady(5000);
    const clicked = await this.clickContinueButton();
    return clicked ? 'submitted' : 'failed';
  }

  // 读取完整姓名
  getFullName() {
    if (this.config.fullName) {
      return this.config.fullName;
    }

    return [this.config.firstName, this.config.lastName].filter(Boolean).join(' ') || 'John Doe';
  }

  // 查找姓名输入框
  async findNameInput() {
    const locators = [
      this.page.getByLabel('Full name'),
      this.page.getByLabel('Name'),
      this.page.getByLabel('姓名'),
      this.page.locator('input[name="name"], input[name="firstName"], input[name="first_name"]'),
      this.page.locator('input[placeholder*="name" i], input[aria-label*="name" i]'),
      this.page.locator('input[placeholder*="姓名"], input[aria-label*="姓名"]'),
    ];

    for (const locator of locators) {
      const input = await this.findVisibleLocator(locator, 0);
      if (input) {
        return input;
      }
    }

    return null;
  }

  // 填写年龄
  async fillAge() {
    const ageInput = await this.findAgeInput();
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

      const ageFilled = await this.fillInputAndConfirm(ageInput, ageText, '年龄', {
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
  async findAgeInput() {
    const locators = [
      this.page.locator('input[name="age"], input[placeholder*="age" i], input[aria-label*="age" i]'),
      this.page.locator('input[type="number"][min][max]'),
      this.page.locator('input[placeholder*="年龄"], input[aria-label*="年龄"]'),
      this.page.getByLabel('Age'),
      this.page.getByLabel('年龄'),
    ];

    for (const locator of locators) {
      const input = await this.findVisibleLocator(locator, 0);
      if (input) {
        return input;
      }
    }

    return null;
  }

  // 填写生日下拉框
  async fillBirthdayFields() {
    const monthSelect = this.page.locator('select[name*="month"], select[id*="month"]');
    const visibleMonthSelect = await this.findVisibleLocator(monthSelect, 0);
    if (visibleMonthSelect) {
      await visibleMonthSelect.selectOption({ index: 1 });
      this.logger.info('[Registration] 已选择月份');
    }

    const daySelect = this.page.locator('select[name*="day"], select[id*="day"]');
    const visibleDaySelect = await this.findVisibleLocator(daySelect, 0);
    if (visibleDaySelect) {
      await visibleDaySelect.selectOption({ index: 15 });
      this.logger.info('[Registration] 已选择日期');
    }

    const yearSelect = this.page.locator('select[name*="year"], select[id*="year"]');
    const visibleYearSelect = await this.findVisibleLocator(yearSelect, 0);
    if (visibleYearSelect) {
      await visibleYearSelect.selectOption(this.config.birthdayDate.slice(0, 4));
      this.logger.info('[Registration] 已选择年份');
    }
  }

  // 填写生日
  async fillBirthday() {
    const birthdayInput = await this.findBirthdayInput();
    if (!birthdayInput) {
      this.logger.warn('[Registration] 未找到生日输入框');
      return false;
    }

    try {
      const typeAttr = await birthdayInput.getAttribute('type');
      await birthdayInput.click();

      if (typeAttr === 'date') {
        const filled = await this.fillInputAndConfirm(birthdayInput, this.config.birthdayDate, '生日', { direct: true });
        if (!filled) {
          return false;
        }
      } else {
        const filled = await this.fillInputAndConfirm(birthdayInput, this.config.birthdayText, '生日');
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
  async findBirthdayInput() {
    const locators = [
      this.page.getByLabel('Birthday'),
      this.page.getByLabel('生日'),
      this.page.locator('input[name="birthday"], input[name="birthdate"], input[name="dob"], input[type="date"]'),
      this.page.locator('input[name*="birth" i], input[id*="birth" i], input[placeholder*="birth" i], input[aria-label*="birth" i]'),
      this.page.locator('input[placeholder*="生日"], input[aria-label*="生日"]'),
    ];

    for (const locator of locators) {
      const input = await this.findVisibleLocator(locator, 0);
      if (input) {
        return input;
      }
    }

    return null;
  }

  // 检查个人信息页错误
  async checkError() {
    try {
      const url = this.page.url();
      const lowerText = await this.readVisibleBodyText();

      if (lowerText.includes('糟糕') || lowerText.includes('出错了') ||
          lowerText.includes('unsupported_email') || lowerText.includes('unsupported email') ||
          lowerText.includes('验证过程中出错') || this.isCreateAccountFailed(lowerText)) {
        this.logger.warn(`[Registration] 个人信息提交后出错 (unsupported_email)，URL: ${url}`);
        return true;
      }

      return false;
    } catch (e) {
      return false;
    }
  }
}

module.exports = { PersonalInfoPage };
