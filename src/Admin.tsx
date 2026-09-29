import { useEffect, useState } from 'react';
import { Download, Plus, ShieldCheck, Users, UserRoundPlus, Pencil, CircleCheck, CircleMinus } from 'lucide-react';
import type { PortalData, Resource } from '../shared/types';
import { api, send } from './api';
import { AccessBadge, ErrorLine, Submit } from './components';
import { ResourceEditor } from './Library';

type Member={email:string;name:string;role:string;active:number;last_login_at:string|null};
type PlayerSlot={id:string;character_name:string;player_name:string;avatar_url:string;email:string|null;active:number|null;last_login_at:string|null};

export default function Admin({data,refresh,notify}:{data:PortalData;refresh:()=>Promise<void>;notify:(s:string)=>void}){
  const [members,setMembers]=useState<Member[]>([]);
  const [slots,setSlots]=useState<PlayerSlot[]>([]);
  const [slotEmails,setSlotEmails]=useState<Record<string,string>>({});
  const [slotNames,setSlotNames]=useState<Record<string,{character:string;player:string}>>({});
  const [email,setEmail]=useState('');const [name,setName]=useState('');
  const [busy,setBusy]=useState(false);const [savingSlot,setSavingSlot]=useState('');
  const [error,setError]=useState('');const [resource,setResource]=useState<Resource|null>(null);const [creating,setCreating]=useState(false);
  async function load(){
    const [nextMembers,nextSlots]=await Promise.all([api<Member[]>('/members'),api<PlayerSlot[]>('/player-slots')]);
    setMembers(nextMembers);setSlots(nextSlots);
    setSlotEmails(Object.fromEntries(nextSlots.map(slot=>[slot.id,slot.email||''])));
    setSlotNames(Object.fromEntries(nextSlots.map(slot=>[slot.id,{character:slot.character_name,player:slot.player_name}])));
  }
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function saveSlot(slot:PlayerSlot){
    setSavingSlot(slot.id);setError('');
    try{
      await send(`/player-slots/${slot.id}`,'PUT',{email:slotEmails[slot.id]||'',character_name:slotNames[slot.id]?.character||slot.character_name,player_name:slotNames[slot.id]?.player||slot.player_name});
      await load();
      notify('Адресу гравця збережено');
    }catch(e){setError((e as Error).message);}finally{setSavingSlot('');}
  }
  async function toggleMember(member:Member){
    setError('');
    try{
      await send('/members','POST',{email:member.email,name:member.name,active:!member.active});
      await load();
      notify('Доступ оновлено');
    }catch(e){setError((e as Error).message);}
  }
  const linkedEmails=new Set(slots.map(slot=>slot.email?.toLowerCase()).filter(Boolean));
  return <>
    <div className="page-heading"><div><span className="eyebrow">ЗА ШИРМОЮ МАЙСТРА</span><h1>Адміністрування</h1><p>Матеріали, гравці та збереження історії.</p></div><span className="admin-label"><ShieldCheck size={17}/>Доступ майстра</span></div>
    <div className="admin-grid">
      <section className="panel admin-materials"><div className="panel-heading"><h2>Плитки бібліотеки</h2><button className="button small secondary" onClick={()=>setCreating(true)}><Plus size={15}/>Додати</button></div><div className="admin-resource-list">{data.resources.map(r=><div key={r.id}><span><strong>{r.title}</strong><small>{r.category}</small></span><AccessBadge visibility={r.visibility}/><button className="icon-button" aria-label={`Редагувати матеріал ${r.title}`} onClick={async()=>{try{setResource(await api<Resource>(`/resources/${r.id}`));}catch(e){setError((e as Error).message);}}}><Pencil size={16}/></button></div>)}</div></section>
      <section className="panel"><div className="panel-heading"><h2>Резервна копія</h2><Download size={18}/></div><p className="panel-description">Збережи партії, усі примітки, матеріали та список гравців одним файлом.</p><button className="button secondary" onClick={async()=>{try{const backup=await api('/export');const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`campaign-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Резервну копію завантажено');}catch(e){setError((e as Error).message);}}}><Download size={16}/>Завантажити копію</button><p className="small-note">Файл містить приватні нотатки майстра.</p></section>
      <section className="panel members-panel"><div className="panel-heading"><h2>Гравці</h2><Users size={19}/></div><p className="panel-description">Прив’яжи дозволені пошти до профілів або додай інших гравців нижче. Вони увійдуть через Google чи пароль сайту з підтвердженою поштою.</p>
        <div className="member-list">
          <div className="member owner"><img className="avatar" src={data.user.avatar_url||'/images/avatars/default.svg'} alt=""/><div><strong>Майстер</strong><small>{data.user.email}</small></div><span className="member-state">Власник</span></div>
          {slots.map(slot=>{
            const member=members.find(item=>item.email.toLowerCase()===slot.email?.toLowerCase());
            const status=!slot.email?'Очікує пошту':!member?.active?'Доступ вимкнено':slot.last_login_at?'Увійшов':'Очікує входу';
            return <div className={`member player-slot ${member&&!member.active?'inactive':''}`} key={slot.id}>
              <img className="avatar" src={slot.avatar_url} alt=""/>
              <div className="slot-identity"><strong>{slot.character_name}</strong><small>{slot.player_name} · {status}</small></div>
              <form className="slot-email-form" onSubmit={e=>{e.preventDefault();void saveSlot(slot)}}>
                <input required aria-label={`Персонаж для ${slot.player_name}`} placeholder="Персонаж" value={slotNames[slot.id]?.character||''} onChange={e=>setSlotNames(current=>({...current,[slot.id]:{...current[slot.id],character:e.target.value}}))}/>
                <input required aria-label={`Ім’я гравця для ${slot.character_name}`} placeholder="Гравець" value={slotNames[slot.id]?.player||''} onChange={e=>setSlotNames(current=>({...current,[slot.id]:{...current[slot.id],player:e.target.value}}))}/>
                <input type="email" aria-label={`Пошта для ${slot.character_name}`} placeholder="Пошта гравця" value={slotEmails[slot.id]||''} onChange={e=>setSlotEmails(current=>({...current,[slot.id]:e.target.value}))}/>
                <button className="button small secondary" type="submit" disabled={savingSlot===slot.id}>Зберегти</button>
              </form>
              {member&&<button className="text-button" aria-label={`${member.active?'Вимкнути':'Відновити'} доступ ${slot.character_name}`} onClick={()=>void toggleMember(member)}>{member.active?<CircleCheck size={16}/>:<CircleMinus size={16}/>}<span>{member.active?'Активний':'Вимкнено'}</span></button>}
            </div>;
          })}
          {members.filter(m=>!linkedEmails.has(m.email.toLowerCase())).map(m=><div key={m.email} className={`member ${m.active?'':'inactive'}`}><span className="avatar player">{m.name.slice(0,1).toUpperCase()}</span><div><strong>{m.name}</strong><small>{m.email}</small></div><button className="text-button" aria-label={`${m.active?'Вимкнути':'Відновити'} доступ ${m.name}`} onClick={()=>void toggleMember(m)}>{m.active?<CircleCheck size={16}/>:<CircleMinus size={16}/>}<span>{m.active?'Активний':'Вимкнено'}</span></button></div>)}
        </div>
        <form className="member-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await send('/members','POST',{email,name,active:true});setEmail('');setName('');await load();notify('Гравця додано');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><label className="field">Ім’я<input required value={name} onChange={e=>setName(e.target.value)} maxLength={200} placeholder="Ім’я іншого гравця"/></label><label className="field">Електронна пошта<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="player@example.com"/></label><Submit busy={busy}><UserRoundPlus size={15}/>Додати іншого</Submit></form>
      </section>
    </div>
    <ErrorLine error={error}/>
    {(resource||creating)&&<ResourceEditor resource={resource||undefined} close={()=>{setCreating(false);setResource(null);}} saved={async()=>{await refresh();setResource(null);setCreating(false);notify('Матеріал збережено');}}/>}
  </>;
}
