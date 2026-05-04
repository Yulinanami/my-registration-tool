// SQLite 数据库连接和初始化
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { SCHEMA_SQL } = require('./schema');

let dbInstance = null;

// 打开数据库并创建表
function openDatabase(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  ensureUsedAtColumn(db);
  return db;
}

function ensureUsedAtColumn(db) {
  const columns = db.prepare('PRAGMA table_info(accounts)').all();
  const hasUsedAt = columns.some((col) => col.name === 'usedAt');
  if (!hasUsedAt) {
    db.prepare('ALTER TABLE accounts ADD COLUMN usedAt INTEGER').run();
  }
}

// 获取全局数据库实例
function getDatabase(dbPath) {
  if (!dbInstance) {
    if (!dbPath) {
      throw new Error('首次调用 getDatabase 必须传入 dbPath');
    }
    dbInstance = openDatabase(dbPath);
  }
  return dbInstance;
}

// 关闭数据库
function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = { getDatabase, openDatabase, closeDatabase };
