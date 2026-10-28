-- ユーザーとセッション
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'teacher', 'student')),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- id はセッショントークンの SHA-256。トークン自体は保存しない
CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX sessions_user ON sessions(user_id);

-- コース
CREATE TABLE courses (
  id         INTEGER PRIMARY KEY,
  code       TEXT    NOT NULL DEFAULT '',
  title      TEXT    NOT NULL,
  summary    TEXT    NOT NULL DEFAULT '',
  color      TEXT    NOT NULL DEFAULT 'indigo',
  enroll_key TEXT,
  visible    INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE enrollments (
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL DEFAULT 'student' CHECK (role IN ('teacher', 'student')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (course_id, user_id)
) WITHOUT ROWID;
CREATE INDEX enrollments_user ON enrollments(user_id);

CREATE TABLE sections (
  id        INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title     TEXT    NOT NULL,
  summary   TEXT    NOT NULL DEFAULT '',
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sections_course ON sections(course_id, position);

CREATE TABLE items (
  id         INTEGER PRIMARY KEY,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL CHECK (type IN ('page', 'link', 'file')),
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL DEFAULT '',
  url        TEXT    NOT NULL DEFAULT '',
  -- type = 'file' のとき R2 のオブジェクト情報
  file_key   TEXT,
  file_name  TEXT,
  file_size  INTEGER,
  file_type  TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX items_section ON items(section_id, position);
CREATE INDEX items_course ON items(course_id);

-- course_id は進捗集計を JOIN なしで行うための非正規化カラム
CREATE TABLE completions (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id      INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  completed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, item_id)
) WITHOUT ROWID;
CREATE INDEX completions_user_course ON completions(user_id, course_id);
CREATE INDEX completions_item ON completions(item_id);
