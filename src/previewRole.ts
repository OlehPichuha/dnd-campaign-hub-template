let memoryRole = 'dm';

export function getPreviewRole() {
  try { return localStorage.getItem('campaign-preview-role') === 'player' ? 'player' : 'dm'; }
  catch { return memoryRole; }
}

export function setPreviewRole(role: string) {
  memoryRole = role === 'player' ? 'player' : 'dm';
  try { localStorage.setItem('campaign-preview-role', memoryRole); } catch { /* Restricted browser storage: keep this tab usable. */ }
}
