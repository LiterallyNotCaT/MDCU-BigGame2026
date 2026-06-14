'use client'

type AuthKind = 'page' | 'baan' | 'kingPro'

type AuthPayload = {
  kind: AuthKind
  mode?: 'login' | 'session'
  pageKey?: string
  baan?: number
  password?: string
  token?: string
}

type AuthResult = {
  ok: boolean
  token?: string
  message?: string
}

const AUTH_LOGIN_TIMEOUT_MS = 25_000
const AUTH_SESSION_TIMEOUT_MS = 8_000

async function authAccess(payload: AuthPayload, timeoutMs = AUTH_LOGIN_TIMEOUT_MS): Promise<AuthResult> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({})) as AuthResult
    if (!res.ok) return { ok: false, message: data.message || `Auth failed: ${res.status}` }
    return data
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      return { ok: false, message: 'Auth request timed out' }
    }
    return { ok: false, message: String(error) }
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function verifyPagePassword(pageKey: string, password: string) {
  return authAccess({ kind: 'page', pageKey, password })
}

export async function verifyBaanPassword(baan: number, password: string) {
  return authAccess({ kind: 'baan', baan, password })
}

export async function verifyKingProPassword(password: string) {
  return authAccess({ kind: 'kingPro', password })
}

export async function verifyPasswordSession(payload: Omit<AuthPayload, 'mode' | 'password'>) {
  return authAccess({ ...payload, mode: 'session' }, AUTH_SESSION_TIMEOUT_MS)
}
