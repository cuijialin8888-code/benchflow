import { emptyWorkspace, validateWorkspace } from './model.js';

let connection;
export async function openDatabase() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('benchflow', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = null; };
      resolve(request.result);
    };
    request.onerror = () => { connection = null; reject(new Error('Browser storage is unavailable. Use a regular browser window.')); };
    request.onblocked = () => { connection = null; reject(new Error('Close other BenchFlow tabs and reload to update storage.')); };
  });
  return connection;
}

export async function loadWorkspace() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', 'readonly');
    const request = tx.objectStore('workspace').get('current');
    request.onsuccess = () => {
      try {
        const record = request.result || { revision: 0, data: emptyWorkspace() };
        validateWorkspace(record.data);
        resolve(record);
      } catch (error) { reject(error); }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveWorkspace(data, expectedRevision) {
  validateWorkspace(data);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', 'readwrite');
    const store = tx.objectStore('workspace');
    let failure;
    const request = store.get('current');
    request.onsuccess = () => {
      const current = request.result || { revision: 0, data: emptyWorkspace() };
      if (current.revision !== expectedRevision) {
        failure = new Error('Another tab saved changes. Reload this tab before editing; your pending changes were not saved.');
        tx.abort(); return;
      }
      store.put(current.data, 'previous');
      store.put({ revision: expectedRevision + 1, data }, 'current');
    };
    tx.oncomplete = () => resolve(expectedRevision + 1);
    tx.onabort = () => reject(failure || new Error('Could not save. Browser storage may be full or unavailable. Your previous workspace is intact.'));
    tx.onerror = () => {}; // onabort owns the error and preserves the previous transaction.
  });
}

export async function previousWorkspace() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('workspace', 'readonly').objectStore('workspace').get('previous');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}
