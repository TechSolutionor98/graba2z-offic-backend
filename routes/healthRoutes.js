import express from "express"
import mongoose from "mongoose"

const router = express.Router()

// How long the database gets to answer a one-document ping before this endpoint
// calls it unhealthy. Deliberately short: the question is not "is Atlas alive"
// but "could a visitor's page load have been served right now".
const DB_PING_TIMEOUT_MS = Number(process.env.HEALTH_DB_TIMEOUT_MS || 4000)

const READY_STATE = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
}

// A ping that cannot itself hang.
//
// This matters more than it looks. When the connection pool is exhausted -- the
// exact failure this endpoint exists to catch -- a plain ping joins the same
// queue as every other request and waits forever, and a health check that hangs
// reports nothing at all. Racing it against a timer means a drained pool is
// reported as unhealthy within four seconds instead of never.
const pingDatabase = async () => {
  const startedAt = Date.now()

  if (mongoose.connection.readyState !== 1) {
    return {
      ok: false,
      state: READY_STATE[mongoose.connection.readyState] || "unknown",
      latencyMs: null,
      error: "not connected",
    }
  }

  let timer
  try {
    const ping = mongoose.connection.db.admin().ping()
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`ping exceeded ${DB_PING_TIMEOUT_MS}ms`)), DB_PING_TIMEOUT_MS)
    })
    await Promise.race([ping, timeout])
    return { ok: true, state: "connected", latencyMs: Date.now() - startedAt, error: null }
  } catch (error) {
    return { ok: false, state: READY_STATE[mongoose.connection.readyState] || "unknown", latencyMs: Date.now() - startedAt, error: error.message }
  } finally {
    clearTimeout(timer)
  }
}

// GET /health
//
// Answers one question honestly: could this process serve a real request right
// now? "The process is running" is not that question -- PM2 already answers it,
// and it answered "online" throughout a full outage, because a hung Node process
// is still a running one. This endpoint touches the database, so it goes red for
// the failure that actually happens here.
//
// 200 when healthy, 503 when not, so any monitor can read it without parsing
// the body. The body is there for a human reading it afterwards.
router.get("/", async (req, res) => {
  const startedAt = Date.now()
  const db = await pingDatabase()

  const body = {
    status: db.ok ? "ok" : "unhealthy",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    responseMs: 0,
    database: {
      ok: db.ok,
      state: db.state,
      latencyMs: db.latencyMs,
      ...(db.error ? { error: db.error } : {}),
    },
    memory: {
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576),
    },
  }
  body.responseMs = Date.now() - startedAt

  // Never cached. A cached health check reports the past, and Cloudflare sits in
  // front of this host.
  res.set("Cache-Control", "no-store, no-cache, must-revalidate")
  return res.status(db.ok ? 200 : 503).json(body)
})

export default router
