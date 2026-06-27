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
      addEventListener: (event: string, cb: (e: { current: { optedIn?: boolean; id?: string } }) => void) => void
    }
  }
  Slidedown: {
    promptPush: (opts?: { force?: boolean }) => Promise<void>
  }
}

const ONESIGNAL_WORKER = 'push/onesignal/OneSignalSDKWorker.js'
const ONESIGNAL_SCOPE = '/push/onesignal/'

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

/** iOS Safari en pestaña normal: Apple exige añadir a inicio. Android/Chrome NO necesitan instalar. */
export function needsIOSInstallStep(): boolean {
  return isIOSDevice() && !isStandalonePWA()
}

export function puedeAlertasEnNavegador(): boolean {
  return !needsIOSInstallStep()
}

export function registerOneSignalDeferred(cb: (OneSignal: OneSignalSDK) => void | Promise<void>) {
  if (typeof window === 'undefined') return
  window.OneSignalDeferred = window.OneSignalDeferred || []
  window.OneSignalDeferred.push(cb)
}

export function initOneSignalSDK(): void {
  registerOneSignalDeferred(async (OneSignal) => {
    const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID
    if (!appId) {
      console.error('OneSignal: falta NEXT_PUBLIC_ONESIGNAL_APP_ID')
      return
    }

    const enNavegador = puedeAlertasEnNavegador()

    await OneSignal.init({
      appId,
      allowLocalhostAsSecureOrigin: true,
      notifyButton: { enable: false },
      serviceWorkerPath: ONESIGNAL_WORKER,
      serviceWorkerUpdaterPath: 'push/onesignal/OneSignalSDKUpdaterWorker.js',
      serviceWorkerParam: { scope: ONESIGNAL_SCOPE },
      promptOptions: {
        slidedown: {
          prompts: [
            {
              type: 'push',
              autoPrompt: enNavegador,
              text: {
                actionMessage: 'EMERGENCIA: ¿Recibir alertas de zonas críticas en Venezuela?',
                acceptButton: 'Sí, activar',
                cancelButton: 'No',
              },
              delay: { pageViews: 1, timeDelay: 1 },
            },
          ],
        },
      },
    })
  })
}

export async function waitForOneSignal(maxMs = 12000): Promise<OneSignalSDK | null> {
  if (typeof window === 'undefined') return null
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const os = window.OneSignal
    if (os) return os
    await new Promise((r) => setTimeout(r, 200))
  }
  return window.OneSignal ?? null
}

export async function estaSuscritoPush(): Promise<boolean> {
  const OneSignal = await waitForOneSignal(6000)
  if (!OneSignal) return false
  try {
    return Boolean(OneSignal.User.PushSubscription.optedIn)
  } catch {
    return false
  }
}

export async function activarNotificacionesPush(): Promise<'ok' | 'denied' | 'unsupported' | 'ios-install'> {
  if (needsIOSInstallStep()) return 'ios-install'

  const OneSignal = await waitForOneSignal()
  if (!OneSignal) return 'unsupported'

  const supported = await OneSignal.Notifications.isPushSupported()
  if (!supported) return 'unsupported'

  const granted = await OneSignal.Notifications.requestPermission()
  if (granted) return 'ok'

  try {
    await OneSignal.Slidedown.promptPush({ force: true })
    const retry = await OneSignal.Notifications.requestPermission()
    return retry ? 'ok' : 'denied'
  } catch {
    return 'denied'
  }
}

/** Pide permiso si aún no está suscrito — para emergencias al primer toque */
export async function asegurarAlertasEmergencia(): Promise<boolean> {
  if (await estaSuscritoPush()) return true
  if (!puedeAlertasEnNavegador()) return false
  return (await activarNotificacionesPush()) === 'ok'
}

export function escucharPrimerToqueParaAlertas(onActivado?: () => void) {
  if (typeof document === 'undefined' || needsIOSInstallStep()) return () => {}

  const handler = async () => {
    const ok = await asegurarAlertasEmergencia()
    if (ok) onActivado?.()
  }

  document.addEventListener('click', handler, { once: true, capture: true })
  document.addEventListener('touchend', handler, { once: true, capture: true })

  return () => {
    document.removeEventListener('click', handler, { capture: true })
    document.removeEventListener('touchend', handler, { capture: true })
  }
}

declare global {
  interface Window {
    OneSignalDeferred?: Array<(OneSignal: OneSignalSDK) => void | Promise<void>>
    OneSignal?: OneSignalSDK
  }
}
