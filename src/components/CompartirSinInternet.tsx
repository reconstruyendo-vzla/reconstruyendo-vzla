'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import QRCode from 'qrcode'
import type { BaseRecord } from '@/lib/idb-store'
import {
  codificarRegistro,
  compartirNativo,
  copiarTexto,
  esPersona,
  numerosRescate,
  textoCompartirRegistro,
  urlSMS,
} from '@/lib/red-rescate'

const C = {
  red: '#DC2626',
  primary: '#2563EB',
  muted: '#64748B',
  border: '#E2E8F0',
  amber: '#D97706',
  amberLt: '#FEF3C7',
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
  const [qr, setQr] = useState('')
  const texto = textoCompartirRegistro(item)
  const nums = numerosRescate()
  const esNino = esPersona(item)

  useEffect(() => {
    const code = codificarRegistro(item)
    QRCode.toDataURL(code, { width: 260, margin: 2, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(''))
  }, [item])

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
          maxHeight: '92vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 900, fontSize: 18, color: C.red, marginBottom: 4 }}>
          {esNino ? '👤 Compartir persona AHORA' : '🚨 Compartir alerta AHORA'}
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 16, lineHeight: 1.5 }}>
          Sin internet: otro rescatista o coordinador escanea el QR, o envía por SMS. Así la familia y los refugios
          saben dónde está esta persona.
        </div>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>{item.nombre}</div>

        {qr && (
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <img
              src={qr}
              alt="QR"
              style={{ width: 260, height: 260, borderRadius: 8, border: `1px solid ${C.border}` }}
            />
            <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Escanear con otro teléfono — sin datos</div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              window.location.href = urlSMS(texto, nums.length ? nums : undefined)
            }}
            style={btn(C.red)}
          >
            📱 Enviar SMS
          </button>
          <button
            type="button"
            onClick={async () => {
              const ok = await compartirNativo(texto)
              if (ok) onToast('Compartido — elige WhatsApp o Bluetooth', 'ok')
              else if (await copiarTexto(texto)) onToast('Copiado — pégalo en WhatsApp', 'ok')
              else onToast('Copia el texto de abajo manualmente', 'warn')
            }}
            style={btn(C.primary)}
          >
            📤 Compartir (WhatsApp / Bluetooth)
          </button>
          <button
            type="button"
            onClick={async () => {
              if (await copiarTexto(texto)) onToast('Copiado al portapapeles', 'ok')
              else onToast('No se pudo copiar', 'warn')
            }}
            style={btnOutline(C.primary)}
          >
            📋 Copiar datos
          </button>
          <button type="button" onClick={onClose} style={btnOutline(C.muted)}>
            Cerrar — ya quedó guardado en este teléfono
          </button>
        </div>

        {!nums.length && (
          <div style={{ marginTop: 12, fontSize: 11, color: C.amber, background: C.amberLt, padding: 10, borderRadius: 8 }}>
            Configura NEXT_PUBLIC_NUMEROS_RESCATE en Vercel para SMS directo a coordinación.
          </div>
        )}
      </div>
    </div>
  )
}

function btn(bg: string): CSSProperties {
  return {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 9,
    border: 'none',
    background: bg,
    color: 'white',
    fontWeight: 800,
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }
}

function btnOutline(color: string): CSSProperties {
  return {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 9,
    border: `2px solid ${color}`,
    background: 'white',
    color,
    fontWeight: 800,
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }
}
