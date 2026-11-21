// @vitest-environment node
import 'fake-indexeddb/auto';
import { DEFAULT_CALIBRATION } from '../../src/core/calibration';
import { DEFAULT_CROP } from '../../src/core/crop';
import { BackupError, exportBackup, importBackup } from '../../src/data/backup';
import {
  addStamp,
  closeDb,
  getBlob,
  getSettings,
  listMade,
  listQueue,
  markMade,
  putBlob,
  saveSettings,
} from '../../src/data/db';
import { resetDb } from '../helpers/resetDb';

beforeEach(resetDb);
afterAll(closeDb);

const titles = (stamps: { title: string }[]) => stamps.map((s) => s.title);

function tmdb(title: string, tmdbId = 1) {
  return addStamp({ source: 'tmdb', tmdbId, title, year: 2001, posterPath: `/${title}.jpg`, crop: DEFAULT_CROP });
}

async function readJson(blob: Blob) {
  return JSON.parse(await blob.text());
}

test('export has the documented shape', async () => {
  await tmdb('a');
  const json = await readJson(await exportBackup());
  expect(json).toMatchObject({ app: 'movie-stamp-maker', version: 1, calibration: DEFAULT_CALIBRATION });
  expect(typeof json.exportedAt).toBe('number');
  expect(json.stamps).toHaveLength(1);
  expect(json.blobs).toEqual({});
});

test('round trip restores stamps and uploaded blobs', async () => {
  const a = await tmdb('a');
  await tmdb('b');
  const blobId = await putBlob(new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/png' }));
  await addStamp({ source: 'upload', title: '내 사진', blobId, crop: { mode: 'fit', cx: 0.3, cy: 0.6, zoom: 2 } });
  await markMade([a.id], 500);
  const backup = await exportBackup();
  const queueBefore = await listQueue();
  const madeBefore = await listMade();

  await resetDb();
  expect(await importBackup(backup)).toEqual({ added: 3, skipped: 0 });

  // 대기열 번호는 가져올 때 기존 대기열(여기선 빈 대기열) 뒤로 다시 매겨진다
  const withoutOrder = ({ queueOrder: _q, ...rest }: { queueOrder: number }) => rest;
  const queueAfter = await listQueue();
  expect(queueAfter.map(withoutOrder)).toEqual(queueBefore.map(withoutOrder));
  expect(queueAfter.map((s) => s.queueOrder)).toEqual([0, 1]);
  expect(await listMade()).toEqual(madeBefore);
  const restored = await getBlob(blobId);
  expect(restored?.type).toBe('image/png');
  expect([...new Uint8Array(await restored!.arrayBuffer())]).toEqual([1, 2, 3, 250]);
});

test('import merges and skips duplicates', async () => {
  await tmdb('a', 1);
  await tmdb('b', 2);
  const backup = await exportBackup();

  await resetDb();
  await tmdb('c', 3);
  expect(await importBackup(backup)).toEqual({ added: 2, skipped: 0 });
  // 들어온 대기열 항목은 기존 대기열 뒤에 붙는다
  expect(titles(await listQueue())).toEqual(['c', 'a', 'b']);
  expect((await listQueue()).map((s) => s.queueOrder)).toEqual([0, 1, 2]);

  expect(await importBackup(backup)).toEqual({ added: 0, skipped: 2 });
  expect(titles(await listQueue())).toEqual(['c', 'a', 'b']);
});

test('import skips a stamp with the same tmdbId and createdAt even if the id differs', async () => {
  const a = await tmdb('a', 42);
  const json = await readJson(await exportBackup());
  json.stamps[0].id = 'another-id';
  expect(await importBackup(new Blob([JSON.stringify(json)]))).toEqual({ added: 0, skipped: 1 });
  expect((await listQueue()).map((s) => s.id)).toEqual([a.id]);
});

test('rejects non-JSON, wrong app, future version without touching data', async () => {
  await tmdb('a');
  await tmdb('b');
  const good = await readJson(await exportBackup());
  const before = await listQueue();
  const brokenStamp = { ...good, stamps: [{ ...good.stamps[0], id: 'x', crop: { mode: 'zoomy' } }] };
  const missingBlob = { ...good, stamps: [{ ...good.stamps[0], id: 'y', source: 'upload', blobId: 'nope' }] };
  for (const bad of [
    'not json',
    '{"foo":1}',
    'null',
    JSON.stringify({ app: 'movie-stamp-maker', version: 99 }),
    JSON.stringify({ ...good, version: 2 }),
    JSON.stringify({ ...good, stamps: 'nope' }),
    JSON.stringify(brokenStamp),
    JSON.stringify(missingBlob),
  ]) {
    await expect(importBackup(new Blob([bad])), bad.slice(0, 40)).rejects.toBeInstanceOf(BackupError);
  }
  expect(await listQueue()).toEqual(before);
});

test('export never contains tmdbKey', async () => {
  await saveSettings({ tmdbKey: 'secret-key-123' });
  await tmdb('a');
  const text = await (await exportBackup()).text();
  expect(text).not.toContain('secret-key-123');
  expect(text).not.toContain('tmdbKey');
});

test('import applies backup calibration only when this device is not calibrated', async () => {
  const cal = { scalePct: 101.5, offsetXMm: 0.3, offsetYMm: -0.2 };
  await saveSettings({ calibration: cal, calibrated: true });
  const backup = await exportBackup();

  await resetDb();
  await importBackup(backup);
  expect(await getSettings()).toMatchObject({ calibration: cal, calibrated: true });

  await resetDb();
  const mine = { scalePct: 99, offsetXMm: 0, offsetYMm: 0 };
  await saveSettings({ calibration: mine, calibrated: true });
  await importBackup(backup);
  expect((await getSettings()).calibration).toEqual(mine);
});
