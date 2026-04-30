// 账号池数据库表结构
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  lastCheckedAt INTEGER,
  lastSuccessAt INTEGER,
  failReason TEXT,
  checkCount INTEGER NOT NULL DEFAULT 0,
  registerAttempt INTEGER
);

CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_lastCheckedAt ON accounts(lastCheckedAt);
`;

const STATUS = {
  ACTIVE: 'active',
  CHECKING: 'checking',
  REMOVE_PENDING: 'remove_pending',
  REGISTERING: 'registering',
  FAILED_REGISTER: 'failed_register',
};

module.exports = { SCHEMA_SQL, STATUS };
