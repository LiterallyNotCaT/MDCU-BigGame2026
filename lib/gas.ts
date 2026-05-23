type GasResponse = {
  status?: string
  message?: string
  [key: string]: unknown
}

const GAS_URL = process.env.GAS_URL || process.env.NEXT_PUBLIC_GAS_URL || ''

export async function callGas<T = GasResponse>(payload: Record<string, unknown>): Promise<T> {
  if (!GAS_URL) throw new Error('GAS URL not configured')

  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })

  const text = await res.text()
  let data: T & GasResponse
  try {
    data = text ? JSON.parse(text) as T & GasResponse : {} as T & GasResponse
  } catch {
    throw new Error(`Apps Script returned non-JSON response: ${text.slice(0, 160)}`)
  }

  if (!res.ok) throw new Error(data.message || `Apps Script HTTP ${res.status}`)
  if (data.status !== 'ok') throw new Error(data.message || 'Apps Script rejected the request')
  return data as T
}
