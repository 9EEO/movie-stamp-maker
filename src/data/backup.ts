import type { Calibration } from '../core/calibration';
import { type Stamp, getDb, getSettings, listQueue } from './db';

const APP = 'movie-stamp-maker';
const VERSION = 1;

interface BackupFile {
  app: typeof APP;
  version: number;
  exportedAt: number;
  stamps: Stamp[];
  /** blob id → data URL */
  blobs: Record<string, string>;
  calibration: Calibration;
  /** 내보낸 기기가 테스트 시트로 보정했는지. 없으면(이전 백업) false로 본다 */
  calibrated?: boolean;
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

function dataUrlToBlob(url: string): Blob {
  const match = /^data:([^;,]*);base64,(.*)$/s.exec(url);
  if (!match) throw new BackupError('이미지 데이터가 올바르지 않아요');
  let binary: string;
  try {
    binary = atob(match[2]);
  } catch {
    throw new BackupError('이미지 데이터가 올바르지 않아요');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}

/** 전체 컬렉션을 JSON 파일 하나로 내보낸다. TMDB 키는 넣지 않는다(파일이 공유될 수 있음). */
export async function exportBackup(): Promise<Blob> {
  const db = await getDb();
  const stamps = await db.getAll('stamps');
  const blobs: Record<string, string> = {};
  for (const s of stamps) {
    if (!s.blobId) continue;
    const blob = await db.get('blobs', s.blobId);
    if (blob) blobs[s.blobId] = await blobToDataUrl(blob);
  }
  const { calibration, calibrated } = await getSettings();
  const file: BackupFile = { app: APP, version: VERSION, exportedAt: Date.now(), stamps, blobs, calibration, calibrated };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isOptional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function isCalibration(v: unknown): v is Calibration {
  return isObject(v) && isNum(v.scalePct) && v.scalePct > 0 && isNum(v.offsetXMm) && isNum(v.offsetYMm);
}

function isStamp(v: unknown, blobs: Record<string, unknown>): v is Stamp {
  if (!isObject(v)) return false;
  const crop = v.crop;
  return (
    isStr(v.id) &&
    (v.source === 'tmdb' || v.source === 'upload') &&
    isStr(v.title) &&
    isOptional(v.tmdbId, isNum) &&
    isOptional(v.year, isNum) &&
    isOptional(v.posterPath, isStr) &&
    isOptional(v.blobId, (id) => isStr(id) && id in blobs) &&
    (v.source === 'tmdb' ? isStr(v.posterPath) : isStr(v.blobId)) &&
    isObject(crop) &&
    (crop.mode === 'fill' || crop.mode === 'fit') &&
    isNum(crop.cx) &&
    isNum(crop.cy) &&
    isNum(crop.zoom) &&
    (v.status === 'queued' || v.status === 'made') &&
    isNum(v.queueOrder) &&
    isNum(v.createdAt) &&
    isOptional(v.madeAt, isNum)
  );
}

/** 모든 항목을 먼저 검증한다. 하나라도 틀리면 BackupError. */
async function parseBackup(file: Blob): Promise<BackupFile & { blobData: Map<string, Blob> }> {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new BackupError('JSON 파일이 아니에요');
  }
  if (!isObject(json) || json.app !== APP) throw new BackupError('이 앱의 백업 파일이 아니에요');
  if (!isNum(json.version) || json.version < 1 || json.version > VERSION) {
    throw new BackupError('지원하지 않는 백업 버전이에요');
  }
  const { stamps, blobs, calibration } = json;
  if (
    !Array.isArray(stamps) ||
    !isObject(blobs) ||
    !isCalibration(calibration) ||
    !isOptional(json.calibrated, (v) => typeof v === 'boolean')
  ) {
    throw new BackupError('백업 파일 형식이 올바르지 않아요');
  }
  if (!stamps.every((s) => isStamp(s, blobs))) throw new BackupError('우표 정보가 올바르지 않아요');
  const blobData = new Map<string, Blob>();
  for (const [id, url] of Object.entries(blobs)) {
    if (!isStr(url)) throw new BackupError('이미지 데이터가 올바르지 않아요');
    blobData.set(id, dataUrlToBlob(url));
  }
  return { ...(json as unknown as BackupFile), blobData };
}

const dupKey = (s: Stamp) => (s.tmdbId === undefined ? null : `${s.tmdbId}:${s.createdAt}`);

/**
 * 백업을 합친다. 같은 id이거나 (tmdbId, createdAt)가 같은 우표는 건너뛴다.
 * 대기열 항목은 기존 대기열 뒤에 원래 순서대로 붙는다.
 * 보정값은 백업한 기기가 보정했고 이 기기는 아직 보정하지 않았을 때만 가져온다.
 */
export async function importBackup(file: Blob): Promise<{ added: number; skipped: number }> {
  const backup = await parseBackup(file);
  const db = await getDb();
  const existing = await db.getAll('stamps');
  const ids = new Set(existing.map((s) => s.id));
  const keys = new Set(existing.map(dupKey).filter((k) => k !== null));

  const toAdd: Stamp[] = [];
  for (const s of backup.stamps) {
    const key = dupKey(s);
    // (tmdbId, createdAt)는 기존 데이터와만 비교한다. 파일 안의 서로 다른 우표는 id로만 구분한다.
    if (ids.has(s.id) || (key !== null && keys.has(key))) continue;
    ids.add(s.id);
    toAdd.push(s);
  }

  let nextOrder = (await listQueue()).reduce((max, s) => Math.max(max, s.queueOrder + 1), 0);
  const queued = toAdd.filter((s) => s.status === 'queued').sort((a, b) => a.queueOrder - b.queueOrder);
  const orders = new Map(queued.map((s) => [s.id, nextOrder++]));
  const settings = await getSettings();

  const tx = db.transaction(['stamps', 'blobs', 'settings'], 'readwrite');
  for (const s of toAdd) {
    await tx.objectStore('stamps').put({ ...s, queueOrder: orders.get(s.id) ?? s.queueOrder });
    if (s.blobId) await tx.objectStore('blobs').put(backup.blobData.get(s.blobId)!, s.blobId);
  }
  if (backup.calibrated === true && !settings.calibrated) {
    await tx.objectStore('settings').put({ ...settings, calibration: backup.calibration, calibrated: true }, 'settings');
  }
  await tx.done;
  return { added: toAdd.length, skipped: backup.stamps.length - toAdd.length };
}
