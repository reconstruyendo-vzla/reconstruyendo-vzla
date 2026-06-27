import type { NextRequest } from 'next/server'
import { sanitize } from '@/lib/validate'

export const REPORT_TABLES = [
  'personas',
  'zonas',
  'refugios',
  'donaciones',
  'voluntarios',
  'mascotas',
  'aliados',
] as const

export type ReportTable = (typeof REPORT_TABLES)[number]

export function isReportTable(table: unknown): table is ReportTable {
  return typeof table === 'string' && (REPORT_TABLES as readonly string[]).includes(table)
}

export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'anonymous'
  return req.headers.get('x-real-ip')?.trim() || 'anonymous'
}

function asString(v: unknown, max = 5000): string | undefined {
  if (typeof v !== 'string') return undefined
  return sanitize(v).slice(0, max)
}

function asNumber(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : undefined
}

function asBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  return undefined
}

function asStringArray(v: unknown, maxItems = 30, maxLen = 120): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v
    .filter((x): x is string => typeof x === 'string')
    .slice(0, maxItems)
    .map(s => sanitize(s).slice(0, maxLen))
    .filter(Boolean)
}

/** Whitelist de campos permitidos por tabla — evita mass assignment */
export function buildReportRecord(table: ReportTable, data: Record<string, unknown>) {
  const base = {
    id: asString(data.id, 80),
    ts: asString(data.ts, 40),
    _off: asBool(data._off),
  }

  switch (table) {
    case 'personas':
      return {
        ...base,
        nombre: asString(data.nombre, 200),
        contacto: asString(data.contacto, 120),
        cat: asString(data.cat, 80),
        descripcion: asString(data.descripcion, 2000),
        ubicacion: asString(data.ubicacion, 300),
        hospital: asString(data.hospital, 200),
        estado: asString(data.estado, 40),
        foto: asString(data.foto, 500000),
        lat: asNumber(data.lat),
        lng: asNumber(data.lng),
      }
    case 'zonas':
      return {
        ...base,
        nombre: asString(data.nombre, 300),
        contacto: asString(data.contacto, 120),
        urgencia: asString(data.urgencia, 40),
        descripcion: asString(data.descripcion, 3000),
        lat: asNumber(data.lat),
        lng: asNumber(data.lng),
      }
    case 'refugios':
      return {
        ...base,
        nombre: asString(data.nombre, 300),
        contacto: asString(data.contacto, 120),
        direccion: asString(data.direccion, 400),
        municipio: asString(data.municipio, 120),
        capacidad: asNumber(data.capacidad),
        ocupacion: asNumber(data.ocupacion),
        necesidades: asStringArray(data.necesidades),
        lat: asNumber(data.lat),
        lng: asNumber(data.lng),
      }
    case 'donaciones':
      return {
        ...base,
        monto: asString(data.monto, 20),
        moneda: asString(data.moneda, 10),
        metodo: asString(data.metodo, 40),
        nombre: asString(data.nombre, 200),
        mensaje: asString(data.mensaje, 1000),
        comprobante: asString(data.comprobante, 500000),
        verificado: false,
      }
    case 'voluntarios':
      return {
        ...base,
        nombre: asString(data.nombre, 200),
        contacto: asString(data.contacto, 120),
        especialidades: asStringArray(data.especialidades, 20, 80),
        pais: asString(data.pais, 80),
        ciudad: asString(data.ciudad, 120),
        remoto: asBool(data.remoto) ?? false,
        idiomas: asStringArray(data.idiomas, 10, 40),
        bio: asString(data.bio, 2000),
        lat: asNumber(data.lat),
        lng: asNumber(data.lng),
        estado: asString(data.estado, 40) || 'disponible',
      }
    case 'mascotas':
      return {
        ...base,
        ubicacion: asString(data.ubicacion, 300),
        contacto: asString(data.contacto, 120),
        descripcion: asString(data.descripcion, 2000),
        tipo: asString(data.tipo, 80),
        estado: asString(data.estado, 40),
        foto: asString(data.foto, 500000),
        lat: asNumber(data.lat),
        lng: asNumber(data.lng),
      }
    case 'aliados':
      return {
        ...base,
        nombre: asString(data.nombre, 200),
        pais: asString(data.pais, 80),
        logo: asString(data.logo, 500000) || '',
        tipo: data.tipo === 'match' ? 'match' : 'fijo',
        porcentaje: asNumber(data.porcentaje),
        hasta: asNumber(data.hasta),
        montoFijo: asNumber(data.montoFijo),
        aportado: 0,
        contactoNombre: asString(data.contactoNombre, 200),
        contacto: asString(data.contacto, 120),
        descripcion: asString(data.descripcion, 1000),
        verificado: false,
      }
  }
}

const ALLOWED_NOTIFY_HOSTS = new Set([
  'reconstruyendovzla.com',
  'www.reconstruyendovzla.com',
])

export function sanitizeNotifyUrl(url: unknown): string {
  const fallback = 'https://reconstruyendovzla.com'
  if (typeof url !== 'string' || !url.trim()) return fallback
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return fallback
    if (!ALLOWED_NOTIFY_HOSTS.has(parsed.hostname)) return fallback
    return parsed.toString()
  } catch {
    return fallback
  }
}

export function sanitizeNotifyText(text: unknown, max: number): string {
  if (typeof text !== 'string') return ''
  return sanitize(text).slice(0, max)
}
