import type { ScoringFormConfig } from './forms'

export type OAuthWebRole = 'ADMIN' | 'Head/Prasarn' | 'Core Team' | 'Staff' | 'Viewer' | 'Banned'

export interface OAuthFormProfile {
  email: string
  nickname: string
  name: string
  job: string
  role: OAuthWebRole
  editableGames: string[]
  gameKeys: string[]
}

export function normalizeGameKey(value: string) {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+[AB]$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

  if (normalized === 'missingvowel') return 'missvowel'
  if (normalized === 'halligalli') return 'halligali'
  if (normalized === 'camelcup') return 'camelup'
  if (normalized === 'dixit' || normalized === 'dixits') return 'dxits'
  if (normalized === 'blitz' || normalized === 'bizz') return 'biss'
  if (normalized === 'snakesandladders' || normalized === 'snakesladders') return 'snakeladder'

  return normalized
}

export function isOAuthAdmin(profile: OAuthFormProfile | null) {
  return profile?.role === 'ADMIN'
}

export function isOAuthBanned(profile: OAuthFormProfile | null) {
  return profile?.role === 'Banned'
}

export function canOAuthEditForm(profile: OAuthFormProfile | null, form: ScoringFormConfig | null) {
  if (!profile || !form || form.blank) return false
  if (isOAuthAdmin(profile)) return true
  return profile.gameKeys.includes(normalizeGameKey(form.user))
}

export function canOAuthViewForm(profile: OAuthFormProfile | null, form: ScoringFormConfig | null) {
  if (!profile || !form || form.blank) return false
  if (isOAuthAdmin(profile)) return true
  if (profile.role === 'Head/Prasarn' || profile.role === 'Core Team') return true
  if (profile.role === 'Staff') return canOAuthEditForm(profile, form)
  return false
}
