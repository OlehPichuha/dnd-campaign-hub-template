ALTER TABLE members ADD COLUMN last_login_at TEXT;

CREATE TABLE player_slots (
  id TEXT PRIMARY KEY,
  character_name TEXT NOT NULL,
  player_name TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  email TEXT UNIQUE COLLATE NOCASE,
  CHECK(email IS NULL OR length(email) > 0)
);

INSERT INTO player_slots (id,character_name,player_name,avatar_url) VALUES
  ('hero-1','Персонаж 1','Гравець 1','/images/avatars/default.svg'),
  ('hero-2','Персонаж 2','Гравець 2','/images/avatars/default.svg'),
  ('hero-3','Персонаж 3','Гравець 3','/images/avatars/default.svg');
