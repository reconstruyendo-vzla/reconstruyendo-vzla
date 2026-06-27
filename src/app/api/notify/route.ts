import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { title, message, url } = await req.json()
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${process.env.ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify({
        app_id: process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID,
        included_segments: ['All'],
        headings: { en: title },
        contents: { en: message },
        url: url || 'https://reconstruyendovzla.com',
      }),
    })
    const data = await response.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: 'Error sending notification' }, { status: 500 })
  }
}
