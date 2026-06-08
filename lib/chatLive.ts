import type { GroupChatMessage } from '@/lib/sheets'
import { redisDeleteKey, redisGetJson, redisSetJsonWithTtl } from '@/lib/redisStore'

export type ChatMode = 'bid' | 'report'

export type LiveChatMessage = GroupChatMessage & {
  clientId: string
  updatedAt: string
}

type ChatLiveState = {
  mode: ChatMode
  version: number
  updatedAt: string
  messages: Record<string, LiveChatMessage>
}

const CHAT_LIVE_TTL_SECONDS = 3 * 60

function chatLiveKey(mode: ChatMode) {
  return `biggame_chat_live:${mode}`
}

function normalizeMode(value: unknown): ChatMode {
  return String(value || '').trim().toLowerCase() === 'report' ? 'report' : 'bid'
}

function normalizeLiveState(mode: ChatMode, value: unknown): ChatLiveState {
  const raw = value && typeof value === 'object' ? value as Partial<ChatLiveState> : {}
  const rawMessages = raw.messages && typeof raw.messages === 'object' ? raw.messages : {}
  const messages = Object.entries(rawMessages).reduce<Record<string, LiveChatMessage>>((next, [key, item]) => {
    if (!item || typeof item !== 'object') return next
    const message = item as Partial<LiveChatMessage>
    const clientId = String(message.clientId || key || '').trim()
    if (!clientId) return next
    const baanNumber = Number(message.baan)
    next[clientId] = {
      id: String(message.id || `live-${clientId}`),
      chatId: String(message.chatId || `live-${clientId}`),
      clientId,
      row: Number.isFinite(Number(message.row)) ? Number(message.row) : 0,
      timestamp: String(message.timestamp || ''),
      dateKey: String(message.dateKey || ''),
      dateLabel: String(message.dateLabel || ''),
      timeLabel: String(message.timeLabel || ''),
      sender: String(message.sender || ''),
      baan: Number.isInteger(baanNumber) && baanNumber >= 1 && baanNumber <= 12 ? baanNumber : null,
      message: String(message.message || ''),
      sendTo: String(message.sendTo || 'public'),
      replyToId: String(message.replyToId || ''),
      topic: normalizeMode(message.topic),
      pending: message.pending === true,
      error: typeof message.error === 'string' ? message.error : '',
      updatedAt: String(message.updatedAt || ''),
    }
    return next
  }, {})

  return {
    mode,
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 0,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    messages,
  }
}

async function readChatLiveState(mode: ChatMode) {
  return normalizeLiveState(mode, await redisGetJson<ChatLiveState>(chatLiveKey(mode)))
}

async function writeChatLiveState(mode: ChatMode, state: ChatLiveState) {
  await redisSetJsonWithTtl(chatLiveKey(mode), state, CHAT_LIVE_TTL_SECONDS)
}

export async function readChatLiveMessages(modeValue: unknown) {
  const mode = normalizeMode(modeValue)
  const state = await readChatLiveState(mode)
  return Object.values(state.messages).sort((a, b) => a.row - b.row)
}

export async function publishChatLiveMessage(modeValue: unknown, message: GroupChatMessage & { clientId: string }) {
  const mode = normalizeMode(modeValue)
  const state = await readChatLiveState(mode)
  const now = new Date().toISOString()
  const nextMessage: LiveChatMessage = {
    ...message,
    clientId: message.clientId,
    id: message.id || `live-${message.clientId}`,
    chatId: message.chatId || `live-${message.clientId}`,
    topic: mode,
    pending: message.pending !== false,
    error: message.error || '',
    updatedAt: now,
  }
  await writeChatLiveState(mode, {
    mode,
    version: Math.max(Date.now(), state.version + 1),
    updatedAt: now,
    messages: {
      ...state.messages,
      [message.clientId]: nextMessage,
    },
  })
}

export async function markChatLiveMessageFailed(modeValue: unknown, clientId: string, error: string) {
  const mode = normalizeMode(modeValue)
  const state = await readChatLiveState(mode)
  const existing = state.messages[clientId]
  if (!existing) return
  const now = new Date().toISOString()
  await writeChatLiveState(mode, {
    mode,
    version: Math.max(Date.now(), state.version + 1),
    updatedAt: now,
    messages: {
      ...state.messages,
      [clientId]: {
        ...existing,
        pending: false,
        error,
        updatedAt: now,
      },
    },
  })
}

export async function deleteChatLiveMessage(modeValue: unknown, clientId: string) {
  const mode = normalizeMode(modeValue)
  const state = await readChatLiveState(mode)
  if (!state.messages[clientId]) return
  const nextMessages = { ...state.messages }
  delete nextMessages[clientId]
  if (!Object.keys(nextMessages).length) {
    await redisDeleteKey(chatLiveKey(mode))
    return
  }
  await writeChatLiveState(mode, {
    mode,
    version: Math.max(Date.now(), state.version + 1),
    updatedAt: new Date().toISOString(),
    messages: nextMessages,
  })
}
