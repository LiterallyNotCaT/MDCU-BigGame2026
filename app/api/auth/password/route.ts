import { NextResponse } from 'next/server'
import { callGas } from '@/lib/gas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AuthPayload = {
  kind?: string
  mode?: string
  pageKey?: string
  baan?: number
  password?: string
  token?: string
}

export async function POST(req: Request) {
  let payload: AuthPayload
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const data = await callGas<{ status: string; ok?: boolean; token?: string; message?: string }>({
      action: 'authAccess',
      kind: payload.kind ?? '',
      mode: payload.mode === 'session' ? 'session' : 'login',
      pageKey: payload.pageKey ?? '',
      baan: payload.baan ?? null,
      password: payload.password ?? '',
      token: payload.token ?? '',
    })
    return NextResponse.json({
      ok: data.ok === true,
      token: data.token,
      message: data.message,
    }, { status: data.ok === true ? 200 : 401 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message }, { status: 401 })
  }
}
