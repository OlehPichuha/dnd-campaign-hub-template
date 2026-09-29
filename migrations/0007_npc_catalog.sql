CREATE TABLE npc_categories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL COLLATE NOCASE,
  position INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(title)
);

CREATE TABLE npcs (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES npc_categories(id),
  name TEXT NOT NULL,
  race TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'alive' CHECK(status IN ('alive','dead','missing','unknown')),
  description TEXT NOT NULL DEFAULT '',
  portrait TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX npcs_category ON npcs(category_id, archived, name);

INSERT INTO npc_categories (id,title,position) VALUES ('npc-uncategorized','Без категорії',0);

INSERT INTO resources (id,title,description,category,icon,visibility,kind,url,body,image_url,theme,position)
VALUES ('npcs','NPC','Персонажі кампанії, їхній стан, роль і останнє відоме місце.','Кампанія','map','group','note','','','','light',4)
ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,category=excluded.category,icon=excluded.icon,visibility=excluded.visibility,position=excluded.position,version=resources.version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
