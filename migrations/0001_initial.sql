PRAGMA foreign_keys = ON;
CREATE TABLE acts (id TEXT PRIMARY KEY, title TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE phases (id TEXT PRIMARY KEY, act_id TEXT NOT NULL REFERENCES acts(id), title TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES sessions(id),
  number INTEGER NOT NULL CHECK(number > 0),
  branch INTEGER NOT NULL DEFAULT 0 CHECK(branch >= 0),
  phase_id TEXT NOT NULL REFERENCES phases(id),
  title TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT '', time TEXT NOT NULL DEFAULT '', level INTEGER,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','completed','cancelled')),
  visibility TEXT NOT NULL DEFAULT 'group' CHECK(visibility IN ('group','dm')),
  summary TEXT NOT NULL DEFAULT '', participants TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(number, branch),
  CHECK((parent_id IS NULL AND branch = 0) OR (parent_id IS NOT NULL AND branch > 0))
);
CREATE INDEX sessions_phase ON sessions(phase_id, archived);
CREATE INDEX sessions_parent ON sessions(parent_id);
CREATE TABLE members (
  email TEXT PRIMARY KEY COLLATE NOCASE, name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('dm','player')),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE notes (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
  author_id TEXT NOT NULL, author_name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'group' CHECK(visibility IN ('group','dm')),
  body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX notes_session ON notes(session_id, visibility, archived);
CREATE TABLE resources (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Матеріали', icon TEXT NOT NULL DEFAULT 'book',
  visibility TEXT NOT NULL DEFAULT 'dm' CHECK(visibility IN ('group','dm')),
  kind TEXT NOT NULL DEFAULT 'note' CHECK(kind IN ('journal','note','link','html')),
  url TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE note_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT NOT NULL, body TEXT NOT NULL,
  editor TEXT NOT NULL, version INTEGER NOT NULL,
  saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO resources (id,title,description,category,icon,visibility,kind,position) VALUES
 ('journal','Журнал партій','Зустрічі, особисті арки та спогади про пригоди.','Кампанія','calendar','group','journal',0),
 ('dm-notes','Нотатки майстра','Плани наступних ігор і таємниці за ширмою.','Майстерня','scroll','dm','note',1),
 ('foundry','Довідник Foundry','Правила столу, підказки й корисні налаштування.','Довідники','compass','group','note',2),
 ('academy','Академія','Знання, навчання та матеріали для персонажів.','Довідники','book','group','note',3),
 ('world','Світ кампанії','Власна мапа, місця та нотатки вашої кампанії.','Кампанія','map','group','note',4),
 ('dm-tools','Інструменти майстра','Таблиці, генератори та інші помічники.','Майстерня','tools','dm','note',5);
