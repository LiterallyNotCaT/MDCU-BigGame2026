import type { ScoringFormConfig } from './forms'

export type OAuthWebRole = 'ADMIN' | 'Head/Prasarn' | 'Head' | 'Prasarn' | 'Core Team' | 'Staff' | 'Viewer' | 'Banned'

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
  if (normalized === 'moneydrop') return 'moneydrop'

  return normalized
}

function normalizeRole(value: OAuthWebRole | string | null | undefined) {
  const compact = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (compact === 'admin') return 'ADMIN'
  if (compact === 'head' || compact === 'prasarn' || compact === 'head/prasarn' || compact === 'head / prasarn') return 'Head/Prasarn'
  if (compact === 'coreteam' || compact === 'core team') return 'Core Team'
  if (compact === 'staff') return 'Staff'
  if (compact === 'banned') return 'Banned'
  return 'Viewer'
}

export function isOAuthAdmin(profile: OAuthFormProfile | null) {
  return normalizeRole(profile?.role) === 'ADMIN'
}

export function isOAuthBanned(profile: OAuthFormProfile | null) {
  return normalizeRole(profile?.role) === 'Banned'
}

export function isOAuthViewAllRole(profile: OAuthFormProfile | null) {
  const role = normalizeRole(profile?.role)
  return role === 'ADMIN' || role === 'Head/Prasarn' || role === 'Core Team'
}

export function hasOAuthGameAccess(profile: OAuthFormProfile | null, form: ScoringFormConfig | null) {
  if (!profile || !form || form.blank || isOAuthBanned(profile)) return false
  return profile.gameKeys.includes(normalizeGameKey(form.user))
}

export function canOAuthEditForm(profile: OAuthFormProfile | null, form: ScoringFormConfig | null) {
  if (!profile || !form || form.blank || isOAuthBanned(profile)) return false
  if (isOAuthAdmin(profile)) return true
  return hasOAuthGameAccess(profile, form)
}

export function canOAuthViewForm(profile: OAuthFormProfile | null, form: ScoringFormConfig | null) {
  if (!profile || !form || form.blank || isOAuthBanned(profile)) return false
  if (isOAuthViewAllRole(profile)) return true
  return canOAuthEditForm(profile, form)
}
