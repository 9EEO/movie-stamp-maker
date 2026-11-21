import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Settings } from '../data/db';
import type { Tmdb } from '../tmdb/client';

export type Overlay = { kind: 'crop'; stampId: string } | { kind: 'detail'; stampId: string } | { kind: 'settings' };

export interface AppContextValue {
  open(o: Overlay): void;
  close(): void;
  /** 우표 데이터가 바뀌었음을 알린다. 목록들은 `version`이 바뀌면 다시 읽는다. */
  refresh(): void;
  version: number;
  settings: Settings | null;
  reloadSettings(): Promise<void>;
  /** 키가 없으면 null */
  tmdb: Tmdb | null;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext가 없어요');
  return ctx;
}
