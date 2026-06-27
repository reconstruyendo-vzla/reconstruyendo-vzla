import { NextRequest, NextResponse } from 'next/server'
import { notifyRatelimit, checkRateLimit } from '@/lib/ratelimit'
import { getClientIp, sanitizeNotifyText, sanitizeNotifyUrl } from '@/lib/api-security'

export async function POST(req: NextRequest) {
  try {
    if (!process.env.ONESIGNAL_REST_API_KEY || !process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID) {
      return NextResponse.json({ error: 'Servicio no disponible' }, { status: 503 })
    }

    const ip = getClientIp(req)
    const { success, limited } = await checkRateLimit(notifyRatelimit, ip)

    if (!success) {
      const msg = limited
        ? 'Límite de notificaciones alcanzado.'
        : 'Servicio temporalmente no disponible.'
      return NextResponse.json({ error: msg }, { status: limited ? 429 : 503 })
    }

    const body = await req.json()
    const title = sanitizeNotifyText(body.title, 100)
    const message = sanitizeNotifyText(body.message, 500)
    const url = sanitizeNotifyUrl(body.url)

    if (!title || !message) {
      return NextResponse.json({ error: 'Título y mensaje son obligatorios' }, { status: 400 })
    }

    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${process.env.ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify({
        app_id: process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID,
        included_segments: ['All'],
        headings: { en: title },
        contents: { en: message },
        url,
      }),
    })

    if (!response.ok) {
      console.error('OneSignal error:', response.status)
      return NextResponse.json({ error: 'No se pudo enviar la notificación' }, { status: 502 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
