import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpDown, CalendarDays, ChevronDown, ChevronRight, Clock3, Plus, Pencil, MessageSquare, LockKeyhole, Users, Archive, BookOpen } from 'lucide-react';
import type { PortalData, Game, Phase, Note, User, Act } from '../shared/types';
import { gameNumber } from '../shared/types';
import { api, send } from './api';
import { AccessBadge, AddLine, ErrorLine, GameEditor, Modal, StructureForm, Submit } from './components';

const statuses = {planned:'Заплановано',completed:'Проведено',cancelled:'Скасовано'};
function dateLabel(date: string) { if(!date) return 'Без дати'; const [y,m,d]=date.split('-');return `${d}.${m}.${y}`; }

export default function Journal({ data, refresh, notify }: {data: PortalData; refresh: () => Promise<void>; notify: (s: string) => void}) {
  const [actId,setActId]=useState(data.acts.at(-1)?.id || '');
  const [sortDirection,setSortDirection]=useState<'asc'|'desc'>(()=>localStorage.getItem('journal-sort')==='desc'?'desc':'asc');
  const [expanded,setExpanded]=useState<Set<string>>(new Set());
  const [collapsed,setCollapsed]=useState<Set<string>>(new Set());
  const [editor,setEditor]=useState<{phase: Phase; game?: Game; parent?: Game}|null>(null);
  const [structure,setStructure]=useState<{kind:'act'|'phase'; existing?: Act | Phase}|null>(null);
  const [archive,setArchive]=useState<Game|null>(null);const [archiveError,setArchiveError]=useState('');const [archiveBusy,setArchiveBusy]=useState(false);
  const dm = data.user.role === 'dm';
  const currentAct=data.acts.find(a=>a.id===actId) || data.acts.at(-1);
  const actPhases=data.phases.filter(p=>p.act_id===currentAct?.id);
  const orderedPhases=actPhases.slice().sort((a,b)=>(a.position-b.position)*(sortDirection==='asc'?1:-1));
  function chooseAct(id:string){setActId(id);setEditor(null);setStructure(null);}
  function toggle(id:string){setExpanded(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});}
  function toggleSort(){setSortDirection(value=>{const next=value==='asc'?'desc':'asc';localStorage.setItem('journal-sort',next);return next;});}
  async function saved(id?:string){await refresh();setEditor(null);if(id)setExpanded(s=>new Set(s).add(id));notify('Партію збережено');}
  const mainGames=data.games.filter(g=>!g.parent_id);
  const lastLevel=mainGames.filter(g=>g.level!=null).reduce<Game|null>((latest,game)=>!latest||game.number>latest.number?game:latest,null)?.level ?? null;
  const nextGame=mainGames.filter(g=>g.status==='planned'&&g.date).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time))[0];
  const total=mainGames.length; const branches=data.games.length-total;

  function orderGames(games:Game[]){return games.slice().sort((a,b)=>((a.number-b.number)||(a.branch-b.branch))*(sortDirection==='asc'?1:-1));}
  function renderGame(g:Game,phase:Phase,child=false){
    const kids=orderGames(data.games.filter(k=>k.parent_id===g.id));
    const open=expanded.has(g.id);
    const editing=editor?.game?.id===g.id;
    const addingChild=editor?.parent?.id===g.id;
    return <article className={`game-block ${child?'child-game':''} ${open?'is-expanded':''}`} key={g.id}>
      <div className="game-card">
      <div className={`game-row ${g.status} ${open?'is-open':''}`}>
        <button className="game-number" onClick={()=>toggle(g.id)} aria-label={`${open?'Згорнути':'Розгорнути'} партію ${gameNumber(g)}`} aria-expanded={open}>{open?<ChevronDown size={16}/>:<ChevronRight size={16}/>}<span>{gameNumber(g)}</span></button>
        <button className="game-name" onClick={()=>toggle(g.id)} aria-expanded={open}><span>{g.title}</span><span className="row-meta">{g.visibility==='dm'&&<LockKeyhole size={12} aria-label="Тільки ДМ"/>}{kids.length>0&&<span className="branch-count">{kids.length} підпартії</span>}{g.note_count>0&&<span className="note-count"><MessageSquare size={12}/>{g.note_count}</span>}</span></button>
        <span className="game-date"><CalendarDays size={13} aria-hidden="true"/>{dateLabel(g.date)}</span><span className="game-time">{g.time || '—'}</span><span className="game-level">{g.level ? <span className="level-token">{g.level}</span> : '—'}</span>
        <span className={`status-badge ${g.status}`}>{statuses[g.status]}</span>
        <div className="row-actions">{dm&&<button className="icon-button" title="Редагувати" aria-label={`Редагувати партію ${gameNumber(g)}`} onClick={()=>{setEditor({phase,game:g});setExpanded(s=>new Set(s).add(g.id));}}><Pencil size={15}/></button>}</div>
      </div>
      {editing ? <GameEditor key={`edit-${g.id}`} game={g} phase={phase} phases={data.phases} saved={saved} cancel={()=>setEditor(null)}/> : open&&<div className="game-details">
        <div className="details-heading"><h3>{g.title}</h3><AccessBadge visibility={g.visibility}/></div>
        {(g.participants||g.summary)&&<div className="game-context">{g.participants&&<p className="participants"><Users size={15}/>{g.participants}</p>}{g.summary&&<p className="game-summary">{g.summary}</p>}</div>}
        <Notes game={g} user={data.user} changed={refresh} notify={notify}/>
        {dm&&<button className="text-button muted archive-button" onClick={()=>{setArchive(g);setArchiveError('');}}><Archive size={14}/>Прибрати з журналу</button>}
      </div>}
      {open&&kids.length>0&&<div className="subparty-list" aria-label={`Підпартії до №${gameNumber(g)}`}>{kids.map(k=>renderGame(k,phase,true))}</div>}
      {addingChild&&<div className="subparty-editor"><GameEditor key={`child-${g.id}`} parent={g} phase={phase} phases={data.phases} saved={saved} cancel={()=>setEditor(null)}/></div>}
      </div>
      {open&&!child&&dm&&!addingChild&&<button className="subparty-trigger" aria-label={`Додати підпартію до №${gameNumber(g)}`} title={`Додати підпартію до №${gameNumber(g)}`} onClick={()=>{setEditor({phase,parent:g});setExpanded(s=>new Set(s).add(g.id));}}><Plus size={14}/><span>Додати підпартію</span></button>}
    </article>;
  }

  return <>
    <header className="journal-heading">
      <div className="journal-title"><h1>Журнал партій</h1><p>Історія вашої кампанії</p></div>
      <div className="journal-heading-actions"><div className="journal-stats" aria-label="Статистика журналу"><span><strong>{total}</strong> основних партій</span><span><strong>{branches}</strong> підпартії</span></div>{dm&&<button className="button primary" onClick={()=>{if(actPhases.length)setEditor({phase:actPhases.at(-1)!});else setStructure({kind:currentAct?'phase':'act'});}}><Plus size={17}/>Нова партія</button>}</div>
    </header>
    <section className="journal-act-bar">
      <div className="act-tabs" role="tablist" aria-label="Акти кампанії">{data.acts.map(a=><button key={a.id} role="tab" aria-selected={a.id===currentAct?.id} onClick={()=>chooseAct(a.id)} className={a.id===currentAct?.id?'selected':''}>{a.title}<span>{data.games.filter(g=>!g.parent_id&&data.phases.some(p=>p.id===g.phase_id&&p.act_id===a.id)).length}</span></button>)}{dm&&<button className="icon-button new-act" title="Додати акт" aria-label="Додати акт" onClick={()=>setStructure({kind:'act'})}><Plus size={18}/></button>}</div>
      <div className="act-actions">{nextGame&&<div className="next-game"><CalendarDays size={15}/><span>Наступна</span><strong>{dateLabel(nextGame.date)}</strong>{nextGame.time&&<><Clock3 size={13}/><span>{nextGame.time}</span></>}</div>}<button className="icon-button sort-order" onClick={toggleSort} aria-label={sortDirection==='asc'?'Показати нові партії спочатку':'Показати ранні партії спочатку'} title={sortDirection==='asc'?'Показати нові партії спочатку':'Показати ранні партії спочатку'}><ArrowUpDown size={16}/></button>{dm&&currentAct&&<button className="icon-button" title="Перейменувати акт" aria-label="Перейменувати акт" onClick={()=>setStructure({kind:'act',existing:currentAct})}><Pencil size={16}/></button>}</div>
    </section>
    {structure&&<StructureForm key={structure.existing?.id||structure.kind} kind={structure.kind} act={currentAct} existing={structure.existing} cancel={()=>setStructure(null)} saved={async id=>{await refresh();setStructure(null);if(id&&structure.kind==='act')chooseAct(id);notify('Структуру збережено');}}/>}
    <div className="journal-board">
      {orderedPhases.map(phase=>{
        const games=orderGames(mainGames.filter(g=>g.phase_id===phase.id));
        const shut=collapsed.has(phase.id);
        const creatingHere=editor?.phase.id===phase.id&&!editor.parent&&!editor.game;
        return <section className="phase-group" key={phase.id}>
          <div className="phase-heading"><button aria-expanded={!shut} onClick={()=>setCollapsed(s=>{const n=new Set(s);n.has(phase.id)?n.delete(phase.id):n.add(phase.id);return n;})}>{shut?<ChevronRight size={16}/>:<ChevronDown size={16}/>}<span>{phase.title}</span><span className="phase-count">{games.length}</span></button>{dm&&<button className="icon-button" title="Перейменувати арку" aria-label={`Перейменувати арку ${phase.title}`} onClick={()=>setStructure({kind:'phase',existing:phase})}><Pencil size={14}/></button>}</div>
          {!shut&&<div className="phase-content"><div className="table-heading"><span>№</span><span>Назва партії</span><span>Дата</span><span>Час</span><span>Рівень</span><span>Стан</span><span/></div>{creatingHere&&sortDirection==='desc'&&<div className="phase-new-editor"><GameEditor key={`new-${phase.id}`} phase={phase} phases={data.phases} defaultLevel={lastLevel} saved={saved} cancel={()=>setEditor(null)}/></div>}<div className="phase-games">{games.map(g=>renderGame(g,phase))}</div>{creatingHere&&sortDirection==='asc'&&<div className="phase-new-editor"><GameEditor key={`new-${phase.id}`} phase={phase} phases={data.phases} defaultLevel={lastLevel} saved={saved} cancel={()=>setEditor(null)}/></div>}{games.length===0&&!creatingHere&&<p className="empty-inline">У цій арці ще немає партій.</p>}{dm&&<div className="phase-add"><AddLine onClick={()=>setEditor({phase})}>Додати партію до арки</AddLine></div>}</div>}
        </section>;
      })}
      {!actPhases.length&&<div className="empty-state"><BookOpen size={30}/><h3>{currentAct?'Почни нову арку':'Додай перший акт'}</h3><p>Тут з’являться партії та їхні особисті арки.</p></div>}
    </div>
    {dm&&currentAct&&<button className="button ghost add-phase" onClick={()=>setStructure({kind:'phase'})}><Plus size={17}/>Додати арку</button>}
    <p className="journal-footnote"><ChevronRight size={14}/>Натисни на партію, щоб відкрити примітки та підпартії.</p>
    {archive&&<Modal title="Прибрати партію з журналу?" close={()=>setArchive(null)}><p>№{gameNumber(archive)} «{archive.title}» та її підпартії буде приховано. Записи залишаться в резервній копії, а номер не використовуватиметься повторно.</p><ErrorLine error={archiveError}/><div className="form-actions"><button className="button ghost" onClick={()=>setArchive(null)}>Залишити</button><button className="button danger" disabled={archiveBusy} onClick={async()=>{setArchiveBusy(true);try{await send(`/games/${archive.id}/archive`,'POST',{version:archive.version});await refresh();setArchive(null);notify('Партію прибрано з журналу');}catch(e){setArchiveError((e as Error).message);}finally{setArchiveBusy(false);}}}>{archiveBusy?'Збереження…':'Прибрати'}</button></div></Modal>}
  </>;
}

