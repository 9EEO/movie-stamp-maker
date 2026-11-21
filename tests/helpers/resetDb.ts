import { closeDb, DB_NAME } from '../../src/data/db';

/** 테스트 사이 격리: 연결을 닫고 DB를 지운다. */
export async function resetDb() {
  closeDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('deleteDatabase blocked'));
  });
}
