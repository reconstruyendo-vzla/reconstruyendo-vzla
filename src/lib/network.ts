/** La app detecta señal sola — sin configuración del usuario */

type Listener = (online: boolean) => void

let ultimoEstado: boolean | null = null
const oyentes = new Set<Listener>()
let vigilanciaActiva = false

async function probarFetch(url: string, init?: RequestInit, timeoutMs = 6000): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(t)
    return res.ok || (res.status > 0 && res.status < 500)
  } catch {
    return false
  }
}

export async function hayInternetReal(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const probes: Promise<boolean>[] = []

  if (url && key) {
    probes.push(
      probarFetch(`${url}/rest/v1/personas?select=id&limit=1`, {
        method: 'GET',
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      })
    )
  }

  probes.push(probarFetch(`${window.location.origin}/`, { method: 'GET' }))

  const results = await Promise.all(probes)
  return results.some(Boolean)
}

export function suscribirConexion(cb: Listener): () => void {
  oyentes.add(cb)
  if (ultimoEstado !== null) cb(ultimoEstado)
  return () => oyentes.delete(cb)
}

function notificar(online: boolean) {
  if (ultimoEstado === online) return
  ultimoEstado = online
  oyentes.forEach((cb) => cb(online))
}

export async function verificarConexion(): Promise<boolean> {
  const online = await hayInternetReal()
  notificar(online)
  return online
}

export function estadoConexionConocido(): boolean | null {
  return ultimoEstado
}

/** Arranca vigilancia automática — cada 5 s y al volver a la app */
export function iniciarVigilanciaConexion(): void {
  if (typeof window === 'undefined' || vigilanciaActiva) return
  vigilanciaActiva = true

  const tick = () => {
    verificarConexion().catch(() => notificar(false))
  }

  tick()

  window.addEventListener('online', tick)
  window.addEventListener('offline', () => notificar(false))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick()
  })

  setInterval(tick, 5000)
}
