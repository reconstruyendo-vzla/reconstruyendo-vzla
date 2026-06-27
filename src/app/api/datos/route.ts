import { NextResponse } from 'next/server'
import { supabaseAdmin, TABLAS_PUBLICAS } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

/** Descarga pública de toda la red de coordinación — todos ven lo mismo */
export async function GET() {
  const sb = supabaseAdmin()
  if (!sb) {
    return NextResponse.json({ error: 'Servicio no disponible' }, { status: 503 })
  }

  const out: Record<string, unknown[]> = {}

  for (const table of TABLAS_PUBLICAS) {
    const { data, error } = await sb
      .from(table)
      .select('id, record, created_at')
      .order('created_at', { ascending: false })
      .limit(1000)

    if (error) {
      console.error('api/datos', table, error.message)
      out[table] = []
      continue
    }
    out[table] = data ?? []
  }

  return NextResponse.json(out, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
