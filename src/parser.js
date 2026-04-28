/**
 * 邮件解析模块
 * 从验证邮件中提取验证链接或 OTP
 */

/**
 * 从邮件内容中提取验证信息
 * @param {{subject: string, from: string, body: string, html: string}} emailData
 * @returns {{type: 'link'|'otp', value: string}|null}
 */
function extractVerification(emailData) {
  if (!emailData) return null;

  const { body, html } = emailData;
  const content = html || body || '';

  // 1. 尝试提取验证链接
  const link = extractVerificationLink(content);
  if (link) {
    return { type: 'link', value: link };
  }

  // 2. 尝试提取 OTP 验证码
  const otp = extractOTP(body || content);
  if (otp) {
    return { type: 'otp', value: otp };
  }

  return null;
}

/**
 * 从 HTML/文本中提取验证链接
 */
function extractVerificationLink(content) {
  if (!content) return null;

  // 匹配验证链接的多种模式
  const patterns = [
    // href 属性中的链接
    /href=["'](https?:\/\/[^"']*(?:auth\.openai\.com|login\.chatgpt\.com|openai\.com\/verify|chatgpt\.com\/auth)[^"']*)/gi,
    // 纯文本中的链接
    /(https?:\/\/(?:auth\.openai\.com|login\.chatgpt\.com|openai\.com|chatgpt\.com)\/[^\s<>"']+(?:verify|confirm|activate|callback|authorize)[^\s<>"']*)/gi,
    // 更宽泛的 OpenAI 链接
    /(https?:\/\/[^\s<>"']*openai[^\s<>"']*(?:verify|confirm|token|code|activate|callback|authorize)[^\s<>"']*)/gi,
    // email-verification 类型的链接
    /(https?:\/\/[^\s<>"']*(?:email-verification|verify-email|confirm-email)[^\s<>"']*)/gi,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (match) {
      let url = match[1];
      // 清理 URL 末尾可能的 HTML 实体
      url = url.replace(/&amp;/g, '&').replace(/&#x3D;/g, '=');
      return url;
    }
  }

  // 通用链接提取
  const allLinks = content.match(/href=["'](https?:\/\/[^"']+)/gi);
  if (allLinks) {
    for (const linkMatch of allLinks) {
      const url = linkMatch.replace(/href=["']/, '');
      // 跳过常见的非验证链接
      if (url.includes('unsubscribe') || url.includes('privacy') || url.includes('terms') ||
          url.includes('help.openai') || url.includes('mailto:')) {
        continue;
      }
      // 如果链接包含 token/code 参数，很可能是验证链接
      if (url.includes('token=') || url.includes('code=') || url.includes('verify')) {
        return url.replace(/&amp;/g, '&');
      }
    }
  }

  return null;
}

/**
 * 从文本中提取 6 位数字 OTP
 */
function extractOTP(text) {
  if (!text) return null;

  // 匹配常见的 OTP 模式
  const patterns = [
    /(?:验证码|code|OTP|密码|passcode)[\s:：]*(\d{6})/i,
    /(\d{6})[\s]*(?:是你的|is your|verification)/i,
    /\b(\d{6})\b/,  // 最后兜底：任意 6 位数字
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return match[1];
    }
  }

  return null;
}

module.exports = { extractVerification, extractVerificationLink, extractOTP };
