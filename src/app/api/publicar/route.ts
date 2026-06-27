import { NextRequest, NextResponse } from 'next/server'
import { ratelimit, checkRateLimit } from '@/lib/ratelimit'
import { getClientIp, isReportTable } from '@/lib/api-security'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

/** Publica en la red central (service role) — visible para todo el mundo */
export async function POST(req: NextRequest) {
  try {
    const sb = supabaseAdmin()
    if (!sb) {
      return NextResponse.json({ error: 'Servicio no disponible' }, { status: 503 })
    }

    const ip = getClientIp(req)
    const { success, limited } = await checkRateLimit(ratelimit, ip)
    if (!success) {
      const msg = limited
        ? 'Límite alcanzado. Máximo 5 reportes por hora.'
        : 'Servicio temporalmente no disponible.'
      return NextResponse.json({ error: msg }, { status: limited ? 429 : 503 })
    }

    const body = await req.json()
    const { table, data, mode = 'upsert' } = body

    if (!isReportTable(table)) {
      return NextResponse.json({ error: 'Tabla no válida' }, { status: 400 })
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || !data.id) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
    }

    const row = { id: String(data.id), record: data }

    const { error } =
      mode === 'insert'
        ? await sb.from(table).insert(row)
        : await sb.from(table).upsert(row)

    if (error) {
      console.error('api/publicar', table, error.message)
      return NextResponse.json({ error: 'No se pudo publicar en la red' }, { status: 500 })
    }

    return NextResponse.json({ success: true, id: row.id })
  } catch (e) {
    console.error('api/publicar error:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sb = supabaseAdmin()
    if (!sb) {
      return NextResponse.json({ error: 'Servicio no disponible' }, { status: 503 })
    }

    const { searchParams } = new URL(req.url)
    const table = searchParams.get('table')
    const id = searchParams.get('id')

    if (!table || !id || !isReportTable(table)) {
      return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 })
    }

    const { error } = await sb.from(table).delete().eq('id', id)
    if (error) {
      console.error('api/publicar DELETE', table, error.message)
      return NextResponse.json({ error: 'No se pudo eliminar' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('api/publicar DELETE error:', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
