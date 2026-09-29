import { useCallback, useEffect, useState } from 'react';
import { LibraryBig, BookOpen, Settings2, ChevronRight, Menu, X, Check, RefreshCw, LogOut, LockKeyhole, ArrowLeft, UsersRound, Map, ScrollText, ArrowUpRight } from 'lucide-react';
import type { PortalData } from '../shared/types';
import { api } from './api';
import { logOut, refreshSession } from './AuthGate';
import { getPreviewRole, setPreviewRole } from './previewRole';
import { Library, ResourcePage, resourceIcons } from './Library';
import Journal from './Journal';
import Admin from './Admin';
import Npcs from './Npcs';
import CampaignMap from './CampaignMap';
import DmNotes from './DmNotes';

const CAMPAIGN_BOOK_URL='/api/books/campaign/drive';

export default function App(){
  const [data,setData]=useState<PortalData|null>(null);const [error,setError]=useState('');const [route,setRoute]=useState(location.hash.slice(1)||'/');const [toast,setToast]=useState('');const [mobileMenu,setMobileMenu]=useState(false);const [pendingRole,setPendingRole]=useState<string|null>(null);const [protectedError,setProtectedError]=useState('');const [headerHidden,setHeaderHidden]=useState(false);
  const refresh=useCallback(async()=>{const result=await api<PortalData>('/bootstrap');setData(result);setError('');},[]);
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[refresh]);
  useEffect(()=>{const listener=()=>{setRoute(location.hash.slice(1)||'/');setMobileMenu(false);window.scrollTo(0,0);};window.addEventListener('hashchange',listener);return()=>window.removeEventListener('hashchange',listener);},[]);
  useEffect(()=>{
    setHeaderHidden(false);
    if(route==='/'||route.startsWith('/open/'))return;
    const mobile=window.matchMedia('(max-width: 600px)');
    let lastY=window.scrollY,travel=0,lastDirection=0;
    const onScroll=()=>{
      const y=window.scrollY,delta=y-lastY;lastY=y;
      if(!mobile.matches||y<64){setHeaderHidden(false);travel=0;return;}
      if(Math.abs(delta)<2)return;
      const direction=Math.sign(delta);
      travel=direction===lastDirection?travel+Math.abs(delta):Math.abs(delta);
      lastDirection=direction;
      if(travel>=(direction>0?16:10)){setHeaderHidden(direction>0);travel=0;}
    };
    const onViewportChange=()=>{setHeaderHidden(false);lastY=window.scrollY;travel=0;};
    window.addEventListener('scroll',onScroll,{passive:true});mobile.addEventListener('change',onViewportChange);
    return()=>{window.removeEventListener('scroll',onScroll);mobile.removeEventListener('change',onViewportChange);};
  },[route]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),4000);return()=>clearTimeout(timer);},[toast]);
  const resourceId=route.startsWith('/resource/')?route.slice('/resource/'.length):'';
  const currentResource=resourceId?data?.resources.find(resource=>resource.id===resourceId):undefined;
  const openId=route.startsWith('/open/')?route.slice('/open/'.length):'';
  const openResource=openId?data?.resources.find(resource=>encodeURIComponent(resource.id)===openId&&resource.kind==='html'):undefined;
  const protectedTarget=route==='/book'&&data?.user.role==='dm'&&data.bookConfigured?CAMPAIGN_BOOK_URL:'';
  const current=route==='/journal'?'Журнал партій':route==='/npcs'?'NPC':route==='/world-map'?'Мапа світу':route==='/dm-notes'?'Нотатки майстра':route==='/admin'?'Адміністрування':openResource?.title||currentResource?.title||'Бібліотека';
  useEffect(()=>{document.title=`${current} — Портал кампанії`;},[current]);
  useEffect(()=>{if(!protectedTarget)return;let cancelled=false;setProtectedError('');refreshSession().then(()=>{if(!cancelled)location.replace(protectedTarget);}).catch(cause=>{if(!cancelled)setProtectedError((cause as Error).message);});return()=>{cancelled=true;};},[protectedTarget]);
  if(!data)return <div className="boot-screen"><img src="/favicon.svg" width={52} height={52} alt=""/><h1>Портал кампанії</h1>{error?<><LockKeyhole size={23}/><p role="alert">{error}</p><button className="button secondary" onClick={()=>refresh().catch(e=>setError(e.message))}><RefreshCw size={16}/>Спробувати ще раз</button>{!['127.0.0.1','localhost','[::1]'].includes(location.hostname)&&<button className="text-button" onClick={()=>void logOut()}>Увійти іншою поштою</button>}</>:<p>Відкриваємо хроніки…</p>}</div>;
  const dm=data.user.role==='dm';
  const switchPreview=async(role:string)=>{if(role===data.user.role||pendingRole)return;const previous=getPreviewRole();setPendingRole(role);setPreviewRole(role);try{await refresh();if(role==='player'&&(route==='/admin'||route==='/dm-notes'||currentResource?.visibility==='dm'))location.hash='/';}catch{setPreviewRole(previous);await refresh().catch(()=>{});setToast('Не вдалося перемкнути перегляд. Спробуй ще раз.');}finally{setPendingRole(null);}};
  if(route==='/book')return <div className="boot-screen"><img src="/favicon.svg" width={52} height={52} alt=""/><h1>Портал кампанії</h1>{protectedError?<p role="alert">{protectedError}</p>:protectedTarget?<p>Відкриваємо книгу…</p>:<p>{dm?'Додай посилання на книгу своєї кампанії за інструкцією в README.':'Цей матеріал доступний лише майстру.'}</p>}<a className="button secondary" href="#/">До бібліотеки</a></div>;
  const isHome=route==='/';
  const isFullPage=route.startsWith('/open/');
  const HeaderIcon=route==='/journal'?BookOpen:route==='/npcs'?UsersRound:route==='/world-map'?Map:route==='/dm-notes'?ScrollText:route==='/admin'?Settings2:currentResource?resourceIcons[currentResource.icon as keyof typeof resourceIcons]||LibraryBig:LibraryBig;
  const bookMarkerContent=<><span className="campaign-cover-wrap"><img className="campaign-cover" src="/images/campaign-cover.svg" width={154} height={205} alt="Місце для обкладинки вашої кампанії"/>{dm&&data.bookConfigured&&<span className="campaign-link-arrow" aria-hidden="true"><ArrowUpRight size={18}/></span>}</span><strong>Ваша кампанія</strong><span className="campaign-edition">{data.bookConfigured?'Книга кампанії':'Додайте книгу та обкладинку'}</span></>;
  return <div className={`app-shell ${isHome?'home-layout':'internal-layout'}`}><a className="skip-link" href="#main-content" onClick={e=>{e.preventDefault();document.getElementById('main-content')?.focus();}}>До вмісту</a>
    {isHome&&<aside className={`sidebar ${mobileMenu?'menu-open':''}`}><a href="#/" className="brand"><img src="/favicon.svg" width={42} height={42} alt=""/><div><strong>ВАША КАМПАНІЯ</strong><span>ХРОНІКИ ПРИГОД</span></div></a><button className="mobile-close icon-button" aria-label="Закрити меню" onClick={()=>setMobileMenu(false)}><X/></button>
    <div className="sidebar-rule"/><span className="nav-label">ПРОСТІР КАМПАНІЇ</span><nav aria-label="Головна навігація"><a href="#/" aria-current="page" className="active"><LibraryBig size={19}/><span>Бібліотека</span><span className="nav-count">{data.resources.length}</span></a><a href="#/journal"><BookOpen size={19}/><span>Журнал партій</span></a>{dm&&<><span className="nav-label second-label">МАЙСТЕРНЯ</span><a href="#/admin"><Settings2 size={19}/><span>Адміністрування</span></a></>}</nav>
    {dm&&data.bookConfigured?<a className="campaign-marker is-linked" href="#/book" target="_blank" rel="noopener noreferrer" aria-label="Відкрити книгу кампанії в новій вкладці">{bookMarkerContent}</a>:<div className="campaign-marker is-placeholder">{bookMarkerContent}</div>}
    <div className="sidebar-footer">{data.user.canPreviewPlayer&&<div className="local-preview"><span>Перегляд ролі</span><select aria-label="Перегляд ролі" value={pendingRole||data.user.role} disabled={Boolean(pendingRole)} onChange={e=>void switchPreview(e.target.value)}><option value="dm">Майстер</option><option value="player">Гравець</option></select></div>}<div className="user-profile">{data.user.avatar_url?<img className="avatar" src={data.user.avatar_url} alt=""/>:<span className="avatar">{dm?'М':'Г'}</span>}<div><strong>{data.user.name}</strong><span>{data.user.canPreviewPlayer?'Майстер кампанії':'Учасник кампанії'}</span></div>{!data.user.dev&&<button className="icon-button" onClick={()=>void logOut()} aria-label="Вийти"><LogOut size={17}/></button>}</div></div></aside>}
    {isHome&&mobileMenu&&<button className="menu-scrim" aria-label="Закрити меню" onClick={()=>setMobileMenu(false)}/>}
    <div className={`main-shell ${isHome?'library-shell home-shell':'internal-shell'}`}>{isHome?<button className="library-mobile-menu icon-button" aria-label="Відкрити меню" onClick={()=>setMobileMenu(true)}><Menu size={22}/></button>:!isFullPage&&<header className={`internal-header ${headerHidden?'is-hidden':''}`}><a href="#/" className="internal-back" aria-label="Повернутися до бібліотеки"><ArrowLeft size={18}/><img src="/favicon.svg" width={25} height={25} alt=""/><span>Кампанія</span></a><ChevronRight className="internal-chevron" size={15}/><span className="internal-page-title"><HeaderIcon size={17}/>{current}</span>{data.user.canPreviewPlayer&&<select className="internal-role-preview" aria-label="Перегляд ролі" value={pendingRole||data.user.role} disabled={Boolean(pendingRole)} onChange={e=>void switchPreview(e.target.value)}><option value="dm">Майстер</option><option value="player">Гравець</option></select>}</header>}
    <main id="main-content" tabIndex={-1}><div className={`main-inner ${route==='/'?'library-main-inner':''} ${route==='/world-map'?'map-main-inner':''} ${isFullPage?'embedded-resource-inner':''}`}>{isFullPage?openResource?<iframe className="full-resource-frame" src={`/view/${encodeURIComponent(openResource.id)}`} title={openResource.title}/>:<div className="empty-state"><LockKeyhole/><h1>Матеріал недоступний</h1><a href="#/">До бібліотеки</a></div>:route==='/journal'?<Journal data={data} refresh={refresh} notify={setToast}/>:route==='/npcs'?<Npcs notify={setToast}/>:route==='/world-map'?<CampaignMap notify={setToast}/>:route==='/dm-notes'?dm?<DmNotes notify={setToast}/>:<div className="empty-state"><LockKeyhole/><h1>Це простір майстра</h1><a href="#/">До бібліотеки</a></div>:route==='/admin'?dm?<Admin data={data} refresh={refresh} notify={setToast}/>:<div className="empty-state"><LockKeyhole/><h1>Це простір майстра</h1><a href="#/">До бібліотеки</a></div>:route.startsWith('/resource/')?<ResourcePage id={route.slice('/resource/'.length)} data={data} refresh={refresh} notify={setToast}/>:<Library data={data} refresh={refresh} notify={setToast}/>}</div></main></div>
    {toast&&<div className="toast" role="status"><Check size={17}/>{toast}<button className="icon-button" aria-label="Закрити повідомлення" onClick={()=>setToast('')}><X size={15}/></button></div>}
  </div>;
}
