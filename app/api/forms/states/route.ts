import { NextResponse } from 'next/server'
import { auth, isAllowedDocChulaEmail } from '@/auth'
import { canOAuthViewForm, type OAuthFormProfile } from '@/lib/formPermissions'
import { mergeFormLiveIntoStates, publishFullFormState } from '@/lib/formLive'
import { callGas } from '@/lib/gas'
import type { ScoringFormState } from '@/lib/forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  let payload: { password?: string; formKeys?: string[]; oauth?: boolean; force?: boolean }
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
      const requestedKeys = Array.isArray(payload.formKeys) ? payload.formKeys.filter(Boolean) : []
      const data = await callGas<{
        status: string
        profile: OAuthFormProfile
        states: Record<string, ScoringFormState>
        errors?: Record<string, string>
      }>({
        action: 'readFormStatesOAuth',
        email,
        formKeys: requestedKeys,
        force: payload.force === true,
      })
      const visibleStates = Object.fromEntries(
        Object.entries(data.states ?? {}).filter(([, state]) => canOAuthViewForm(data.profile, state.form)),
      )
      if (payload.force === true) {
        await Promise.all(Object.values(visibleStates).map(state => publishFullFormState(state)))
      }
      const states = await mergeFormLiveIntoStates(visibleStates)
      return NextResponse.json({ ok: true, states, errors: data.errors ?? {} })
    }

    const data = await callGas<{
      status: string
      states: Record<string, ScoringFormState>
      errors?: Record<string, string>
    }>({
      action: 'readFormStates',
      password: payload.password ?? '',
      formKeys: payload.formKeys ?? [],
      force: payload.force === true,
    })
    if (payload.force === true) {
      await Promise.all(Object.values(data.states ?? {}).map(state => publishFullFormState(state)))
    }
    const states = await mergeFormLiveIntoStates(data.states ?? {})
    return NextResponse.json({ ok: true, states, errors: data.errors ?? {} })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message, states: {} }, { status: 500 })
  }
}
