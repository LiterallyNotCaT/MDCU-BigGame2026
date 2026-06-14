import { createHash } from 'node:crypto'
import { redisGetJson, redisSetJsonWithTtl } from '@/lib/redisStore'

type AccessKind = 'page' | 'baan' | 'kingPro' | string

type AccessSession = {
  kind: AccessKind
  pageKey?: string
  baan?: number | null
  token?: string
}

const ACCESS_SESSION_TTL_SECONDS = 12 * 60 * 60

function tokenDigest(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function accessScope(session: AccessSession) {
  const kind = String(session.kind || '').trim()
  if (kind === 'baan') {
    const baan = Number(session.baan)
    return Number.isInteger(baan) && baan >= 1 && baan <= 12 ? `baan:${baan}` : ''
  }
  if (kind === 'page') {
    const pageKey = String(session.pageKey || '').trim()
    return pageKey ? `page:${pageKey}` : ''
  }
  if (kind === 'kingPro') return 'kingPro'
  return kind
}

function accessSessionKey(session: AccessSession) {
  const scope = accessScope(session)
  const token = String(session.token || '').trim()
  if (!scope || !token) return ''
  return `biggame_access_session:${scope}:${tokenDigest(token)}`
}

export async function cacheAccessSession(session: AccessSession) {
  const key = accessSessionKey(session)
  if (!key) return
  await redisSetJsonWithTtl(key, {
    scope: accessScope(session),
    verifiedAt: new Date().toISOString(),
  }, ACCESS_SESSION_TTL_SECONDS).catch(() => undefined)
}

export async function isCachedAccessSession(session: AccessSession) {
  const key = accessSessionKey(session)
  if (!key) return false
  const cached = await redisGetJson<{ verifiedAt?: string }>(key).catch(() => null)
  return Boolean(cached?.verifiedAt)
}
