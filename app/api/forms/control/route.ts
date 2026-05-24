import { NextResponse } from 'next/server'
import { auth, isAllowedDocChulaEmail } from '@/auth'
import { callGas } from '@/lib/gas'
import { callOAuthGas } from '@/lib/oauthGas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request) {
  let payload: Record<string, unknown>
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
        return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
      }
      const data = await callOAuthGas({
        ...payload,
        email,
        action: 'setFormRoundControlOAuth',
      })
      return NextResponse.json({ ok: true, message: data.message || 'Updated', data })
    }

    const data = await callGas({
      ...payload,
      action: 'setFormRoundControl',
    })
    return NextResponse.json({ ok: true, message: data.message || 'Updated', data })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message }, { status: /busy|lock|timeout/i.test(message) ? 503 : 400 })
  }
}
