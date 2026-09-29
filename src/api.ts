import { refreshSession } from './AuthGate';
import { getPreviewRole } from './previewRole';

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const request = () => fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'campaign-hub',
      'X-Dev-Role': getPreviewRole(),
      'X-Preview-Role': getPreviewRole(),
      ...options.headers,
    },
  });
  let response = await request();
  if (response.status === 401 && await refreshSession(true).catch(() => false)) response = await request();
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(error.error || 'Не вдалося виконати дію. Спробуй ще раз.');
  }
  return response.json();
}
export const send = <T,>(path: string, method: string, body: unknown) => api<T>(path, { method, body: JSON.stringify(body) });
