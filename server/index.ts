/**
 * server/index.ts — OhMySwarm Express + Socket.io entry point
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { initEmitter } from "./emit";
import sessionsRouter from "./routes/sessions";
import subagentsRouter from "./routes/subagents";
import walletRouter from "./routes/wallet";

const PORT = parseInt(process.env.PORT ?? "3001");
const FRONTEND_ORIGINS = (
  process.env.FRONTEND_URLS ??
  process.env.FRONTEND_URL ??
  "http://localhost:3000"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const DEFAULT_ALLOWED_PATTERNS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://*.vercel.app",
];

const ALLOWED_PATTERNS = [
  ...DEFAULT_ALLOWED_PATTERNS,
  ...FRONTEND_ORIGINS,
].filter(Boolean);

function toRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wildcard = escaped.replace(/\\\*/g, ".*");
  return new RegExp(`^${wildcard}$`);
}

const ORIGIN_REGEXES = ALLOWED_PATTERNS.map(toRegex);

function isAllowedOrigin(origin?: string): boolean {
  // Non-browser tools (curl/postman/server-to-server) may not send Origin.
  if (!origin) return true;
  return ORIGIN_REGEXES.some((rx) => rx.test(origin));
}

// ── Express ───────────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);

app.use(
  cors({
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin)) return cb(null, true);
      return cb(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────

app.use("/api/sessions", sessionsRouter);
app.use("/agents", subagentsRouter);
app.use("/api/wallet", walletRouter);

app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Socket.io ─────────────────────────────────────────────────────────────────

const io = new Server(server, {
  cors: {
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin)) return cb(null, true);
      return cb(new Error(`CORS origin not allowed: ${origin}`), false);
    },
    credentials: true,
    methods: ["GET", "POST"],
  },
});

initEmitter(io);

io.on("connection", (socket) => {
  const sessionId = socket.handshake.query.sessionId as string | undefined;

  if (sessionId) {
    socket.join(`session:${sessionId}`);
    console.log(`[socket] client joined session:${sessionId}`);
  }

  socket.on("join_session", (id: string) => {
    socket.join(`session:${id}`);
    console.log(`[socket] client joined session:${id}`);
  });

  socket.on("leave_session", (id: string) => {
    socket.leave(`session:${id}`);
  });

  socket.on("disconnect", () => {
    console.log(`[socket] client disconnected`);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║       OhMySwarm  ·  server           ║
  ║       http://localhost:${PORT}          ║
  ╚══════════════════════════════════════╝
  `);
});

export { app, io };
