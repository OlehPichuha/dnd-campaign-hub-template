CREATE TABLE map_markers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  x REAL NOT NULL CHECK(x >= 0 AND x <= 1),
  y REAL NOT NULL CHECK(y >= 0 AND y <= 1),
  color TEXT NOT NULL DEFAULT 'gold' CHECK(color IN ('gold','cyan','red','violet','green')),
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX map_markers_visible ON map_markers(archived, title);

CREATE TABLE dm_note_categories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL COLLATE NOCASE,
  position INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(title)
);

CREATE TABLE dm_notebooks (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES dm_note_categories(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX dm_notebooks_category ON dm_notebooks(category_id, archived, position, title);

INSERT INTO dm_note_categories (id,title,position) VALUES ('dm-notes-general','Загальні нотатки',0);

UPDATE resources
SET title='Мапа світу',description='Інтерактивна мапа вашого світу з позначками, нотатками та вимірюванням відстані.',category='Кампанія',icon='map',visibility='group',kind='note',body='',version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='world';

UPDATE resources
SET title='Нотатки майстра',description='Текстові блокноти, згруповані за категоріями.',category='Майстерня',icon='scroll',visibility='dm',kind='note',body='',version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='dm-tools';

INSERT INTO resources (id,title,description,category,icon,visibility,kind,url,body,image_url,theme,position)
VALUES ('dm-price-guide','Швидкий довідник цін','Таверни, ночівля, товари й послуги з місцевими поправками.','Майстерня','tools','dm','html','','','','dark',7)
ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,category=excluded.category,icon=excluded.icon,visibility=excluded.visibility,position=excluded.position,version=resources.version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');

UPDATE resources SET position=0 WHERE id='journal';
UPDATE resources SET position=1 WHERE id='dm-notes';
UPDATE resources SET position=2 WHERE id='foundry';
UPDATE resources SET position=3 WHERE id='npcs';
UPDATE resources SET position=4 WHERE id='world';
UPDATE resources SET position=5 WHERE id='drow-sunlight';
UPDATE resources SET position=6 WHERE id='dm-tools';
UPDATE resources SET position=7 WHERE id='dm-price-guide';
UPDATE resources SET position=8 WHERE id='academy';
