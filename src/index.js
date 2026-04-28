/**
 * ChatGPT 注册辅助器 — 主入口
 *
 * 流程：
 * 1. 控制台输入需要注册的数量 N
 * 2. 循环：GPTMail 获取邮箱 → ChatGPT 注册 → GPTMail 获取验证码 → 验证
 * 3. 成功的账号写入 emails.txt
 * 4. 失败则换邮箱重试，直到成功 N 个
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const winston = require('winston');
const { GptMailScraper } = require('./gptmail-scraper');
const { ChatGPTRegister, RegisterResult } = require('./chatgpt-register');

// ============ 配置 ============

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.json');
const EMAILS_OUTPUT = path.join(PROJECT_ROOT, 'emails.txt');
const LOG_DIR = path.join(PROJECT_ROOT, 'results');
const LOG_PATH = path.join(LOG_DIR, 'run.log');

function loadConfig() {
  const defaults = {
    chatgptPassword: 'qwerasdfzxcv',
    headless: false,
    mailPollIntervalMs: 3000,
    mailPollTimeoutMs: 120000,
    maxRetries: 20,
    typingDelayMin: 50,
    typingDelayMax: 150,
    stepDelayMin: 1000,
    stepDelayMax: 3000,
  };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return { ...defaults, ...userConfig };
    }
  } catch (e) {
    console.warn(`⚠️  读取配置文件失败，使用默认值: ${e.message}`);
  }
  return defaults;
}

// ============ 日志 ============

function createLogger() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  return winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
        ),
      }),
      new winston.transports.File({ filename: LOG_PATH }),
    ],
  });
}

// ============ 工具函数 ============

function askQuestion(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function appendToEmailsFile(email, password) {
  const line = `${email}----${password}\n`;
  fs.appendFileSync(EMAILS_OUTPUT, line, 'utf-8');
}

function randomDelay(min, max) {
  return new Promise((resolve) => setTimeout(resolve, Math.random() * (max - min) + min));
}

// ============ 核心流程 ============

async function registerOne(browser, config, logger, attemptNum) {
  logger.info(`\n${'='.repeat(60)}`);
  logger.info(`开始第 ${attemptNum} 次尝试注册`);
  logger.info('='.repeat(60));

  // 创建 GPTMail 上下文（独立）
  const gptmailContext = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1280, height: 720 },
  });

  const scraper = new GptMailScraper(gptmailContext, logger);
  let email = null;
  let success = false;

  try {
    // Step 1: 从 GPTMail 获取临时邮箱
    email = await scraper.init();
    if (!email) {
      logger.error('❌ 无法从 GPTMail 获取邮箱');
      return false;
    }
    logger.info(`📧 获取到临时邮箱: ${email}`);

    // Step 2: 用这个邮箱去 ChatGPT 注册
    const chatgptContext = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });

    const registrar = new ChatGPTRegister(chatgptContext, config, logger);

    try {
      const regResult = await registrar.register(email);
      logger.info(`📋 注册结果: ${regResult.result} — ${regResult.message}`);

      if (regResult.result === RegisterResult.NEED_VERIFICATION) {
        // Step 3: 回 GPTMail 等待验证邮件
        logger.info('📬 等待验证邮件...');
        const emailData = await scraper.waitForVerificationEmail(
          config.mailPollIntervalMs,
          config.mailPollTimeoutMs
        );

        if (emailData) {
          logger.info(`📨 收到验证邮件: ${emailData.subject || '(无标题)'}`);
          // Step 4: 处理验证
          const verifyResult = await registrar.handleVerification(emailData);
          logger.info(`✉️  验证结果: ${verifyResult.result} — ${verifyResult.message}`);

          if (verifyResult.result === RegisterResult.SUCCESS) {
            success = true;
          }
        } else {
          logger.warn('⏰ 验证邮件等待超时');
        }
      } else if (regResult.result === RegisterResult.SUCCESS) {
        success = true;
      }
      // 其它情况（CAPTCHA、域名被拒等）：不成功，外层会重试
    } finally {
      try { await registrar.close(); } catch (e) { /* ignore */ }
      try { await chatgptContext.close(); } catch (e) { /* ignore */ }
    }

    if (success) {
      logger.info(`\n🎉 注册成功！邮箱: ${email}, 密码: ${config.chatgptPassword}`);
      appendToEmailsFile(email, config.chatgptPassword);
      logger.info(`📝 已写入 ${EMAILS_OUTPUT}`);
    }

    return success;
  } catch (error) {
    logger.error(`❌ 注册过程异常: ${error.message}`);
    return false;
  } finally {
    try { await scraper.close(); } catch (e) { /* ignore */ }
    try { await gptmailContext.close(); } catch (e) { /* ignore */ }
  }
}

