'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { MessageCircle, Send, X } from 'lucide-react'
import { HOUSE_COLORS, HOUSE_NAMES, normalizeChatPermissions, type ChatPermissions } from '@/lib/constants'
import {
  fetchGroupChatMessages,
  sendGroupChatMessage,
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
  return Number.isInteger(baan) && baan >= 1 && baan <= 12 ? HOUSE_NAMES[baan] : 'Group chat'
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

function canSendToTarget(target: string, actor: GroupChatActor, permissions: ChatPermissions) {
  return target !== actorTarget(actor) && canUseChatTarget(target, actor, permissions)
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

export default function GroupChat({
  actor,
  label,
  topic = 'bid',
  topicOptions,
  adminOnly = false,
}: {
  actor: GroupChatActor
  label?: string
  topic?: string
  topicOptions?: string[]
  adminOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<GroupChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sendTo, setSendTo] = useState('public')
  const [channelFilter, setChannelFilter] = useState('all')
  const [topicFilter, setTopicFilter] = useState(topicOptions?.[0] ?? topic)
  const [replyTo, setReplyTo] = useState<GroupChatMessage | null>(null)
  const [sending, setSending] = useState(false)
  const [unread, setUnread] = useState(false)
  const [error, setError] = useState('')
  const [chatPermissions, setChatPermissions] = useState(() => normalizeChatPermissions(getGameState().chatPermissions))
  const seenLatestRef = useRef('')
  const initializedRef = useRef(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const channelOptions = useMemo(() => adminOnly
    ? [{ value: 'all', label: 'All' }, { value: 'admin', label: 'Admin' }]
    : chatTargetOptions(actor, chatPermissions, true),
    [actor, adminOnly, chatPermissions]
  )
  const sendTargetOptions = useMemo(() => adminOnly
    ? [{ value: 'admin', label: 'Admin' }]
    : sendOptionsForChannel(actor, channelFilter, chatPermissions),
    [actor, adminOnly, channelFilter, chatPermissions]
  )
  const viewableMessages = useMemo(
    () => messages.filter(message => adminOnly
      ? (isAdminActor(actor) ? true : isSameActor(message, actor))
      : canViewMessage(message, actor, chatPermissions)),
    [actor, adminOnly, chatPermissions, messages]
  )
  const visibleMessages = useMemo(
    () => viewableMessages.filter(message => {
      const messageTopic = message.topic || 'bid'
      const topicMatches = topicOptions?.length ? topicFilter === 'all' || messageTopic === topicFilter : messageTopic === topic
      return topicMatches && (channelFilter === 'all' || messageChannelForActor(message, actor) === channelFilter)
    }),
    [actor, channelFilter, topic, topicFilter, topicOptions?.length, viewableMessages]
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
    if (!channelOptions.some(option => option.value === channelFilter)) setChannelFilter('all')
  }, [channelFilter, channelOptions])

  const refresh = useCallback(async () => {
    try {
      const next = await fetchGroupChatMessages()
      const viewableNext = next.filter(message => canViewMessage(message, actor, chatPermissions))
      const latestId = viewableNext.at(-1)?.id ?? ''
      setMessages(next)
      setError('')
      if (!initializedRef.current) {
        initializedRef.current = true
        seenLatestRef.current = latestId
        return
      }
      if (latestId && latestId !== seenLatestRef.current && !open) setUnread(true)
      if (open) {
        seenLatestRef.current = latestId
        setUnread(false)
      }
    } catch (e) {
      console.error(e)
      setError('Cannot load chat')
    }
  }, [actor, chatPermissions, open])

  useEffect(() => {
    refresh()
    const intervalId = window.setInterval(refresh, 5000)
    return () => window.clearInterval(intervalId)
  }, [refresh])

  useEffect(() => {
    if (!open) {
      return
    }
    const latestId = viewableMessages.at(-1)?.id ?? ''
    seenLatestRef.current = latestId
    setUnread(false)
  }, [open, viewableMessages])

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
    const target = lockedReplyTarget || sendTo
    if (!canSendToTarget(target, actor, chatPermissions)) {
      setError('This chat channel is disabled by admin')
      return
    }
    const effectiveTopic = topicOptions?.length ? topicFilter : topic
    setSending(true)
    setDraft('')
    const now = Date.now()
    const time = optimisticChatTime()
    const effectiveSendTo = target
    setMessages(prev => [...prev, {
      id: `local-${now}`,
      row: -now,
      timestamp: time.timestamp,
      dateKey: time.dateKey,
      dateLabel: time.dateLabel,
      timeLabel: time.timeLabel,
      sender: isAdminActor(actor) ? 'Admin' : String(actor),
      baan: typeof actor === 'number' ? actor : null,
      message,
      chatId: `local-${now}`,
      sendTo: effectiveSendTo,
      replyToId: replyTo?.chatId ?? '',
      topic: effectiveTopic,
    }])
    const result = await sendGroupChatMessage(actor, message, { sendTo: effectiveSendTo, replyToId: replyTo?.chatId ?? '', topic: effectiveTopic })
    if (!result.ok) setError(result.message ?? 'Cannot send message')
    setReplyTo(null)
    window.setTimeout(refresh, 900)
    setSending(false)
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost group-chat-trigger" aria-label="Open group chat">
        <MessageCircle size={15} />
        {label ?? 'Group chat'}
        {unread && <span className="group-chat-dot" />}
      </button>

      {open && (
        <div className="group-chat-backdrop" role="dialog" aria-modal="true" aria-label="Group chat">
          <div className="group-chat-panel">
            <div className="group-chat-header">
              <div>
                <div className="group-chat-title">Group chat</div>
                <div className="group-chat-subtitle">{actorLabel(actor)}</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="group-chat-close" aria-label="Close group chat">
                <X size={18} />
              </button>
            </div>
            <div className="group-chat-channel-filter">
              {topicOptions?.length ? (
                <label className="group-chat-target">
                  <span>Topic</span>
                  <select value={topicFilter} onChange={e => setTopicFilter(e.target.value)}>
                    {topicOptions.map(option => (
                      <option key={option} value={option}>{option === 'all' ? 'All' : option === 'bid' ? 'Bid' : option === 'report' ? 'Report' : option}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="group-chat-target">
                <span>Channel</span>
                <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)}>
                  {channelOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
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
