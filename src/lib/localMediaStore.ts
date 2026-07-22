const DB_NAME = 'aime-scheduler-media';
const STORE_NAME = 'media';
const DB_VERSION = 1;

const openMediaDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Could not open local media storage.'));
});

const runStoreRequest = async <T,>(mode: IDBTransactionMode, runner: (store: IDBObjectStore) => IDBRequest<T>) => {
  const db = await openMediaDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = runner(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local media storage failed.'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error('Local media storage transaction failed.'));
    };
  });
};

export const saveLocalMedia = async (key: string, file: File) => {
  await runStoreRequest('readwrite', (store) => store.put(file, key));
};

export const deleteLocalMedia = async (key?: string | null) => {
  if (!key) return;
  await runStoreRequest('readwrite', (store) => store.delete(key));
};

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('Could not read local media.'));
  reader.readAsDataURL(blob);
});

export const getLocalMediaDataUrl = async (key?: string | null) => {
  if (!key) return '';
  const blob = await runStoreRequest<Blob | undefined>('readonly', (store) => store.get(key));
  return blob ? blobToDataUrl(blob) : '';
};
