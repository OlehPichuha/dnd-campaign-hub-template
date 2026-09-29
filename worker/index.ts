import { Hono } from 'hono';
import { z } from 'zod';
import { authenticate, isLocal, verifyFirebaseToken, SESSION_COOKIE, type Env } from './auth';
import type { User, Game, Note, Resource } from '../shared/types';

type Context = { Bindings: Env; Variables: { user: User } };
const app = new Hono<Context>();
const visibility = z.enum(['group', 'dm']);
const noteSection = z.enum(['shared', 'dm']);
const id = z.string().min(1).max(100);
const title = z.string().trim().min(1, 'Вкажи назву').max(200);
const day = z.string().refine(s => {
  if (!s) return true;
  const parsed = new Date(`${s}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10) === s;
}, 'Перевір дату');
const gameSchema = z.object({
  phase_id: id, title, date: day.default(''), time: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/).default(''),
  level: z.number().int().min(1).max(20).nullable().default(null),
  status: z.enum(['planned','completed','cancelled']).default('planned'), visibility: visibility.default('group'),
  summary: z.string().max(20000).default(''), participants: z.string().max(1000).default(''),
  initial_note: z.string().trim().max(20000).default(''),
  parent_id: id.nullable().default(null), version: z.number().int().positive().optional(),
});
const resourceSchema = z.object({
  title, description: z.string().max(500).default(''), category: z.string().trim().min(1).max(80),
  icon: z.enum(['calendar','scroll','compass','book','map','tools','terminal']).default('book'),
  visibility: visibility.default('dm'), kind: z.enum(['note','link','html','journal']),
  url: z.string().max(2000).default(''), body: z.string().max(1000000).default(''),
  image_url: z.string().max(2000).default(''), theme: z.enum(['light','dark']).default('light'),
  version: z.number().int().positive().optional(),
}).refine(r => r.kind !== 'link' || /^https:\/\//i.test(r.url), { message: 'Посилання має починатися з https://', path: ['url'] })
  .refine(r => !r.image_url || /^https:\/\//i.test(r.image_url), { message: 'Адреса обкладинки має починатися з https://', path: ['image_url'] });
const npcCategorySchema = z.object({ title, version: z.number().int().positive().optional() });
const npcSchema = z.object({
  category_id: id, name: title, race: z.string().trim().max(100).default(''), role: z.string().trim().max(200).default(''),
  location: z.string().trim().max(200).default(''), status: z.enum(['alive','dead','missing','unknown']).default('unknown'),
  description: z.string().trim().max(20000).default(''), portrait: z.string().max(800000).default(''),
  version: z.number().int().positive().optional(),
}).refine(n => !n.portrait || /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(n.portrait), { message: 'Портрет має бути зображенням', path: ['portrait'] });
const mapMarkerSchema = z.object({
  title: z.string().trim().min(1,'Вкажи назву').max(120), body: z.string().trim().max(10000).default(''),
  x: z.number().min(0).max(1), y: z.number().min(0).max(1), color: z.enum(['gold','cyan','red','violet','green']).default('gold'),
  version: z.number().int().positive().optional(),
});
const dmNoteCategorySchema = z.object({ title, version: z.number().int().positive().optional() });
const dmNotebookSchema = z.object({
  category_id: id, title, body: z.string().max(100000).default(''), version: z.number().int().positive().optional(),
});

const visibleGames = `(s.archived = 0 AND (s.parent_id IS NULL OR EXISTS (SELECT 1 FROM sessions p WHERE p.id = s.parent_id AND p.archived = 0)))`;
const playerGames = `(${visibleGames} AND s.visibility = 'group' AND (s.parent_id IS NULL OR EXISTS (SELECT 1 FROM sessions p WHERE p.id = s.parent_id AND p.visibility = 'group')))`;
const canSeeSql = (u: User) => u.role === 'dm' ? visibleGames : playerGames;
const isDm = (u: User) => u.role === 'dm';
const getGame = (db: D1Database, u: User, gameId: string) => db.prepare(`SELECT s.* FROM sessions s WHERE s.id = ? AND ${canSeeSql(u)}`).bind(gameId).first<Game>();
const now = () => new Date().toISOString();
function kyivClock() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Kyiv', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', hourCycle:'h23' }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  return { date:`${value('year')}-${value('month')}-${value('day')}`, hour:Number(value('hour')) };
}
async function completeDueGames(db: D1Database) {
  const clock = kyivClock();
  await db.prepare(`UPDATE sessions SET status='completed',version=version+1,updated_at=?
    WHERE archived=0 AND status='planned' AND status_manual=0 AND date<>'' AND (date<? OR (date=? AND ?=1))`)
    .bind(now(),clock.date,clock.date,clock.hour>=22?1:0).run();
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
function resourceIcon(icon: Resource['icon']) {
  const paths: Record<Resource['icon'], string> = {
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    scroll:'<path d="M6 3h12v15a3 3 0 0 1-3 3H6a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3Z"/><path d="M6 3a3 3 0 0 0-3 3v1h6"/>',
    compass:'<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
    book:'<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22V5.5ZM20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22V5.5Z"/>',
    map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/>',
    tools:'<path d="M14.7 6.3a4 4 0 0 0-5-5L7.4 3.6l3 3L8.7 8.3l-3-3-2.3 2.3a4 4 0 0 0 5 5L16 20.2a2 2 0 1 0 2.8-2.8l-7.6-7.6"/>',
    terminal:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  };
  return `<svg class="campaign-hub-resource-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[icon]}</svg>`;
}

function fullPageHtml(resource: Resource) {
  const theme = resource.theme === 'dark' ? 'dark' : 'light';
  const navigationTitle = resource.id === 'academy' ? 'Конклав Сільвермуна' : resource.title;
  const designSystem = '<link rel="stylesheet" href="/page-ui-kit.css">';
  const navigation = `<header class="campaign-hub-rail"><nav class="campaign-hub-breadcrumbs" aria-label="Навігація сторінки"><a class="campaign-hub-home" href="/#/" target="_top" aria-label="Повернутися до бібліотеки"><svg class="campaign-hub-back" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg><img class="campaign-hub-logo" src="/favicon.svg" width="25" height="25" alt=""><strong>Кампанія</strong></a><svg class="campaign-hub-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg><span class="campaign-hub-current">${resourceIcon(resource.icon)}<strong>${escapeHtml(navigationTitle)}</strong></span></nav></header>`;
  const navigationBehavior = `<script>(function(){const mobile=matchMedia('(max-width: 600px)');let lastY=scrollY,travel=0,direction=0;function update(){const y=scrollY,delta=y-lastY;lastY=y;if(!mobile.matches||y<64){document.body.classList.remove('campaign-hub-rail-hidden');travel=0;return}if(Math.abs(delta)<2)return;const next=Math.sign(delta);travel=next===direction?travel+Math.abs(delta):Math.abs(delta);direction=next;if(travel>=(next>0?16:10)){document.body.classList.toggle('campaign-hub-rail-hidden',next>0);travel=0}}addEventListener('scroll',update,{passive:true});mobile.addEventListener('change',function(){document.body.classList.remove('campaign-hub-rail-hidden');lastY=scrollY;travel=0})})()</script>`;
  let html = resource.body || '<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Матеріал</title></head><body><p>Матеріал ще не додано.</p></body></html>';
  html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${designSystem}</head>`) : `${designSystem}${html}`;
  html = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, match => {
    const themedBody = /\bclass\s*=\s*(["'])/i.test(match)
      ? match.replace(/\bclass\s*=\s*(["'])(.*?)\1/i, (_all, quote, names) => `class=${quote}${names} portal-page portal-theme-${theme} portal-resource-${resource.id}${quote}`)
      : match.replace(/>$/, ` class="portal-page portal-theme-${theme} portal-resource-${resource.id}">`);
    return `${themedBody}${navigation}${navigationBehavior}`;
  }) : `${navigation}${navigationBehavior}${html}`;
  return html;
}

app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('Cache-Control', 'private, no-store');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://images.unsplash.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com; frame-src 'self' https://*.firebaseapp.com; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
  const path = new URL(c.req.url).pathname;
  const authEndpoint = path === '/api/auth/session' || path === '/api/auth/logout';
  const publicAsset = ['GET', 'HEAD'].includes(c.req.method) && (path === '/' || path === '/index.html' || /^\/(?:assets|images|fonts)\//.test(path) || /^\/(?:favicon\.[a-z]+|page-ui-kit\.css)$/.test(path));
  if (publicAsset || authEndpoint) {
    if (authEndpoint) {
      if (c.req.method !== 'POST' || c.req.header('X-Requested-With') !== 'campaign-hub' || c.req.header('Origin') !== new URL(c.req.url).origin || !c.req.header('Content-Type')?.startsWith('application/json')) return c.json({ error: 'Недійсний запит' }, 403);
    }
    await next();
    return;
  }
  const user = await authenticate(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Доступ закрито. Увійди дозволеною поштою або звернися до майстра.' }, 401);
  c.set('user', user);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    if (c.req.header('X-Requested-With') !== 'campaign-hub') return c.json({ error: 'Недійсний запит' }, 403);
    const origin = c.req.header('Origin');
    const local = isLocal(c.req.raw, c.env);
    const allowedOrigins = [new URL(c.req.url).origin, ...(local ? ['http://127.0.0.1:5174', 'http://localhost:5174'] : [])];
    if (origin && !allowedOrigins.includes(origin)) return c.json({ error: 'Недійсне джерело запиту' }, 403);
    if (!c.req.header('Content-Type')?.startsWith('application/json')) return c.json({ error: 'Очікується JSON' }, 415);
    const text = await c.req.raw.clone().text();
    if (new TextEncoder().encode(text).length > 1300000) return c.json({ error: 'Файл завеликий. Максимум — 1 МБ.' }, 413);
  }
  await next();
});

app.post('/api/auth/session', async c => {
  const input = z.object({ token: z.string().min(100).max(8192) }).parse(await c.req.json());
  const identity = await verifyFirebaseToken(input.token, c.env);
  if (!identity) return c.json({ error: 'Не вдалося перевірити вхід' }, 401);
  const authenticated = await authenticate(new Request(c.req.url, { headers: { Authorization: `Bearer ${input.token}` } }), c.env);
  if (!authenticated) return c.json({ error: 'Цю адресу ще не дозволено. Звернися до майстра.' }, 403);
  const seconds = Math.min(3600, Math.max(1, identity.expiresAt - Math.floor(Date.now() / 1000)));
  c.header('Set-Cookie', `${SESSION_COOKIE}=${input.token}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`);
  return c.json({ ok: true });
});

app.post('/api/auth/logout', c => {
  c.header('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return c.json({ ok: true });
});

app.get('/api/bootstrap', async c => {
  const u = c.get('user');
  await completeDueGames(c.env.DB);
  const [acts, phases, games, resources] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM acts ORDER BY position'),
    c.env.DB.prepare('SELECT * FROM phases ORDER BY position'),
    c.env.DB.prepare(`SELECT s.id,s.parent_id,s.number,s.branch,s.phase_id,s.title,s.date,s.time,s.level,s.status,s.visibility,s.summary,s.participants,s.version,
      (SELECT COUNT(*) FROM notes n WHERE n.session_id = s.id AND n.archived = 0 ${isDm(u) ? '' : "AND n.visibility = 'group'"}) AS note_count
      FROM sessions s WHERE ${canSeeSql(u)} ORDER BY s.number DESC, s.branch ASC`),
    c.env.DB.prepare(`SELECT id,title,description,category,icon,visibility,kind,url,image_url,theme,position,version,updated_at FROM resources WHERE archived = 0 ${isDm(u) ? '' : "AND visibility = 'group'"} ORDER BY position`),
  ]);
  return c.json({ user: u, acts: acts.results, phases: phases.results, games: games.results, resources: resources.results, bookConfigured: Boolean(c.env.CAMPAIGN_BOOK_URL) });
});

app.post('/api/games', async c => {
  if (!isDm(c.get('user'))) return c.json({ error: 'Створювати партії може лише майстер' }, 403);
  const g = gameSchema.parse(await c.req.json());
  const gameId = crypto.randomUUID();
  const user = c.get('user');
  if (!await c.env.DB.prepare('SELECT id FROM phases WHERE id = ?').bind(g.phase_id).first()) return c.json({ error: 'Фазу не знайдено' }, 400);
  let insert: D1PreparedStatement;
  if (g.parent_id) {
    const parent = await getGame(c.env.DB, user, g.parent_id);
    if (!parent || parent.parent_id) return c.json({ error: 'Підпартію можна додати тільки до основної партії' }, 400);
    insert = c.env.DB.prepare(`INSERT INTO sessions (id,parent_id,number,branch,phase_id,title,date,time,level,status,visibility,summary,participants)
      SELECT ?,?,?,COALESCE(MAX(branch),0)+1,?,?,?,?,?,?,?,?,? FROM sessions WHERE parent_id = ?`)
      .bind(gameId, parent.id, parent.number, parent.phase_id, g.title, g.date, g.time, g.level, g.status, g.visibility, g.summary, g.participants, parent.id);
  } else {
    insert = c.env.DB.prepare(`INSERT INTO sessions (id,number,branch,phase_id,title,date,time,level,status,visibility,summary,participants)
      SELECT ?,COALESCE(MAX(number),0)+1,0,?,?,?,?,?,?,?,?,? FROM sessions`)
      .bind(gameId, g.phase_id, g.title, g.date, g.time, g.level, g.status, g.visibility, g.summary, g.participants);
  }
  const statements = [insert];
  if (g.initial_note) statements.push(c.env.DB.prepare('INSERT INTO notes (id,session_id,author_id,author_name,visibility,section,body) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),gameId,user.id,user.name,'group','dm',g.initial_note));
  await c.env.DB.batch(statements);
  return c.json({ id: gameId }, 201);
});

app.put('/api/games/:id', async c => {
  if (!isDm(c.get('user'))) return c.json({ error: 'Редагувати партії може лише майстер' }, 403);
  const g = gameSchema.extend({ version: z.number().int().positive() }).parse(await c.req.json());
  const original = await getGame(c.env.DB, c.get('user'), c.req.param('id'));
  if (!original) return c.json({ error: 'Партію не знайдено' }, 404);
  const phaseId = original.parent_id ? original.phase_id : g.phase_id;
  if (!await c.env.DB.prepare('SELECT id FROM phases WHERE id = ?').bind(phaseId).first()) return c.json({ error: 'Фазу не знайдено' }, 400);
  const updatedAt = now();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE sessions SET phase_id=?,title=?,date=?,time=?,level=?,status=?,status_manual=CASE WHEN status<>? THEN 1 ELSE status_manual END,visibility=?,summary=?,participants=?,version=version+1,updated_at=? WHERE id=? AND version=? AND archived=0`)
      .bind(phaseId, g.title, g.date, g.time, g.level, g.status, g.status, g.visibility, g.summary, g.participants, updatedAt, original.id, g.version),
    c.env.DB.prepare(`UPDATE sessions SET phase_id=?,version=version+1 WHERE parent_id=? AND EXISTS (SELECT 1 FROM sessions p WHERE p.id=? AND p.updated_at=?)`).bind(phaseId, original.id, original.id, updatedAt),
  ]);
  if (!result[0].meta.changes) return c.json({ error: 'Запис уже змінився в іншій вкладці. Онови сторінку перед збереженням.' }, 409);
  return c.json({ ok: true });
});

