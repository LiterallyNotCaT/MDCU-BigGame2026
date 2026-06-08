import { NextResponse } from 'next/server'
import { deleteFormLiveState, hasStaleSavingFormLiveRound, isFormLiveStateExpired, readFormLiveState } from '@/lib/formLive'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const formKey = url.searchParams.get('formKey') ?? ''
  if (!formKey.trim()) {
    return NextResponse.json({ ok: false, message: 'Missing formKey' }, { status: 400 })
  }

  try {
    let live = await readFormLiveState(formKey)
    if (isFormLiveStateExpired(live)) {
      await deleteFormLiveState(formKey)
      live = await readFormLiveState(formKey)
    }
    return NextResponse.json({ ok: true, live, staleSaving: hasStaleSavingFormLiveRound(live) }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}
