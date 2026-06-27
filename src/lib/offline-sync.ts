import { hayInternetReal } from '@/lib/network'
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
  if (!(await hayInternetReal())) return false
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

/** Sube un reporte a Supabase — visible en todos los dispositivos */
export async function publicarEnServidor(
  table: SupabaseTable,
  data: BaseRecord,
  mode: 'insert' | 'upsert' = 'upsert'
): Promise<boolean> {
  const row = { id: String(data.id), record: data }
  const req =
    mode === 'insert'
      ? supabase.from(table).insert(row)
      : supabase.from(table).upsert(row)

  const result = await withTimeout(Promise.resolve(req), 30000)
  if (!result) {
    console.error('publicarEnServidor', table, 'timeout')
    return false
  }
  if (!result.error) return true

  if (mode === 'insert') {
    const retry = await withTimeout(Promise.resolve(supabase.from(table).upsert(row)), 30000)
    if (!retry) {
      console.error('publicarEnServidor', table, 'timeout en reintento')
      return false
    }
    if (!retry.error) return true
    console.error('publicarEnServidor', table, retry.error.message)
    return false
  }

  console.error('publicarEnServidor', table, result.error.message)
  return false
}

export async function eliminarEnServidor(table: SupabaseTable, id: string): Promise<boolean> {
  const result = await withTimeout(Promise.resolve(supabase.from(table).delete().eq('id', id)), 15000)
  if (!result || result.error) {
    console.error('eliminarEnServidor', table, result?.error?.message)
    return false
  }
  return true
}

/** Sube reportes que quedaron solo en un dispositivo */
async function subirHuerfanosLocales(serverIds: Map<SupabaseTable, Set<string>>): Promise<number> {
  let subidos = 0
  for (const table of SYNC_TABLES) {
    const ids = serverIds.get(table) ?? new Set()
    const localAll = await IDB.getAll(table)
    for (const item of localAll) {
      if (ids.has(String(item.id))) continue
      const ok = await publicarEnServidor(table, item, 'upsert')
      if (ok) {
        await IDB.put(table, { ...item, _off: false })
        subidos++
      }
    }
  }
  return subidos
}

/** Descarga toda la red desde Supabase — siempre intenta si el navegador tiene conexión */
export async function syncFromSupabase(): Promise<number> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0

  let count = 0
  const serverIds = new Map<SupabaseTable, Set<string>>()

  for (const table of SYNC_TABLES) {
    const result = await withTimeout(
      Promise.resolve(
        supabase
          .from(table)
          .select('id, record, created_at')
          .order('created_at', { ascending: false })
          .limit(1000)
      ),
      30000
    )
    if (!result || result.error) {
      console.error('syncFromSupabase', table, result?.error?.message)
      serverIds.set(table, new Set())
      continue
    }

    const rows = result.data || []
    serverIds.set(table, new Set(rows.map((r) => r.id)))

    for (const row of rows) {
      const record =
        row.record && typeof row.record === 'object' && !Array.isArray(row.record)
          ? (row.record as BaseRecord)
          : ({} as BaseRecord)
      await IDB.put(table, {
        ...record,
        id: row.id,
        ts: record.ts || row.created_at || new Date().toISOString(),
        _off: false,
      })
      count++
    }
  }

  await subirHuerfanosLocales(serverIds)
  return count
}

async function publicarItem(item: QueueItem): Promise<void> {
  if (!isSupabaseTable(item.table)) return

  if (item.action === 'delete' && item.id) {
    const ok = await eliminarEnServidor(item.table, item.id)
    if (!ok) throw new Error('delete failed')
    return
  }

  if (item.action === 'update' && item.id && item.patch) {
    const local = await IDB.get(item.table, item.id)
    const base = local || (item.data as BaseRecord | undefined)
    if (!base) throw new Error('registro no encontrado')
    const updated = { ...base, ...item.patch }
    const ok = await publicarEnServidor(item.table, updated, 'upsert')
    if (!ok) throw new Error('update failed')
    await IDB.put(item.table, { ...updated, _off: false })
    return
  }

  const data = item.data
  if (!data?.id) throw new Error('datos inválidos en cola')

  const ok = await publicarEnServidor(
    item.table,
    data,
    item.action === 'insert' ? 'insert' : 'upsert'
  )
  if (!ok) throw new Error('insert failed')
  await IDB.put(item.table, { ...data, _off: false })
}

export async function processQueue(): Promise<{ synced: number; failed: number; notified: number }> {
  if (!(await hayInternetReal())) return { synced: 0, failed: getQ().length, notified: 0 }

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
  const puedeSubir = await hayInternetReal()
  const { synced, failed, notified } = puedeSubir
    ? await processQueue()
    : { synced: 0, failed: getQ().length, notified: 0 }
  const downloaded = await syncFromSupabase()
  return { downloaded, synced, failed, notified }
}

export { addQ, getQ }
