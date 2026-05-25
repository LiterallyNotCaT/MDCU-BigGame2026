import { NextResponse } from 'next/server'
import { readFormLiveState } from '@/lib/formLive'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const formKey = url.searchParams.get('formKey') ?? ''
  if (!formKey.trim()) {
    return NextResponse.json({ ok: false, message: 'Missing formKey' }, { status: 400 })
  }

  try {
    const live = await readFormLiveState(formKey)
    return NextResponse.json({ ok: true, live }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}