// ============ 主程序 ============

async function main() {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║      ChatGPT 注册辅助器 v1.0            ║
  ║                                          ║
  ║  🖱️  鼠标优先 · 自动化注册 · 批量处理    ║
  ╚══════════════════════════════════════════╝
  `);

  const config = loadConfig();
  const logger = createLogger();

  // 获取目标注册数量（支持命令行参数：node src/index.js 3）
  let targetCount;
  const cliArg = process.argv[2];
  if (cliArg) {
    targetCount = parseInt(cliArg) || 1;
  } else {
    const input = await askQuestion('📌 请输入需要注册的账号数量 (默认 1): ');
    targetCount = parseInt(input) || 1;
  }
  logger.info(`目标注册数量: ${targetCount}`);

  // 启动浏览器（使用系统已安装的 Chrome）
  const chromePath = config.chromePath || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  logger.info(`🚀 启动浏览器: ${chromePath}`);
  let browser = await chromium.launch({
    headless: config.headless,
    executablePath: chromePath,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  let successCount = 0;
  let totalAttempts = 0;

  try {
    while (successCount < targetCount) {
      totalAttempts++;

      if (totalAttempts > config.maxRetries) {
        logger.error(`❌ 已达最大重试次数 (${config.maxRetries})，停止`);
        break;
      }

      // 检查浏览器是否还活着，如果断开就重新启动
      if (!browser.isConnected()) {
        logger.warn('⚠️  浏览器已断开，重新启动...');
        browser = await chromium.launch({
          headless: config.headless,
          executablePath: chromePath,
          args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
          ],
        });
      }

      const result = await registerOne(browser, config, logger, totalAttempts);

      if (result) {
        successCount++;
        logger.info(`\n✅ 进度: ${successCount}/${targetCount} 已完成`);
      } else {
        logger.info(`\n⚠️  第 ${totalAttempts} 次尝试失败，${successCount}/${targetCount}，继续重试...`);
      }

      // 尝试间隔，避免频率过高
      if (successCount < targetCount) {
        const waitTime = 5000 + Math.random() * 5000;
        logger.info(`⏳ 等待 ${Math.round(waitTime / 1000)}s 后继续...`);
        await randomDelay(waitTime, waitTime);
      }
    }
  } finally {
    if (browser.isConnected()) await browser.close();
  }

  // 打印最终结果
  console.log(`
  ╔══════════════════════════════════════════╗
  ║              运行结束                    ║
  ╠══════════════════════════════════════════╣
  ║  总尝试次数: ${String(totalAttempts).padStart(3)}                        ║
  ║  成功注册数: ${String(successCount).padStart(3)}                        ║
  ║  目标数量:   ${String(targetCount).padStart(3)}                        ║
  ╠══════════════════════════════════════════╣
  ║  📄 结果文件: emails.txt                 ║
  ║  📋 运行日志: results/run.log            ║
  ╚══════════════════════════════════════════╝
  `);
}

main().catch((error) => {
  console.error(`\n❌ 程序异常退出: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
