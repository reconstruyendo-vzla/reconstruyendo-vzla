export type OneSignalSDK = {
  init: (opts: Record<string, unknown>) => Promise<void>
  Notifications: {
    isPushSupported: () => Promise<boolean>
    permission: boolean
    requestPermission: () => Promise<boolean>
  }
  User: {
    PushSubscription: {
      optedIn: boolean
      id?: string | null
    }
  }
  Slidedown: {
    promptPush: (opts?: { force?: boolean }) => Promise<void>
  }
}

const ONESIGNAL_WORKER = 'push/onesignal/OneSignalSDKWorker.js'
const ONESIGNAL_SCOPE = '/push/onesignal/'
const PUSH_OK_KEY = 'rvzla_push_ok'

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

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

export function puedeAlertasEnNavegador(): boolean {
  return !needsIOSInstallStep()
}

export function permisoNativoConcedido(): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  return Notification.permission === 'granted' || localStorage.getItem(PUSH_OK_KEY) === '1'
}

export function initOneSignalSDK(): void {
  if (typeof window === 'undefined') return
  window.OneSignalDeferred = window.OneSignalDeferred || []
  window.OneSignalDeferred.push(async (OneSignal) => {
    const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID
    if (!appId) return

    try {
      await OneSignal.init({
        appId,
        allowLocalhostAsSecureOrigin: true,
        notifyButton: { enable: false },
        serviceWorkerPath: ONESIGNAL_WORKER,
        serviceWorkerUpdaterPath: 'push/onesignal/OneSignalSDKUpdaterWorker.js',
        serviceWorkerParam: { scope: ONESIGNAL_SCOPE },
        promptOptions: {
          slidedown: {
            prompts: [{
              type: 'push',
              autoPrompt: false,
              text: {
                actionMessage: '¿Recibir alertas de zonas críticas?',
                acceptButton: 'Sí',
                cancelButton: 'No',
              },
            }],
          },
        },
      })
      if (permisoNativoConcedido()) {
        OneSignal.Notifications.requestPermission().catch(() => {})
      }
    } catch (e) {
      console.error('OneSignal init:', e)
    }
  })
}

export async function estaSuscritoPush(): Promise<boolean> {
  if (permisoNativoConcedido()) return true
  const OS = await withTimeout(waitForOneSignal(4000), 4000, null)
  if (!OS) return false
  try {
    return Boolean(OS.User.PushSubscription.optedIn)
  } catch {
    return false
  }
}

async function waitForOneSignal(maxMs: number): Promise<OneSignalSDK | null> {
  if (typeof window === 'undefined') return null
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    if (window.OneSignal) return window.OneSignal
    await new Promise((r) => setTimeout(r, 150))
  }
  return window.OneSignal ?? null
}

/** Permiso nativo del navegador — funciona en Chrome/Android sin esperar OneSignal */
export async function activarNotificacionesPush(): Promise<'ok' | 'denied' | 'unsupported' | 'ios-install'> {
  if (needsIOSInstallStep()) return 'ios-install'

  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'

  if (Notification.permission === 'granted') {
    localStorage.setItem(PUSH_OK_KEY, '1')
    vincularOneSignalEnFondo()
    return 'ok'
  }

  if (Notification.permission === 'denied') return 'denied'

  try {
    const perm = await withTimeout(
      Notification.requestPermission(),
      8000,
      'denied' as NotificationPermission
    )
    if (perm === 'granted') {
      localStorage.setItem(PUSH_OK_KEY, '1')
      vincularOneSignalEnFondo()
      return 'ok'
    }
    return 'denied'
  } catch {
    return 'denied'
  }
}

function vincularOneSignalEnFondo() {
  waitForOneSignal(20000).then((OS) => {
    if (!OS) return
    OS.Notifications.requestPermission().catch(() => {})
  })
}

declare global {
  interface Window {
    OneSignalDeferred?: Array<(OneSignal: OneSignalSDK) => void | Promise<void>>
    OneSignal?: OneSignalSDK
  }
}
