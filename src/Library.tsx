import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, BookOpen, CalendarDays, Compass, FileCode2, Map, Plus, Search, ScrollText, Wrench, Pencil, Upload, ExternalLink, SquareTerminal } from 'lucide-react';
import type { PortalData, Resource } from '../shared/types';
import { api, send } from './api';
import { AccessBadge, ErrorLine, Modal, Submit } from './components';

export const resourceIcons = {calendar:CalendarDays,scroll:ScrollText,compass:Compass,book:BookOpen,map:Map,tools:Wrench,terminal:SquareTerminal};
const localResourceCovers:Record<string,string>={journal:'/images/journal-placeholder.svg','dm-notes':'/images/console-placeholder.svg',foundry:'/images/foundry-placeholder.svg',npcs:'/images/npcs-placeholder.svg',world:'/images/template-map.svg','drow-sunlight':'/images/drow-placeholder.svg','dm-tools':'/images/notes-placeholder.svg','dm-price-guide':'/images/prices-placeholder.svg',academy:'/images/academy-placeholder.svg'};
export function Library({data,refresh,notify}:{data:PortalData;refresh:()=>Promise<void>;notify:(s:string)=>void}){
  const [query,setQuery]=useState(''); const [category,setCategory]=useState('Усі матеріали');const [creating,setCreating]=useState(false);
  const categories=['Усі матеріали',...new Set(data.resources.map(r=>r.category))];
  useEffect(()=>{if(category!=='Усі матеріали'&&!data.resources.some(r=>r.category===category))setCategory('Усі матеріали');},[category,data.resources]);
  const shown=data.resources.filter(r=>(category==='Усі матеріали'||r.category===category)&&`${r.title} ${r.description}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="library-home" data-ui-theme="dark" aria-labelledby="library-title">
    <div className="library-mobile-header">{data.user.role==='dm'&&<button className="ui-button primary" onClick={()=>setCreating(true)}><Plus size={17}/>Додати матеріал</button>}</div>
    <header className="library-hero"><div className="library-hero-copy"><h1 id="library-title">Ваша кампанія</h1><p>Бібліотека пригод і матеріалів</p></div><div className="library-hero-actions">{data.user.role==='dm'&&<button className="ui-button primary" onClick={()=>setCreating(true)}><Plus size={17}/>Додати матеріал</button>}</div></header>
    <div className="library-utility"><div className="filter-pills" aria-label="Категорії матеріалів">{categories.map(c=><button key={c} className={category===c?'selected':''} aria-pressed={category===c} onClick={()=>setCategory(c)}>{c}</button>)}</div><label className="library-search"><Search size={17}/><span className="sr-only">Пошук матеріалів</span><input type="search" placeholder="Знайти матеріал…" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
    <div className="resource-grid library-card-grid">{shown.map((r,index)=>{
      const Icon=resourceIcons[r.icon as keyof typeof resourceIcons]||BookOpen;
      const href=r.kind==='journal'?'#/journal':r.id==='npcs'?'#/npcs':r.id==='world'?'#/world-map':r.id==='dm-tools'?'#/dm-notes':r.kind==='link'?r.url:r.kind==='html'?`#/open/${encodeURIComponent(r.id)}`:`#/resource/${r.id}`;
      const cover=r.image_url||localResourceCovers[r.id];
      return <a key={r.id} className={`resource-card image-card ${r.kind==='journal'?'journal-card':''}`} href={href} target={r.kind==='link'?'_blank':undefined} rel={r.kind==='link'?'noopener noreferrer':undefined} data-card-theme={r.theme}>
        {cover?<img className="resource-cover" src={cover} alt="" width="1200" height="800" loading={index<2?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer"/>:<span className="resource-cover-placeholder"><Icon size={44} strokeWidth={1.2}/></span>}
        <span className="resource-shade" aria-hidden="true"/>
        <span className="resource-card-head"><span className="resource-kind"><Icon size={15}/>{r.category}</span><AccessBadge visibility={r.visibility}/></span>
        <span className="resource-card-copy"><span className="resource-card-index">{String(index+1).padStart(2,'0')}</span><span><strong>{r.title}</strong><small>{r.description}</small></span><span className="resource-card-arrow" aria-hidden="true"><ArrowUpRight size={20}/></span></span>
      </a>;
    })}</div>
    {shown.length===0&&<div className="library-empty"><Search size={25}/><h2>Нічого не знайшлося</h2><p>Спробуй іншу назву або категорію.</p></div>}
    <footer className="library-footer"><span>{data.resources.length} матеріалів</span><span>Простір вашої кампанії</span></footer>
    {creating&&<ResourceEditor close={()=>setCreating(false)} saved={async()=>{await refresh();setCreating(false);notify('Матеріал додано');}}/>}
  </section>;
}