app.post('/api/games/:id/archive', async c => {
  if (!isDm(c.get('user'))) return c.json({ error: 'Потрібен доступ майстра' }, 403);
  const body = z.object({ version: z.number().int().positive() }).parse(await c.req.json());
  const result = await c.env.DB.prepare('UPDATE sessions SET archived=1,version=version+1 WHERE id=? AND version=? AND archived=0').bind(c.req.param('id'), body.version).run();
  return result.meta.changes ? c.json({ ok: true }) : c.json({ error: 'Запис уже змінився. Онови сторінку.' }, 409);
});

app.get('/api/games/:id/notes', async c => {
  const u = c.get('user');
  if (!await getGame(c.env.DB, u, c.req.param('id'))) return c.json({ error: 'Партію не знайдено' }, 404);
  const notes = await c.env.DB.prepare(`SELECT id,session_id,author_id,author_name,visibility,section,body,created_at,updated_at,version FROM notes WHERE session_id=? AND archived=0 ${isDm(u) ? '' : "AND visibility='group'"} ORDER BY created_at`).bind(c.req.param('id')).all();
  return c.json(notes.results);
});
app.post('/api/games/:id/notes', async c => {
  const u = c.get('user');
  if (!await getGame(c.env.DB, u, c.req.param('id'))) return c.json({ error: 'Партію не знайдено' }, 404);
  const n = z.object({ body: z.string().trim().min(1).max(20000), visibility, section: noteSection.optional() }).parse(await c.req.json());
  const section = n.section || (n.visibility === 'dm' ? 'dm' : 'shared');
  if (!isDm(u) && (n.visibility === 'dm' || section === 'dm')) return c.json({ error: 'Цей розділ доступний майстру' }, 403);
  const noteId = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO notes (id,session_id,author_id,author_name,visibility,section,body) VALUES (?,?,?,?,?,?,?)').bind(noteId, c.req.param('id'), u.id, u.name, section === 'shared' ? 'group' : n.visibility, section, n.body).run();
  return c.json({ id: noteId }, 201);
});
app.put('/api/notes/:id', async c => {
  const u = c.get('user');
  const n = z.object({ body: z.string().trim().min(1).max(20000), visibility: visibility.optional(), version: z.number().int().positive() }).parse(await c.req.json());
  const original = await c.env.DB.prepare('SELECT * FROM notes WHERE id=? AND archived=0').bind(c.req.param('id')).first<Note>();
  if (!original || !await getGame(c.env.DB,u,original.session_id) || !isDm(u) && (original.author_id !== u.id || original.visibility !== 'group' || original.section !== 'shared') || !isDm(u) && n.visibility === 'dm') return c.json({ error: 'Немає доступу до редагування цієї примітки' }, 403);
  const nextVisibility = original.section === 'shared' ? 'group' : (n.visibility || original.visibility);
  const results = await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO note_revisions (note_id,body,editor,version) SELECT id,body,?,version FROM notes WHERE id=? AND version=? AND archived=0').bind(u.id, original.id, n.version),
    c.env.DB.prepare('UPDATE notes SET body=?,visibility=?,version=version+1,updated_at=? WHERE id=? AND version=? AND archived=0').bind(n.body,nextVisibility,now(),original.id,n.version),
  ]);
  return results[1].meta.changes ? c.json({ ok: true }) : c.json({ error: 'Примітку вже змінили. Онови її перед збереженням.' }, 409);
});

