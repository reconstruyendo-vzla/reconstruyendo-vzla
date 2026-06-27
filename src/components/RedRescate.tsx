'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { BaseRecord } from '@/lib/idb-store'
import { numerosRescate, textoCompartirRegistro, urlSMS } from '@/lib/red-rescate'
import { CompartirSinInternet } from '@/components/CompartirSinInternet'

const C = {
  red: '#DC2626',
  redLt: '#FEF2F2',
  primary: '#2563EB',
  txt: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
}

type Props = {
  zonas: BaseRecord[]
  online: boolean
  onToast: (msg: string, type?: string) => void
  alertaRecienGuardada?: BaseRecord | null
  onCerrarAlerta?: () => void
}

function Btn({
  onClick,
  children,
  color = C.primary,
  full,
}: {
  onClick?: () => void
  children: ReactNode
  color?: string
  full?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: full ? '100%' : undefined,
        padding: '14px 16px',
        borderRadius: 10,
        border: 'none',
        background: color,
        color: 'white',
        fontWeight: 800,
        fontSize: 15,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  )
}

export function RedRescate({ zonas, online, onToast, alertaRecienGuardada, onCerrarAlerta }: Props) {
  const [modalItem, setModalItem] = useState<BaseRecord | null>(null)
  const pendientes = zonas.filter((z) => z._off)

  useEffect(() => {
    if (alertaRecienGuardada) setModalItem(alertaRecienGuardada)
  }, [alertaRecienGuardada])

  const enviarSMS = (item: BaseRecord) => {
    const nums = numerosRescate()
    window.location.href = urlSMS(textoCompartirRegistro(item), nums.length ? nums : undefined)
    onToast(nums.length ? 'Abre el mensaje y toca Enviar' : 'Elige bomberos o coordinación y envía', 'ok')
  }

  if (online && pendientes.length === 0 && !alertaRecienGuardada) return null

  return (
    <>
      <div
        style={{
          background: C.redLt,
          border: `2px solid ${C.red}`,
          borderRadius: 14,
          padding: 16,
          marginBottom: 14,
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 16, color: C.red, marginBottom: 8 }}>
          Se publicará para todos cuando haya señal
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.55, color: C.txt }}>
          Todo lo guardado <strong>se sube solo</strong> al reconectar. Mientras no hay señal, envía un <strong>SMS</strong> para avisar ya a coordinación.
        </p>

        {pendientes.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendientes.slice(0, 8).map((z) => (
              <Btn key={z.id} color={C.red} full onClick={() => enviarSMS(z)}>
                📱 Enviar SMS — {z.nombre}
              </Btn>
            ))}
            <button
              type="button"
              onClick={() => setModalItem(pendientes[0])}
              style={{
                background: 'none',
                border: 'none',
                color: C.primary,
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                padding: '4px 0',
              }}
            >
              También enviar por WhatsApp →
            </button>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
            Reporta una zona con <strong>+ Zona</strong>. Al guardar podrás enviar el SMS.
          </p>
        )}
      </div>

      {modalItem && (
        <CompartirSinInternet
          item={modalItem}
          onClose={() => {
            setModalItem(null)
            onCerrarAlerta?.()
          }}
          onToast={onToast}
        />
      )}
    </>
  )
}