export function ResourcePage({id,data,refresh,notify}:{id:string;data:PortalData;refresh:()=>Promise<void>;notify:(s:string)=>void}){
  const [resource,setResource]=useState<Resource|null>(null);const [error,setError]=useState('');const [editing,setEditing]=useState(false);
  async function load(){setResource(await api<Resource>(`/resources/${id}`));}
  useEffect(()=>{setResource(null);setError('');load().catch(e=>setError(e.message));},[id,data.user.role]);
  if(error)return <div className="empty-state"><ErrorLine error={error}/><a className="button ghost" href="#/">До бібліотеки</a></div>;
  if(!resource)return <p className="loading">Завантаження матеріалу…</p>;
  const Icon=resourceIcons[resource.icon as keyof typeof resourceIcons]||BookOpen;
  return <><div className="page-heading resource-heading"><div><span className="eyebrow">{resource.category}</span><h1>{resource.title}</h1><p>{resource.description}</p></div>{data.user.role==='dm'&&<button className="button primary" onClick={()=>setEditing(true)}><Pencil size={16}/>Редагувати</button>}</div><div className="resource-meta"><AccessBadge visibility={resource.visibility}/><span>{resource.kind==='html'?'HTML-сторінка':resource.kind==='link'?'Зовнішнє посилання':'Нотатка'}</span></div>
    {resource.kind==='html'&&resource.body?<a className="button primary" href={`#/open/${encodeURIComponent(resource.id)}`}><ExternalLink size={17}/>Відкрити повну сторінку</a>:resource.kind==='link'?<a className="button primary" href={resource.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={17}/>Відкрити сайт</a>:resource.body?<article className="document-body">{resource.body}</article>:<div className="empty-material"><Icon size={36} strokeWidth={1.3}/><h2>Тут починається новий матеріал</h2><p>{data.user.role==='dm'?'Додай нотатку, посилання або готову HTML-сторінку.':'Майстер ще не додав вміст цього розділу.'}</p>{data.user.role==='dm'&&<button className="button secondary" onClick={()=>setEditing(true)}><Plus size={16}/>Додати вміст</button>}</div>}
    {editing&&<ResourceEditor resource={resource} close={()=>setEditing(false)} saved={async()=>{await load();await refresh();setEditing(false);notify('Матеріал збережено');}}/>}
  </>;
}

export function ResourceEditor({resource,close,saved}:{resource?:Resource;close:()=>void;saved:()=>Promise<void>}){
  const [form,setForm]=useState({title:resource?.title||'',description:resource?.description||'',category:resource?.category||'Матеріали',icon:resource?.icon||'book',visibility:resource?.visibility||'dm',kind:resource?.kind||'note',url:resource?.url||'',body:resource?.body||'',image_url:resource?.image_url||'',theme:resource?.theme||'light'});
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [filename,setFilename]=useState('');
  function field(name:keyof typeof form,value:string){setForm(f=>({...f,[name]:value}));}
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{await send(resource?`/resources/${resource.id}`:'/resources',resource?'PUT':'POST',{...form,version:resource?.version});await saved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Modal title={resource?'Редагувати матеріал':'Новий матеріал'} close={close} wide><form onSubmit={submit} className="resource-editor"><div className="two-columns">
    <label className="field full">Назва *<input required autoFocus value={form.title} onChange={e=>field('title',e.target.value)} maxLength={200} placeholder="Назва плитки"/></label>
    <label className="field full">Короткий опис<textarea rows={2} value={form.description} onChange={e=>field('description',e.target.value)} maxLength={500}/></label>
    <label className="field">Категорія<input required value={form.category} onChange={e=>field('category',e.target.value)} list="categories" maxLength={80}/><datalist id="categories"><option>Кампанія</option><option>Для гравців</option><option>Довідники</option><option>Майстерня</option></datalist></label>
    <label className="field">Доступ<select value={form.visibility} onChange={e=>field('visibility',e.target.value)}><option value="dm">Тільки ДМ</option><option value="group">Для гравців</option></select></label>
    <label className="field">Тип матеріалу<select disabled={resource?.kind==='journal'} value={form.kind} onChange={e=>field('kind',e.target.value)}><option value="note">Текстова нотатка</option><option value="link">Посилання на сайт</option><option value="html">HTML-сторінка</option>{resource?.kind==='journal'&&<option value="journal">Журнал партій</option>}</select></label>
    <label className="field">Піктограма<select value={form.icon} onChange={e=>field('icon',e.target.value)}><option value="book">Книга</option><option value="calendar">Календар</option><option value="scroll">Сувій</option><option value="compass">Компас</option><option value="map">Мапа</option><option value="tools">Інструменти</option><option value="terminal">Консоль</option></select></label>
    <label className="field">Стиль сторінки<select value={form.theme} onChange={e=>field('theme',e.target.value)}><option value="light">Світлий · Archive</option><option value="dark">Темний · Moonlit</option></select></label>
    <label className="field full">Обкладинка<input type="url" value={form.image_url} onChange={e=>field('image_url',e.target.value)} placeholder="https://images.unsplash.com/…"/><small className="field-hint">Пряме HTTPS-посилання на зображення для плитки.</small></label>
    {form.kind==='link'&&<label className="field full">Адреса сайту<input required type="url" value={form.url} onChange={e=>field('url',e.target.value)} placeholder="https://…"/></label>}
    {form.kind==='note'&&<label className="field full">Текст матеріалу<textarea rows={9} value={form.body} onChange={e=>field('body',e.target.value)} maxLength={1000000}/></label>}
    {form.kind==='html'&&<div className="field full"><span>Готовий HTML-файл</span><label className="file-upload"><Upload size={21}/><span>{filename||'Вибрати HTML-файл'}<small>Самодостатня сторінка до 1 МБ, із вбудованими стилями</small></span><input type="file" accept=".html,.htm,text/html" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>1000000){setError('Файл завеликий. Максимум — 1 МБ.');return;}field('body',await file.text());setFilename(file.name);setError('');}}/></label>{form.body&&<p className="file-status"><FileCode2 size={15}/>{filename?'Файл готовий до збереження':'HTML-сторінку завантажено'}</p>}</div>}
    </div><ErrorLine error={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={close}>Скасувати</button><Submit busy={busy}/></div></form></Modal>;
}
