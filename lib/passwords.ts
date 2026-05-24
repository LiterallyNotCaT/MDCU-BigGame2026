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

async function authAccess(payload: AuthPayload): Promise<AuthResult> {
  const res = await fetch('/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({})) as AuthResult
  if (!res.ok) return { ok: false, message: data.message || `Auth failed: ${res.status}` }
  return data
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
  return authAccess({ ...payload, mode: 'session' })
}
