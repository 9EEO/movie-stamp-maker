// @vitest-environment node
// jsdom의 Blob은 structuredClone으로 복제되지 않아, 실제 브라우저처럼 Blob을 저장하려면 Node 환경이 필요하다.
import 'fake-indexeddb/auto';
import { DEFAULT_CALIBRATION } from '../../src/core/calibration';
import { DEFAULT_CROP } from '../../src/core/crop';
import {
  addStamp,
  closeDb,
  deleteStamp,
  findByTmdbId,
  getBlob,
  getSettings,
  getStamp,
  listMade,
  listQueue,
  markMade,
  putBlob,
  reorderQueue,
  returnToQueue,
  saveSettings,
  updateStamp,
} from '../../src/data/db';
import { resetDb } from '../helpers/resetDb';

beforeEach(resetDb);

function tmdb(title: string, tmdbId = 1) {
  return addStamp({ source: 'tmdb', tmdbId, title, posterPath: `/${title}.jpg`, crop: DEFAULT_CROP });
}

const titles = (stamps: { title: string }[]) => stamps.map((s) => s.title);

test('addStamp appends to the queue with increasing queueOrder', async () => {
  const a = await tmdb('a');
  const b = await tmdb('b');
  const c = await tmdb('c');
  expect([a.queueOrder, b.queueOrder, c.queueOrder]).toEqual([0, 1, 2]);
  expect(a).toMatchObject({ status: 'queued', title: 'a', source: 'tmdb' });
  expect(a.id).not.toBe(b.id);
  expect(typeof a.createdAt).toBe('number');
  expect(titles(await listQueue())).toEqual(['a', 'b', 'c']);
});

test('getStamp returns one stamp or undefined', async () => {
  const a = await tmdb('a');
  expect(await getStamp(a.id)).toEqual(a);
  expect(await getStamp('missing')).toBeUndefined();
});

test('updateStamp patches fields', async () => {
  const a = await tmdb('a');
  await updateStamp(a.id, { crop: { mode: 'fit', cx: 0.5, cy: 0.5, zoom: 1 }, posterPath: '/other.jpg' });
  const [stored] = await listQueue();
  expect(stored.crop.mode).toBe('fit');
  expect(stored.posterPath).toBe('/other.jpg');
  expect(stored.title).toBe('a');
});

test('reorderQueue renumbers from 0 in the given order', async () => {
  const a = await tmdb('a');
  const b = await tmdb('b');
  const c = await tmdb('c');
  await reorderQueue([c.id, a.id, b.id]);
  const q = await listQueue();
  expect(titles(q)).toEqual(['c', 'a', 'b']);
  expect(q.map((s) => s.queueOrder)).toEqual([0, 1, 2]);
});

test('markMade moves stamps from queue to made and returns previous order', async () => {
  const a = await tmdb('a');
  const b = await tmdb('b');
  await tmdb('c');
  const prev = await markMade([a.id, b.id], 1000);
  expect(prev).toEqual([
    { id: a.id, queueOrder: 0 },
    { id: b.id, queueOrder: 1 },
  ]);
  expect(titles(await listQueue())).toEqual(['c']);
  const made = await listMade();
  expect(titles(made).sort()).toEqual(['a', 'b']);
  expect(made.every((s) => s.status === 'made' && s.madeAt === 1000)).toBe(true);
});

test('listMade is newest first', async () => {
  const a = await tmdb('a');
  const b = await tmdb('b');
  await markMade([a.id], 100);
  await markMade([b.id], 200);
  expect(titles(await listMade())).toEqual(['b', 'a']);
});

test('returnToQueue with previous order restores the original position', async () => {
  const a = await tmdb('a');
  const b = await tmdb('b');
  const c = await tmdb('c');
  await tmdb('d');
  const prev = await markMade([a.id, b.id, c.id], 1000);
  for (const p of prev) await returnToQueue(p.id, p.queueOrder);
  expect(titles(await listQueue())).toEqual(['a', 'b', 'c', 'd']);
  expect(await listMade()).toEqual([]);
  const [restored] = await listQueue();
  expect(restored.madeAt).toBeUndefined();
});

test('returnToQueue without order puts the stamp at the end', async () => {
  const a = await tmdb('a');
  await tmdb('b');
  await markMade([a.id], 1000);
  await returnToQueue(a.id);
  expect(titles(await listQueue())).toEqual(['b', 'a']);
});

test('deleteStamp removes the linked blob too', async () => {
  const blobId = await putBlob(new Blob(['png-bytes'], { type: 'image/png' }));
  expect(await getBlob(blobId)).toBeDefined();
  const s = await addStamp({ source: 'upload', title: '내 사진', blobId, crop: DEFAULT_CROP });
  await deleteStamp(s.id);
  expect(await listQueue()).toEqual([]);
  expect(await getBlob(blobId)).toBeUndefined();
});

test('putBlob/getBlob round trip', async () => {
  const id = await putBlob(new Blob(['hello'], { type: 'text/plain' }));
  const blob = await getBlob(id);
  expect(blob).toBeDefined();
  expect(blob!.size).toBe(5);
});

test('findByTmdbId finds queued and made stamps', async () => {
  const a = await tmdb('a', 42);
  await tmdb('b', 42);
  await tmdb('other', 7);
  await markMade([a.id], 1000);
  const found = await findByTmdbId(42);
  expect(titles(found).sort()).toEqual(['a', 'b']);
  expect(await findByTmdbId(999)).toEqual([]);
});

test('getSettings returns defaults', async () => {
  expect(await getSettings()).toEqual({
    calibration: DEFAULT_CALIBRATION,
    calibrated: false,
    installPrompted: false,
  });
});

test('saveSettings merges the patch', async () => {
  await saveSettings({ tmdbKey: 'abc' });
  await saveSettings({ calibrated: true, calibration: { scalePct: 101, offsetXMm: 0.2, offsetYMm: 0 } });
  expect(await getSettings()).toEqual({
    tmdbKey: 'abc',
    calibration: { scalePct: 101, offsetXMm: 0.2, offsetYMm: 0 },
    calibrated: true,
    installPrompted: false,
  });
});

afterAll(closeDb);
