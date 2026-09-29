import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const project = new URL('../', import.meta.url);
const projectId = 'auth-regression-test';
const ownerEmail = 'owner@example.test';
const playerEmail = 'player@example.test';
const googleKeyUrl = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const originalFetch = globalThis.fetch;
let mf, db, env, authenticate, verifyFirebaseToken, privateKey;
let keyRequests = 0;

before(async () => {
  mkdirSync(new URL('private/', project), { recursive: true });
  const output = new URL('private/test-auth.mjs', project);
  await build({
    entryPoints: [fileURLToPath(new URL('worker/auth.ts', project))],
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    outfile: fileURLToPath(output), logLevel: 'silent',
  });
  const keyPair = await generateKeyPair('RS256');
  privateKey = keyPair.privateKey;
  const publicJwk = { ...await exportJWK(keyPair.publicKey), kid: 'test-signing-key', alg: 'RS256', use: 'sig' };

  // Only the Google key download is substituted. Production JWT verification,
  // signature checks and D1 membership lookups all execute unchanged.
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== googleKeyUrl) return originalFetch(input, init);
    keyRequests++;
    return Response.json({ keys: [publicJwk] });
  };
  ({ authenticate, verifyFirebaseToken } = await import(output.href));
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: 'export default {fetch(){return new Response("test")}}',
    d1Databases: ['DB'], compatibilityDate: '2026-09-19',
  }));
  db = await mf.getD1Database('DB');
  for (const file of readdirSync(new URL('migrations/', project)).filter(name => name.endsWith('.sql')).sort()) {
    const migration = readFileSync(new URL(`migrations/${file}`, project), 'utf8');
    for (const statement of migration.split(';').map(value => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  await db.prepare('INSERT INTO members (email,name,role,active) VALUES (?,?,?,1)')
    .bind(playerEmail, 'Test player', 'player').run();
  await db.prepare('UPDATE player_slots SET email=? WHERE id=?').bind(playerEmail, 'hero-2').run();
  env = { DB: db, FIREBASE_PROJECT_ID: projectId, OWNER_EMAIL: ownerEmail, DEV_AUTH: 'local-only' };
});

after(async () => {
  globalThis.fetch = originalFetch;
  await mf?.dispose();
});

async function token({ email = ownerEmail, provider = 'google.com', claims = {}, key = privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: `https://securetoken.google.com/${projectId}`, aud: projectId,
    sub: 'synthetic-firebase-user', iat: now, exp: now + 3600, auth_time: now,
    email, email_verified: true, firebase: { sign_in_provider: provider }, ...claims,
  }).setProtectedHeader({ alg: 'RS256', kid: 'test-signing-key' }).sign(key);
}

function request(jwt, headers = {}, url = 'https://campaign.example.test/api/bootstrap') {
  return new Request(url, { headers: { ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), ...headers } });
}

test('verified Google and password owner identities both receive DM access', async () => {
  for (const provider of ['google.com', 'password']) {
    const user = await authenticate(request(await token({ provider })), env);
    assert.equal(user?.email, ownerEmail, provider);
    assert.equal(user?.role, 'dm', provider);
    assert.equal(user?.canPreviewPlayer, true, provider);
    assert.equal(user?.dev, false, provider);
  }
  assert.ok(keyRequests > 0, 'verification must obtain and use the public signing key');
});

test('owner can preview a player and return to DM without changing their account', async () => {
  const jwt = await token();
  const preview = await authenticate(request(jwt, { 'X-Preview-Role': 'player' }), env);
  assert.equal(preview?.role, 'player');
  assert.equal(preview?.canPreviewPlayer, true);
  assert.equal(preview?.id, ownerEmail);
  assert.equal((await authenticate(request(jwt), env))?.role, 'dm');
});

