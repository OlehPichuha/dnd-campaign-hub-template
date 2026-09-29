ALTER TABLE resources ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE resources ADD COLUMN theme TEXT NOT NULL DEFAULT 'light' CHECK(theme IN ('light','dark'));

UPDATE resources SET theme='dark' WHERE id IN ('journal','dm-notes','academy','world');
UPDATE resources SET theme='light' WHERE id IN ('foundry','dm-tools');
