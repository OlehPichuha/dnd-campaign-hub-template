import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { User } from '../shared/types';

export interface Env {
  DB: D1Database; ASSETS: Fetcher;
  FIREBASE_PROJECT_ID?: string; OWNER_EMAIL?: string; CAMPAIGN_BOOK_URL?: string; DEV_AUTH?: string;
}

const firebaseKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
export const SESSION_COOKIE = '__Host-campaign_session';

export function isLocal(request: Request, env: Env) {
  return env.DEV_AUTH === 'local-only' && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(request.url).hostname);
}

function readCookie(request: Request, name: string) {
  const entry = request.headers.get('Cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return entry?.slice(name.length + 1) || null;
}

export async function verifyFirebaseToken(token: string, env: Env) {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId || !env.OWNER_EMAIL || token.length > 8192) return null;
  try {
    const { payload } = await jwtVerify(token, firebaseKeys, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
    });
    if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || payload.email_verified !== true || typeof payload.auth_time !== 'number') return null;
    return { email: payload.email.toLowerCase(), expiresAt: payload.exp! };
  } catch { return null; }
}

export async function authenticate(request: Request, env: Env): Promise<User | null> {
  if (isLocal(request, env)) {
    const player = request.headers.get('X-Dev-Role') === 'player';
    return { id: player ? 'local-player' : 'local-dm', email: player ? 'player@local.test' : 'dm@local.test', name: player ? 'Гравець' : 'Майстер', role: player ? 'player' : 'dm', dev: true, avatar_url: player ? '' : '/images/avatars/default.svg', canPreviewPlayer: true };
  }
  const bearer = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1];
  const token = bearer || readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const identity = await verifyFirebaseToken(token, env);
  if (!identity) return null;
  const { email } = identity;
  if (email === env.OWNER_EMAIL?.trim().toLowerCase()) return { id: email, email, name: 'Майстер', role: request.headers.get('X-Preview-Role') === 'player' ? 'player' : 'dm', dev: false, avatar_url: '/images/avatars/default.svg', canPreviewPlayer: true };
  const member = await env.DB.prepare('SELECT m.name, m.last_login_at, s.avatar_url FROM members m LEFT JOIN player_slots s ON s.email = m.email WHERE m.email = ? AND m.active = 1').bind(email).first<{name: string; last_login_at: string | null; avatar_url: string | null}>();
  if (!member) return null;
  if (!member.last_login_at) await env.DB.prepare("UPDATE members SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email = ? AND last_login_at IS NULL").bind(email).run();
  return { id: email, email, name: member.name, role: 'player', dev: false, avatar_url: member.avatar_url || '', canPreviewPlayer: false };
}
