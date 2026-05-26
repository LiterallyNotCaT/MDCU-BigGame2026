import { callGas } from './gas'
import type { OAuthFormProfile } from './formPermissions'
import { redisGetJson, redisSetJsonWithTtl } from './redisStore'

const OAUTH_PROFILE_CACHE_SECONDS = 30

function oauthProfileCacheKey(email: string) {
  return `biggame_oauth_profile:${Buffer.from(email.trim().toLowerCase()).toString('base64url')}`
}

export async function readOAuthProfile(email: string) {
  const key = oauthProfileCacheKey(email)
  const cached = await redisGetJson<OAuthFormProfile>(key).catch(() => null)
  if (cached) return cached

  const data = await callGas<{ status: string; profile: OAuthFormProfile }>({
    action: 'readOAuthLogin',
    email,
  })

  await redisSetJsonWithTtl(key, data.profile, OAUTH_PROFILE_CACHE_SECONDS).catch(() => undefined)
  return data.profile
}
