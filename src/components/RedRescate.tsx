'use client'

import { useEffect, useState } from 'react'
import type { BaseRecord } from '@/lib/idb-store'
import { CompartirSinInternet } from '@/components/CompartirSinInternet'

type Props = {
  zonas: BaseRecord[]
  online: boolean
  onToast: (msg: string, type?: string) => void
  alertaRecienGuardada?: BaseRecord | null
  onCerrarAlerta?: () => void
}

/** Solo muestra opciones de compartir DESPUÉS de guardar un reporte */
export function RedRescate({ onToast, alertaRecienGuardada, onCerrarAlerta }: Props) {
  const [modalItem, setModalItem] = useState<BaseRecord | null>(null)

  useEffect(() => {
    if (alertaRecienGuardada) setModalItem(alertaRecienGuardada)
  }, [alertaRecienGuardada])

  if (!modalItem) return null

  return (
    <CompartirSinInternet
      item={modalItem}
      onClose={() => {
        setModalItem(null)
        onCerrarAlerta?.()
      }}
      onToast={onToast}
    />
  )
}
