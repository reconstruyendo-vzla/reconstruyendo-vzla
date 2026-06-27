const ONESIGNAL_WORKER = 'push/onesignal/OneSignalSDKWorker.js'
const ONESIGNAL_SCOPE = '/push/onesignal/'
export const PUSH_OK_KEY = 'rvzla_push_ok'

let oneSignalInitStarted = false

export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export function needsIOSInstallStep(): boolean {
  return isIOSDevice() && !isStandalonePWA()
}

export function permisoNativoConcedido(): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  return Notification.permission === 'granted' || localStorage.getItem(PUSH_OK_KEY) === '1'
}

export function marcarPushActivo(): void {
  try {
    localStorage.setItem(PUSH_OK_KEY, '1')
  } catch {
    /* ignore */
  }
  iniciarOneSignalCuandoListo()
}

/** Solo inicializa OneSignal — NUNCA pide permiso (evita bloqueos) */
export function iniciarOneSignalCuandoListo(): void {
  if (typeof window === 'undefined' || oneSignalInitStarted) return
  oneSignalInitStarted = true

  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID
  if (!appId) return

  window.OneSignalDeferred = window.OneSignalDeferred || []
  window.OneSignalDeferred.push(async (OneSignal) => {
    try {
      await OneSignal.init({
        appId,
        allowLocalhostAsSecureOrigin: true,
        notifyButton: { enable: false },
        serviceWorkerPath: ONESIGNAL_WORKER,
        serviceWorkerUpdaterPath: 'push/onesignal/OneSignalSDKUpdaterWorker.js',
        serviceWorkerParam: { scope: ONESIGNAL_SCOPE },
        promptOptions: { slidedown: { prompts: [{ type: 'push', autoPrompt: false }] } },
      })
      if (permisoNativoConcedido()) {
        OneSignal.Notifications.requestPermission().catch(() => {})
      }
    } catch (e) {
      console.error('OneSignal init:', e)
    }
  })

  if (!document.querySelector('script[src*="OneSignalSDK.page"]')) {
    const s = document.createElement('script')
    s.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'
    s.defer = true
    document.head.appendChild(s)
  }
}

/**
 * Pide permiso SOLO con API nativa — sincrónico al clic del usuario.
 * Devuelve al instante; no usar await largo.
 */
export function pedirPermisoNotificaciones(
  onResult: (ok: boolean) => void
): void {
  if (needsIOSInstallStep()) {
    onResult(false)
    return
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    onResult(false)
    return
  }

  if (Notification.permission === 'granted') {
    marcarPushActivo()
    onResult(true)
    return
  }

  if (Notification.permission === 'denied') {
    onResult(false)
    return
  }

  Notification.requestPermission()
    .then((perm) => {
      if (perm === 'granted') {
        marcarPushActivo()
        onResult(true)
      } else {
        onResult(false)
      }
    })
    .catch(() => onResult(false))
}

export function vigilarPermisoNotificaciones(onGranted: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  let done = false
  const check = () => {
    if (done) return
    if (Notification.permission === 'granted') {
      done = true
      marcarPushActivo()
      onGranted()
    }
  }

  check()
  const interval = setInterval(check, 400)

  let permStatus: PermissionStatus | null = null
  if ('permissions' in navigator) {
    navigator.permissions.query({ name: 'notifications' as PermissionName }).then((s) => {
      permStatus = s
      s.onchange = check
    }).catch(() => {})
  }

  return () => {
    clearInterval(interval)
    if (permStatus) permStatus.onchange = null
  }
}

declare global {
  interface Window {
    OneSignalDeferred?: Array<(os: {
      init: (o: Record<string, unknown>) => Promise<void>
      Notifications: { requestPermission: () => Promise<boolean> }
    }) => void | Promise<void>>
    OneSignal?: {
      Notifications: { requestPermission: () => Promise<boolean> }
    }
  }
}
