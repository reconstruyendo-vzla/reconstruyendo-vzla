export async function initOneSignal() {
  if (typeof window === 'undefined') return
  try {
    const OneSignal = (await import('react-onesignal')).default
    await OneSignal.init({
      appId: process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID!,
      allowLocalhostAsSecureOrigin: true,
      notifyButton: { enable: false },
    } as unknown as Parameters<typeof OneSignal.init>[0])
  } catch (e) {
    console.error('OneSignal init error:', e)
  }
}

export async function notifyZonaCritica(nombre: string, ubicacion: string) {
  try {
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Zona Crítica Reportada',
        message: `${nombre} — ${ubicacion}. Personas necesitan ayuda urgente.`,
        url: 'https://reconstruyendovzla.com',
      }),
    })
  } catch (e) {
    console.error('Notify error:', e)
  }
}
