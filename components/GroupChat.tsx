'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { MessageCircle, RefreshCw, Send, X } from 'lucide-react'
import { HOUSE_COLORS, HOUSE_NAMES, normalizeChatPermissions, type ChatPermissions } from '@/lib/constants'
import {
  type GroupChatActor,
  type GroupChatMessage,
} from '@/lib/sheets'
import { getGameState, subscribeStore } from '@/lib/store'

function isAdminActor(actor: GroupChatActor) {
  return String(actor).trim().toLowerCase() === 'admin'
}

function isSameActor(message: GroupChatMessage, actor: GroupChatActor) {
  return isAdminActor(actor)
    ? isAdminSender(message)
    : message.baan === actor || (!message.baan && String(message.sender).trim().toLowerCase() === String(actor).trim().toLowerCase())
}

function actorTarget(actor: GroupChatActor) {
  return isAdminActor(actor) ? 'admin' : String(actor).trim()
}

function senderTarget(message: GroupChatMessage) {
  return isAdminSender(message) ? 'admin' : message.baan ? String(message.baan) : String(message.sender || '').trim()
}

function targetLabel(target: string) {
  if (target === 'all') return 'All'
  if (target === 'public') return 'Group chat'
  if (target === 'admin') return 'Admin'
  const baan = Number(target)
  return Number.isInteger(baan) && baan >= 1 && baan <= 12 ? HOUSE_NAMES[baan] : target || 'Group chat'
}

function isHouseTarget(target: string) {
  const baan = Number(target)
  return Number.isInteger(baan) && baan >= 1 && baan <= 12
}

function canUseChatTarget(target: string, actor: GroupChatActor, permissions: ChatPermissions) {
  if (target === 'all') return true
  if (isAdminActor(actor)) {
    if (target === 'public') return permissions.groupChat
    return isHouseTarget(target)
  }
  if (!isHouseTarget(actorTarget(actor)) && target === 'admin') return true
  if (target === 'public') return permissions.groupChat
  if (target === 'admin') return permissions.adminPrivate
  if (isHouseTarget(target)) return permissions.playerPrivate && target !== actorTarget(actor)
  return false
}

function canViewMessage(message: GroupChatMessage, actor: GroupChatActor, permissions: ChatPermissions) {
  if (isAdminActor(actor)) return true
  const target = message.sendTo || 'public'
  if (target === 'public') return permissions.groupChat
  const currentActor = actorTarget(actor)
  const sender = senderTarget(message) || String(message.sender || '').trim()
  const involved = target === currentActor || sender === currentActor
  if (!involved) return false
  const withAdmin = target === 'admin' || sender === 'admin'
  return withAdmin ? permissions.adminPrivate : permissions.playerPrivate
}

function chatTargetOptions(actor: GroupChatActor, permissions: ChatPermissions, includeAll = false) {
  const self = actorTarget(actor)
  const isGenericStaff = !isAdminActor(actor) && !isHouseTarget(self)
  if (isGenericStaff) {
    return [
      ...(includeAll ? [{ value: 'all', label: 'All' }] : []),
      { value: 'admin', label: 'Admin' },
    ]
  }
  const options = [
    ...(includeAll ? [{ value: 'all', label: 'All' }] : []),
    { value: 'public', label: 'Group chat' },
    ...(self === 'admin' ? [] : [{ value: 'admin', label: 'Admin' }]),
    ...Array.from({ length: 12 }, (_, index) => index + 1)
      .filter(baan => String(baan) !== self)
      .map(baan => ({ value: String(baan), label: HOUSE_NAMES[baan] })),
  ]
  return options.filter(option => canUseChatTarget(option.value, actor, permissions))
}

function sendOptionsForChannel(actor: GroupChatActor, channelFilter: string, permissions: ChatPermissions) {
  const options = chatTargetOptions(actor, permissions)
  if (channelFilter === 'all' || channelFilter === 'public') return options
  return options.filter(option => option.value === channelFilter)
}

