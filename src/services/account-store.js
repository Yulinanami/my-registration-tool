// 账号数据读写
const { STATUS } = require('../db/schema');

class AccountStore {
  constructor(db) {
    this.db = db;
  }

  // 统计 active 账号数量
  countActive() {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM accounts WHERE status = ?')
      .get(STATUS.ACTIVE);
    return row.count;
  }

  // 列出 active 账号
  listActive() {
    return this.db
      .prepare('SELECT * FROM accounts WHERE status = ? ORDER BY id ASC')
      .all(STATUS.ACTIVE);
  }

  // 列出所有账号
  listAll() {
    return this.db.prepare('SELECT * FROM accounts ORDER BY id ASC').all();
  }

  // 按邮箱查找
  findByEmail(email) {
    return this.db.prepare('SELECT * FROM accounts WHERE email = ?').get(email);
  }

  // 插入新账号 (状态默认 active)
  insertActive({ email, password, registerAttempt = null }) {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO accounts (email, password, status, createdAt, lastSuccessAt, registerAttempt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(email, password, STATUS.ACTIVE, now, now, registerAttempt);
    return info.lastInsertRowid;
  }

  // 标记为待删除
  markRemovePending(id, failReason) {
    const stmt = this.db.prepare(`
      UPDATE accounts
      SET status = ?, failReason = ?, lastCheckedAt = ?, checkCount = checkCount + 1
      WHERE id = ?
    `);
    stmt.run(STATUS.REMOVE_PENDING, failReason || null, Date.now(), id);
  }

  // 标记为登录成功
  markActiveSuccess(id) {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE accounts
      SET status = ?, lastCheckedAt = ?, lastSuccessAt = ?, failReason = NULL, checkCount = checkCount + 1
      WHERE id = ?
    `);
    stmt.run(STATUS.ACTIVE, now, now, id);
  }

  // 标记为已使用 (账号列表点击复制邮箱后写入)
  markUsed(id) {
    const now = Date.now();
    this.db
      .prepare('UPDATE accounts SET usedAt = COALESCE(usedAt, ?) WHERE id = ?')
      .run(now, id);
    return this.findById(id);
  }

  // 按 id 查找
  findById(id) {
    return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  }

  // 按 id 删除
  deleteById(id) {
    return this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes;
  }

  // 一轮检查后统一删除被标记账号 (返回被删账号列表)
  purgeRemovePending() {
    const purge = this.db.transaction(() => {
      const rows = this.db
        .prepare('SELECT * FROM accounts WHERE status = ?')
        .all(STATUS.REMOVE_PENDING);
      this.db.prepare('DELETE FROM accounts WHERE status = ?').run(STATUS.REMOVE_PENDING);
      return rows;
    });
    return purge();
  }
}

module.exports = { AccountStore, STATUS };
