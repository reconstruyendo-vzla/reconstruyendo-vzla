/** La app detecta señal sola — sin configuración del usuario */

type Listener = (online: boolean) => void

let ultimoEstado: boolean | null = null
const oyentes = new Set<Listener>()
let vigilanciaActiva = false

export async function hayInternetReal(): Promise<boolean> {
  if (typeof window === 'undefined') return false

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const probes: Promise<boolean>[] = []

  if (url && key) {
    probes.push(
      (async () => {
        try {
          const ctrl = new AbortController()
          const t = setTimeout(() => ctrl.abort(), 4500)
          const res = await fetch(`${url}/rest/v1/`, {
            method: 'HEAD',
            headers: { apikey: key, Authorization: `Bearer ${key}` },
            signal: ctrl.signal,
            cache: 'no-store',
          })
          clearTimeout(t)
          return res.status > 0 && res.status < 500
        } catch {
          return false
        }
      })()
    )
  }

  probes.push(
    (async () => {
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 3500)
        await fetch(`${window.location.origin}/favicon.ico`, {
          method: 'HEAD',
          signal: ctrl.signal,
          cache: 'no-store',
        })
        clearTimeout(t)
        return true
      } catch {
        return false
      }
    })()
  )

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
