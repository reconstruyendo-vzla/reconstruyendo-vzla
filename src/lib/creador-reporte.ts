import type { BaseRecord } from '@/lib/idb-store'

const KEY = 'rvz_mis_contactos'

export function contactoDeReporte(item: BaseRecord): string {
  return String(item.contacto || item.reporta_contacto || '')
}

export function normalizarContacto(t: string): string {
  return t.replace(/\D/g, '').slice(-10)
}

function leerMisContactos(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function registrarCreador(contacto: string) {
  if (typeof window === 'undefined' || !contacto.trim()) return
  const n = normalizarContacto(contacto)
  if (n.length < 6) return
  const list = leerMisContactos()
  if (!list.includes(n)) {
    localStorage.setItem(KEY, JSON.stringify([...list, n]))
  }
}

export function registrarCreadorDesdeItem(item: BaseRecord) {
  registrarCreador(contactoDeReporte(item))
}

export function esCreadorDelReporte(item: BaseRecord): boolean {
  const c = normalizarContacto(contactoDeReporte(item))
  if (c.length < 6) return false
  return leerMisContactos().includes(c)
}
