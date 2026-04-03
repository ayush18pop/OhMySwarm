/**
 * server/index.ts — OhMySwarm Express + Socket.io entry point
 */

import 'dotenv/config'
import express           from 'express'
import cors              from 'cors'
import http              from 'http'
import { Server }        from 'socket.io'
import { initEmitter }   from './emit'
import sessionsRouter    from './routes/sessions'
import subagentsRouter   from './routes/subagents'
import walletRouter      from './routes/wallet'

const PORT         = parseInt(process.env.PORT ?? '3001')
const FRONTEND_ORIGINS = (
  process.env.FRONTEND_URLS
    ?? process.env.FRONTEND_URL
    ?? 'http://localhost:3000'
)
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

function isAllowedOrigin(origin?: string): boolean {
  // Non-browser tools (curl/postman/server-to-server) may not send Origin.
  if (!origin) return true
  return FRONTEND_ORIGINS.includes(origin)
}

// ── Express ───────────────────────────────────────────────────────────────────

const app    = express()
const server = http.createServer(app)

app.use(cors({
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) return cb(null, true)
    return cb(new Error(`CORS origin not allowed: ${origin}`))
  },
  credentials: true,
}))
app.use(express.json())

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/api/sessions', sessionsRouter)
app.use('/agents',       subagentsRouter)
app.use('/api/wallet',   walletRouter)

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

// ── Socket.io ─────────────────────────────────────────────────────────────────

const io = new Server(server, {
  cors: {
    origin: FRONTEND_ORIGINS,
    credentials: true,
  },
})

initEmitter(io)

io.on('connection', socket => {
  const sessionId = socket.handshake.query.sessionId as string | undefined

  if (sessionId) {
    socket.join(`session:${sessionId}`)
    console.log(`[socket] client joined session:${sessionId}`)
  }

  socket.on('join_session', (id: string) => {
    socket.join(`session:${id}`)
    console.log(`[socket] client joined session:${id}`)
  })

  socket.on('leave_session', (id: string) => {
    socket.leave(`session:${id}`)
  })

  socket.on('disconnect', () => {
    console.log(`[socket] client disconnected`)
  })
})

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║       OhMySwarm  ·  server           ║
  ║       http://localhost:${PORT}          ║
  ╚══════════════════════════════════════╝
  `)
})

export { app, io }
