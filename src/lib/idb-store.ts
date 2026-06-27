export type StoreName =
  | 'personas'
  | 'mascotas'
  | 'zonas'
  | 'voluntarios'
  | 'donaciones'
  | 'refugios'
  | 'aliados'
  | 'voluntarios_rec'
  | 'alertas_mesh'

export type SupabaseTable = Exclude<StoreName, 'voluntarios_rec'>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BaseRecord = { id: string; ts?: string; _off?: boolean; [key: string]: any }

export type QueuePatch = Record<string, unknown>

export type QueueNotify = { title: string; message: string; url?: string }

export type QueueItem = {
  table: string
  action: string
  data?: BaseRecord
  id?: string
  patch?: QueuePatch
  notify?: QueueNotify
}

const QUEUE_KEY = 'crisisve_queue_v3'

export const IDB = {
  db: null as IDBDatabase | null,
  async open(): Promise<IDBDatabase> {
    if (this.db) return this.db
    return new Promise((res, rej) => {
      const req = indexedDB.open('crisisve_v3', 4)
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result
        ;(['personas', 'mascotas', 'zonas', 'voluntarios', 'donaciones', 'refugios', 'aliados', 'voluntarios_rec', 'alertas_mesh'] as StoreName[]).forEach((s) => {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' })
        })
      }
      req.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result
        res(this.db)
      }
      req.onerror = () => rej(req.error)
    })
  },
  async getAll(store: StoreName): Promise<BaseRecord[]> {
    const db = await this.open()
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readonly')
      const req = tx.objectStore(store).getAll()
      req.onsuccess = () =>
        res(((req.result as BaseRecord[]) || []).sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || ''))))
      req.onerror = () => rej(req.error)
    })
  },
  async get(store: StoreName, id: string): Promise<BaseRecord | undefined> {
    const db = await this.open()
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readonly')
      const req = tx.objectStore(store).get(id)
      req.onsuccess = () => res(req.result as BaseRecord | undefined)
      req.onerror = () => rej(req.error)
    })
  },
  async put(store: StoreName, item: BaseRecord): Promise<BaseRecord> {
    const db = await this.open()
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).put(item)
      tx.oncomplete = () => res(item)
      tx.onerror = () => rej(tx.error)
    })
  },
  async patch(store: StoreName, id: string, patch: Record<string, unknown>): Promise<BaseRecord> {
    const db = await this.open()
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite')
      const s = tx.objectStore(store)
      const req = s.get(id)
      req.onsuccess = () => {
        const u = { ...(req.result as BaseRecord), ...patch }
        s.put(u)
        res(u)
      }
      req.onerror = () => rej(req.error)
    })
  },
  async delete(store: StoreName, id: string): Promise<void> {
    const db = await this.open()
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).delete(id)
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  },
}

export function addQ(item: QueueItem) {
  try {
    const q = getQ()
    q.push(item)
    setQ(q)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('crisisve-queue'))
    }
  } catch {
    /* ignore */
  }
}

export function getQ(): QueueItem[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') as QueueItem[]
  } catch {
    return []
  }
}

export function setQ(items: QueueItem[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items))
}

export function clearQ() {
  localStorage.removeItem(QUEUE_KEY)
}

export function isSupabaseTable(table: string): table is SupabaseTable {
  return ['personas', 'mascotas', 'zonas', 'voluntarios', 'donaciones', 'refugios', 'aliados'].includes(table)
}
