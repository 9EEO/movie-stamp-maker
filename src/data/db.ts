import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import { type Calibration, DEFAULT_CALIBRATION } from '../core/calibration';
import type { Crop } from '../core/crop';

export interface Stamp {
  id: string;
  source: 'tmdb' | 'upload';
  tmdbId?: number;
  title: string;
  year?: number;
  posterPath?: string;
  blobId?: string;
  crop: Crop;
  status: 'queued' | 'made';
  queueOrder: number;
  createdAt: number;
  madeAt?: number;
}

export interface Settings {
  tmdbKey?: string;
  calibration: Calibration;
  calibrated: boolean;
  preferredOutput?: 'share' | 'save';
  installPrompted: boolean;
}

export type NewStamp = Omit<Stamp, 'id' | 'status' | 'queueOrder' | 'createdAt'>;

interface StampDB extends DBSchema {
  stamps: { key: string; value: Stamp; indexes: { tmdbId: number; status: string } };
  blobs: { key: string; value: Blob };
  settings: { key: string; value: Settings };
}

export const DB_NAME = 'movie-stamps';
const DB_VERSION = 1;
const SETTINGS_KEY = 'settings';

let dbPromise: Promise<IDBPDatabase<StampDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<StampDB>> {
  dbPromise ??= openDB<StampDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const stamps = db.createObjectStore('stamps', { keyPath: 'id' });
      stamps.createIndex('tmdbId', 'tmdbId');
      stamps.createIndex('status', 'status');
      db.createObjectStore('blobs');
      db.createObjectStore('settings');
    },
  });
  return dbPromise;
}

export function closeDb(): void {
  dbPromise?.then((db) => db.close());
  dbPromise = null;
}

function nextQueueOrder(queued: Stamp[]): number {
  return queued.reduce((max, s) => Math.max(max, s.queueOrder + 1), 0);
}

/** 대기열 맨 뒤에 추가한다. */
export async function addStamp(input: NewStamp): Promise<Stamp> {
  const db = await getDb();
  const tx = db.transaction('stamps', 'readwrite');
  const queued = await tx.store.index('status').getAll('queued');
  const stamp: Stamp = {
    ...input,
    id: crypto.randomUUID(),
    status: 'queued',
    queueOrder: nextQueueOrder(queued),
    createdAt: Date.now(),
  };
  await tx.store.add(stamp);
  await tx.done;
  return stamp;
}

export async function getStamp(id: string): Promise<Stamp | undefined> {
  const db = await getDb();
  return db.get('stamps', id);
}

export async function updateStamp(id: string, patch: Partial<Stamp>): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('stamps', 'readwrite');
  const stamp = await tx.store.get(id);
  if (stamp) await tx.store.put({ ...stamp, ...patch, id });
  await tx.done;
}

/** 우표와 연결된 blob을 함께 지운다. */
export async function deleteStamp(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['stamps', 'blobs'], 'readwrite');
  const stamp = await tx.objectStore('stamps').get(id);
  await tx.objectStore('stamps').delete(id);
  if (stamp?.blobId) await tx.objectStore('blobs').delete(stamp.blobId);
  await tx.done;
}

export async function listQueue(): Promise<Stamp[]> {
  const db = await getDb();
  const queued = await db.getAllFromIndex('stamps', 'status', 'queued');
  return queued.sort((a, b) => a.queueOrder - b.queueOrder);
}

export async function listMade(): Promise<Stamp[]> {
  const db = await getDb();
  const made = await db.getAllFromIndex('stamps', 'status', 'made');
  return made.sort((a, b) => (b.madeAt ?? 0) - (a.madeAt ?? 0));
}

/** 주어진 순서대로 0부터 다시 번호를 매긴다. */
export async function reorderQueue(ids: string[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('stamps', 'readwrite');
  await Promise.all(
    ids.map(async (id, queueOrder) => {
      const stamp = await tx.store.get(id);
      if (stamp) await tx.store.put({ ...stamp, queueOrder });
    }),
  );
  await tx.done;
}

/** 만든 우표로 옮기고, 되돌리기용으로 이전 순서를 반환한다. */
export async function markMade(ids: string[], at: number): Promise<{ id: string; queueOrder: number }[]> {
  const db = await getDb();
  const tx = db.transaction('stamps', 'readwrite');
  const prev: { id: string; queueOrder: number }[] = [];
  for (const id of ids) {
    const stamp = await tx.store.get(id);
    if (!stamp) continue;
    prev.push({ id, queueOrder: stamp.queueOrder });
    await tx.store.put({ ...stamp, status: 'made', madeAt: at });
  }
  await tx.done;
  return prev;
}

/**
 * 대기열로 되돌린다. 순서를 주면 그 자리에 끼워 넣고(같거나 뒤인 항목은 한 칸씩 밀림),
 * 주지 않으면 맨 뒤로 보낸다.
 */
export async function returnToQueue(id: string, queueOrder?: number): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('stamps', 'readwrite');
  const stamp = await tx.store.get(id);
  if (!stamp) {
    await tx.done;
    return;
  }
  const queued = (await tx.store.index('status').getAll('queued')).filter((s) => s.id !== id);
  let order = nextQueueOrder(queued);
  if (queueOrder !== undefined) {
    order = queueOrder;
    for (const s of queued) {
      if (s.queueOrder >= queueOrder) await tx.store.put({ ...s, queueOrder: s.queueOrder + 1 });
    }
  }
  const { madeAt: _madeAt, ...rest } = stamp;
  await tx.store.put({ ...rest, status: 'queued', queueOrder: order });
  await tx.done;
}

export async function findByTmdbId(tmdbId: number): Promise<Stamp[]> {
  const db = await getDb();
  return db.getAllFromIndex('stamps', 'tmdbId', tmdbId);
}

export async function putBlob(blob: Blob): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.put('blobs', blob, id);
  return id;
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const db = await getDb();
  return db.get('blobs', id);
}

const DEFAULT_SETTINGS: Settings = {
  calibration: DEFAULT_CALIBRATION,
  calibrated: false,
  installPrompted: false,
};

export async function getSettings(): Promise<Settings> {
  const db = await getDb();
  return { ...DEFAULT_SETTINGS, ...(await db.get('settings', SETTINGS_KEY)) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('settings', 'readwrite');
  const current = { ...DEFAULT_SETTINGS, ...(await tx.store.get(SETTINGS_KEY)) };
  await tx.store.put({ ...current, ...patch }, SETTINGS_KEY);
  await tx.done;
}
