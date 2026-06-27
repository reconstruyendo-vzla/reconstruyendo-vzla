import type { BaseRecord } from '@/lib/idb-store'

export type AlertaZona = {
  t: 'z'
  id: string
  n: string
  u: string
  e?: string
  la?: number | null
  ln?: number | null
  c: string
  cn?: string
  d?: string
  ts: string
  ins?: string[]
  ay?: string[]
  per?: string[]
}

export type AlertaPersona = {
  t: 'p'
  id: string
  n: string
  edad?: string
  cat?: string
  ub?: string
  la?: number | null
  ln?: number | null
  d?: string
  c?: string
  cn?: string
  h?: string
  s?: string
  ts: string
}

export type AlertaMesh = AlertaZona | AlertaPersona

const PREFIX = 'RVZ1:'

export function esPersona(item: BaseRecord): boolean {
  return typeof item.cat === 'string' && !item.urgencia
}

export function zonaAAlerta(item: BaseRecord): AlertaZona {
  return {
    t: 'z',
    id: String(item.id),
    n: String(item.nombre ?? ''),
    u: String(item.urgencia ?? 'critica'),
    e: item.estado ? String(item.estado) : undefined,
    la: item.lat ?? null,
    ln: item.lng ?? null,
    c: String(item.contacto ?? ''),
    cn: item.contactoNombre ? String(item.contactoNombre) : undefined,
    d: item.descripcion ? String(item.descripcion).slice(0, 200) : undefined,
    ts: String(item.ts ?? item.created_at ?? new Date().toISOString()),
    ins: item.insumos?.length ? [...item.insumos] : undefined,
    ay: item.ayuda?.length ? [...item.ayuda] : undefined,
    per: item.personal?.length ? [...item.personal] : undefined,
  }
}

export function personaAAlerta(item: BaseRecord): AlertaPersona {
  return {
    t: 'p',
    id: String(item.id),
    n: String(item.nombre ?? ''),
    edad: item.edad ? String(item.edad) : undefined,
    cat: item.cat ? String(item.cat) : undefined,
    ub: item.ubicacion ? String(item.ubicacion) : undefined,
    la: item.lat ?? null,
    ln: item.lng ?? null,
    d: item.descripcion ? String(item.descripcion).slice(0, 200) : undefined,
    c: item.contacto ? String(item.contacto) : undefined,
    cn: item.contactoNombre ? String(item.contactoNombre) : undefined,
    h: item.hospital ? String(item.hospital) : undefined,
    s: item.sala ? String(item.sala) : undefined,
    ts: String(item.ts ?? item.created_at ?? new Date().toISOString()),
  }
}

export function alertaAZona(a: AlertaZona): BaseRecord {
  return {
    id: a.id,
    ts: a.ts,
    nombre: a.n,
    urgencia: a.u,
    estado: a.e ?? '',
    estado_vzla: a.e ?? '',
    pais: 'Venezuela',
    lat: a.la ?? null,
    lng: a.ln ?? null,
    contacto: a.c,
    contactoNombre: a.cn ?? '',
    contacto_nombre: a.cn ?? '',
    descripcion: a.d ?? '',
    insumos: a.ins ?? [],
    ayuda: a.ay ?? [],
    personal: a.per ?? [],
    estado_zona: 'activa',
    _mesh: true,
    created_at: a.ts,
  }
}

export function alertaAPersona(a: AlertaPersona): BaseRecord {
  return {
    id: a.id,
    ts: a.ts,
    nombre: a.n,
    edad: a.edad ?? '',
    cat: a.cat ?? 'nino_sano',
    ubicacion: a.ub ?? '',
    pais: 'Venezuela',
    lat: a.la ?? null,
    lng: a.ln ?? null,
    descripcion: a.d ?? '',
    contacto: a.c ?? 'Rescatista en terreno',
    contactoNombre: a.cn ?? 'Rescatista',
    hospital: a.h ?? '',
    sala: a.s ?? '',
    estado: 'buscando',
    _mesh: true,
    created_at: a.ts,
  }
}

function toB64Url(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  return decodeURIComponent(escape(atob(b64 + pad)))
}

export function codificarRegistro(item: BaseRecord): string {
  const payload = esPersona(item) ? personaAAlerta(item) : zonaAAlerta(item)
  return PREFIX + toB64Url(JSON.stringify(payload))
}

/** @deprecated use codificarRegistro */
export function codificarAlerta(item: BaseRecord): string {
  return codificarRegistro(item)
}