function Notes({game,user,changed,notify}:{game:Game;user:User;changed:()=>Promise<void>;notify:(s:string)=>void}){
  const [notes,setNotes]=useState<Note[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  async function load(){setNotes(await api<Note[]>(`/games/${game.id}/notes`));}
  useEffect(()=>{let alive=true;setLoading(true);api<Note[]>(`/games/${game.id}/notes`).then(n=>{if(alive)setNotes(n);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[game.id,user.role]);
  if(loading)return <p className="notes-loading">Завантаження приміток…</p>;
  return <><ErrorLine error={error}/><div className="notes-grid">
    <NoteColumn title="Спільні примітки" section="shared" notes={notes.filter(n=>n.section==='shared')} game={game} user={user} reloaded={load} changed={changed} notify={notify}/>
    <NoteColumn title="Нотатки ДМ" section="dm" notes={notes.filter(n=>n.section==='dm')} game={game} user={user} reloaded={load} changed={changed} notify={notify}/>
  </div></>;
}

function NoteColumn({title,section,notes,game,user,reloaded,changed,notify}:{title:string;section:'shared'|'dm';notes:Note[];game:Game;user:User;reloaded:()=>Promise<void>;changed:()=>Promise<void>;notify:(s:string)=>void}){
  const [body,setBody]=useState('');const [editing,setEditing]=useState<Note|null>(null);const [hidden,setHidden]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const canCreate=section==='shared'||user.role==='dm';
  function cancelEdit(){setEditing(null);setBody('');setHidden(false);}
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{await send(editing?`/notes/${editing.id}`:`/games/${game.id}/notes`,editing?'PUT':'POST',{body,section,visibility:section==='dm'&&hidden?'dm':'group',version:editing?.version});cancelEdit();await reloaded();await changed();notify('Примітку збережено');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section className={`note-column ${section}`}><div className="note-column-heading"><div>{section==='dm'?<LockKeyhole size={15}/>:<MessageSquare size={15}/>}<h4>{title}</h4></div><span>{notes.length}</span></div>
    <div className="note-list">{notes.length?notes.map(n=><article className="note" key={n.id}><div className="note-header"><strong>{n.author_name}</strong><time>{new Date(n.created_at).toLocaleDateString('uk-UA')}</time>{n.visibility==='dm'&&<span className="private-note-mark"><LockKeyhole size={11}/> Приховано</span>}{(n.author_id===user.id||user.role==='dm')&&<button className="icon-button" aria-label={`Редагувати примітку ${n.author_name}`} onClick={()=>{setEditing(n);setBody(n.body);setHidden(n.visibility==='dm');}}><Pencil size={14}/></button>}</div><p>{n.body}</p></article>):<p className="empty-notes">{section==='dm'?'Нотатки майстра з’являться тут і будуть видимі гравцям, якщо їх не приховати.':'Додайте перший спогад про цю пригоду.'}</p>}</div>
    {canCreate&&<form className="note-form" onSubmit={submit}><label className="field">{editing?'Редагування примітки':'Додати примітку'}<textarea aria-label={section==='dm'?'Текст нотатки ДМ':'Текст спільної примітки'} required rows={3} maxLength={20000} value={body} onChange={e=>setBody(e.target.value)} placeholder={section==='dm'?'Плани, деталі, підготовка…':'Події, знахідки, ідеї…'}/></label><div className="note-form-footer">{section==='dm'?<label className="note-visibility-toggle"><input type="checkbox" checked={hidden} onChange={e=>setHidden(e.target.checked)}/><span>Приховати від гравців</span></label>:<span><Users size={13}/> Учасникам</span>}<div>{editing&&<button type="button" className="button ghost" onClick={cancelEdit}>Скасувати</button>}<Submit busy={busy}>{editing?'Зберегти':'Додати'}</Submit></div></div><ErrorLine error={error}/></form>}
  </section>;
}
