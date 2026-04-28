// 从邮件里找验证内容
function extractVerification(emailData) {
  if (!emailData) return null;

  const { body, html } = emailData;
  const content = html || body || '';

  const link = extractVerificationLink(content);
  if (link) {
    return { type: 'link', value: link };
  }

  const otp = extractOTP(body || content);
  if (otp) {
    return { type: 'otp', value: otp };
  }

  return null;
}

// 从邮件里找验证链接
function extractVerificationLink(content) {
  if (!content) return null;

  const patterns = [
    /href=["'](https?:\/\/[^"']*(?:auth\.openai\.com|login\.chatgpt\.com|openai\.com\/verify|chatgpt\.com\/auth)[^"']*)/gi,
    /(https?:\/\/(?:auth\.openai\.com|login\.chatgpt\.com|openai\.com|chatgpt\.com)\/[^\s<>"']+(?:verify|confirm|activate|callback|authorize)[^\s<>"']*)/gi,
    /(https?:\/\/[^\s<>"']*openai[^\s<>"']*(?:verify|confirm|token|code|activate|callback|authorize)[^\s<>"']*)/gi,
    /(https?:\/\/[^\s<>"']*(?:email-verification|verify-email|confirm-email)[^\s<>"']*)/gi,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (match) {
      return cleanUrl(match[1]);
    }
  }

  const allLinks = content.match(/href=["'](https?:\/\/[^"']+)/gi);
  if (allLinks) {
    for (const linkMatch of allLinks) {
      const url = linkMatch.replace(/href=["']/, '');
      if (isIgnoredUrl(url)) {
        continue;
      }
      if (url.includes('token=') || url.includes('code=') || url.includes('verify')) {
        return cleanUrl(url);
      }
    }
  }

  return null;
}

// 整理链接里的特殊字符
function cleanUrl(url) {
  return url.replace(/&amp;/g, '&').replace(/&#x3D;/g, '=');
}

// 判断链接是否无关
function isIgnoredUrl(url) {
  return url.includes('unsubscribe') ||
    url.includes('privacy') ||
    url.includes('terms') ||
    url.includes('help.openai') ||
    url.includes('mailto:');
}

// 从文字里找六位验证码
function extractOTP(text) {
  if (!text) return null;

  const patterns = [
    /(?:验证码|code|OTP|密码|passcode)[\s:：]*(\d{6})/i,
    /(\d{6})[\s]*(?:是你的|is your|verification)/i,
    /\b(\d{6})\b/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return match[1];
    }
  }

  return null;
}

module.exports = { extractVerification };
