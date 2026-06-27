'use client'

import type { CSSProperties } from 'react'
import type { BaseRecord } from '@/lib/idb-store'
import {
  compartirNativo,
  copiarTexto,
  numerosRescate,
  textoCompartirRegistro,
  urlSMS,
} from '@/lib/red-rescate'

const C = {
  red: '#DC2626',
  primary: '#2563EB',
  muted: '#64748B',
}

export function CompartirSinInternet({
  item,
  onClose,
  onToast,
}: {
  item: BaseRecord
  onClose: () => void
  onToast: (msg: string, type?: string) => void
}) {
  const texto = textoCompartirRegistro(item)
  const nums = numerosRescate()

  const abrirSMS = () => {
    window.location.href = urlSMS(texto, nums.length ? nums : undefined)
    onToast(nums.length ? 'Toca Enviar en el mensaje' : 'Elige el contacto de bomberos o coordinación', 'ok')
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.75)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        padding: 12,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white',
          borderRadius: 16,
          padding: 20,
          maxWidth: 420,
          width: '100%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 900, fontSize: 18, color: C.red, marginBottom: 6 }}>
          Reporte publicado
        </div>
        <p style={{ fontSize: 14, color: C.muted, marginBottom: 16, lineHeight: 1.5 }}>
          Sin señal de datos en este lugar. Se publicará para todos cuando haya señal. ¿Avisar ya por mensaje de texto?
        </p>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 16, color: '#0F172A' }}>{item.nombre}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button type="button" onClick={abrirSMS} style={btn(C.red, 17)}>
            📱 ENVIAR SMS AHORA
          </button>
          <button
            type="button"
            onClick={async () => {
              const ok = await compartirNativo(texto, 'Reconstruyendo VZLA')
              if (ok) onToast('Elige WhatsApp y envía', 'ok')
              else if (await copiarTexto(texto)) onToast('Copiado — pégalo en WhatsApp', 'ok')
            }}
            style={btn(C.primary, 15)}
          >
            Enviar por WhatsApp
          </button>
          <button type="button" onClick={onClose} style={btnOutline(C.muted)}>
            Listo, cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

function btn(bg: string, fontSize: number): CSSProperties {
  return {
    width: '100%',
    padding: '16px',
    borderRadius: 10,
    border: 'none',
    background: bg,
    color: 'white',
    fontWeight: 900,
    fontSize,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }
}

function btnOutline(color: string): CSSProperties {
  return {
    width: '100%',
    padding: '12px',
    borderRadius: 10,
    border: `2px solid ${color}`,
    background: 'white',
    color,
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }
}
