type OAuthGasResponse = {
  status?: string
  message?: string
  [key: string]: unknown
}

const OAUTH_GAS_URL = process.env.OAUTH_GAS_URL || ''

export async function callOAuthGas<T = OAuthGasResponse>(payload: Record<string, unknown>): Promise<T> {
  if (!OAUTH_GAS_URL) throw new Error('OAUTH_GAS_URL not configured')

  const res = await fetch(OAUTH_GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })

  const text = await res.text()
  let data: T & OAuthGasResponse
  try {
    data = text ? JSON.parse(text) as T & OAuthGasResponse : {} as T & OAuthGasResponse
  } catch {
    throw new Error(`OAuth Apps Script returned non-JSON response: ${text.slice(0, 160)}`)
  }

  if (!res.ok) throw new Error(data.message || `OAuth Apps Script HTTP ${res.status}`)
  if (data.status !== 'ok') throw new Error(data.message || 'OAuth Apps Script rejected the request')
  return data as T
}
