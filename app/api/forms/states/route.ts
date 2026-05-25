import { NextResponse } from 'next/server'
import { auth, isAllowedDocChulaEmail } from '@/auth'
import { canOAuthViewForm, type OAuthFormProfile } from '@/lib/formPermissions'
import { publishFormState } from '@/lib/formLive'
import { callGas } from '@/lib/gas'
import { callOAuthGas } from '@/lib/oauthGas'
import type { ScoringFormState } from '@/lib/forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  let payload: { password?: string; formKeys?: string[]; oauth?: boolean }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON' }, { status: 400 })
  }

  try {
    if (payload.oauth === true) {
      const session = await auth()
      const email = session?.user?.email ?? ''
      if (!session?.user || !isAllowedDocChulaEmail(email)) {
        return NextResponse.json({ ok: false, message: 'Unauthorized', states: {} }, { status: 401 })
      }
      const profileData = await callOAuthGas<{ status: string; profile: OAuthFormProfile }>({
        action: 'readOAuthLogin',
        email,
      })
      const requestedKeys = Array.isArray(payload.formKeys) ? payload.formKeys.filter(Boolean) : []
      const states: Record<string, ScoringFormState> = {}
      const errors: Record<string, string> = {}
      for (const formKey of requestedKeys) {
        try {
          const data = await callGas<{ status: string; state: ScoringFormState }>({
            action: 'readFormState',
            formKey,
          })
          if (!canOAuthViewForm(profileData.profile, data.state.form)) continue
          states[formKey] = data.state
          await publishFormState(data.state).catch(error => console.error('Form live publish after OAuth batch read failed:', error))
        } catch (error) {
          errors[formKey] = error instanceof Error ? error.message : String(error)
        }
      }
      return NextResponse.json({ ok: true, states, errors })
    }

    const data = await callGas<{
      status: string
      states: Record<string, ScoringFormState>
      errors?: Record<string, string>
    }>({
      action: 'readFormStates',
      password: payload.password ?? '',
      formKeys: payload.formKeys ?? [],
    })
    return NextResponse.json({ ok: true, states: data.states ?? {}, errors: data.errors ?? {} })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message, states: {} }, { status: 500 })
  }
}