test('an authenticated allowlisted player cannot elevate via preview or dev headers', async () => {
  const jwt = await token({ email: playerEmail });
  for (const headers of [
    {}, { 'X-Preview-Role': 'dm' }, { 'X-Dev-Role': 'dm' },
    { 'X-Preview-Role': 'player', 'X-Dev-Role': 'dm', 'Cf-Access-Authenticated-User-Email': ownerEmail },
  ]) {
    const user = await authenticate(request(jwt, headers), env);
    assert.equal(user?.role, 'player');
    assert.equal(user?.email, playerEmail);
    assert.equal(user?.canPreviewPlayer, false);
    assert.equal(user?.dev, false);
    assert.equal(user?.avatar_url, '/images/avatars/default.svg');
  }
  const member = await db.prepare('SELECT last_login_at FROM members WHERE email=?').bind(playerEmail).first();
  assert.ok(member.last_login_at, 'first successful login is recorded for the master');
});

test('unverified email is denied even for the owner or an allowlisted player', async () => {
  for (const email of [ownerEmail, playerEmail]) {
    for (const provider of ['google.com', 'password']) {
      const jwt = await token({ email, provider, claims: { email_verified: false } });
      assert.equal(await authenticate(request(jwt), env), null, `${email} via ${provider}`);
    }
  }
});

test('a verified but unlisted Google or password account is denied', async () => {
  for (const provider of ['google.com', 'password']) {
    const jwt = await token({ email: 'stranger@example.test', provider });
    assert.equal(await authenticate(request(jwt), env), null, provider);
  }
});

test('revoking membership takes effect immediately for an existing valid token', async () => {
  const email = 'revocable@example.test';
  await db.prepare('INSERT INTO members (email,name,active) VALUES (?,?,1)').bind(email, 'Revoked player').run();
  const jwt = await token({ email });
  assert.equal((await authenticate(request(jwt), env))?.role, 'player');
  await db.prepare('UPDATE members SET active=0 WHERE email=?').bind(email).run();
  assert.equal(await authenticate(request(jwt), env), null);
  assert.equal(await authenticate(request(undefined, { Cookie: `__Host-campaign_session=${jwt}` }), env), null);
});

test('invalid expiration, issuer, audience and required identity claims are denied', async () => {
  const now = Math.floor(Date.now() / 1000);
  const invalidClaims = [
    { exp: now - 60 },
    { iss: 'https://securetoken.google.com/another-project' },
    { aud: 'another-project' },
    { sub: '' },
    { email: undefined },
    { email_verified: undefined },
    { auth_time: undefined },
  ];
  for (const claims of invalidClaims) {
    const jwt = await token({ claims });
    assert.equal(await verifyFirebaseToken(jwt, env), null, `claims: ${JSON.stringify(claims)}`);
    assert.equal(await authenticate(request(jwt), env), null);
  }
});

test('a forged signature never becomes an identity even with correct owner claims', async () => {
  const attackerKeys = await generateKeyPair('RS256');
  const forged = await token({ key: attackerKeys.privateKey });
  assert.equal(await authenticate(request(forged), env), null);
});

test('same-origin session cookie preserves the verified identity for document requests', async () => {
  const jwt = await token();
  const user = await authenticate(request(undefined, {
    Cookie: `unrelated=1; __Host-campaign_session=${jwt}; preference=dark`,
  }), env);
  assert.equal(user?.role, 'dm');
  assert.equal(user?.email, ownerEmail);
  assert.equal(await authenticate(request(undefined, { Cookie: '__Host-campaign_session=bad-token' }), env), null);
});

test('missing credentials and forged headers cannot enable local development access on the public site', async () => {
  assert.equal(await authenticate(request(undefined, {
    'X-Dev-Role': 'dm', 'X-Preview-Role': 'dm', 'Cf-Access-Authenticated-User-Email': ownerEmail,
  }), env), null);
  assert.equal(await authenticate(request(undefined, { 'X-Dev-Role': 'dm' }, 'http://localhost/api/bootstrap'), {
    ...env, DEV_AUTH: undefined,
  }), null);
});
