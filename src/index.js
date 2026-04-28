const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
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
const BROWSER_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-translate',
  '--disable-features=Translate,TranslateUI',
  '--no-sandbox',
  '--disable-setuid-sandbox',
];

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
    retryDelayMin: 1000,
    retryDelayMax: 2000,
    statusCheckIntervalMs: 2000,
    signUpButtonTimeoutMs: 10000,
    signUpClickCheckMs: 1200,
    registrationStatusTimeoutMs: 15000,
    cloudflareCheckIntervalMs: 1000,
    cloudflareMaxWaitMs: 30000,
    mailPageTimeoutMs: 30000,
    mailEmailTimeoutMs: 15000,
    mailEmailCheckIntervalMs: 1000,
    mailRefreshWaitMs: 1500,
    mailDetailTimeoutMs: 5000,
    mailDetailRetryCount: 3,
    mailDetailRetryDelayMs: 1000,
    popupCloseDelayMs: 500,
    passwordInputTimeoutMs: 20000,
    fullName: 'John Doe',
    firstName: 'John',
    lastName: 'Doe',
    birthdayText: '01/15/2000',
    birthdayDate: '2000-01-15',
    age: '25',
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

// 添加可用内核路径
function addBrowserCandidate(candidates, name, executablePath) {
  if (!executablePath || !fs.existsSync(executablePath)) {
    return;
  }

  if (candidates.some((item) => item.executablePath === executablePath)) {
    return;
  }

  candidates.push({ name, executablePath });
}