app.post('/api/structure', async c => {
  if (!isDm(c.get('user'))) return c.json({ error: 'Потрібен доступ майстра' }, 403);
  const s = z.object({ kind: z.enum(['act','phase']), title, act_id: id.optional() }).parse(await c.req.json());
  const newId = crypto.randomUUID();
  if (s.kind === 'act') await c.env.DB.prepare('INSERT INTO acts SELECT ?,?,COALESCE(MAX(position),0)+1 FROM acts').bind(newId,s.title).run();
  else {
    if (!s.act_id || !await c.env.DB.prepare('SELECT id FROM acts WHERE id=?').bind(s.act_id).first()) return c.json({ error: 'Спочатку вибери акт' }, 400);
    await c.env.DB.prepare('INSERT INTO phases SELECT ?,?,?,COALESCE(MAX(position),0)+1 FROM phases').bind(newId,s.act_id,s.title).run();
  }
  return c.json({ id: newId }, 201);
});
app.put('/api/structure/:id', async c => {
  if (!isDm(c.get('user'))) return c.json({ error: 'Потрібен доступ майстра' }, 403);
  const s = z.object({ kind: z.enum(['act','phase']), title }).parse(await c.req.json());
  await c.env.DB.prepare(`UPDATE ${s.kind === 'act' ? 'acts' : 'phases'} SET title=? WHERE id=?`).bind(s.title,c.req.param('id')).run();
  return c.json({ ok: true });
});

