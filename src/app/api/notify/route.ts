import { NextRequest, NextResponse } from 'next/server'
import { notifyRatelimit, checkRateLimit } from '@/lib/ratelimit'
import { getClientIp, sanitizeNotifyText, sanitizeNotifyUrl } from '@/lib/api-security'

export async function POST(req: NextRequest) {
  try {
    if (!process.env.ONESIGNAL_REST_API_KEY || !process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID) {
      console.error('Notify: faltan ONESIGNAL_REST_API_KEY o NEXT_PUBLIC_ONESIGNAL_APP_ID')
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
        headings: { en: title, es: title },
        contents: { en: message, es: message },
        url,
      }),
    })

    const result = await response.json().catch(() => ({})) as { errors?: string[]; id?: string }

    if (!response.ok) {
      console.error('OneSignal error:', response.status, result)
      const detail = result.errors?.[0] || 'No se pudo enviar la notificación'
      return NextResponse.json({ error: detail }, { status: 502 })
    }

    return NextResponse.json({ success: true, id: result.id })
  } catch (e) {
    console.error('Notify internal error:', e)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
