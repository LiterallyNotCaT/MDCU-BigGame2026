import { after, NextResponse } from 'next/server'
import {
  deleteChatLiveMessage,
  markChatLiveMessageFailed,
  publishChatLiveMessage,
  readChatLiveMessages,
  type ChatMode,
} from '@/lib/chatLive'
import { callGas } from '@/lib/gas'
import {
  fetchGroupChatLatestId,
  fetchGroupChatMessages,
  type GroupChatMessage,
} from '@/lib/sheets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function normalizeMode(value: unknown): ChatMode {
  return String(value || '').trim().toLowerCase() === 'report' ? 'report' : 'bid'
}

function normalizeTarget(value: unknown) {
  const text = String(value || '').trim()
  if (!text || text.toLowerCase() === 'all') return 'public'
  return text
}

function actorMessageParts(actorValue: unknown) {
  const actorText = String(actorValue || '').trim()
  const baan = Number(actorText)
  if (Number.isInteger(baan) && baan >= 1 && baan <= 12) {
    return { sheetActor: baan, sender: String(baan), baan }
  }
  if (actorText.toLowerCase() === 'admin') {
    return { sheetActor: 'Admin', sender: 'Admin', baan: null }
  }
  return { sheetActor: actorText, sender: actorText, baan: null }
}

function chatTimeParts() {
  const now = new Date()
  const date = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return {
    timestamp: `${date} ${time}`,
    dateKey: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    dateLabel: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    timeLabel: time,
  }
}

function chatFingerprint(message: GroupChatMessage) {
  return [
    String(message.sender || '').trim().toLowerCase(),
    String(message.baan ?? ''),
    String(message.message || '').trim(),
    normalizeTarget(message.sendTo).toLowerCase(),
    String(message.replyToId || '').trim(),
    normalizeMode(message.topic),
  ].join('\u001f')
}

async function messagesWithLive(mode: ChatMode) {
  const [sheetMessages, liveMessages] = await Promise.all([
    fetchGroupChatMessages(mode),
    readChatLiveMessages(mode),
  ])
  const sheetFingerprints = new Set(sheetMessages.map(chatFingerprint))
  const pendingMessages: GroupChatMessage[] = []

  await Promise.all(liveMessages.map(async message => {
    if (sheetFingerprints.has(chatFingerprint(message))) {
      await deleteChatLiveMessage(mode, message.clientId).catch(() => undefined)
      return
    }
    pendingMessages.push(message)
  }))

  return [...sheetMessages, ...pendingMessages].sort((a, b) => a.row - b.row)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const mode = normalizeMode(url.searchParams.get('mode'))
  const latestOnly = url.searchParams.get('latest') === '1'

  try {
    if (latestOnly) {
      const [latestSheetId, liveMessages] = await Promise.all([
        fetchGroupChatLatestId(mode),
        readChatLiveMessages(mode),
      ])
      const latestLiveId = liveMessages[liveMessages.length - 1]?.chatId || ''
      return NextResponse.json({
        ok: true,
        latestId: latestLiveId || latestSheetId,
      }, {
        headers: { 'Cache-Control': 'no-store' },
      })
    }

    const messages = await messagesWithLive(mode)
    return NextResponse.json({
      ok: true,
      messages,
      latestId: messages[messages.length - 1]?.chatId || '',
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message, messages: [] }, { status: 500 })
  }
}

export async function POST(req: Request) {
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON' }, { status: 400 })
  }

  const mode = normalizeMode(payload.topic || payload.mode)
  const text = String(payload.message || '').trim().slice(0, 500)
  if (!text) {
    return NextResponse.json({ ok: false, message: 'Message is blank' }, { status: 400 })
  }

  const clientId = String(payload.clientId || crypto.randomUUID()).trim()
  const sendTo = normalizeTarget(payload.sendTo)
  const replyToId = String(payload.replyToId || '').trim()
  const actorParts = actorMessageParts(payload.actor ?? payload.baan)
  if (!String(actorParts.sheetActor || '').trim()) {
    return NextResponse.json({ ok: false, message: 'Invalid chat actor' }, { status: 400 })
  }

  const time = chatTimeParts()
  const liveMessage: GroupChatMessage & { clientId: string } = {
    id: `live-${clientId}`,
    chatId: `live-${clientId}`,
    clientId,
    row: Date.now(),
    timestamp: time.timestamp,
    dateKey: time.dateKey,
    dateLabel: time.dateLabel,
    timeLabel: time.timeLabel,
    sender: actorParts.sender,
    baan: actorParts.baan,
    message: text,
    sendTo,
    replyToId,
    topic: mode,
    pending: true,
  }

  try {
    await publishChatLiveMessage(mode, liveMessage)
    after(() => persistChatMessage({
      mode,
      clientId,
      actor: actorParts.sheetActor,
      message: text,
      sendTo,
      replyToId,
    }))
    return NextResponse.json({
      ok: true,
      queued: true,
      message: 'Sending to sheet...',
      data: { message: liveMessage },
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}

async function persistChatMessage({
  mode,
  clientId,
  actor,
  message,
  sendTo,
  replyToId,
}: {
  mode: ChatMode
  clientId: string
  actor: number | string
  message: string
  sendTo: string
  replyToId: string
}) {
  try {
    await callGas({
      action: 'writeChat',
      actor,
      baan: actor,
      message,
      sendTo,
      replyToId,
      topic: mode,
    })
    await deleteChatLiveMessage(mode, clientId)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await markChatLiveMessageFailed(mode, clientId, errorMessage).catch(() => undefined)
  }
}
