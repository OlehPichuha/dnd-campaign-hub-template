export type Role = 'dm' | 'player';
export type Visibility = 'group' | 'dm';
export type GameStatus = 'planned' | 'completed' | 'cancelled';
export interface User { id: string; email: string; name: string; role: Role; dev: boolean; avatar_url: string; canPreviewPlayer: boolean }
export interface Act { id: string; title: string; position: number }
export interface Phase { id: string; act_id: string; title: string; position: number }
export interface Game {
  id: string; parent_id: string | null; number: number; branch: number;
  phase_id: string; title: string; date: string; time: string; level: number | null;
  status: GameStatus; visibility: Visibility; summary: string; participants: string;
  version: number; note_count: number;
}
export interface Note {
  id: string; session_id: string; author_id: string; author_name: string;
  visibility: Visibility; section: 'shared' | 'dm'; body: string; created_at: string; updated_at: string; version: number;
}
export interface Resource {
  id: string; title: string; description: string; category: string; icon: string;
  visibility: Visibility; kind: 'journal' | 'note' | 'link' | 'html';
  url: string; body?: string; image_url: string; theme: 'light' | 'dark';
  position: number; version: number; updated_at: string;
}
export type NpcStatus = 'alive' | 'dead' | 'missing' | 'unknown';
export interface NpcCategory { id: string; title: string; position: number; version: number }
export interface Npc {
  id: string; category_id: string; name: string; race: string; role: string; location: string;
  status: NpcStatus; description: string; portrait: string; version: number; updated_at: string;
}
export interface NpcData { categories: NpcCategory[]; npcs: Npc[] }
export type MapMarkerColor = 'gold' | 'cyan' | 'red' | 'violet' | 'green';
export interface MapMarker {
  id: string; title: string; body: string; x: number; y: number; color: MapMarkerColor;
  created_by: string; created_by_name: string; version: number; created_at: string; updated_at: string;
}
export interface DmNoteCategory { id: string; title: string; position: number; version: number }
export interface DmNotebook {
  id: string; category_id: string; title: string; body: string; position: number;
  version: number; created_at: string; updated_at: string;
}
export interface DmNotebookData { categories: DmNoteCategory[]; notes: DmNotebook[] }
export interface PortalData { user: User; acts: Act[]; phases: Phase[]; games: Game[]; resources: Resource[]; bookConfigured: boolean }
export const gameNumber = (game: Pick<Game, 'number' | 'branch'>) => `${game.number}${game.branch ? `-${game.branch}` : ''}`;
