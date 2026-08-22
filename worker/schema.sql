-- 1m.de5.net 临时邮箱：收件箱 + 邮件（追加迁移，旧 aliases/mail_log 表保留不动）

CREATE TABLE IF NOT EXISTS inboxes (
  address     TEXT PRIMARY KEY,          -- 不含 @1m.de5.net，小写
  created_at  INTEGER NOT NULL,          -- unix ms
  expires_at  INTEGER NOT NULL,          -- unix ms
  last_seen   INTEGER                    -- 最近收信时间
);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  address      TEXT NOT NULL,            -- 所属收件箱
  mail_id      TEXT,                     -- Message-ID（去重用）
  from_addr    TEXT,
  from_name    TEXT,
  subject      TEXT,
  text_content TEXT,
  html_content TEXT,
  received_at  INTEGER NOT NULL,
  is_read      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_messages_addr ON messages(address, id);
CREATE INDEX IF NOT EXISTS idx_inboxes_expires ON inboxes(expires_at);
