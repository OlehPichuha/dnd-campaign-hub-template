import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

let mf, db, app, env;
const project = new URL('../', import.meta.url);
before(async () => {
  mkdirSync(new URL('private/',project),{recursive:true});
  await build({entryPoints:[fileURLToPath(new URL('worker/index.ts',project))],bundle:true,platform:'browser',format:'esm',target:'es2022',outfile:fileURLToPath(new URL('private/test-worker.mjs',project)),logLevel:'silent'});
  app=(await import(new URL('private/test-worker.mjs',project).href)).default;
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:['DB'],compatibilityDate:'2026-09-19'}));
  db=await mf.getD1Database('DB');
  for(const file of readdirSync(new URL('migrations/',project)).filter(name=>name.endsWith('.sql')).sort()){
    const migration=readFileSync(new URL(`migrations/${file}`,project),'utf8');
    for(const statement of migration.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  }
  for(const table of ['acts','phases','sessions','notes','members','npcs','map_markers','dm_notebooks']){
    const row=await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first();
    assert.equal(row.count,0,`Fresh template contains ${table} data`);
  }
  await db.prepare("INSERT INTO acts VALUES ('a','Тестовий акт',0)").run();
  await db.prepare("INSERT INTO phases VALUES ('p','a','Тестова фаза',0)").run();
  env={DB:db,DEV_AUTH:'local-only',ASSETS:{fetch:async()=>new Response('asset')}};
});
after(async()=>{await mf?.dispose();});
async function request(path,{role='dm',method='GET',body,headers={},host='http://127.0.0.1:8787',bindings=env}={}){
  return app.fetch(new Request(host+path,{method,headers:{'Content-Type':'application/json','X-Requested-With':'campaign-hub','X-Dev-Role':role,...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}),bindings);
}
async function createGame(overrides={}){
  const res=await request('/api/games',{method:'POST',body:{phase_id:'p',title:'Тестова пригода',date:'2026-09-20',visibility:'group',...overrides}});
  assert.equal(res.status,201,await res.clone().text());return (await res.json()).id;
}
async function game(id){return(await(await request('/api/bootstrap')).json()).games.find(g=>g.id===id);}

test('production serves the login shell but denies private data and forged identity',async()=>{
  const bindings={...env,OWNER_EMAIL:'owner@example.com',FIREBASE_PROJECT_ID:'campaign-test'};
  for(const path of ['/api/bootstrap','/api/export','/view/private','/api/books/campaign/drive']){
    const result=await request(path,{host:'https://campaign.example',headers:{'Cf-Access-Authenticated-User-Email':'owner@example.com','X-Dev-Role':'dm'},bindings});
    assert.equal(result.status,401,path);
    assert.match(result.headers.get('cache-control'),/no-store/);
  }
  for(const path of ['/','/favicon.svg','/assets/index.js'])assert.equal((await request(path,{host:'https://campaign.example',bindings})).status,200,path);
  for(const headers of [{Authorization:'Bearer not.a.valid-token'},{Cookie:'__Host-campaign_session=not.a.valid-token'},{'Cf-Access-Jwt-Assertion':'not.a.valid-token'}]){
    assert.equal((await request('/api/bootstrap',{host:'https://campaign.example',headers,bindings})).status,401);
  }
  const forgedSession=await request('/api/auth/session',{host:'https://campaign.example',method:'POST',headers:{Origin:'https://campaign.example'},body:{token:'x'.repeat(120)},bindings});
  assert.equal(forgedSession.status,401);
  assert.equal((await request('/api/auth/session',{host:'https://campaign.example',method:'POST',headers:{Origin:'https://evil.example'},body:{token:'x'.repeat(120)},bindings})).status,403);
});

test('only successful public static files are cacheable; protected data and HTML fallbacks remain private',async()=>{
  const bindings={...env,ASSETS:{fetch:async req=>{
    const path=new URL(req.url).pathname;
    const missing=path.includes('missing');
    const type=path.endsWith('.pdf')?'application/pdf':path.endsWith('.webp')&&!missing?'image/webp':path.endsWith('.css')&&!missing?'text/css':path.endsWith('.js')&&!missing?'text/javascript':path.endsWith('.woff2')?'font/woff2':'text/html';
    return new Response(req.method==='HEAD'?null:'asset',{status:path.includes('error')?404:200,headers:{'Content-Type':type,'Cache-Control':'public, max-age=12345'}});
  }}};
  const checks=[
    ['/images/map-tiles/7650/0_0.webp?v=quality3',/public, max-age=31536000, immutable/],
    ['/images/map-tiles/7650/0_0.webp',/public, max-age=3600/],
    ['/images/cover.webp',/public, max-age=3600/],
    ['/assets/index-abc123.js',/public, max-age=31536000, immutable/],
    ['/assets/index-abc123.css',/public, max-age=31536000, immutable/],
    ['/fonts/example.woff2',/public, max-age=31536000, immutable/],
    ['/images/map-tiles/7650/missing.webp?v=quality3',/private, no-store/],
    ['/images/map-tiles/7650/error.webp?v=quality3',/private, no-store/],
    ['/assets/missing.css',/private, no-store/],
    ['/',/private, no-store/],
    ['/index.html',/private, no-store/],
  ];
  for(const method of ['GET','HEAD'])for(const[path,expected]of checks){
    const response=await request(path,{host:'https://campaign.example',method,bindings});
    assert.match(response.headers.get('cache-control')||'',expected,`${method} ${path}`);
  }
  for(const path of ['/api/bootstrap','/api/map-markers']){
    const response=await request(path,{bindings});
    assert.equal(response.status,200,path);
    assert.match(response.headers.get('cache-control')||'',/private, no-store/,path);
  }
  for(const path of ['/api/bootstrap','/api/map-markers','/api/books/campaign/drive']){
    const response=await request(path,{host:'https://campaign.example',bindings});
    assert.equal(response.status,401,path);
    assert.match(response.headers.get('cache-control')||'',/private, no-store/,path);
  }
});

test('concurrent creation assigns unique main and branch numbers without renumbering',async()=>{
  const ids=await Promise.all(Array.from({length:4},()=>createGame()));
  const games=await Promise.all(ids.map(game));
  assert.deepEqual(games.map(g=>g.number).sort((a,b)=>a-b),[1,2,3,4]);
  const parent=games[0];
  const childIds=await Promise.all([createGame({parent_id:parent.id}),createGame({parent_id:parent.id})]);
  const children=await Promise.all(childIds.map(game));
  assert.ok(children.every(c=>c.number===parent.number&&c.parent_id===parent.id));
  assert.deepEqual(children.map(c=>c.branch).sort(),[1,2]);
  const next=await game(await createGame());assert.equal(next.number,5);
  const invalid=await request('/api/games',{method:'POST',body:{phase_id:'p',title:'Nested child',parent_id:children[0].id}});assert.equal(invalid.status,400);
});

test('players cannot create games, manage access, edit other notes, or export',async()=>{
  const gid=await createGame();
  const note=await request(`/api/games/${gid}/notes`,{method:'POST',body:{body:'Shared DM note',visibility:'group'}});
  const noteId=(await note.json()).id;
  const attempts=[
    ['/api/games','POST',{title:'Bad',phase_id:'p'}],
    [`/api/games/${gid}`,'PUT',{title:'Bad',phase_id:'p',version:1}],
    ['/api/members','POST',{name:'Bad',email:'bad@example.com'}],
    ['/api/resources','POST',{title:'Bad',category:'Bad',kind:'note'}],
    [`/api/notes/${noteId}`,'PUT',{body:'Hijacked',version:1}],
    ['/api/export','GET',undefined],
  ];
  for(const[path,method,body]of attempts)assert.equal((await request(path,{role:'player',method,body})).status,403,path);
});

test('player slots stay unlinked until email is assigned and never grant DM access',async()=>{
  const slots=await(await request('/api/player-slots')).json();
  assert.deepEqual(slots.map(slot=>slot.character_name),['Персонаж 1','Персонаж 2','Персонаж 3']);
  assert.ok(slots.every(slot=>slot.email===null&&slot.active===null));
  assert.equal((await request('/api/player-slots',{role:'player'})).status,403);
  const first={email:'player@example.com',character_name:'Мандрівник',player_name:'Гравець'};
  assert.equal((await request('/api/player-slots/hero-1',{role:'player',method:'PUT',body:first})).status,403);
  assert.equal((await request('/api/player-slots/hero-1',{method:'PUT',body:first})).status,200);
  const assigned=await db.prepare('SELECT name,role,active,last_login_at FROM members WHERE email=?').bind(first.email).first();
  assert.deepEqual(assigned,{name:'Гравець',role:'player',active:1,last_login_at:null});
  assert.equal((await request('/api/player-slots/hero-2',{method:'PUT',body:first})).status,409);
  assert.equal((await request('/api/player-slots/hero-1',{method:'PUT',body:{...first,email:'another@example.com'}})).status,200);
  assert.equal((await db.prepare('SELECT active FROM members WHERE email=?').bind(first.email).first()).active,0);
  const backup=await(await request('/api/export')).json();
  assert.ok(backup.data.player_slots.some(slot=>slot.id==='hero-1'&&slot.email==='another@example.com'&&slot.character_name==='Мандрівник'));
});

test('private notes and a private parent never leak through bootstrap or child routes',async()=>{
  const gid=await createGame();
  await request(`/api/games/${gid}/notes`,{method:'POST',body:{body:'DM_SECRET_SENTINEL',visibility:'dm'}});
  const notes=await(await request(`/api/games/${gid}/notes`,{role:'player'})).json();assert.equal(notes.length,0);
  const bootstrap=await(await request('/api/bootstrap',{role:'player'})).json();assert.equal(bootstrap.games.find(g=>g.id===gid).note_count,0);assert.ok(!JSON.stringify(bootstrap).includes('DM_SECRET_SENTINEL'));
  const parent=await createGame({visibility:'dm',title:'HIDDEN_PARENT'});const child=await createGame({parent_id:parent,title:'HIDDEN_CHILD',visibility:'group'});
  const playerBootstrap=await(await request('/api/bootstrap',{role:'player'})).json();assert.ok(!playerBootstrap.games.some(g=>[parent,child].includes(g.id)));
  assert.equal((await request(`/api/games/${child}/notes`,{role:'player'})).status,404);
});

test('notes persist, use the authenticated author, and reject stale edits',async()=>{
  const gid=await createGame();
  const created=await request(`/api/games/${gid}/notes`,{method:'POST',role:'player',body:{body:'Знайдено ключ',visibility:'group',author_id:'local-dm',author_name:'Forged'}});assert.equal(created.status,201);
  const nid=(await created.json()).id;
  let notes=await(await request(`/api/games/${gid}/notes`,{role:'player'})).json();assert.equal(notes[0].author_id,'local-player');assert.equal(notes[0].author_name,'Гравець');
  assert.equal((await request(`/api/notes/${nid}`,{method:'PUT',role:'player',body:{body:'Ключ від брами',version:1}})).status,200);
  assert.equal((await request(`/api/notes/${nid}`,{method:'PUT',role:'player',body:{body:'Стара вкладка',version:1}})).status,409);
  notes=await(await request(`/api/games/${gid}/notes`,{role:'player'})).json();assert.equal(notes[0].body,'Ключ від брами');
  const history=await db.prepare('SELECT * FROM note_revisions WHERE note_id=?').bind(nid).all();assert.equal(history.results.length,1);assert.equal(history.results[0].body,'Знайдено ключ');
});

test('an optional session note is created in the DM column and is visible by default',async()=>{
  const gid=await createGame({initial_note:'Підготувати сцену в архіві'});
  const dmNotes=await(await request(`/api/games/${gid}/notes`)).json();
  assert.equal(dmNotes.length,1);
  assert.equal(dmNotes[0].body,'Підготувати сцену в архіві');
  assert.equal(dmNotes[0].section,'dm');
  assert.equal(dmNotes[0].visibility,'group');
  assert.equal(dmNotes[0].author_id,'local-dm');
  const playerNotes=await(await request(`/api/games/${gid}/notes`,{role:'player'})).json();
  assert.equal(playerNotes.length,1);
});

test('private HTML and resource bodies require access and execute in a restricted sandbox',async()=>{
  const created=await request('/api/resources',{method:'POST',body:{title:'Private HTML',category:'Test',visibility:'dm',kind:'html',theme:'dark',body:'<!doctype html><html><head><title>Secret</title></head><body class="original-page"><h1>HTML_SECRET</h1></body></html>'}});assert.equal(created.status,201);const rid=(await created.json()).id;
  assert.equal((await request(`/api/resources/${rid}`,{role:'player'})).status,404);
  assert.equal((await request(`/api/resources/${rid}/html`,{role:'player'})).status,404);
  assert.equal((await request(`/view/${rid}`,{role:'player'})).status,404);
  const html=await request(`/api/resources/${rid}/html`);assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.doesNotMatch(html.headers.get('content-security-policy'),/allow-same-origin/);
  const fullPage=await request(`/view/${rid}`);assert.equal(fullPage.status,200);assert.match(fullPage.headers.get('content-security-policy'),/allow-top-navigation-by-user-activation/);assert.doesNotMatch(fullPage.headers.get('content-security-policy'),/allow-same-origin/);const fullPageBody=await fullPage.text();assert.match(fullPageBody,/campaign-hub-rail/);assert.match(fullPageBody,/page-ui-kit\.css/);assert.match(fullPageBody,/original-page portal-page portal-theme-dark/);assert.match(fullPageBody,/href="\/#\/"/);assert.match(fullPageBody,/HTML_SECRET/);
  const bootstrap=await request('/api/bootstrap',{role:'player'});assert.ok(!(await bootstrap.text()).includes(rid));
  const unsafe=await request('/api/resources',{method:'POST',body:{title:'Unsafe',category:'Test',kind:'link',url:'javascript:alert(1)'}});assert.equal(unsafe.status,400);
});

test('the configurable book shortcut redirects only the DM',async()=>{
  const path='/api/books/campaign/drive';
  const player=await request(path,{role:'player'});assert.equal(player.status,403);assert.equal(player.headers.get('location'),null);
  assert.equal((await request(path)).status,404);
  const dm=await request(path,{bindings:{...env,CAMPAIGN_BOOK_URL:'https://example.com/your-book'}});
  assert.equal(dm.status,302);assert.equal(dm.headers.get('location'),'https://example.com/your-book');
});

test('the template does not serve a bundled PDF',async()=>{
  assert.equal((await request('/api/books/campaign/pdf')).status,404);
});

test('game edits use version checks; archiving a parent hides all descendants',async()=>{
  const gid=await createGame();const child=await createGame({parent_id:gid});let g=await game(gid);
  const originalVersion=g.version;
  assert.equal((await request(`/api/games/${gid}`,{method:'PUT',body:{...g,title:'Нова назва'}})).status,200);
  assert.equal((await request(`/api/games/${gid}`,{method:'PUT',body:{...g,title:'Застаріле збереження'}})).status,409);
  g=await game(gid);assert.equal(g.title,'Нова назва');assert.equal(g.version,originalVersion+1);
  assert.equal((await request(`/api/games/${gid}/archive`,{method:'POST',body:{version:g.version}})).status,200);
  assert.equal(await game(gid),undefined);assert.equal(await game(child),undefined);
  const backup=await(await request('/api/export')).json();assert.ok(backup.data.sessions.some(s=>s.id===gid&&s.archived===1));
});

test('past planned games complete automatically, while a manual status change is preserved',async()=>{
  const gid=await createGame({date:'2000-01-01',status:'planned'});
  let g=await game(gid);assert.equal(g.status,'completed');
  assert.equal((await request(`/api/games/${gid}`,{method:'PUT',body:{...g,status:'planned'}})).status,200);
  g=await game(gid);assert.equal(g.status,'planned');
});

test('players can create categories and collaboratively edit NPCs',async()=>{
  const category=await request('/api/npc-categories',{role:'player',method:'POST',body:{title:'Невервінтер'}});
  assert.equal(category.status,201,await category.clone().text());const categoryId=(await category.json()).id;
  const created=await request('/api/npcs',{role:'player',method:'POST',body:{category_id:categoryId,name:'Міра',race:'Людина',role:'Торговиця',location:'Ринок',status:'alive',description:'Знає місцеві чутки',created_by:'forged'}});
  assert.equal(created.status,201,await created.clone().text());const npcId=(await created.json()).id;
  let catalogue=await(await request('/api/npcs',{role:'player'})).json();let npc=catalogue.npcs.find(n=>n.id===npcId);
  assert.equal(npc.name,'Міра');assert.equal(npc.version,1);
  assert.equal((await request(`/api/npcs/${npcId}`,{role:'dm',method:'PUT',body:{...npc,status:'missing'}})).status,200);
  assert.equal((await request(`/api/npcs/${npcId}`,{role:'player',method:'PUT',body:{...npc,status:'dead'}})).status,409);
  catalogue=await(await request('/api/npcs',{role:'player'})).json();npc=catalogue.npcs.find(n=>n.id===npcId);assert.equal(npc.status,'missing');
  const backup=await(await request('/api/export')).json();assert.ok(backup.data.npcs.some(n=>n.id===npcId));assert.ok(backup.data.npc_categories.some(c=>c.id===categoryId));
});

test('library uses the requested tile order and omits the standalone campaign book',async()=>{
  const bootstrap=await(await request('/api/bootstrap')).json();
  assert.deepEqual(bootstrap.resources.slice(0,9).map(resource=>resource.id),['journal','dm-notes','foundry','npcs','world','drow-sunlight','dm-tools','dm-price-guide','academy']);
  assert.ok(!bootstrap.resources.some(resource=>resource.url.includes('drive.google.com')));
  const player=await(await request('/api/bootstrap',{role:'player'})).json();
  assert.deepEqual(player.resources.map(resource=>resource.id),['journal','npcs','world','academy']);
});

test('map markers are shared and use optimistic version checks',async()=>{
  const created=await request('/api/map-markers',{role:'player',method:'POST',body:{title:'Невервінтер',body:'Місце зустрічі',x:.42,y:.31,color:'cyan'}});
  assert.equal(created.status,201,await created.clone().text());const markerId=(await created.json()).id;
  let markers=await(await request('/api/map-markers',{role:'dm'})).json();let marker=markers.find(item=>item.id===markerId);
  assert.equal(marker.created_by,'local-player');assert.equal(marker.created_by_name,'Гравець');assert.equal(marker.version,1);
  assert.equal((await request(`/api/map-markers/${markerId}`,{method:'PUT',body:{...marker,title:'Невервінтерський замок'}})).status,200);
  assert.equal((await request(`/api/map-markers/${markerId}`,{role:'player',method:'PUT',body:{...marker,title:'Застаріла назва'}})).status,409);
  markers=await(await request('/api/map-markers',{role:'player'})).json();marker=markers.find(item=>item.id===markerId);assert.equal(marker.title,'Невервінтерський замок');
});

test('master notebooks are private, editable, and included in backups',async()=>{
  for(const [path,method,body] of [['/api/dm-notebooks','GET'],['/api/dm-note-categories','POST',{title:'Секрети'}],['/api/dm-notebooks','POST',{category_id:'dm-notes-general',title:'План',body:'Таємниця'}]]){
    assert.equal((await request(path,{role:'player',method,body})).status,403,path);
  }
  const categoryResponse=await request('/api/dm-note-categories',{method:'POST',body:{title:'Наступна сесія'}});assert.equal(categoryResponse.status,201);
  const categoryId=(await categoryResponse.json()).id;
  const noteResponse=await request('/api/dm-notebooks',{method:'POST',body:{category_id:categoryId,title:'Фортеця',body:'Підготувати велетнів'}});assert.equal(noteResponse.status,201);
  const noteId=(await noteResponse.json()).id;
  let notebooks=await(await request('/api/dm-notebooks')).json();let note=notebooks.notes.find(item=>item.id===noteId);assert.equal(note.body,'Підготувати велетнів');
  assert.equal((await request(`/api/dm-notebooks/${noteId}`,{method:'PUT',body:{...note,body:'Підготувати велетнів і пастки'}})).status,200);
  const backup=await(await request('/api/export')).json();
  assert.ok(backup.data.dm_note_categories.some(item=>item.id===categoryId));assert.ok(backup.data.dm_notebooks.some(item=>item.id===noteId));assert.ok(Array.isArray(backup.data.map_markers));
});

test('mutation requests validate origin, anti-CSRF header, date, time, and level',async()=>{
  const base={phase_id:'p',title:'Valid'};
  assert.equal((await request('/api/games',{method:'POST',body:base,headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await request('/api/games',{method:'POST',body:base,headers:{'X-Requested-With':''}})).status,403);
  for(const fields of[{date:'2026-99-10'},{date:'2026-02-30'},{time:'25:70'},{level:99},{title:''}])assert.equal((await request('/api/games',{method:'POST',body:{...base,...fields}})).status,400,JSON.stringify(fields));
});
