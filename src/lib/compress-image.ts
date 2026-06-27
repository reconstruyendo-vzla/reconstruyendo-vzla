/** Reduce foto para que IndexedDB no falle sin internet (límite ~5MB por registro) */
export async function compressImage(b64: string, maxW = 720): Promise<string> {
  if (!b64?.startsWith('data:image')) return b64
  if (typeof document === 'undefined') return b64
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxW / Math.max(img.width, 1))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(b64)
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.72))
      } catch {
        resolve(b64)
      }
    }
    img.onerror = () => resolve(b64)
    img.src = b64
  })
}
