import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { X, LockKeyhole, Users, Plus, Check, LoaderCircle } from 'lucide-react';
import type { Act, Phase, Game, Visibility } from '../shared/types';
import { gameNumber } from '../shared/types';
import { send } from './api';

export function AccessBadge({ visibility: value }: { visibility: Visibility }) {
  return <span className={`access-badge ${value}`}>
    {value === 'dm' ? <LockKeyhole size={12}/> : <Users size={12}/>}{value === 'dm' ? 'Тільки ДМ' : 'Для гравців'}
  </span>;
}
export function Modal({ title, children, close, wide = false }: {title: string; children: ReactNode; close: () => void; wide?: boolean}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const focus = document.activeElement as HTMLElement | null;
    const el = ref.current!; el.showModal();
    return () => { el.close(); focus?.focus(); };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={e => { e.preventDefault(); close(); }}>
    <div className="modal-title"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="Закрити"><X size={20}/></button></div>
    {children}
  </dialog>;
}
export function ErrorLine({ error }: {error: string}) { return error ? <p role="alert" className="error-line">{error}</p> : null; }
export function Submit({ busy, children = 'Зберегти' }: {busy: boolean; children?: ReactNode}) {
  return <button type="submit" className="button primary" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>} {busy ? 'Збереження…' : children}</button>;
}
export function GameEditor({ game, parent, phase, phases, defaultLevel, saved, cancel }: {
  game?: Game; parent?: Game; phase: Phase; phases: Phase[]; defaultLevel?: number | null; saved: (id?: string) => void | Promise<void>; cancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    title: game?.title || '', phase_id: game?.phase_id || phase.id, date: game?.date || '', time: game ? game.time : '12:00',
    level: game ? (game.level ?? '') : (parent?.level ?? defaultLevel ?? ''), status: game?.status || 'planned', visibility: game?.visibility || parent?.visibility || 'group',
    summary: game?.summary || '', participants: game?.participants || '', initial_note: '',
  });
  function field(name: keyof typeof form, value: string) { setForm(f => ({ ...f, [name]: value })); }
  const [hour = '', minute = ''] = form.time.split(':');
  const hours = Array.from({length: 14}, (_, index) => String(index + 9).padStart(2, '0'));
  const minutes = Array.from({length: 6}, (_, index) => String(index * 10).padStart(2, '0'));
  if (hour && !hours.includes(hour)) hours.push(hour);
  if (minute && !minutes.includes(minute)) minutes.push(minute);
  hours.sort(); minutes.sort();
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await send<{id?: string}>(game ? `/games/${game.id}` : '/games', game ? 'PUT' : 'POST', {
        ...form, level: form.level === '' ? null : Number(form.level), parent_id: parent?.id || game?.parent_id || null, version: game?.version,
      });
      await saved(result.id || game?.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <form className="game-editor" onSubmit={submit}>
    <div className="editor-heading"><strong>{game ? `Редагування №${gameNumber(game)}` : parent ? `Нова підпартія до №${gameNumber(parent)}` : 'Нова партія'}</strong><span>Номер присвоюється автоматично</span></div>
    <div className="editor-grid">
      <label className="field title-field">Назва *<input autoFocus required maxLength={200} value={form.title} onChange={e => field('title',e.target.value)} placeholder="Як назвемо цю пригоду?"/></label>
      <label className="field">Дата<input type="date" value={form.date} onChange={e => field('date',e.target.value)}/></label>
      <div className="field time-field"><span>Час</span><div className="time-selects"><select aria-label="Година" value={hour} onChange={e => field('time',e.target.value ? `${e.target.value}:${minute || '00'}` : '')}><option value="">Год</option>{hours.map(value=><option key={value} value={value}>{value}</option>)}</select><span aria-hidden="true">:</span><select aria-label="Хвилини" value={minute} onChange={e => field('time',e.target.value ? `${hour || '12'}:${e.target.value}` : '')}><option value="">Хв</option>{minutes.map(value=><option key={value} value={value}>{value}</option>)}</select></div></div>
      <label className="field">Рівень<select value={form.level} onChange={e => field('level',e.target.value)}><option value="">—</option>{Array.from({length:20},(_,index)=><option key={index+1} value={index+1}>{index+1}</option>)}</select></label>
      <label className="field status-field">Стан<select value={form.status} onChange={e => field('status',e.target.value)}><option value="planned">Заплановано</option><option value="completed">Проведено</option><option value="cancelled">Скасовано</option></select></label>
      {!parent && !game?.parent_id && <label className="field phase-field">Арка<select value={form.phase_id} onChange={e => field('phase_id',e.target.value)}>{phases.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>}
      {!game&&<label className="field full">Нотатки до партії <span className="field-hint">Необов’язково · після створення з’являться в колонці «Нотатки ДМ»</span><textarea rows={3} value={form.initial_note} onChange={e => field('initial_note',e.target.value)} maxLength={20000} placeholder="Плани, події або деталі для майстра…"/></label>}
    </div>
    <ErrorLine error={error}/>
    <div className="form-actions"><button type="button" className="button ghost" onClick={cancel} disabled={busy}>Скасувати</button><Submit busy={busy}>{game ? 'Зберегти зміни' : 'Створити'}</Submit></div>
  </form>;
}
export function StructureForm({ kind, act, existing, saved, cancel }: {kind: 'act' | 'phase'; act?: Act; existing?: {id: string; title: string}; saved: (id?: string) => void | Promise<void>; cancel: () => void}) {
  const [value,setValue] = useState(existing?.title || '');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  return <form className="structure-form" onSubmit={async e => {
    e.preventDefault();setBusy(true);setError('');
    try { const result = await send<{id?: string}>(existing ? `/structure/${existing.id}` : '/structure',existing ? 'PUT' : 'POST',{kind,title:value,act_id:act?.id});await saved(result.id); }
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }}><label className="field">{existing ? 'Нова назва' : kind === 'act' ? 'Назва нового акту' : 'Назва нової фази'}<input required autoFocus value={value} maxLength={200} onChange={e=>setValue(e.target.value)}/></label><div className="form-actions"><button type="button" className="button ghost" onClick={cancel}>Скасувати</button><Submit busy={busy}/></div><ErrorLine error={error}/></form>;
}
export function AddLine({ children, onClick }: {children: ReactNode; onClick: () => void}) {
  return <button className="add-line" onClick={onClick}><Plus size={15}/>{children}</button>;
}
