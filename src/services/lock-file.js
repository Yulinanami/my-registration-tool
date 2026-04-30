// 防止重复运行：启动写锁，退出删锁，发现旧锁先验证 PID
const fs = require('fs');
const path = require('path');

// 检测进程是否存活
function isProcessAlive(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM 表示进程存在但无权限发送，仍视为存活
    return e.code === 'EPERM';
  }
}

// 读取已有锁
function readLock(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { pid: parseInt(parsed.pid, 10), startedAt: parsed.startedAt };
  } catch (e) {
    return null;
  }
}

// 取锁，被占就抛异常
function acquireLock(lockPath, logger) {
  const dir = path.dirname(lockPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(lockPath)) {
    const existing = readLock(lockPath);
    if (existing && isProcessAlive(existing.pid)) {
      throw new Error(
        `已有进程在运行 (pid=${existing.pid}, 启动于 ${existing.startedAt})，` +
        `如果确认是残留进程请手动删除 ${lockPath}`
      );
    }
    if (logger) {
      logger.warn(`[Lock] 发现旧锁 (pid=${existing ? existing.pid : '未知'}) 但进程不存在，清理后继续`);
    }
    try { fs.unlinkSync(lockPath); } catch (e) {}
  }

  const payload = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  fs.writeFileSync(lockPath, payload, { encoding: 'utf-8', flag: 'wx' });
  if (logger) logger.info(`[Lock] 已获取锁 ${lockPath} (pid=${process.pid})`);
}

// 释放锁，仅当锁内 PID 是自己时才删
function releaseLock(lockPath, logger) {
  if (!fs.existsSync(lockPath)) return;
  const existing = readLock(lockPath);
  if (existing && existing.pid && existing.pid !== process.pid) {
    if (logger) logger.warn(`[Lock] 锁内 PID (${existing.pid}) 与当前 (${process.pid}) 不一致，不删除`);
    return;
  }
  try {
    fs.unlinkSync(lockPath);
    if (logger) logger.info(`[Lock] 已释放锁 ${lockPath}`);
  } catch (e) {
    if (logger) logger.warn(`[Lock] 删除锁失败: ${e.message}`);
  }
}

module.exports = { acquireLock, releaseLock };
