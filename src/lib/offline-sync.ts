import { supabase } from '@/lib/supabase'
import {
  IDB,
  addQ,
  getQ,
  setQ,
  isSupabaseTable,
  type BaseRecord,
  type QueueItem,
  type QueueNotify,
  type SupabaseTable,
} from '@/lib/idb-store'

const SYNC_TABLES: SupabaseTable[] = [
  'personas',
  'zonas',
  'mascotas',
  'voluntarios',
  'donaciones',
  'refugios',
  'aliados',
]

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

export function notificacionZonaCritica(item: BaseRecord): QueueNotify {
  const estado = String(item.estado_vzla ?? item.estado ?? '')
  const pais = String(item.pais ?? 'Venezuela')
  return {
    title: '🚨 Zona Crítica',
    message: `${item.nombre} en ${estado}, ${pais} — ayuda urgente`,
    url: 'https://reconstruyendovzla.com',
  }
}

export async function enviarNotificacion(payload: QueueNotify): Promise<boolean> {
  if (!navigator.onLine) return false
  try {
    const res = await withTimeout(
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: payload.title,
          message: payload.message,
          url: payload.url ?? 'https://reconstruyendovzla.com',
        }),
      }),
      15000
    )
    return res?.ok ?? false
  } catch (e) {
    console.error('enviarNotificacion error:', e)
    return false
  }
}

export async function syncFromSupabase(): Promise<number> {
  if (!navigator.onLine) return 0
  let count = 0
  for (const table of SYNC_TABLES) {
    const result = await withTimeout(
      (async () =>
        supabase
          .from(table)
          .select('id, record, created_at')
          .order('created_at', { ascending: false })
          .limit(500)
      )(),
      15000
    )
    if (!result || result.error) {
      if (result?.error) console.error('syncFromSupabase', table, result.error.message)
      continue
    }

    for (const row of result.data || []) {
      const record =
        row.record && typeof row.record === 'object' && !Array.isArray(row.record)
          ? (row.record as BaseRecord)
          : ({} as BaseRecord)
      const item: BaseRecord = {
        ...record,
        id: row.id,
        ts: record.ts || row.created_at || new Date().toISOString(),
        _off: false,
      }
      await IDB.put(table, item)
      count++
    }
  }
  return count
}

async function publicarItem(item: QueueItem): Promise<void> {
  if (!isSupabaseTable(item.table)) return

  if (item.action === 'update' && item.id && item.patch) {
    const local = await IDB.get(item.table, item.id)
    const base = local || (item.data as BaseRecord | undefined)
    if (!base) throw new Error('registro no encontrado')
    const updated = { ...base, ...item.patch }
    const { error } = await supabase.from(item.table).upsert({ id: item.id, record: updated })
    if (error) throw error
    await IDB.put(item.table, { ...updated, _off: false })
    return
  }

  const data = item.data
  if (!data?.id) throw new Error('datos inválidos en cola')

  const row = { id: data.id, record: data }
  const { error } =
    item.action === 'upsert' || item.action === 'update'
      ? await supabase.from(item.table).upsert(row)
      : await supabase.from(item.table).insert(row)
  if (error) throw error
  await IDB.put(item.table, { ...data, _off: false })
}

export async function processQueue(): Promise<{ synced: number; failed: number; notified: number }> {
  if (!navigator.onLine) return { synced: 0, failed: getQ().length, notified: 0 }

  const queue = getQ()
  if (!queue.length) return { synced: 0, failed: 0, notified: 0 }

  const remaining: QueueItem[] = []
  let synced = 0
  let notified = 0

  for (const item of queue) {
    try {
      if (item.table === 'zona_asistentes') {
        synced++
        continue
      }
      await publicarItem(item)
      if (item.notify) {
        const ok = await enviarNotificacion(item.notify)
        if (ok) notified++
      }
      synced++
    } catch (e) {
      console.error('processQueue item error:', item.table, e)
      remaining.push(item)
    }
  }

  setQ(remaining)
  return { synced, failed: remaining.length, notified }
}

export async function sincronizarTodo(): Promise<{
  downloaded: number
  synced: number
  failed: number
  notified: number
}> {
  if (!navigator.onLine) {
    return { downloaded: 0, synced: 0, failed: getQ().length, notified: 0 }
  }
  const { synced, failed, notified } = await processQueue()
  const downloaded = await syncFromSupabase()
  return { downloaded, synced, failed, notified }
}

export { addQ, getQ }
