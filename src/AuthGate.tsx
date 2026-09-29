import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence, browserPopupRedirectResolver, browserSessionPersistence,
  createUserWithEmailAndPassword, GoogleAuthProvider, indexedDBLocalPersistence,
  inMemoryPersistence, initializeAuth, onIdTokenChanged, reload, sendEmailVerification,
  sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut, type User,
} from 'firebase/auth';

const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};
const configured = Object.values(config).every(Boolean);
const auth = !local && configured ? initializeAuth(initializeApp(config as Required<typeof config>), {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, inMemoryPersistence],
  // Preload Firebase's helper on Safari/mobile before the click. Loading it
  // during the click can lose user activation and make Safari block the popup.
  popupRedirectResolver: browserPopupRedirectResolver,
}) : null;
if (auth) auth.languageCode = 'uk';

class SessionError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
let sessionWrites: Promise<void> = Promise.resolve();
let sessionRenewal: { uid: string; promise: Promise<boolean> } | null = null;

// Order cookie writes so a delayed old login cannot overwrite logout or a new account.
function session(token?: string, uid?: string) {
  const write = sessionWrites.catch(() => {}).then(async () => {
    if (uid && auth?.currentUser?.uid !== uid) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`/api/auth/${token ? 'session' : 'logout'}`, {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'campaign-hub' },
        body: JSON.stringify(token ? { token } : {}),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new SessionError(body.error || 'Не вдалося підтвердити вхід.', response.status);
      }
    } finally { clearTimeout(timeout); }
  });
  sessionWrites = write;
  return write;
}

export function refreshSession(forceToken = false): Promise<boolean> {
  const current = auth?.currentUser;
  if (!current?.emailVerified) return Promise.resolve(false);
  if (sessionRenewal?.uid === current.uid) return sessionRenewal.promise;
  const renewal = { uid: current.uid, promise: Promise.resolve(false) };
  renewal.promise = (async () => {
    const token = await current.getIdToken(forceToken);
    if (auth?.currentUser?.uid !== current.uid) return false;
    await session(token, current.uid);
    return auth?.currentUser?.uid === current.uid;
  })().finally(() => { if (sessionRenewal === renewal) sessionRenewal = null; });
  sessionRenewal = renewal;
  return renewal.promise;
}

export async function logOut() {
  if (!auth) return;
  await signOut(auth);
  await session().catch(() => {});
  location.hash = '/';
  location.reload();
}

