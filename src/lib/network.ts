/** navigator.onLine miente si hay WiFi sin internet real */
export async function hayInternetReal(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.onLine) return false
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return navigator.onLine

  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3500)
    const res = await fetch(`${url}/rest/v1/`, {
      method: 'HEAD',
      headers: { apikey: key },
      signal: ctrl.signal,
    })
    clearTimeout(t)
    return res.status < 500
  } catch {
    return false
  }
}
