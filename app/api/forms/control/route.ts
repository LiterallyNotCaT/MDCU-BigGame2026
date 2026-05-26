import { NextResponse } from 'next/server'
import { auth, isAllowedDocChulaEmail } from '@/auth'
import { cacheFormAdminPassword, readCachedFormAdminPassword } from '@/lib/formAdminAuthCache'
import { publishFormRoundPatch } from '@/lib/formLive'
import { isOAuthAdmin } from '@/lib/formPermissions'
import { callGas } from '@/lib/gas'
import { readOAuthProfile } from '@/lib/oauthProfile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

type ControlTarget = {
  formKey?: unknown
  roundCount?: unknown
}

type ControlPatch = {
  confirmed?: boolean
  locked?: boolean
  deadlineAt?: string
}

export async function POST(req: Request) {
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON' }, { status: 400 })
  }

  try {
    await assertAdmin(payload)

    const patch = controlPatchFromPayload(payload)
    if (!patch) {
      return NextResponse.json({ ok: false, message: 'No control change supplied' }, { status: 400 })
    }

    const targets = controlTargetsFromPayload(payload)
    if (!targets.length) {
      return NextResponse.json({ ok: false, message: 'Invalid round' }, { status: 400 })
    }

    await Promise.all(targets.map(target => publishFormRoundPatch(
      target.formKey,
      target.rounds.map(index => ({ index, ...patch })),
    )))

    return NextResponse.json({
      ok: true,
      message: 'Updated',
      data: {
        patch,
        targets,
      },
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message }, { status: /unauthorized/i.test(message) ? 401 : 400 })
  }
}

async function assertAdmin(payload: Record<string, unknown>) {
  if (payload.oauth === true) {
    const session = await auth()
    const email = session?.user?.email ?? ''
    if (!session?.user || !isAllowedDocChulaEmail(email)) {
      throw new Error('Unauthorized')
    }
    const profile = await readOAuthProfile(email)
    if (!isOAuthAdmin(profile)) throw new Error('Unauthorized')
    return
  }

  const password = String(payload.password ?? '')
  if (await readCachedFormAdminPassword(password)) return

  await callGas({
    action: 'authFormUser',
    admin: true,
    password,
  })
  await cacheFormAdminPassword(password)
}

function controlTargetsFromPayload(payload: Record<string, unknown>) {
  const rawTargets = Array.isArray(payload.targets) ? payload.targets as ControlTarget[] : []
  const targets = rawTargets.length
    ? rawTargets
    : [{
      formKey: payload.formKey,
      roundCount: payload.roundCount,
    }]

  return targets.flatMap(target => {
    const formKey = String(target.formKey ?? '').trim()
    if (!formKey) return []

    const allRounds = payload.allRounds === true || rawTargets.length > 0
    if (!allRounds) {
      const roundIndex = Number(payload.roundIndex)
      if (!Number.isInteger(roundIndex) || roundIndex < 0) return []
      return [{ formKey, rounds: [roundIndex] }]
    }

    const roundCount = Math.max(1, Math.min(24, Math.floor(Number(target.roundCount) || 0)))
    if (!roundCount) return []
    return [{
      formKey,
      rounds: Array.from({ length: roundCount }, (_, index) => index),
    }]
  })
}

function controlPatchFromPayload(payload: Record<string, unknown>): ControlPatch | null {
  const patch: ControlPatch = {}
  if (payload.confirmed !== undefined) patch.confirmed = payload.confirmed === true
  if (payload.locked !== undefined) patch.locked = payload.locked === true
  if (payload.clearDeadline === true) patch.deadlineAt = ''
  if (payload.deadlineMinutes !== undefined) {
    const minutes = Math.max(1, Math.min(240, Number(payload.deadlineMinutes) || 10))
    patch.deadlineAt = new Date(Date.now() + minutes * 60000).toISOString()
  }
  return Object.keys(patch).length ? patch : null
}
