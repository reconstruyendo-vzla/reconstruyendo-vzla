import { NextRequest, NextResponse } from 'next/server'
import { ratelimit } from '@/lib/ratelimit'
import { validatePersona, validateZona, validateRefugio, validateDonacion, validateVoluntario, validateMascota, validateAliado, sanitize } from '@/lib/validate'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'anonymous'
    const { success } = await ratelimit.limit(ip)

    if (!success) {
      return NextResponse.json(
        { error: `Límite alcanzado. Máximo 5 reportes por hora. Intenta de nuevo más tarde.` },
        { status: 429 }
      )
    }

    const body = await req.json()
    const { table, data } = body

    let errors: string[] = []

    if (table === 'personas') errors = validatePersona(data)
    else if (table === 'zonas') errors = validateZona(data)
    else if (table === 'refugios') errors = validateRefugio(data)
    else if (table === 'donaciones') errors = validateDonacion(data)
    else if (table === 'voluntarios') errors = validateVoluntario(data)
    else if (table === 'mascotas') errors = validateMascota(data)
    else if (table === 'aliados') errors = validateAliado(data)
    else return NextResponse.json({ error: 'Tabla no válida' }, { status: 400 })

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(', ') }, { status: 400 })
    }

    const sanitized = {
      ...data,
      nombre: data.nombre ? sanitize(data.nombre) : undefined,
      descripcion: data.descripcion ? sanitize(data.descripcion) : undefined,
      contacto: data.contacto ? sanitize(data.contacto) : undefined,
      contactoNombre: data.contactoNombre ? sanitize(data.contactoNombre) : undefined,
      ubicacion: data.ubicacion ? sanitize(data.ubicacion) : undefined,
      hospital: data.hospital ? sanitize(data.hospital) : undefined,
      direccion: data.direccion ? sanitize(data.direccion) : undefined,
      municipio: data.municipio ? sanitize(data.municipio) : undefined,
      mensaje: data.mensaje ? sanitize(data.mensaje) : undefined,
      pais: data.pais ? sanitize(data.pais) : undefined,
      telefono: data.telefono ? sanitize(data.telefono) : undefined,
    }

    const { data: result, error } = await supabase
      .from(table)
      .insert(sanitized)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: result })
  } catch {
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