function authMessage(error: unknown) {
  const code = (error as { code?: string }).code;
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
  if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') return 'Google не відкрився в цьому браузері. Увійди поштою та паролем сайту — це працює без нового вікна.';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'Перевір пошту та пароль сайту. Якщо раніше входив через Google, скористайся кнопкою «Створити / відновити пароль».';
  if (code === 'auth/invalid-email') return 'Перевір, чи правильно вказана пошта.';
  if (code === 'auth/weak-password') return 'Обери пароль щонайменше з 8 символів.';
  if (code === 'auth/user-disabled') return 'Цей акаунт вимкнений. Звернися до майстра.';
  if (code === 'auth/too-many-requests') return 'Забагато спроб. Зачекай кілька хвилин і спробуй знову.';
  if (code === 'auth/network-request-failed' || (error as Error)?.name === 'AbortError' || error instanceof TypeError) return 'Не вдалося з’єднатися. Перевір інтернет і спробуй ще раз.';
  if (code === 'auth/operation-not-allowed') return 'Цей спосіб входу поки недоступний. Звернися до майстра.';
  return error instanceof Error ? error.message : 'Не вдалося увійти.';
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(local);
  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mailCooldown, setMailCooldown] = useState(false);
  const authorizedUid = useRef<string | null>(null);
  const sequence = useRef(0);
  const mailSettings = { url: `${location.origin}/#/`, handleCodeInApp: false };

  useEffect(() => {
    if (!mailCooldown) return;
    const timer = setTimeout(() => setMailCooldown(false), 60000);
    return () => clearTimeout(timer);
  }, [mailCooldown]);

  useEffect(() => {
    if (!auth) return;
    let active = true;
    const unsubscribe = onIdTokenChanged(auth, async current => {
      const version = ++sequence.current;
      setUser(current);
      if (authorizedUid.current !== current?.uid) { setAuthorized(false); authorizedUid.current = null; }
      if (!current?.emailVerified) {
        authorizedUid.current = null;
        setAuthorized(false); setCheckingAccess(false); setReady(true); setError('');
        // A stale cookie can be cleared in the background. Rendering the login
        // form does not need a network roundtrip, especially on weak mobile links.
        void session().catch(() => {});
        return;
      }
      setCheckingAccess(true);
      try {
        const accepted = await refreshSession();
        if (!active || version !== sequence.current) return;
        setAuthorized(accepted);
        authorizedUid.current = accepted ? current.uid : null;
        setError('');
      } catch (cause) {
        if (!active || version !== sequence.current) return;
        // Offline token refresh must not unmount the current page. An actual
        // access denial still closes the gate; every API request is protected.
        if (authorizedUid.current !== current?.uid || cause instanceof SessionError && [401, 403].includes(cause.status)) {
          authorizedUid.current = null; setAuthorized(false); setError(authMessage(cause));
        }
      } finally { if (active && version === sequence.current) { setReady(true); setCheckingAccess(false); } }
    }, cause => { if (active) { setReady(true); setError(authMessage(cause)); } });
    return () => { active = false; ++sequence.current; unsubscribe(); };
  }, []);

  if (local) return children;
  if (!configured) return <div className="auth-screen"><div className="auth-panel"><h1>Портал кампанії</h1><p>Вхід ще налаштовується майстром.</p></div></div>;
  if (!ready) return <div className="auth-screen"><div className="auth-panel"><h1>Портал кампанії</h1><p role="status">Перевіряємо збережений вхід…</p></div></div>;
  if (user && authorized) return children;
  if (user && checkingAccess) return <div className="auth-screen"><div className="auth-panel"><h1>Портал кампанії</h1><p role="status">Відкриваємо кампанію…</p></div></div>;

  const chooseMode = (next: typeof mode) => { setMode(next); setError(''); setNotice(''); setPassword(''); };
  const google = async () => {
    setBusy(true); setError(''); setNotice('');
    try { await signInWithPopup(auth!, new GoogleAuthProvider()); }
    catch (cause) { setError(authMessage(cause)); }
    finally { setBusy(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const address = email.trim();
    try {
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth!, address, mailSettings);
        setNotice('Якщо акаунт із цією поштою існує, надійде лист для встановлення пароля. Відкрий лист, обери пароль сайту й повернися сюди для входу. Перевір також «Спам».');
        setMailCooldown(true);
      } else if (mode === 'register') {
        const result = await createUserWithEmailAndPassword(auth!, address, password);
        setPassword('');
        await sendEmailVerification(result.user, mailSettings);
        setNotice('Лист підтвердження надіслано. Перевір пошту та «Спам».');
        setMailCooldown(true);
      } else {
        await signInWithEmailAndPassword(auth!, address, password);
        setPassword('');
      }
    } catch (cause) {
      if ((cause as { code?: string }).code === 'auth/email-already-in-use') {
        setMode('reset'); setPassword('');
        setError('Для цієї пошти вже є акаунт. Натисни «Надіслати лист», щоб створити або відновити пароль сайту.');
      } else setError(authMessage(cause));
    } finally { setBusy(false); }
  };
  const retry = async () => {
    setBusy(true); setError('');
    try {
      const current = auth!.currentUser;
      if (!current) return;
      await reload(current);
      if (!current.emailVerified) { setNotice('Пошта ще не підтверджена. Відкрий посилання в листі й натисни цю кнопку ще раз.'); return; }
      const accepted = await refreshSession(true);
      setUser(current); setAuthorized(accepted); authorizedUid.current = accepted ? current.uid : null;
    } catch (cause) { setError(authMessage(cause)); }
    finally { setBusy(false); }
  };
  const leave = async () => {
    setBusy(true);
    try { await signOut(auth!); await session(); setNotice(''); setError(''); }
    catch (cause) { setError(authMessage(cause)); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    if (!user) return;
    setBusy(true); setError('');
    try { await sendEmailVerification(user, mailSettings); setNotice('Лист підтвердження надіслано. Перевір також «Спам».'); setMailCooldown(true); }
    catch (cause) { setError(authMessage(cause)); }
    finally { setBusy(false); }
  };
  return <main className="auth-screen"><section className="auth-panel" aria-labelledby="auth-title">
    <img src="/favicon.svg" width={48} height={48} alt=""/><h1 id="auth-title">Портал кампанії</h1>
    <p>Увійди з поштою, яку майстер додав до кампанії.</p>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {notice && <p className="auth-notice" role="status">{notice}</p>}
    {user ? <>
      {!user.emailVerified && <p>Підтвердь адресу <strong>{user.email}</strong> за посиланням у листі. Потім повернися в цю вкладку.</p>}
      <div className="auth-actions">
        <button disabled={busy} onClick={()=>void retry()}>{busy?'Перевіряємо…':user.emailVerified?'Спробувати ще раз':'Я підтвердив пошту'}</button>
        {!user.emailVerified&&<button className="auth-secondary" disabled={busy||mailCooldown} onClick={()=>void resend()}>{mailCooldown?'Лист надіслано':'Надіслати лист ще раз'}</button>}
        <button className="auth-link-button" disabled={busy} onClick={()=>void leave()}>Увійти іншою поштою</button>
      </div>
    </> : <>
      <form onSubmit={event=>void submit(event)}>
        {mode==='register'&&<p className="auth-form-hint">Створи окремий пароль для цього сайту. Після цього підтвердь пошту за посиланням у листі.</p>}
        {mode==='reset'&&<p className="auth-form-hint">Раніше входив через Google або забув пароль? Отримай лист і встанови окремий пароль сайту.</p>}
        <label>Пошта<input type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={event=>setEmail(event.target.value)} disabled={busy}/></label>
        {mode!=='reset'&&<label>Пароль сайту<input type="password" autoComplete={mode==='register'?'new-password':'current-password'} minLength={mode==='register'?8:undefined} required value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/></label>}
        <button type="submit" disabled={busy||mode==='reset'&&mailCooldown}>{busy?'Зачекай…':mode==='register'?'Створити акаунт':mode==='reset'?(mailCooldown?'Лист надіслано':'Надіслати лист'):'Увійти'}</button>
      </form>
      <div className="auth-mode-links">
        {mode==='login'?<><button className="auth-link-button" disabled={busy} onClick={()=>chooseMode('reset')}>Створити / відновити пароль</button><button className="auth-link-button" disabled={busy} onClick={()=>chooseMode('register')}>Перший вхід у кампанію</button></>:<button className="auth-link-button" disabled={busy} onClick={()=>chooseMode('login')}>Повернутися до входу</button>}
      </div>
      <div className="auth-divider">або</div>
      <button className="auth-google" disabled={busy} onClick={()=>void google()}>Увійти через Google</button>
      <p className="auth-footnote">У Telegram використовуй пошту й пароль сайту, щоб залишитися в цьому браузері. Вхід зберігається на цьому пристрої, якщо браузер дозволяє зберігати дані.</p>
    </>}
  </section></main>;
}
