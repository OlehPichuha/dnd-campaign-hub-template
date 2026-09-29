import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';

const project = new URL('../', import.meta.url);
const output = new URL('private/test-auth-ui.mjs', project);
const originalFetch = globalThis.fetch;
let dom, createRoot, root, fixture, moduleNumber = 0;

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://campaign.example.test/#/' });
  for (const key of ['window', 'document', 'location', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent']) globalThis[key] = dom.window[key];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import('react-dom/client'));
  mkdirSync(new URL('private/', project), { recursive: true });
  await build({
    entryPoints: [fileURLToPath(new URL('src/AuthGate.tsx', project))],
    bundle: true, platform: 'node', format: 'esm', target: 'es2022', jsx: 'automatic',
    outfile: fileURLToPath(output), logLevel: 'silent', external: ['react', 'react/jsx-runtime'],
    define: {
      'import.meta.env.VITE_FIREBASE_API_KEY': '"synthetic-test-api-key"',
      'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': '"auth.example.test"',
      'import.meta.env.VITE_FIREBASE_PROJECT_ID': '"auth-ui-test"',
      'import.meta.env.VITE_FIREBASE_APP_ID': '"auth-ui-test-app"',
    },
    plugins: [{ name: 'synthetic-firebase', setup(builder) {
      builder.onResolve({ filter: /^firebase\/(app|auth)$/ }, args => ({ path: args.path, namespace: 'synthetic-firebase' }));
      builder.onLoad({ filter: /.*/, namespace: 'synthetic-firebase' }, args => ({ contents: args.path === 'firebase/app'
        ? 'export const initializeApp = config => ({config});'
        : `
          const f=globalThis.__campaignAuthFixture;
          export const browserLocalPersistence={}, browserSessionPersistence={}, inMemoryPersistence={}, indexedDBLocalPersistence={}, browserPopupRedirectResolver={};
          export const initializeAuth=(app,options)=>{f.options=options;return f.auth;};
          export class GoogleAuthProvider {}
          export const onIdTokenChanged=(auth,listener)=>{
            f.listeners.add(listener);f.allListeners.push(listener);
            queueMicrotask(()=>{if(f.listeners.has(listener))void listener(auth.currentUser);});
            return()=>f.listeners.delete(listener);
          };
          export const reload=user=>f.handlers.reload(user);
          export const sendEmailVerification=(user,settings)=>f.handlers.verify(user,settings);
          export const sendPasswordResetEmail=(auth,email,settings)=>f.handlers.reset(email,settings);
          export const signInWithPopup=(auth,provider)=>f.handlers.popup(provider);
          export const signOut=async()=>{await f.emit(null);};
          export const signInWithEmailAndPassword=async(auth,email,password)=>{
            const user=await f.handlers.login(email,password);await f.emit(user);return {user};
          };
          export const createUserWithEmailAndPassword=async(auth,email,password)=>{
            const user=await f.handlers.register(email,password);await f.emit(user);return {user};
          };
        `, loader: 'js' }));
    } }],
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  document.getElementById('root').replaceChildren();
});
after(() => { globalThis.fetch = originalFetch; dom?.window.close(); delete globalThis.__campaignAuthFixture; });

function user(uid, verified = true) {
  return { uid, email: `${uid}@example.test`, emailVerified: verified, getIdToken: async () => `token-${uid}` };
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const drain = () => new Promise(resolve => setImmediate(resolve));
const body = () => document.body.textContent;
function button(text) {
  const match = [...document.querySelectorAll('button')].find(item => item.textContent === text);
  assert.ok(match, `button '${text}' is present`);
  return match;
}
async function click(text) { await act(async () => { button(text).dispatchEvent(new MouseEvent('click', { bubbles: true })); await drain(); }); }
async function input(type, value) {
  await act(async () => {
    const field = document.querySelector(`input[type="${type}"]`);
    assert.ok(field, `${type} field is present`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() { await act(async () => { document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await drain(); }); }

async function mount({ currentUser = null, fetcher, strict = false } = {}) {
  fixture = {
    auth: { currentUser }, listeners: new Set(), allListeners: [], calls: [],
    handlers: {
      reload: async () => {}, verify: async () => {}, reset: async () => {},
      popup: async () => { throw { code: 'auth/popup-blocked' }; },
      login: async email => user(email.split('@')[0]),
      register: async email => user(email.split('@')[0], false),
    },
    emit: async current => {
      fixture.auth.currentUser = current;
      await Promise.all([...fixture.listeners].map(listener => listener(current)));
    },
  };
  globalThis.__campaignAuthFixture = fixture;
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), body: JSON.parse(init.body), signal: init.signal };
    fixture.calls.push(call);
    return fetcher ? fetcher(call) : Response.json({ ok: true });
  };
  const gate = await import(`${output.href}?case=${++moduleNumber}`);
  root = createRoot(document.getElementById('root'));
  const content = createElement(gate.default, null, createElement('div', { 'data-private-content': true }, 'PRIVATE CAMPAIGN'));
  await act(async () => { root.render(strict ? createElement(StrictMode, null, content) : content); await drain(); });
  return gate;
}

test('an empty stored session shows login without waiting for background cookie cleanup', async () => {
  const cleanup = deferred();
  await mount({ fetcher: () => cleanup.promise });
  assert.match(body(), /Пароль сайту/);
  assert.doesNotMatch(body(), /Перевіряємо збережений вхід/);
  assert.equal(fixture.calls[0].url, '/api/auth/logout');
  await act(async () => { cleanup.resolve(Response.json({ ok: true })); await drain(); });
});

test('token renewal keeps the current page during a network failure, but access denial closes it', async () => {
  const current = user('owner');
  let mode = 'ok';
  await mount({ currentUser: current, fetcher: () => {
    if (mode === 'offline') throw new TypeError('offline');
    return Response.json(mode === 'denied' ? { error: 'Доступ закрито.' } : { ok: true }, { status: mode === 'denied' ? 403 : 200 });
  } });
  assert.match(body(), /PRIVATE CAMPAIGN/);
  mode = 'offline';
  await act(async () => fixture.emit(current));
  assert.match(body(), /PRIVATE CAMPAIGN/);
  mode = 'denied';
  await act(async () => fixture.emit(current));
  assert.doesNotMatch(body(), /PRIVATE CAMPAIGN/);
  assert.match(body(), /Доступ закрито/);
});

test('an email becoming unverified closes the existing page before cookie cleanup finishes', async () => {
  const current = user('owner');
  await mount({ currentUser: current });
  assert.match(body(), /PRIVATE CAMPAIGN/);
  const cleanup = deferred();
  globalThis.fetch = async () => cleanup.promise;
  current.emailVerified = false;
  await act(async () => { await fixture.emit(current); await drain(); });
  assert.doesNotMatch(body(), /PRIVATE CAMPAIGN/);
  assert.match(body(), /Підтвердь адресу/);
  await act(async () => { cleanup.resolve(Response.json({ ok: true })); await drain(); });
});

test('StrictMode leaves one auth observer and concurrent session renewal is coalesced', async () => {
  const gate = await mount({ currentUser: user('owner'), strict: true });
  assert.equal(fixture.listeners.size, 1);
  assert.match(body(), /PRIVATE CAMPAIGN/);
  const pending = deferred();
  globalThis.fetch = async (url, init) => { fixture.calls.push({ url, body: JSON.parse(init.body) }); return pending.promise; };
  const beforeCalls = fixture.calls.length;
  let first, second;
  await act(async () => { first = gate.refreshSession(true); second = gate.refreshSession(true); await drain(); });
  assert.equal(first, second);
  assert.equal(fixture.calls.length, beforeCalls + 1);
  await act(async () => { pending.resolve(Response.json({ ok: true })); await first; });
});

test('switching accounts cannot display a delayed successful session for the old account', async () => {
  const oldExchange = deferred();
  await mount({ currentUser: user('old'), fetcher: call => call.body.token === 'token-old' ? oldExchange.promise : Response.json({ ok: true }) });
  assert.doesNotMatch(body(), /PRIVATE CAMPAIGN/);
  await act(async () => { await fixture.emit(null); await drain(); });
  assert.match(body(), /Пароль сайту/);
  let newEvent;
  await act(async () => { newEvent = fixture.emit(user('new')); await drain(); });
  assert.doesNotMatch(body(), /PRIVATE CAMPAIGN/);
  await act(async () => { oldExchange.resolve(Response.json({ ok: true })); await newEvent; await drain(); });
  assert.match(body(), /PRIVATE CAMPAIGN/);
  assert.deepEqual(fixture.calls.map(call => call.body.token || 'logout'), ['token-old', 'logout', 'token-new']);
});

test('registration sends verification once and never opens the campaign before verified', async () => {
  await mount();
  let verificationCount = 0;
  fixture.handlers.verify = async () => { verificationCount++; };
  await click('Перший вхід у кампанію');
  await input('email', 'newplayer@example.test');
  await input('password', 'synthetic-test-password');
  await submit();
  assert.equal(verificationCount, 1);
  assert.match(body(), /Підтвердь адресу/);
  assert.doesNotMatch(body(), /PRIVATE CAMPAIGN/);
  assert.equal(button('Лист надіслано').disabled, true);
  await click('Я підтвердив пошту');
  assert.match(body(), /Пошта ще не підтверджена/);
  assert.equal(fixture.calls.some(call => call.url === '/api/auth/session'), false);
  fixture.handlers.reload = async current => { current.emailVerified = true; };
  await click('Я підтвердив пошту');
  assert.match(body(), /PRIVATE CAMPAIGN/);
});

test('email login works in the same page after a blocked Google popup', async () => {
  await mount();
  await click('Увійти через Google');
  assert.match(body(), /Увійди поштою та паролем сайту/);
  let loginArguments;
  fixture.handlers.login = async (...args) => { loginArguments = args; return user('player'); };
  await input('email', 'player@example.test');
  await input('password', 'synthetic-test-password');
  await submit();
  assert.deepEqual(loginArguments, ['player@example.test', 'synthetic-test-password']);
  assert.match(body(), /PRIVATE CAMPAIGN/);
  assert.equal(location.href, 'https://campaign.example.test/#/');
});

test('password reset sends one requested email and enforces the resend cooldown', async () => {
  await mount();
  const resets = [];
  fixture.handlers.reset = async (...args) => { resets.push(args); };
  await click('Створити / відновити пароль');
  await input('email', 'player@example.test');
  await submit();
  assert.equal(resets.length, 1);
  assert.equal(resets[0][0], 'player@example.test');
  assert.equal(resets[0][1].url, 'https://campaign.example.test/#/');
  assert.match(body(), /Якщо акаунт із цією поштою існує/);
  assert.equal(button('Лист надіслано').disabled, true);
  assert.equal(fixture.auth.currentUser, null);
});

test('registering an existing Google account offers reset without silently sending mail', async () => {
  await mount();
  let resets = 0;
  fixture.handlers.register = async () => { throw { code: 'auth/email-already-in-use' }; };
  fixture.handlers.reset = async () => { resets++; };
  await click('Перший вхід у кампанію');
  await input('email', 'player@example.test');
  await input('password', 'synthetic-test-password');
  await submit();
  assert.match(body(), /Для цієї пошти вже є акаунт/);
  assert.equal(document.querySelector('input[type="password"]'), null);
  assert.equal(resets, 0);
  await submit();
  assert.equal(resets, 1);
});