function messageChannelForActor(message: GroupChatMessage, actor: GroupChatActor) {
  const target = message.sendTo || 'public'
  if (target === 'public') return 'public'
  const currentActor = actorTarget(actor)
  const sender = senderTarget(message)
  if (sender === currentActor) return target
  if (target === currentActor) return sender
  return target
}

function latestIdsByChannel(messages: GroupChatMessage[], actor: GroupChatActor) {
  const latest: Record<string, string> = {}
  messages.forEach(message => {
    const id = message.id || message.chatId
    if (!id) return
    latest.all = id
    latest[messageChannelForActor(message, actor)] = id
  })
  return latest
}

function canSendToTarget(target: string, actor: GroupChatActor, permissions: ChatPermissions) {
  return target !== actorTarget(actor) && canUseChatTarget(target, actor, permissions)
}

function canViewReportMessage(message: GroupChatMessage, actor: GroupChatActor) {
  if (isAdminActor(actor)) return true
  const currentActor = actorTarget(actor)
  return senderTarget(message) === currentActor || (message.sendTo || '') === currentActor
}

function privateReplyTarget(message: GroupChatMessage, actor: GroupChatActor) {
  const currentActor = actorTarget(actor)
  const sender = senderTarget(message) || String(message.sender || '').trim()
  const originalTarget = message.sendTo || 'public'
  if (originalTarget === 'public') return ''
  if (sender && sender !== currentActor) return sender
  if (originalTarget !== currentActor) return originalTarget
  return ''
}

function actorLabel(actor: GroupChatActor) {
  if (isAdminActor(actor)) return 'Admin'
  const baan = Number(actor)
  return Number.isInteger(baan) && baan >= 1 && baan <= 12 ? HOUSE_NAMES[baan] : String(actor)
}

function messageSenderName(message: GroupChatMessage) {
  if (isAdminSender(message)) return 'Admin'
  if (message.baan) return HOUSE_NAMES[message.baan]
  return message.sender || 'Unknown'
}

function isAdminSender(message: GroupChatMessage) {
  const sender = String(message.sender || '').trim().toLowerCase()
  return sender === 'admin' || sender === 'unknown' || (!sender && message.baan == null)
}

function optimisticChatTime() {
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

function chatWait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isTransientFetchFailure(error: unknown) {
  return error instanceof TypeError
}

async function fetchChatJson<T>(url: string, init?: RequestInit): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) throw new Error(data?.message || `Chat request failed: ${res.status}`)
      return data as T
    } catch (error) {
      if (!isTransientFetchFailure(error) || attempt > 0) throw error
      await chatWait(300)
    }
  }
  throw new Error('Chat request failed')
}

async function fetchGroupChatMessages(mode: 'bid' | 'report' = 'bid') {
  const data = await fetchChatJson<{ messages: GroupChatMessage[]; latestId?: string }>(`/api/chat?mode=${encodeURIComponent(mode)}`)
  return data.messages ?? []
}

async function fetchGroupChatLatestId(mode: 'bid' | 'report' = 'bid') {
  const data = await fetchChatJson<{ latestId?: string }>(`/api/chat?mode=${encodeURIComponent(mode)}&latest=1`)
  return data.latestId || ''
}

