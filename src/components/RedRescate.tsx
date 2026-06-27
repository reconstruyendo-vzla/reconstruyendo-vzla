'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { IDB, type BaseRecord } from '@/lib/idb-store'
import { avisarLocal, decodificarRegistro } from '@/lib/red-rescate'
import { CompartirSinInternet } from '@/components/CompartirSinInternet'

const C = {
  red: '#DC2626',
  redLt: '#FEF2F2',
  primary: '#2563EB',
  primaryLt: '#EFF6FF',
  green: '#059669',
  greenLt: '#ECFDF5',
  amber: '#D97706',
  amberLt: '#FEF3C7',
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
  onImportada?: () => void
}

function Btn({
  onClick,
  children,
  color = C.primary,
  outline,
  full,
}: {
  onClick?: () => void
  children: ReactNode
  color?: string
  outline?: boolean
  full?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: full ? '100%' : undefined,
        padding: '12px 16px',
        borderRadius: 9,
        border: outline ? `2px solid ${color}` : 'none',
        background: outline ? 'white' : color,
        color: outline ? color : 'white',
        fontWeight: 800,
        fontSize: 14,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  )
}

function EscannerQR({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let cancelled = false

    const start = async () => {
      const BD = typeof window !== 'undefined' ? (window as Window & { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (src: ImageBitmapSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector : undefined
      if (!BD) {
        setError('Usa pegar código abajo, o abre en Chrome Android para escanear.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled || !videoRef.current) return
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        const detector = new BD({ formats: ['qr_code'] })
        const tick = async () => {
          if (cancelled || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes[0]?.rawValue?.startsWith('RVZ1:')) {
              onCode(codes[0].rawValue)
              return
            }
          } catch {
            /* frame skip */
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      } catch {
        setError('No se pudo abrir la cámara. Pega el código manualmente.')
      }
    }
    start()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onCode])

  return (
    <div style={{ marginBottom: 12 }}>
      {error ? (
        <div style={{ fontSize: 12, color: C.amber, marginBottom: 8 }}>{error}</div>
      ) : (
        <video ref={videoRef} style={{ width: '100%', borderRadius: 10, background: '#000', maxHeight: 220 }} playsInline muted />
      )}
      <Btn outline color={C.muted} full onClick={onClose}>
        Cerrar cámara
      </Btn>
    </div>
  )
}

export function RedRescate({ zonas, online, onToast, alertaRecienGuardada, onCerrarAlerta, onImportada }: Props) {
  const [modalItem, setModalItem] = useState<BaseRecord | null>(null)
  const [codigoPegado, setCodigoPegado] = useState('')
  const [escaneando, setEscaneando] = useState(false)
  const [recibidas, setRecibidas] = useState<BaseRecord[]>([])

  const reloadRecibidas = useCallback(async () => {
    const all = await IDB.getAll('alertas_mesh')
    setRecibidas(all)
  }, [])

  useEffect(() => {
    reloadRecibidas()
  }, [reloadRecibidas])

  useEffect(() => {
    if (alertaRecienGuardada) setModalItem(alertaRecienGuardada)
  }, [alertaRecienGuardada])

  const importarCodigo = async (raw: string) => {
    const decoded = decodificarRegistro(raw)
    if (!decoded) {
      onToast('Código inválido — pide al otro rescatista que reenvíe', 'warn')
      return
    }
    const { table, item } = decoded
    const existente = await IDB.get(table, item.id)
    if (!existente) await IDB.put(table, { ...item, _off: true, _mesh: true })
    await IDB.put('alertas_mesh', { ...item, recibida_en: new Date().toISOString() })
    const titulo = table === 'personas' ? '👤 Persona recibida' : '🚨 Alerta recibida'
    avisarLocal(titulo, String(item.nombre))
    onToast(`${table === 'personas' ? 'Persona' : 'Alerta'} recibida: ${item.nombre}`, 'ok')
    setCodigoPegado('')
    setEscaneando(false)
    await reloadRecibidas()
    onImportada?.()
  }

  const criticas = zonas.filter((z) => z.urgencia === 'critica')

  return (
    <>
      <div
        style={{
          background: online ? C.primaryLt : C.redLt,
          border: `2px solid ${online ? C.primary : C.red}`,
          borderRadius: 14,
          padding: 16,
          marginBottom: 14,
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 15, color: online ? C.primary : C.red, marginBottom: 6 }}>
          {online ? '📡 Red de rescate' : '🆘 RED SIN INTERNET — Modo rescate activo'}
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.55, color: C.txt }}>
          {online
            ? 'Las alertas críticas también se envían por push. Sin fibra en la costa, usa SMS, QR o compartir entre teléfonos.'
            : 'No hay internet en la zona — normal. Envía alertas por SMS (si hay señal celular), QR entre rescatistas, o Bluetooth/WhatsApp. Cada teléfono retransmite la alerta.'}
        </p>

        {!online && criticas[0] && (
          <div style={{ marginBottom: 12 }}>
            <Btn color={C.red} full onClick={() => setModalItem(criticas[0])}>
              🚨 Compartir última zona crítica
            </Btn>
          </div>
        )}

        <div style={{ fontWeight: 800, fontSize: 12, textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>
          Recibir alerta o persona de otro rescatista
        </div>

        {escaneando ? (
          <EscannerQR onCode={(code) => importarCodigo(code)} onClose={() => setEscaneando(false)} />
        ) : (
          <div style={{ marginBottom: 8 }}>
            <Btn outline full onClick={() => setEscaneando(true)}>
              📷 Escanear QR
            </Btn>
          </div>
        )}

        <textarea
          value={codigoPegado}
          onChange={(e) => setCodigoPegado(e.target.value)}
          placeholder="Pega aquí el código RVZ1:… (persona o zona)"
          rows={2}
          style={{
            width: '100%',
            padding: 10,
            borderRadius: 8,
            border: `1.5px solid ${C.border}`,
            fontSize: 12,
            boxSizing: 'border-box',
            marginBottom: 8,
            fontFamily: 'monospace',
          }}
        />
        <Btn full color={C.green} onClick={() => codigoPegado.trim() && importarCodigo(codigoPegado.trim())}>
          ✓ Importar
        </Btn>

        {recibidas.length > 0 && (
          <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.green, marginBottom: 8 }}>
              {recibidas.length} recibido(s) por red local
            </div>
            {recibidas.slice(0, 5).map((z) => (
              <div key={z.id} style={{ fontSize: 12, marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 700 }}>{z.nombre}</span>
                <button
                  type="button"
                  onClick={() => setModalItem(z)}
                  style={{ background: 'none', border: 'none', color: C.primary, fontWeight: 700, cursor: 'pointer', fontSize: 12 }}
                >
                  Reenviar →
                </button>
              </div>
            ))}
          </div>
        )}

        {zonas.length > 0 && (
          <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8 }}>Compartir zona guardada</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {zonas.slice(0, 6).map((z) => (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => setModalItem(z)}
                  style={{
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: 'white',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {z.urgencia === 'critica' ? '🚨 ' : ''}
                  {z.nombre}
                  {z._off ? ' · en teléfono' : ''}
                </button>
              ))}
            </div>
          </div>
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
