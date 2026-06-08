import { NextResponse } from 'next/server'
import { callGas } from '@/lib/gas'
import { normalizeScoringFormConfig, type ScoringFormConfig } from '@/lib/forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const data = await callGas<{ status: string; forms: ScoringFormConfig[] }>({ action: 'readFormConfig' })
    const forms = (data.forms ?? [])
      .filter(form => form.user.trim().toLowerCase() !== 'event')
      .map(normalizeScoringFormConfig)
    return NextResponse.json({ ok: true, forms })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message, forms: [] }, { status: 500 })
  }
}