async function sendGroupChatMessage(
  actor: GroupChatActor,
  message: string,
  options: { sendTo?: string; replyToId?: string; topic?: string; clientId?: string } = {}
): Promise<{ ok: boolean; message?: string }> {
  try {
    const data = await fetchChatJson<{ queued?: boolean; message?: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        actor,
        message,
        sendTo: options.sendTo ?? 'public',
        replyToId: options.replyToId ?? '',
        topic: options.topic ?? 'bid',
        clientId: options.clientId ?? '',
      }),
    })
    return { ok: true, message: data.message || 'Sending to sheet...' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export default function GroupChat({
  actor,
  label,
  mode = 'bid',
  reportTargets = [],
}: {
  actor: GroupChatActor
  label?: string
  mode?: 'bid' | 'report'
  reportTargets?: Array<{ value: string; label: string }>
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<GroupChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sendTo, setSendTo] = useState('public')
  const [channelFilter, setChannelFilter] = useState('all')
  const [replyTo, setReplyTo] = useState<GroupChatMessage | null>(null)
  const [sending, setSending] = useState(false)
  const [unread, setUnread] = useState(false)
  const [unreadChannels, setUnreadChannels] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [chatPermissions, setChatPermissions] = useState(() => normalizeChatPermissions(getGameState().chatPermissions))
  const seenLatestRef = useRef<Record<string, string>>({})
  const latestSheetIdRef = useRef('')
  const initializedRef = useRef(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const initialScrollDoneRef = useRef(false)
  const refreshInFlightRef = useRef(false)
  const latestInFlightRef = useRef(false)
  const chatTitle = label ?? (mode === 'report' ? 'Report' : 'Chat')
  const reportStaffOptions = useMemo(() => {
    const seen = new Set<string>()
    const options = new Map<string, string>()
    const allowedTargets = new Set(
      reportTargets
        .map(option => String(option.value || '').trim())
        .filter(Boolean)
    )
    const hasTargetLimit = allowedTargets.size > 0
    const addOption = (value: string) => {
      if (!value || value === 'admin' || value === 'public') return
      if (hasTargetLimit && !allowedTargets.has(value)) return
      seen.add(value)
      if (!options.has(value)) options.set(value, targetLabel(value))
    }
    reportTargets.forEach(option => {
      const value = String(option.value || '').trim()
      if (!value || value.toLowerCase() === 'admin' || value === 'public') return
      seen.add(value)
      options.set(value, option.label || targetLabel(value))
    })
    messages.forEach(message => {
      if ((message.topic || 'bid') !== 'report') return
      const sender = senderTarget(message)
      const target = message.sendTo || ''
      if (sender && sender !== 'admin') {
        addOption(sender)
      }
      if (target && target !== 'admin' && target !== 'public') {
        addOption(target)
      }
    })
    return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(value => ({ value, label: options.get(value) || targetLabel(value) }))
  }, [messages, reportTargets])
  const channelOptions = useMemo(() => mode === 'report'
    ? isAdminActor(actor)
      ? reportStaffOptions
      : [{ value: 'admin', label: 'Admin' }]
    : chatTargetOptions(actor, chatPermissions, true),
    [actor, chatPermissions, mode, reportStaffOptions]
  )
  const sendTargetOptions = useMemo(() => mode === 'report'
    ? isAdminActor(actor)
      ? channelFilter && channelFilter !== 'all'
        ? reportStaffOptions.filter(option => option.value === channelFilter)
        : []
      : [{ value: 'admin', label: 'Admin' }]
    : sendOptionsForChannel(actor, channelFilter, chatPermissions),
    [actor, channelFilter, chatPermissions, mode, reportStaffOptions]
  )
  const viewableMessages = useMemo(
    () => messages.filter(message => mode === 'report'
      ? canViewReportMessage(message, actor)
      : (message.topic || 'bid') === 'bid' && canViewMessage(message, actor, chatPermissions)),
    [actor, chatPermissions, messages, mode]
  )
  const visibleMessages = useMemo(
    () => viewableMessages.filter(message => channelFilter === 'all' || messageChannelForActor(message, actor) === channelFilter),
    [actor, channelFilter, viewableMessages]
  )
  const hasUnreadChannel = useCallback(
    (channel: string) => channel === 'all'
      ? Object.values(unreadChannels).some(Boolean)
      : Boolean(unreadChannels[channel]),
    [unreadChannels]
  )
  const messageByChatId = useMemo(
    () => new Map(viewableMessages.map(message => [message.chatId, message])),
    [viewableMessages]
  )
  const lockedReplyTarget = replyTo ? privateReplyTarget(replyTo, actor) : ''
  const composeTargetOptions = useMemo(
    () => lockedReplyTarget
      ? [{ value: lockedReplyTarget, label: targetLabel(lockedReplyTarget) }]
      : sendTargetOptions,
    [lockedReplyTarget, sendTargetOptions]
  )

  useEffect(() => {
    const update = () => setChatPermissions(normalizeChatPermissions(getGameState().chatPermissions))
    update()
    return subscribeStore(update)
  }, [])

  useEffect(() => {
    if (lockedReplyTarget) return
    if (!sendTargetOptions.some(option => option.value === sendTo)) setSendTo(sendTargetOptions[0]?.value ?? '')
  }, [lockedReplyTarget, sendTargetOptions, sendTo])

  useEffect(() => {
    if (channelFilter !== 'all' && channelFilter !== 'public' && sendTargetOptions.some(option => option.value === channelFilter)) {
      setSendTo(channelFilter)
    }
  }, [channelFilter, sendTargetOptions])

  useEffect(() => {
    if (!channelOptions.length) {
      if (channelFilter !== '') setChannelFilter('')
      return
    }
    if (!channelOptions.some(option => option.value === channelFilter)) setChannelFilter(channelOptions[0].value)
  }, [channelFilter, channelOptions])

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    try {
      const next = await fetchGroupChatMessages(mode)
      const viewableNext = next.filter(message => mode === 'report'
        ? canViewReportMessage(message, actor)
        : (message.topic || 'bid') === 'bid' && canViewMessage(message, actor, chatPermissions))
      latestSheetIdRef.current = next[next.length - 1]?.chatId || latestSheetIdRef.current
      const latestByChannel = latestIdsByChannel(viewableNext, actor)
      setMessages(next)
      setError('')
      if (!initializedRef.current) {
        initializedRef.current = true
        seenLatestRef.current = latestByChannel
        setUnread(false)
        setUnreadChannels({})
        return
      }
      if (open) {
        if (channelFilter === 'all') {
          seenLatestRef.current = latestByChannel
        } else if (latestByChannel[channelFilter]) {
          seenLatestRef.current = {
            ...seenLatestRef.current,
            [channelFilter]: latestByChannel[channelFilter],
          }
        }
      }

      const nextUnread: Record<string, boolean> = {}
      Object.entries(latestByChannel).forEach(([channel, latestId]) => {
        if (channel === 'all') return
        nextUnread[channel] = Boolean(latestId && latestId !== seenLatestRef.current[channel])
      })
      setUnreadChannels(nextUnread)
      setUnread(Object.values(nextUnread).some(Boolean))
      if (open && channelFilter === 'all') {
        setUnread(false)
      }
    } catch (e) {
      if (!isTransientFetchFailure(e)) {
        console.warn('Cannot load chat:', e)
        setError('Cannot load chat')
      }
    } finally {
      refreshInFlightRef.current = false
    }
  }, [actor, channelFilter, chatPermissions, mode, open])

  const checkLatest = useCallback(async () => {
    if (latestInFlightRef.current) return
    latestInFlightRef.current = true
    try {
      const latestId = await fetchGroupChatLatestId(mode)
      if (!latestId) return
      if (!latestSheetIdRef.current) {
        latestSheetIdRef.current = latestId
        return
      }
      if (latestId !== latestSheetIdRef.current) {
        await refresh()
      }
    } catch (e) {
      if (!isTransientFetchFailure(e)) console.warn('Cannot check latest chat:', e)
    } finally {
      latestInFlightRef.current = false
    }
  }, [mode, refresh])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (open) void refresh()
      else void checkLatest()
    }, open ? 3000 : 8000)
    return () => window.clearInterval(intervalId)
  }, [checkLatest, open, refresh])

  useEffect(() => {
    if (!open) {
      initialScrollDoneRef.current = false
      return
    }
    const latestByChannel = latestIdsByChannel(viewableMessages, actor)
    if (channelFilter === 'all') {
      seenLatestRef.current = latestByChannel
      setUnreadChannels({})
      setUnread(false)
      return
    }
    if (latestByChannel[channelFilter]) {
      seenLatestRef.current = {
        ...seenLatestRef.current,
        [channelFilter]: latestByChannel[channelFilter],
      }
    }
    setUnreadChannels(prev => {
      const next = { ...prev, [channelFilter]: false }
      return next
    })
  }, [actor, channelFilter, open, viewableMessages])

  useEffect(() => {
    if (!open || initialScrollDoneRef.current || !visibleMessages.length) return
    const frame = window.requestAnimationFrame(() => {
      const list = listRef.current
      if (!list) return
      list.scrollTop = list.scrollHeight
      initialScrollDoneRef.current = true
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, visibleMessages.length])

  useEffect(() => {
    setUnread(Object.values(unreadChannels).some(Boolean))
  }, [unreadChannels])

  const beginReply = (message: GroupChatMessage) => {
    setReplyTo(message)
    const lockedTarget = privateReplyTarget(message, actor)
    if (lockedTarget) {
      setSendTo(lockedTarget)
    } else if (!isSameActor(message, actor)) {
      const target = senderTarget(message)
      if (target) setSendTo(target)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const message = draft.trim()
    if (!message || sending) return
    const target = mode === 'report' ? (lockedReplyTarget || sendTargetOptions[0]?.value || '') : (lockedReplyTarget || sendTo)
    const canSend = mode === 'report'
      ? isAdminActor(actor)
        ? Boolean(target && target !== 'admin' && target !== 'public')
        : target === 'admin'
      : canSendToTarget(target, actor, chatPermissions)
    if (!canSend) {
      setError('This chat channel is disabled by admin')
      return
    }
    const effectiveTopic = mode
    setSending(true)
    setDraft('')
    const now = Date.now()
    const clientId = `${effectiveTopic}-${now}-${Math.random().toString(36).slice(2)}`
    const time = optimisticChatTime()
    const effectiveSendTo = target
    setMessages(prev => [...prev, {
      id: `live-${clientId}`,
      row: now,
      timestamp: time.timestamp,
      dateKey: time.dateKey,
      dateLabel: time.dateLabel,
      timeLabel: time.timeLabel,
      sender: isAdminActor(actor) ? 'Admin' : String(actor),
      baan: typeof actor === 'number' ? actor : null,
      message,
      chatId: `live-${clientId}`,
      clientId,
      sendTo: effectiveSendTo,
      replyToId: replyTo?.chatId ?? '',
      topic: effectiveTopic,
      pending: true,
    }])
    const result = await sendGroupChatMessage(actor, message, { sendTo: effectiveSendTo, replyToId: replyTo?.chatId ?? '', topic: effectiveTopic, clientId })
    if (!result.ok) {
      const errorText = result.message ?? 'Cannot send message'
      setError(errorText)
      setMessages(prev => prev.map(item => item.clientId === clientId ? { ...item, pending: false, error: errorText } : item))
    } else {
      setError('')
    }
    setReplyTo(null)
    window.setTimeout(refresh, 500)
    setSending(false)
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost group-chat-trigger" aria-label={`Open ${chatTitle}`}>
        <MessageCircle size={15} />
        {chatTitle}
        {unread && <span className="group-chat-dot" />}
      </button>

      {open && (
        <div className="group-chat-backdrop" role="dialog" aria-modal="true" aria-label={chatTitle}>
          <div className="group-chat-panel">
            <div className="group-chat-header">
              <div>
                <div className="group-chat-title">{chatTitle}</div>
                <div className="group-chat-subtitle">{actorLabel(actor)}</div>
              </div>
              <div className="group-chat-header-actions">
                <button type="button" onClick={() => void refresh()} className="group-chat-icon-btn" aria-label="Refresh chat">
                  <RefreshCw size={17} />
                </button>
                <button type="button" onClick={() => setOpen(false)} className="group-chat-icon-btn" aria-label="Close group chat">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="group-chat-channel-filter">
              <label className="group-chat-target">
                <span>Channel</span>
                <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)}>
                  {channelOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {hasUnreadChannel(option.value) ? `● ${option.label}` : option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div ref={listRef} className="group-chat-list">
              {visibleMessages.map((message, index) => {
                const isMine = isSameActor(message, actor)
                const isAdmin = isAdminSender(message)
                const color = isAdmin ? '#111827' : message.baan ? HOUSE_COLORS[message.baan] : '#64748b'
                const senderName = messageSenderName(message)
                const replySource = message.replyToId ? messageByChatId.get(message.replyToId) : null
                const dateKey = message.dateKey || 'unknown-date'
                const prevDateKey = index > 0 ? visibleMessages[index - 1].dateKey || 'unknown-date' : ''
                const showDateDivider = dateKey !== 'unknown-date' && dateKey !== prevDateKey
                return (
                  <Fragment key={message.id}>
                    {showDateDivider && (
                      <div className="group-chat-date-divider">{message.dateLabel || 'Unknown date'}</div>
                    )}
                    <div className={clsx('group-chat-message-row', isMine && 'is-mine')}>
                      <div className="group-chat-message-meta">
                        <span style={{ color }}>{senderName}</span>
                        <span>sent to {targetLabel(message.sendTo)}</span>
                      </div>
                      {message.replyToId && (
                        <div className="group-chat-reply-context">
                          <div className="group-chat-reply-author">
                            Replying to {replySource ? messageSenderName(replySource) : 'private message'}
                          </div>
                          {replySource && (
                            <div className="group-chat-reply-text">{replySource.message}</div>
                          )}
                        </div>
                      )}
                      <div className="group-chat-bubble-line">
                        <div className={clsx('group-chat-bubble', isMine && 'is-mine')} style={isMine ? { background: color } : undefined}>
                          {message.message}
                        </div>
                        <span className="group-chat-message-actions">
                          <span className="group-chat-time">{message.timeLabel}</span>
                          {message.error ? (
                            <span className="group-chat-time">not sent</span>
                          ) : message.pending ? (
                            <span className="group-chat-time">sending</span>
                          ) : null}
                          <button type="button" className="group-chat-reply-btn" onClick={() => beginReply(message)}>
                            reply
                          </button>
                        </span>
                      </div>
                    </div>
                  </Fragment>
                )
              })}
              {!visibleMessages.length && (
                <div className="group-chat-empty">No messages yet.</div>
              )}
            </div>

            {error && <div className="group-chat-error">{error}</div>}
            <form onSubmit={submit} className="group-chat-form">
              <div className="group-chat-compose-tools">
                {mode === 'report' ? (
                  <div className="group-chat-target-static">
                    To {composeTargetOptions[0]?.label ?? 'No channel'}
                  </div>
                ) : (
                  <label className="group-chat-target">
                    <span>To</span>
                    <select value={sendTo} onChange={e => setSendTo(e.target.value)} disabled={Boolean(lockedReplyTarget) || !composeTargetOptions.length}>
                      {!composeTargetOptions.length && (
                        <option value="">No channels</option>
                      )}
                      {composeTargetOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                {replyTo && (
                  <div className="group-chat-replying">
                    <span>
                      Replying to {messageSenderName(replyTo)}: {replyTo.message}
                    </span>
                    <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">x</button>
                  </div>
                )}
              </div>
              <div className="group-chat-input-row">
                <input
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  maxLength={500}
                  placeholder="Type a message"
                  className="group-chat-input"
                />
                <button type="submit" disabled={!draft.trim() || sending || !composeTargetOptions.length} className="group-chat-send" aria-label="Send message">
                  <Send size={18} />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