app.get('/api/npcs', async c => {
  const [categories,npcs] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id,title,position,version FROM npc_categories WHERE archived=0 ORDER BY position,title'),
    c.env.DB.prepare('SELECT id,category_id,name,race,role,location,status,description,portrait,version,updated_at FROM npcs WHERE archived=0 ORDER BY name COLLATE NOCASE'),
  ]);
  return c.json({ categories: categories.results, npcs: npcs.results });
});
app.post('/api/npc-categories', async c => {
  const category = npcCategorySchema.parse(await c.req.json());
  const categoryId = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO npc_categories (id,title,position) SELECT ?,?,COALESCE(MAX(position),0)+1 FROM npc_categories').bind(categoryId,category.title).run();
  return c.json({ id: categoryId },201);
});
app.put('/api/npc-categories/:id', async c => {
  const category = npcCategorySchema.extend({version:z.number().int().positive()}).parse(await c.req.json());
  const result = await c.env.DB.prepare('UPDATE npc_categories SET title=?,version=version+1,updated_at=? WHERE id=? AND version=? AND archived=0').bind(category.title,now(),c.req.param('id'),category.version).run();
  return result.meta.changes ? c.json({ok:true}) : c.json({error:'Категорію вже змінили. Онови сторінку.'},409);
});
app.post('/api/npcs', async c => {
  const npc = npcSchema.parse(await c.req.json());
  if (!await c.env.DB.prepare('SELECT id FROM npc_categories WHERE id=? AND archived=0').bind(npc.category_id).first()) return c.json({error:'Категорію не знайдено'},400);
  const npcId=crypto.randomUUID(), user=c.get('user');
  await c.env.DB.prepare('INSERT INTO npcs (id,category_id,name,race,role,location,status,description,portrait,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .bind(npcId,npc.category_id,npc.name,npc.race,npc.role,npc.location,npc.status,npc.description,npc.portrait,user.id,user.id).run();
  return c.json({id:npcId},201);
});
app.put('/api/npcs/:id', async c => {
  const npc = npcSchema.safeExtend({version:z.number().int().positive()}).parse(await c.req.json());
  if (!await c.env.DB.prepare('SELECT id FROM npc_categories WHERE id=? AND archived=0').bind(npc.category_id).first()) return c.json({error:'Категорію не знайдено'},400);
  const result = await c.env.DB.prepare('UPDATE npcs SET category_id=?,name=?,race=?,role=?,location=?,status=?,description=?,portrait=?,updated_by=?,version=version+1,updated_at=? WHERE id=? AND version=? AND archived=0')
    .bind(npc.category_id,npc.name,npc.race,npc.role,npc.location,npc.status,npc.description,npc.portrait,c.get('user').id,now(),c.req.param('id'),npc.version).run();
  return result.meta.changes ? c.json({ok:true}) : c.json({error:'NPC вже змінили. Онови сторінку.'},409);
});

app.get('/api/map-markers', async c => c.json((await c.env.DB.prepare('SELECT id,title,body,x,y,color,created_by,created_by_name,version,created_at,updated_at FROM map_markers WHERE archived=0 ORDER BY title COLLATE NOCASE').all()).results));
app.post('/api/map-markers', async c => {
  const marker=mapMarkerSchema.parse(await c.req.json()),user=c.get('user'),markerId=crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO map_markers (id,title,body,x,y,color,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?)').bind(markerId,marker.title,marker.body,marker.x,marker.y,marker.color,user.id,user.name).run();
  return c.json({id:markerId},201);
});
app.put('/api/map-markers/:id', async c => {
  const marker=mapMarkerSchema.extend({version:z.number().int().positive()}).parse(await c.req.json());
  const result=await c.env.DB.prepare('UPDATE map_markers SET title=?,body=?,x=?,y=?,color=?,version=version+1,updated_at=? WHERE id=? AND version=? AND archived=0').bind(marker.title,marker.body,marker.x,marker.y,marker.color,now(),c.req.param('id'),marker.version).run();
  return result.meta.changes?c.json({ok:true}):c.json({error:'Позначку вже змінили. Онови мапу.'},409);
});
app.delete('/api/map-markers/:id', async c => {
  const input=z.object({version:z.number().int().positive()}).parse(await c.req.json());
  const result=await c.env.DB.prepare('UPDATE map_markers SET archived=1,version=version+1,updated_at=? WHERE id=? AND version=? AND archived=0').bind(now(),c.req.param('id'),input.version).run();
  return result.meta.changes?c.json({ok:true}):c.json({error:'Позначку вже змінили. Онови мапу.'},409);
});

app.get('/api/dm-notebooks', async c => {
  if(!isDm(c.get('user')))return c.json({error:'Потрібен доступ майстра'},403);
  const [categories,notes]=await c.env.DB.batch([
    c.env.DB.prepare('SELECT id,title,position,version FROM dm_note_categories WHERE archived=0 ORDER BY position,title'),
    c.env.DB.prepare('SELECT id,category_id,title,body,position,version,created_at,updated_at FROM dm_notebooks WHERE archived=0 ORDER BY position,title COLLATE NOCASE'),
  ]);
  return c.json({categories:categories.results,notes:notes.results});
});
app.post('/api/dm-note-categories', async c => {
  if(!isDm(c.get('user')))return c.json({error:'Потрібен доступ майстра'},403);
  const category=dmNoteCategorySchema.parse(await c.req.json()),categoryId=crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO dm_note_categories (id,title,position) SELECT ?,?,COALESCE(MAX(position),0)+1 FROM dm_note_categories').bind(categoryId,category.title).run();
  return c.json({id:categoryId},201);
});
app.put('/api/dm-note-categories/:id', async c => {
  if(!isDm(c.get('user')))return c.json({error:'Потрібен доступ майстра'},403);
  const category=dmNoteCategorySchema.extend({version:z.number().int().positive()}).parse(await c.req.json());
  const result=await c.env.DB.prepare('UPDATE dm_note_categories SET title=?,version=version+1,updated_at=? WHERE id=? AND version=? AND archived=0').bind(category.title,now(),c.req.param('id'),category.version).run();
  return result.meta.changes?c.json({ok:true}):c.json({error:'Категорію вже змінили. Онови сторінку.'},409);
});
app.post('/api/dm-notebooks', async c => {
  if(!isDm(c.get('user')))return c.json({error:'Потрібен доступ майстра'},403);
  const note=dmNotebookSchema.parse(await c.req.json());
  if(!await c.env.DB.prepare('SELECT id FROM dm_note_categories WHERE id=? AND archived=0').bind(note.category_id).first())return c.json({error:'Категорію не знайдено'},400);
  const noteId=crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO dm_notebooks (id,category_id,title,body,position) SELECT ?,?,?,?,COALESCE(MAX(position),0)+1 FROM dm_notebooks WHERE category_id=?').bind(noteId,note.category_id,note.title,note.body,note.category_id).run();
  return c.json({id:noteId},201);
});
app.put('/api/dm-notebooks/:id', async c => {
  if(!isDm(c.get('user')))return c.json({error:'Потрібен доступ майстра'},403);
  const note=dmNotebookSchema.extend({version:z.number().int().positive()}).parse(await c.req.json());
  if(!await c.env.DB.prepare('SELECT id FROM dm_note_categories WHERE id=? AND archived=0').bind(note.category_id).first())return c.json({error:'Категорію не знайдено'},400);
  const result=await c.env.DB.prepare('UPDATE dm_notebooks SET category_id=?,title=?,body=?,version=version+1,updated_at=? WHERE id=? AND version=? AND archived=0').bind(note.category_id,note.title,note.body,now(),c.req.param('id'),note.version).run();
  return result.meta.changes?c.json({ok:true}):c.json({error:'Блокнот уже змінили. Онови сторінку.'},409);
});
app.delete('/api/dm-notebooks/:id', async c => {
  if(!isDm(c.get('user')))return c.json({error:'Потрібен доступ майстра'},403);
  const input=z.object({version:z.number().int().positive()}).parse(await c.req.json());
  const result=await c.env.DB.prepare('UPDATE dm_notebooks SET archived=1,version=version+1,updated_at=? WHERE id=? AND version=? AND archived=0').bind(now(),c.req.param('id'),input.version).run();
  return result.meta.changes?c.json({ok:true}):c.json({error:'Блокнот уже змінили. Онови сторінку.'},409);
});

app.get('/api/resources/:id', async c => {
  const resource = await c.env.DB.prepare(`SELECT * FROM resources WHERE id=? AND archived=0 ${isDm(c.get('user')) ? '' : "AND visibility='group'"}`).bind(c.req.param('id')).first<Resource>();
  return resource ? c.json(resource) : c.json({ error: 'Матеріал не знайдено' }, 404);
});
app.get('/api/resources/:id/html', async c => {
  const resource = await c.env.DB.prepare(`SELECT * FROM resources WHERE id=? AND kind='html' AND archived=0 ${isDm(c.get('user')) ? '' : "AND visibility='group'"}`).bind(c.req.param('id')).first<Resource>();
  if (!resource) return c.text('Матеріал не знайдено',404);
  c.header('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'");
  return c.html(resource.body || '<p>Матеріал ще не додано.</p>');
});
app.get('/view/:id', async c => {
  const resource = await c.env.DB.prepare(`SELECT * FROM resources WHERE id=? AND kind='html' AND archived=0 ${isDm(c.get('user')) ? '' : "AND visibility='group'"}`).bind(c.req.param('id')).first<Resource>();
  if (!resource) return c.html('<!doctype html><html lang="uk"><meta charset="utf-8"><title>Матеріал не знайдено</title><body><p>Матеріал не знайдено.</p><a href="/#/">До бібліотеки</a></body></html>',404);
  c.header('Content-Security-Policy', "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline' http: https:; img-src data: blob: http: https:; font-src data: http: https:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'");
  return c.html(fullPageHtml(resource));
});
app.get('/api/books/campaign/drive', c => {
  if (!isDm(c.get('user'))) return c.json({ error: 'Книга доступна лише майстру' },403);
  if (!c.env.CAMPAIGN_BOOK_URL) return c.json({ error: 'Додай посилання на книгу в налаштуваннях сайту.' },404);
  try {
    const url = new URL(c.env.CAMPAIGN_BOOK_URL);
    if (url.protocol !== 'https:') throw new Error('HTTPS required');
    return c.redirect(url.toString(),302);
  } catch { return c.json({ error: 'Адресу книги налаштовано неправильно.' },503); }
});
app.post('/api/resources', async c => {
  if (!isDm(c.get('user'))) return c.json({ error: 'Потрібен доступ майстра' }, 403);
  const r = resourceSchema.parse(await c.req.json());
  if (r.kind === 'journal') return c.json({ error: 'Журнал уже є в бібліотеці' },400);
  const resourceId = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO resources (id,title,description,category,icon,visibility,kind,url,body,image_url,theme,position) SELECT ?,?,?,?,?,?,?,?,?,?,?,COALESCE(MAX(position),0)+1 FROM resources').bind(resourceId,r.title,r.description,r.category,r.icon,r.visibility,r.kind,r.url,r.body,r.image_url,r.theme).run();
  return c.json({ id: resourceId }, 201);
});
app.put('/api/resources/:id', async c => {
  if (!isDm(c.get('user'))) return c.json({ error: 'Потрібен доступ майстра' }, 403);
  const r = resourceSchema.parse(await c.req.json());
  if (!r.version) return c.json({ error: 'Відсутня версія матеріалу' },400);
  if ((c.req.param('id') === 'journal') !== (r.kind === 'journal')) return c.json({ error: 'Тип журналу змінювати не можна' },400);
  const result = await c.env.DB.prepare('UPDATE resources SET title=?,description=?,category=?,icon=?,visibility=?,kind=?,url=?,body=?,image_url=?,theme=?,version=version+1,updated_at=? WHERE id=? AND version=? AND archived=0').bind(r.title,r.description,r.category,r.icon,r.visibility,r.kind,r.url,r.body,r.image_url,r.theme,now(),c.req.param('id'),r.version).run();
  return result.meta.changes ? c.json({ ok: true }) : c.json({ error: 'Матеріал уже змінився. Онови сторінку.' },409);
});

app.get('/api/members', async c => {
  if (!isDm(c.get('user'))) return c.json({ error: 'Потрібен доступ майстра' },403);
  return c.json((await c.env.DB.prepare('SELECT email,name,role,active,last_login_at FROM members ORDER BY name').all()).results);
});
app.get('/api/player-slots', async c => {
  if (!isDm(c.get('user'))) return c.json({ error: 'Потрібен доступ майстра' },403);
  return c.json((await c.env.DB.prepare(`SELECT s.id,s.character_name,s.player_name,s.avatar_url,s.email,m.active,m.last_login_at
    FROM player_slots s LEFT JOIN members m ON m.email=s.email ORDER BY s.id`).all()).results);
});
app.put('/api/player-slots/:id', async c => {
  if (!isDm(c.get('user'))) return c.json({ error: 'Потрібен доступ майстра' },403);
  const input=z.object({email:z.union([z.email(),z.literal('')]).transform(email=>email.trim().toLowerCase()),character_name:title,player_name:title}).parse(await c.req.json());
  const slot=await c.env.DB.prepare('SELECT email,player_name FROM player_slots WHERE id=?').bind(c.req.param('id')).first<{email:string|null;player_name:string}>();
  if(!slot)return c.json({error:'Гравця не знайдено'},404);
  const email=input.email||null;
  if(email===c.env.OWNER_EMAIL?.trim().toLowerCase())return c.json({error:'Адреса майстра налаштовується окремо'},400);
  if(email){
    const taken=await c.env.DB.prepare('SELECT id FROM player_slots WHERE email=? AND id<>?').bind(email,c.req.param('id')).first();
    if(taken)return c.json({error:'Цю адресу вже прив’язано до іншого гравця'},409);
  }
  const updates=[];
  if(slot.email&&slot.email!==email)updates.push(c.env.DB.prepare('UPDATE members SET active=0 WHERE email=?').bind(slot.email));
  if(email)updates.push(c.env.DB.prepare("INSERT INTO members (email,name,role,active) VALUES (?,?,'player',1) ON CONFLICT(email) DO UPDATE SET name=excluded.name,role='player',active=1").bind(email,input.player_name));
  updates.push(c.env.DB.prepare('UPDATE player_slots SET email=?,character_name=?,player_name=? WHERE id=?').bind(email,input.character_name,input.player_name,c.req.param('id')));
  await c.env.DB.batch(updates);
  return c.json({ok:true});
});
app.post('/api/members', async c => {
  if (!isDm(c.get('user'))) return c.json({ error: 'Потрібен доступ майстра' },403);
  const m = z.object({ email: z.email(), name: title, active: z.boolean().default(true) }).parse(await c.req.json());
  if (m.email.toLowerCase() === c.env.OWNER_EMAIL?.trim().toLowerCase()) return c.json({ error: 'Доступ власника налаштовується окремо' },400);
  await c.env.DB.prepare("INSERT INTO members (email,name,role,active) VALUES (?,?,'player',?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,active=excluded.active").bind(m.email.toLowerCase(),m.name,m.active ? 1 : 0).run();
  return c.json({ ok: true });
});
app.get('/api/export', async c => {
  if (!isDm(c.get('user'))) return c.json({ error: 'Експорт доступний майстру' },403);
  const tables = ['acts','phases','sessions','notes','resources','members','player_slots','note_revisions','npc_categories','npcs','map_markers','dm_note_categories','dm_notebooks'];
  const data = await c.env.DB.batch(tables.map(t => c.env.DB.prepare(`SELECT * FROM ${t}`)));
  c.header('Content-Disposition', `attachment; filename="campaign-backup-${new Date().toISOString().slice(0,10)}.json"`);
  return c.json({ format: 1, exported_at: now(), data: Object.fromEntries(tables.map((t,i) => [t,data[i].results])) });
});
app.all('/api/*', c => c.json({ error: 'Сторінку не знайдено' },404));
app.get('*', async c => {
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  const response = new Response(asset.body, asset);
  const url = new URL(c.req.url);
  const type = asset.headers.get('Content-Type') || '';
  let cache = 'private, no-store';
  // Only cache public static files, never API data, documents, or SPA fallbacks.
  if (asset.ok && type.startsWith('image/') && url.pathname.startsWith('/images/')) {
    cache = url.pathname.startsWith('/images/map-tiles/') && url.searchParams.has('v')
      ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
  } else if (asset.ok && url.pathname.startsWith('/assets/') && /(?:javascript|css)/.test(type)) {
    cache = 'public, max-age=31536000, immutable';
  } else if (asset.ok && url.pathname.startsWith('/fonts/') && /(?:font|woff)/.test(type)) {
    cache = 'public, max-age=31536000, immutable';
  }
  c.header('Cache-Control', cache);
  response.headers.set('Cache-Control', cache);
  return response;
});
app.onError((error, c) => {
  if (error instanceof z.ZodError) return c.json({ error: error.issues.map(i => i.message).join('. ') },400);
  if (error instanceof SyntaxError) return c.json({ error: 'Не вдалося прочитати запит' },400);
  console.error('Request failed', c.req.method, new URL(c.req.url).pathname, error instanceof Error ? error.name : 'Unknown');
  return c.json({ error: 'Не вдалося зберегти або завантажити дані. Спробуй ще раз.' },500);
});
export default app;
