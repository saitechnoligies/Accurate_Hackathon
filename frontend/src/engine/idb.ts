/* Tiny IndexedDB key-value store for photos and ticket files (too big for localStorage).
   Falls back to an in-memory map when IndexedDB is unavailable (private mode, previews). */
const DB = 'delayproof-files'
const STORE = 'files'
const mem = new Map<string, string>()

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function putFile(id: string, dataUrl: string): Promise<void> {
  mem.set(id, dataUrl)
  try {
    await tx('readwrite', (s) => s.put(dataUrl, id))
  } catch {
    /* memory only */
  }
}

export async function getFile(id: string): Promise<string | undefined> {
  if (mem.has(id)) return mem.get(id)
  try {
    const v = await tx<string | undefined>('readonly', (s) => s.get(id) as IDBRequest<string | undefined>)
    if (v) mem.set(id, v)
    return v
  } catch {
    return undefined
  }
}

export async function delFile(id: string): Promise<void> {
  mem.delete(id)
  try {
    await tx('readwrite', (s) => s.delete(id))
  } catch {
    /* ignore */
  }
}
