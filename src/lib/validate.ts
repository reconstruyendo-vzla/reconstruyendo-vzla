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

export function validateAliado(data: any) {
  const errors: string[] = []
  if (!data.nombre || data.nombre.trim().length < 2) errors.push('Nombre de empresa o fundación inválido')
  if (!data.pais || data.pais.trim().length < 2) errors.push('País inválido')
  if (!data.contactoNombre || data.contactoNombre.trim().length < 2) errors.push('Nombre de contacto inválido')
  if (!data.contacto || data.contacto.trim().length < 6) errors.push('WhatsApp o teléfono inválido')
  if (data.tipo === 'fijo') {
    if (!data.montoFijo || isNaN(parseFloat(data.montoFijo))) errors.push('Monto fijo inválido')
    else if (parseFloat(data.montoFijo) <= 0) errors.push('El monto debe ser mayor a 0')
    else if (parseFloat(data.montoFijo) > 10000000) errors.push('Monto fuera de rango')
  } else if (data.tipo === 'match') {
    if (!data.porcentaje || isNaN(parseFloat(data.porcentaje))) errors.push('Porcentaje inválido')
    else if (parseFloat(data.porcentaje) <= 0 || parseFloat(data.porcentaje) > 100) errors.push('El porcentaje debe estar entre 1 y 100')
    if (!data.hasta || isNaN(parseFloat(data.hasta))) errors.push('Límite máximo inválido')
    else if (parseFloat(data.hasta) <= 0) errors.push('El límite debe ser mayor a 0')
  } else {
    errors.push('Tipo de aporte inválido')
  }
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
