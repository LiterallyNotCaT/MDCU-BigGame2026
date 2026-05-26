import { createHash } from 'node:crypto'
import { redisGetJson, redisSetJsonWithTtl } from '@/lib/redisStore'

const FORM_ADMIN_AUTH_CACHE_SECONDS = 5 * 60

function adminPasswordCacheKey(password: string) {
  const digest = createHash('sha256').update(password).digest('hex')
  return `biggame_form_admin_ok:${digest}`
}

export async function readCachedFormAdminPassword(password: string) {
  if (!password) return false
  const cached = await redisGetJson<{ ok?: boolean }>(adminPasswordCacheKey(password)).catch(() => null)
  return cached?.ok === true
}

export async function cacheFormAdminPassword(password: string) {
  if (!password) return
  await redisSetJsonWithTtl(adminPasswordCacheKey(password), { ok: true }, FORM_ADMIN_AUTH_CACHE_SECONDS).catch(() => undefined)
}
