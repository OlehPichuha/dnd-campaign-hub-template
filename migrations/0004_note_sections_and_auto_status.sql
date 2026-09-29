ALTER TABLE notes ADD COLUMN section TEXT NOT NULL DEFAULT 'shared' CHECK(section IN ('shared','dm'));
UPDATE notes SET section = CASE WHEN visibility = 'dm' THEN 'dm' ELSE 'shared' END;
UPDATE notes SET visibility = 'group' WHERE section = 'dm';

ALTER TABLE sessions ADD COLUMN status_manual INTEGER NOT NULL DEFAULT 0 CHECK(status_manual IN (0,1));
