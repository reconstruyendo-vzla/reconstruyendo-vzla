import { NextRequest, NextResponse } from 'next/server'
import { ratelimit, checkRateLimit } from '@/lib/ratelimit'
import { validatePersona, validateZona, validateRefugio, validateDonacion, validateVoluntario, validateMascota, validateAliado } from '@/lib/validate'
import { buildReportRecord, getClientIp, isReportTable } from '@/lib/api-security'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
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
    const { table, data } = body

    if (!isReportTable(table)) {
      return NextResponse.json({ error: 'Tabla no válida' }, { status: 400 })
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
    }

    let errors: string[] = []

    if (table === 'personas') errors = validatePersona(data)
    else if (table === 'zonas') errors = validateZona(data)
    else if (table === 'refugios') errors = validateRefugio(data)
    else if (table === 'donaciones') errors = validateDonacion(data)
    else if (table === 'voluntarios') errors = validateVoluntario(data)
    else if (table === 'mascotas') errors = validateMascota(data)
    else if (table === 'aliados') errors = validateAliado(data)

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(', ') }, { status: 400 })
    }

    const sanitized = buildReportRecord(table, data as Record<string, unknown>)

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const row = {
      id: (sanitized as { id?: string }).id,
      record: sanitized,
    }

    const { data: result, error } = await supabase
      .from(table)
      .insert(row)
      .select()
      .single()

    if (error) {
      console.error('Supabase insert error:', error.message)
      return NextResponse.json({ error: 'No se pudo guardar el reporte' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: result })
  } catch {
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
