import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['--local', '--remote'].includes(mode)) {
  console.error('Вкажи --local або --remote.');
  process.exit(1);
}

const items = [
  { id: 'dm-notes', file: 'jockie-console.html', title: 'Консоль Jockie', description: 'Команди, шаблони та швидка робота з консоллю бота.', category: 'Майстерня', icon: 'terminal', visibility: 'dm', theme: 'dark', image: '', position: 1 },
  { id: 'foundry', file: 'foundry-v13-macro-library.html', title: 'Foundry VTT v13', description: 'Макроси, модулі та готові рішення для майстра.', category: 'Майстерня', icon: 'tools', visibility: 'dm', theme: 'light', image: '', position: 2 },
  { id: 'academy', file: 'silverymoon-academy.html', title: 'Академія Сільвермуна', description: 'Довідник вступника до магічного конклаву.', category: 'Для гравців', icon: 'book', visibility: 'group', theme: 'dark', image: '', position: 8 },
  { id: 'drow-sunlight', file: 'drow-sunlight.html', title: 'Дроу під сонцем', description: 'Калькулятор прямого світла, погоди та видимості.', category: 'Майстерня', icon: 'compass', visibility: 'dm', theme: 'dark', image: '', position: 5 },
  { id: 'dm-price-guide', file: 'dm-price-guide.html', title: 'Швидкий довідник цін', description: 'Таверни, ночівля, товари й послуги з місцевими поправками.', category: 'Майстерня', icon: 'tools', visibility: 'dm', theme: 'dark', image: '', position: 7 },
];

const root = new URL('../', import.meta.url);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const sql = items.flatMap(item => {
  const body = readFileSync(new URL(`content/library/${item.file}`, root), 'utf8');
  const statements = [`INSERT INTO resources (id,title,description,category,icon,visibility,kind,url,body,image_url,theme,position) VALUES (${quote(item.id)},${quote(item.title)},${quote(item.description)},${quote(item.category)},${quote(item.icon)},${quote(item.visibility)},'html','', '',${quote(item.image)},${quote(item.theme)},${item.position}) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,category=excluded.category,icon=excluded.icon,visibility=excluded.visibility,kind='html',url='',body='',image_url=excluded.image_url,theme=excluded.theme,position=excluded.position,version=resources.version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');`];
  const characters = [...body];
  for (let offset = 0; offset < characters.length; offset += 12000) {
    statements.push(`UPDATE resources SET body=body||${quote(characters.slice(offset, offset + 12000).join(''))} WHERE id=${quote(item.id)};`);
  }
  return statements;
});

const privateDirectory = fileURLToPath(new URL('private/', root));
mkdirSync(privateDirectory, { recursive: true });
const sqlFile = fileURLToPath(new URL('private/library-content.sql', root));
writeFileSync(sqlFile, `${sql.join('\n')}\n`, 'utf8');
const wrangler = fileURLToPath(new URL('node_modules/wrangler/bin/wrangler.js', root));
const result = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'campaign-template-db', mode, '--file', sqlFile], {
  cwd: fileURLToPath(root), stdio: 'inherit', windowsHide: true,
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Синхронізовано ${items.length} HTML-матеріали (${mode.slice(2)}).`);
