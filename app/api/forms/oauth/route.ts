import { NextResponse } from 'next/server'
import { auth, isAllowedDocChulaEmail } from '@/auth'
import { callOAuthGas } from '@/lib/oauthGas'
import type { OAuthFormProfile } from '@/lib/formPermissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  const email = session?.user?.email ?? ''

  if (!session?.user || !isAllowedDocChulaEmail(email)) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const data = await callOAuthGas<{ status: string; profile: OAuthFormProfile }>({
      action: 'readOAuthLogin',
      email,
    })
    return NextResponse.json({ ok: true, profile: data.profile })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}
