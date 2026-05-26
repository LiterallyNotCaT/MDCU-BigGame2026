import { createConnection, type Socket } from 'node:net'
import { connect, type TLSSocket } from 'node:tls'
import { createClient } from '@vercel/kv'

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

export async function redisGetJson<T>(key: string): Promise<T | null> {
  const restKv = getRestKvClient()
  if (restKv) return await restKv.get<T>(key)

  if (process.env.REDIS_URL) {
    const raw = await redisUrlCommand(['GET', key])
    return typeof raw === 'string' ? JSON.parse(raw) as T : null
  }

  return null
}

export async function redisSetJson(key: string, value: unknown) {
  const restKv = getRestKvClient()
  if (restKv) {
    await restKv.set(key, value)
    return
  }

  if (process.env.REDIS_URL) {
    await redisUrlCommand(['SET', key, JSON.stringify(value)])
  }
}

export async function redisSetJsonIfNotExists(key: string, value: unknown, ttlSeconds: number) {
  const ttl = Math.max(30, Math.floor(ttlSeconds))
  const restKv = getRestKvClient()
  if (restKv) {
    const result = await restKv.set(key, value, { nx: true, ex: ttl })
    return result === 'OK'
  }

  if (process.env.REDIS_URL) {
    const result = await redisUrlCommand(['SET', key, JSON.stringify(value), 'NX', 'EX', String(ttl)])
    return result === 'OK'
  }

  throw new Error('Redis is required to prevent duplicate form submits')
}

export async function redisDeleteKey(key: string) {
  const restKv = getRestKvClient()
  if (restKv) {
    await restKv.del(key)
    return
  }

  if (process.env.REDIS_URL) {
    await redisUrlCommand(['DEL', key])
  }
}
