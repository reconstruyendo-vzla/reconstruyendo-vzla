export function validatePersona(data: any) {
  const errors: string[] = []
  if (!data.nombre || data.nombre.trim().length < 2) errors.push('Nombre inválido')
  if (!data.contacto || data.contacto.trim().length < 6) errors.push('Contacto inválido')
  if (!data.cat) errors.push('Categoría requerida')
  if (data.nombre && data.nombre.length > 200) errors.push('Nombre demasiado largo')
  if (data.descripcion && data.descripcion.length > 2000) errors.push('Descripción demasiado larga')
  return errors
}

export function validateZona(data: any) {
  const errors: string[] = []
  if (!data.nombre || data.nombre.trim().length < 3) errors.push('Nombre de zona inválido')
  if (!data.contacto || data.contacto.trim().length < 6) errors.push('Contacto inválido')
  if (!data.urgencia) errors.push('Urgencia requerida')
  if (data.nombre && data.nombre.length > 300) errors.push('Nombre demasiado largo')
  if (data.descripcion && data.descripcion.length > 3000) errors.push('Descripción demasiado larga')
  return errors
}

export function validateRefugio(data: any) {
  const errors: string[] = []
  if (!data.nombre || data.nombre.trim().length < 3) errors.push('Nombre del refugio inválido')
  if (!data.contacto || data.contacto.trim().length < 6) errors.push('Contacto inválido')
  if (data.nombre && data.nombre.length > 300) errors.push('Nombre demasiado largo')
  return errors
}

export function validateDonacion(data: any) {
  const errors: string[] = []
  if (!data.nombre || data.nombre.trim().length < 2) errors.push('Nombre inválido')
  if (!data.monto || isNaN(parseFloat(data.monto))) errors.push('Monto inválido')
  if (parseFloat(data.monto) <= 0) errors.push('El monto debe ser mayor a 0')
  if (parseFloat(data.monto) > 100000) errors.push('Monto fuera de rango')
  if (!data.destinos || data.destinos.length === 0) errors.push('Selecciona al menos un destino')
  return errors
}

export function validateVoluntario(data: any) {
  const errors: string[] = []
  if (!data.nombre || data.nombre.trim().length < 2) errors.push('Nombre inválido')
  if (!data.contacto || data.contacto.trim().length < 6) errors.push('Contacto inválido')
  if (!data.especialidades || data.especialidades.length === 0) errors.push('Selecciona al menos una especialidad')
  return errors
}

export function validateMascota(data: any) {
  const errors: string[] = []
  if (!data.ubicacion || data.ubicacion.trim().length < 3) errors.push('Ubicación inválida')
  if (!data.contacto || data.contacto.trim().length < 6) errors.push('Contacto inválido')
  if (data.descripcion && data.descripcion.length > 2000) errors.push('Descripción demasiado larga')
  return errors
}

export function sanitize(str: string): string {
  if (!str) return ''
  return str
    .trim()
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .slice(0, 5000)
}