export function decodificarRegistro(code: string): { table: 'personas' | 'zonas'; item: BaseRecord } | null {
  const raw = code.trim()
  if (!raw.startsWith(PREFIX)) return null
  try {
    const parsed = JSON.parse(fromB64Url(raw.slice(PREFIX.length))) as AlertaMesh
    if (parsed?.t === 'p' && parsed.n) {
      return { table: 'personas', item: alertaAPersona(parsed) }
    }
    if (parsed?.t === 'z' && parsed.n) {
      return { table: 'zonas', item: alertaAZona(parsed) }
    }
    return null
  } catch {
    return null
  }
}

/** @deprecated */
export function decodificarAlerta(code: string): AlertaZona | null {
  const r = decodificarRegistro(code)
  return r?.table === 'zonas' ? (r.item as unknown as AlertaZona) : null
}

const CAT_LABEL: Record<string, string> = {
  nino_sano: 'Niño/a sano',
  nino_hospital: 'Niño/a en hospital',
  adulto_sano: 'Adulto sano',
  adulto_hospital: 'Adulto en hospital',
}

const URG_LABEL: Record<string, string> = {
  critica: 'CRÍTICA',
  alta: 'ALTA',
  media: 'MEDIA',
}

export function textoCompartirRegistro(item: BaseRecord): string {
  if (esPersona(item)) {
    const lines = [
      '👤 PERSONA — RECONSTRUYENDO VZLA',
      item.estado === 'resuelto' ? '✓ RESUELTO — con familia' : '',
      `${CAT_LABEL[String(item.cat)] ?? 'Persona'}: ${item.nombre}`,
      item.edad ? `Edad: ${item.edad}` : '',
      item.nino_cedula ? `Cédula niño/a: ${item.nino_cedula}` : '',
      item.ubicacion ? `Ubicación: ${item.ubicacion}` : '',
      item.hospital ? `Hospital: ${item.hospital}${item.sala ? ` — ${item.sala}` : ''}` : '',
      item.descripcion ? `Señas: ${item.descripcion}` : '',
      item.lat != null && item.lng != null ? `Ubicación GPS: https://maps.google.com/?q=${item.lat},${item.lng}` : '',
      item.estado === 'resuelto' && item.lleva_nombre ? `Se va con: ${item.lleva_nombre} (${item.lleva_parentesco ?? ''})` : '',
      item.estado === 'resuelto' && item.lleva_cedula ? `Cédula quien recoge: ${item.lleva_cedula}` : '',
      item.estado === 'resuelto' && item.lleva_contacto ? `Tel. familiar: ${item.lleva_contacto}` : '',
      item.estado === 'resuelto' && item.destino ? `Destino: ${item.destino}` : '',
      `Contacto quien reporta: ${item.contactoNombre ?? ''} ${item.contacto ?? ''}`.trim(),
    ]
    return lines.filter(Boolean).join('\n')
  }

  const a = zonaAAlerta(item)
  const lines = [
    '🚨 ZONA DE CRISIS — RECONSTRUYENDO VZLA',
    `${URG_LABEL[a.u] ?? a.u.toUpperCase()}: ${a.n}`,
    a.e ? `Lugar: ${a.e}` : '',
    a.d ? `Situación: ${a.d}` : '',
    a.ay?.length ? `Necesita: ${a.ay.join(', ')}` : '',
    a.per?.length ? `Personal: ${a.per.join(', ')}` : '',
    a.ins?.length ? `Insumos: ${a.ins.join(', ')}` : '',
    a.la != null && a.ln != null ? `Ubicación: https://maps.google.com/?q=${a.la},${a.ln}` : '',
    `Contacto: ${a.cn ? `${a.cn} ` : ''}${a.c}`,
  ]
  return lines.filter(Boolean).join('\n')
}

/** @deprecated */
export function textoAlertaCompartir(item: BaseRecord): string {
  return textoCompartirRegistro(item)
}

export function numerosRescate(): string[] {
  const raw = process.env.NEXT_PUBLIC_NUMEROS_RESCATE ?? ''
  return raw
    .split(/[,;\s]+/)
    .map((n) => n.trim())
    .filter((n) => n.length >= 8)
}

export function urlSMS(body: string, nums?: string[]): string {
  const dest = (nums ?? numerosRescate()).join(',')
  const params = `body=${encodeURIComponent(body.slice(0, 900))}`
  return dest ? `sms:${dest}?${params}` : `sms:?${params}`
}

export async function compartirNativo(texto: string, titulo = '🚨 Reconstruyendo VZLA'): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.share) return false
  try {
    await navigator.share({ title: titulo, text: texto })
    return true
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return false
    return false
  }
}

export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}

export function avisarLocal(titulo: string, cuerpo: string): void {
  try {
    navigator.vibrate?.([300, 100, 300, 100, 300])
  } catch {
    /* ignore */
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(titulo, { body: cuerpo, tag: `rescate-${Date.now()}` })
    } catch {
      /* ignore */
    }
  }
}
