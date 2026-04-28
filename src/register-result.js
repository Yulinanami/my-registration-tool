// 保存注册流程会用到的结果状态
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

module.exports = { RegisterResult };