// 用系统命令查找内核
function findBrowserPaths(command) {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';

  try {
    const output = execFileSync(finder, [command], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

// 读取注册表里的程序路径
function findWindowsAppPath(executableName) {
  if (process.platform !== 'win32') {
    return [];
  }

  const keys = [
    `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
  ];
  const results = [];

  for (const key of keys) {
    try {
      const output = execFileSync('reg.exe', ['query', key, '/ve'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const match = output.match(/REG_SZ\s+(.+)/);
      if (match) {
        results.push(match[1].trim().replace(/^"|"$/g, ''));
      }
    } catch (e) {}
  }

  return results;
}

// 添加命令找到的内核
function addBrowserCandidatesFromCommand(candidates) {
  const commands = process.platform === 'win32'
    ? [
        { name: 'Chrome Chromium 内核', command: 'chrome' },
        { name: 'Chrome Chromium 内核', command: 'chrome.exe' },
        { name: 'Edge Chromium 内核', command: 'msedge' },
        { name: 'Edge Chromium 内核', command: 'msedge.exe' },
        { name: 'Brave Chromium 内核', command: 'brave' },
        { name: 'Brave Chromium 内核', command: 'brave.exe' },
        { name: 'Opera Chromium 内核', command: 'opera' },
        { name: 'Opera Chromium 内核', command: 'opera.exe' },
        { name: 'Vivaldi Chromium 内核', command: 'vivaldi' },
        { name: 'Vivaldi Chromium 内核', command: 'vivaldi.exe' },
        { name: 'Chromium', command: 'chromium' },
        { name: 'Chromium', command: 'chromium.exe' },
      ]
    : [
        { name: 'Chrome Chromium 内核', command: 'google-chrome' },
        { name: 'Chrome Chromium 内核', command: 'google-chrome-stable' },
        { name: 'Edge Chromium 内核', command: 'microsoft-edge' },
        { name: 'Brave Chromium 内核', command: 'brave-browser' },
        { name: 'Opera Chromium 内核', command: 'opera' },
        { name: 'Vivaldi Chromium 内核', command: 'vivaldi' },
        { name: 'Chromium', command: 'chromium' },
        { name: 'Chromium', command: 'chromium-browser' },
      ];

  for (const item of commands) {
    for (const executablePath of findBrowserPaths(item.command)) {
      addBrowserCandidate(candidates, `${item.name} (${item.command})`, executablePath);
    }
  }
}

// 添加注册表里的内核
function addBrowserCandidatesFromRegistry(candidates) {
  const apps = [
    { name: 'Chrome Chromium 内核', executableName: 'chrome.exe' },
    { name: 'Edge Chromium 内核', executableName: 'msedge.exe' },
    { name: 'Brave Chromium 内核', executableName: 'brave.exe' },
    { name: 'Opera Chromium 内核', executableName: 'opera.exe' },
    { name: 'Vivaldi Chromium 内核', executableName: 'vivaldi.exe' },
    { name: 'Chromium', executableName: 'chromium.exe' },
  ];

  for (const app of apps) {
    for (const executablePath of findWindowsAppPath(app.executableName)) {
      addBrowserCandidate(candidates, `${app.name} (注册表)`, executablePath);
    }
  }
}

// 添加常见路径里的内核
function addBrowserCandidatesFromCommonPaths(candidates) {
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env.LOCALAPPDATA;

  const roots = [programFiles, programFilesX86, localAppData].filter(Boolean);
  const relativePaths = [
    ['Chrome Chromium 内核', 'Google\\Chrome\\Application\\chrome.exe'],
    ['Edge Chromium 内核', 'Microsoft\\Edge\\Application\\msedge.exe'],
    ['Brave Chromium 内核', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    ['Opera Chromium 内核', 'Programs\\Opera\\opera.exe'],
    ['Opera GX Chromium 内核', 'Programs\\Opera GX\\opera.exe'],
    ['Vivaldi Chromium 内核', 'Vivaldi\\Application\\vivaldi.exe'],
    ['Vivaldi Chromium 内核', 'Programs\\Vivaldi\\Application\\vivaldi.exe'],
    ['Chromium', 'Chromium\\Application\\chrome.exe'],
  ];

  for (const root of roots) {
    for (const [name, relativePath] of relativePaths) {
      addBrowserCandidate(candidates, name, path.join(root, relativePath));
    }
  }
}

// 查找本机 Chromium 内核
function getBrowserCandidates(config) {
  const candidates = [];
  const configuredPath = config.chromiumPath || config.browserPath || config.chromePath;

  addBrowserCandidate(candidates, '配置的 Chromium 内核', configuredPath);
  addBrowserCandidatesFromCommand(candidates);
  addBrowserCandidatesFromRegistry(candidates);
  addBrowserCandidatesFromCommonPaths(candidates);
  addBrowserCandidate(candidates, 'Playwright Chromium', chromium.executablePath());

  return candidates;
}

// 打开浏览器
async function launchBrowser(config, logger) {
  const candidates = getBrowserCandidates(config);

  if (candidates.length === 0) {
    throw new Error('没有找到可用的 Chromium 内核，请运行 npm run install-browser 安装内核');
  }

  for (const candidate of candidates) {
    try {
      logger.info(`尝试启动 ${candidate.name}: ${candidate.executablePath}`);
      return await chromium.launch({
        headless: config.headless,
        executablePath: candidate.executablePath,
        args: BROWSER_ARGS,
      });
    } catch (error) {
      logger.warn(`${candidate.name} 启动失败: ${error.message}`);
    }
  }

  throw new Error('找到的 Chromium 内核都无法启动，请运行 npm run install-browser 重新安装内核');
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

  const scraper = new MailScraper(mailContext, logger, config);
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

  let browser = await launchBrowser(config, logger);

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
        browser = await launchBrowser(config, logger);
      }

      const result = await registerOne(browser, config, logger, totalAttempts);

      if (result) {
        successCount++;
        logger.info(`\n进度: ${successCount}/${targetCount} 已完成`);
      } else {
        logger.info(`\n第 ${totalAttempts} 次尝试失败，${successCount}/${targetCount}，继续重试...`);
      }

      if (successCount < targetCount) {
        await randomDelay(config.retryDelayMin, config.retryDelayMax);
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
