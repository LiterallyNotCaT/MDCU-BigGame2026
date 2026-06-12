import { createConnection, type Socket } from 'node:net'
import { connect, type TLSSocket } from 'node:tls'
import { createClient } from '@vercel/kv'
import { NextResponse } from 'next/server'
import {
  DEFAULT_AMBASSADOR_VISIBILITY,
  DEFAULT_CHAT_PERMISSIONS,
  normalizeAmbassadorVisibility,
  normalizeChatPermissions,
  type GameState,
} from '@/lib/constants'

export const runtime = 'nodejs'

const GAME_STATE_KEY = 'cloud_biggame_state'
let cachedState: GameState | null = null
let cachedAt = 0
const GET_CACHE_MS = 800

const defaultState: GameState = {
  currentWave: 1,
  isOpen: false,
  timerEnd: null,
  duration: 10,
  gameMode: 'bid',
  gamePhase: 'play',
  showResults: false,
  showEventSolution: false,
  ambassadorVisibility: DEFAULT_AMBASSADOR_VISIBILITY,
  chatPermissions: DEFAULT_CHAT_PERMISSIONS,
}

function normalizeGameState(value: unknown): GameState {
  const state = (value && typeof value === 'object' ? value : {}) as Partial<GameState>
  const currentWave = Number(state.currentWave)
  const duration = Number(state.duration)
  const gamePhase =
    state.gamePhase === 'select-disaster'
      ? 'select-disaster'
      : state.gamePhase === 'welcome'
      ? 'welcome'
      : state.gamePhase === 'rules'
      ? 'rules'
      : 'play'
  const gameMode =
    gamePhase === 'welcome' || gamePhase === 'rules'
      ? 'bid'
      : state.gameMode === 'bet' || state.gameMode === 'event'
      ? state.gameMode
      : 'bid'

  return {
    ...defaultState,
    ...state,
    currentWave: Number.isFinite(currentWave) && currentWave >= 1 ? currentWave : defaultState.currentWave,
    isOpen: state.isOpen === true,
    timerEnd: typeof state.timerEnd === 'string' && state.timerEnd ? state.timerEnd : null,
    duration: Number.isFinite(duration) && duration > 0 ? duration : defaultState.duration,
    gameMode,
    gamePhase: gameMode === 'bid' ? gamePhase : 'play',
    showResults: state.showResults === true,
    showEventSolution: state.showEventSolution === true,
    ambassadorVisibility: normalizeAmbassadorVisibility(state.ambassadorVisibility),
    chatPermissions: normalizeChatPermissions(state.chatPermissions),
    updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : undefined,
  }
}

function encodeCommand(args: string[]) {
  return args.reduce(
    (command, arg) => `${command}$${Buffer.byteLength(arg)}\r\n${arg}\r\n`,
    `*${args.length}\r\n`,
  )
}

function parseRedisValue(buffer: Buffer): { value: unknown; consumed: number } | null {
  const lineEnd = buffer.indexOf('\r\n')
  if (lineEnd < 0) return null

  const prefix = String.fromCharCode(buffer[0])
  const line = buffer.subarray(1, lineEnd).toString()
  const next = lineEnd + 2

  if (prefix === '+') return { value: line, consumed: next }
  if (prefix === ':') return { value: Number(line), consumed: next }
  if (prefix === '-') throw new Error(line)

  if (prefix === '$') {
    const length = Number(line)
    if (length === -1) return { value: null, consumed: next }
    const end = next + length
    if (buffer.length < end + 2) return null
    return { value: buffer.subarray(next, end).toString(), consumed: end + 2 }
  }

  throw new Error(`Unsupported Redis response: ${prefix}`)
}

async function redisUrlCommand(args: string[]) {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) throw new Error('Missing REDIS_URL')

  const url = new URL(redisUrl)
  const port = Number(url.port || (url.protocol === 'rediss:' ? 6380 : 6379))
  const socket: Socket | TLSSocket = url.protocol === 'rediss:'
    ? connect({ host: url.hostname, port, servername: url.hostname })
    : createConnection({ host: url.hostname, port })

  const responsesNeeded = url.password ? 2 : 1
  const commands = [
    ...(url.password ? [['AUTH', decodeURIComponent(url.username || 'default'), decodeURIComponent(url.password)]] : []),
    args,
  ]

  return await new Promise<unknown>((resolve, reject) => {
    let pending = Buffer.alloc(0)
    const values: unknown[] = []
    const done = (err?: Error, value?: unknown) => {
      socket.destroy()
      if (err) reject(err)
      else resolve(value)
    }

    socket.setTimeout(8000, () => done(new Error('Redis command timed out')))
    socket.once('error', done)
    socket.once('connect', () => {
      socket.write(commands.map(encodeCommand).join(''))
    })
    socket.on('data', chunk => {
      try {
        pending = Buffer.concat([pending, chunk])
        while (values.length < responsesNeeded) {
          const parsed = parseRedisValue(pending)
          if (!parsed) return
          values.push(parsed.value)
          pending = pending.subarray(parsed.consumed)
        }
        done(undefined, values[values.length - 1])
      } catch (error) {
        done(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
}

function getRestKvClient() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null
  return createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  })
}

async function readGameState() {
  if (cachedState && Date.now() - cachedAt < GET_CACHE_MS) return cachedState

  const restKv = getRestKvClient()
  if (restKv) {
    cachedState = await restKv.get<GameState>(GAME_STATE_KEY)
    cachedAt = Date.now()
    return cachedState
  }

  if (process.env.REDIS_URL) {
    const raw = await redisUrlCommand(['GET', GAME_STATE_KEY])
    cachedState = typeof raw === 'string' ? JSON.parse(raw) as GameState : null
    cachedAt = Date.now()
    return cachedState
  }

  throw new Error('Missing KV_REST_API_URL/KV_REST_API_TOKEN or REDIS_URL')
}

async function writeGameState(state: GameState) {
  cachedState = state
  cachedAt = Date.now()

  const restKv = getRestKvClient()
  if (restKv) {
    await restKv.set(GAME_STATE_KEY, state)
    return
  }

  if (process.env.REDIS_URL) {
    await redisUrlCommand(['SET', GAME_STATE_KEY, JSON.stringify(state)])
    return
  }

  throw new Error('Missing KV_REST_API_URL/KV_REST_API_TOKEN or REDIS_URL')
}

export async function GET() {
  try {
    const state = await readGameState()
    return NextResponse.json(normalizeGameState(state), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('Game state GET failed:', error)
    return NextResponse.json(defaultState, {
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}

export async function POST(req: Request) {
  try {
    const state = normalizeGameState(await req.json())
    await writeGameState(state)
    return NextResponse.json({ success: true, state })
  } catch (error) {
    console.error('Game state POST failed:', error)
    return NextResponse.json({ success: false }, { status: 500 })
  }
}
