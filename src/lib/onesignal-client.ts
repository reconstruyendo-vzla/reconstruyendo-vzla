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

export function needsIOSInstallStep(): boolean {
  return isIOSDevice() && !isStandalonePWA()
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
              autoPrompt: !needsIOSInstallStep(),
              text: {
                actionMessage: 'Recibe alertas EN VIVO de zonas críticas en Venezuela',
                acceptButton: 'Activar alertas',
                cancelButton: 'Ahora no',
              },
              delay: { pageViews: 1, timeDelay: 4 },
            },
          ],
        },
      },
    })
  })
}

export async function waitForOneSignal(maxMs = 10000): Promise<OneSignalSDK | null> {
  if (typeof window === 'undefined') return null
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const os = window.OneSignal
    if (os) return os
    await new Promise((r) => setTimeout(r, 250))
  }
  return window.OneSignal ?? null
}

export async function activarNotificacionesPush(): Promise<'ok' | 'denied' | 'unsupported' | 'ios-install'> {
  if (needsIOSInstallStep()) return 'ios-install'

  const OneSignal = await waitForOneSignal()
  if (!OneSignal) return 'unsupported'

  const supported = await OneSignal.Notifications.isPushSupported()
  if (!supported) return 'unsupported'

  try {
    await OneSignal.Slidedown.promptPush({ force: true })
  } catch {
    /* slidedown opcional */
  }

  const granted = await OneSignal.Notifications.requestPermission()
  return granted ? 'ok' : 'denied'
}

export async function estaSuscritoPush(): Promise<boolean> {
  const OneSignal = await waitForOneSignal(5000)
  if (!OneSignal) return false
  return Boolean(OneSignal.User.PushSubscription.optedIn)
}

declare global {
  interface Window {
    OneSignalDeferred?: Array<(OneSignal: OneSignalSDK) => void | Promise<void>>
    OneSignal?: OneSignalSDK
  }
}
