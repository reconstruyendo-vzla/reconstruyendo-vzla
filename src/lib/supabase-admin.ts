import { createClient } from '@supabase/supabase-js'
import type { SupabaseTable } from '@/lib/idb-store'

export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export const TABLAS_PUBLICAS: SupabaseTable[] = [
  'personas',
  'zonas',
  'mascotas',
  'voluntarios',
  'donaciones',
  'refugios',
  'aliados',
]
