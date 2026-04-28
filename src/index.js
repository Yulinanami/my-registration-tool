const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const winston = require('winston');
const { MailScraper } = require('./scraper');
const { Registrar, RegisterResult } = require('./registrar');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.json');
const EMAILS_OUTPUT = path.join(PROJECT_ROOT, 'emails.txt');
const LOG_DIR = path.join(PROJECT_ROOT, 'results');
const LOG_PATH = path.join(LOG_DIR, 'run.log');

// 读取配置文件
function loadConfig() {
  const defaults = {
    password: 'qwerasdfzxcv',
    headless: false,
    mailPollIntervalMs: 3000,
    mailPollTimeoutMs: 120000,
    maxRetries: 20,
    typingDelayMin: 50,
    typingDelayMax: 150,
  };

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return { ...defaults, ...userConfig };
    }
  } catch (e) {
    console.warn(`读取配置文件失败，使用默认值: ${e.message}`);
  }

  return defaults;
}

// 创建日志记录
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

// 读取用户输入
function askQuestion(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// 保存成功账号
function appendToEmailsFile(email, password) {
  const line = `${email}----${password}\n`;
  fs.appendFileSync(EMAILS_OUTPUT, line, 'utf-8');
}

// 等待一小段随机时间
function randomDelay(min, max) {
  return new Promise((resolve) => setTimeout(resolve, Math.random() * (max - min) + min));
}

// 打开浏览器
async function launchBrowser(config, chromePath) {
  return await chromium.launch({
    headless: config.headless,
    executablePath: chromePath,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
}

// 注册一个账号
async function registerOne(browser, config, logger, attemptNum) {
  logger.info(`\n${'='.repeat(60)}`);
  logger.info(`开始第 ${attemptNum} 次尝试注册`);
  logger.info('='.repeat(60));

  const mailContext = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1280, height: 720 },
  });

  const scraper = new MailScraper(mailContext, logger);
  let email = null;
  let success = false;

  try {
    email = await scraper.init();
    if (!email) {
      logger.error('无法获取邮箱');
      return false;
    }
    logger.info(`获取到临时邮箱: ${email}`);

    let siteContext = null;
    let registrar = null;

    try {
      siteContext = await browser.newContext({
        locale: 'en-US',
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      });

      registrar = new Registrar(siteContext, config, logger);

      const regResult = await registrar.register(email);
      logger.info(`注册结果: ${regResult.result} - ${regResult.message}`);

      if (regResult.result === RegisterResult.NEED_VERIFICATION) {
        logger.info('等待验证邮件...');
        const emailData = await scraper.waitForVerificationEmail(
          config.mailPollIntervalMs,
          config.mailPollTimeoutMs
        );

        if (emailData) {
          logger.info(`收到验证邮件: ${emailData.subject || '(无标题)'}`);
          const verifyResult = await registrar.handleVerification(emailData);
          logger.info(`验证结果: ${verifyResult.result} - ${verifyResult.message}`);

          if (verifyResult.result === RegisterResult.SUCCESS) {
            success = true;
          }
        } else {
          logger.warn('验证邮件等待超时');
        }
      } else if (regResult.result === RegisterResult.SUCCESS) {
        success = true;
      }
    } finally {
      if (registrar) {
        try { await registrar.close(); } catch (e) {}
      }
      if (siteContext) {
        try { await siteContext.close(); } catch (e) {}
      }
    }

    if (success) {
      logger.info(`\n注册成功，邮箱: ${email}, 密码: ${config.password}`);
      appendToEmailsFile(email, config.password);
      logger.info(`已写入 ${EMAILS_OUTPUT}`);
    }

    return success;
  } catch (error) {
    logger.error(`注册过程异常: ${error.message}`);
    return false;
  } finally {
    try { await scraper.close(); } catch (e) {}
    try { await mailContext.close(); } catch (e) {}
  }
}

// 启动程序
async function main() {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║          注册辅助工具 v1.0               ║
  ║                                          ║
  ║  鼠标优先 · 自动化注册 · 批量处理        ║
  ╚══════════════════════════════════════════╝
  `);

  const config = loadConfig();
  const logger = createLogger();

  let targetCount;
  const cliArg = process.argv[2];
  if (cliArg) {
    targetCount = parseInt(cliArg) || 1;
  } else {
    const input = await askQuestion('请输入需要注册的账号数量 (默认 1): ');
    targetCount = parseInt(input) || 1;
  }
  logger.info(`目标注册数量: ${targetCount}`);

  const chromePath = config.chromePath || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  logger.info(`启动浏览器: ${chromePath}`);
  let browser = await launchBrowser(config, chromePath);

  let successCount = 0;
  let totalAttempts = 0;

  try {
    while (successCount < targetCount) {
      totalAttempts++;

      if (totalAttempts > config.maxRetries) {
        logger.error(`已达最大重试次数 (${config.maxRetries})，停止`);
        break;
      }

      if (!browser.isConnected()) {
        logger.warn('浏览器已断开，重新启动...');
        browser = await launchBrowser(config, chromePath);
      }

      const result = await registerOne(browser, config, logger, totalAttempts);

      if (result) {
        successCount++;
        logger.info(`\n进度: ${successCount}/${targetCount} 已完成`);
      } else {
        logger.info(`\n第 ${totalAttempts} 次尝试失败，${successCount}/${targetCount}，继续重试...`);
      }

      if (successCount < targetCount) {
        await randomDelay(1000, 2000);
      }
    }
  } finally {
    if (browser.isConnected()) await browser.close();
  }

  console.log(`
  ╔══════════════════════════════════════════╗
  ║              运行结束                    ║
  ╠══════════════════════════════════════════╣
  ║  总尝试次数: ${String(totalAttempts).padStart(3)}                        ║
  ║  成功注册数: ${String(successCount).padStart(3)}                        ║
  ║  目标数量:   ${String(targetCount).padStart(3)}                        ║
  ╠══════════════════════════════════════════╣
  ║  结果文件: emails.txt                   ║
  ║  运行日志: results/run.log              ║
  ╚══════════════════════════════════════════╝
  `);
}

main().catch((error) => {
  console.error(`\n程序异常退出: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
