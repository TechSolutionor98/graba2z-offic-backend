// Watches the live site and emails when it goes slow or stops answering.
//
// This runs as its OWN pm2 process, not inside the API, and that is the whole
// point of it. The outage it exists to catch is the one where the API process
// is still running -- pm2 green, no crash, no error in the log -- and simply
// stops answering requests. Code living inside that process cannot report it,
// because the thing that would do the reporting is the thing that is stuck.
// So this watches from the outside, over the network, the same way a customer
// does, and it shares nothing with the API: its own process, its own mail
// transport, no database, no imports from the app.
//
//   node monitor/watchdog.js           run it (pm2 does this)
//   node monitor/watchdog.js --once    one round of checks, print, no email
//   node monitor/watchdog.js --test    send a test email and exit
//
// Required in .env:   ALERT_EMAIL_TO, plus the SUPPORT_EMAIL_* block the app
//                     already uses to send mail.

import nodemailer from "nodemailer"
import dotenv from "dotenv"
import { captureIncident } from "./captureIncident.js"

dotenv.config()

const num = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const CONFIG = {
  // How often the API is checked. This is the one that actually breaks, it runs
  // on our own VPS, and checking it costs nothing.
  intervalMs: num(process.env.MONITOR_INTERVAL_MS, 60_000),

  // The website is checked far less often than the API, and the reason is money
  // rather than engineering. It is served by Vercel, where every check spends
  // one request out of the Hobby plan's monthly million. Once a minute would be
  // 43,200 a month; once every ten minutes is 4,320, which is close enough to
  // free to stop thinking about.
  //
  // The trade is detection speed: with two strikes required, a dead website is
  // reported up to twenty minutes after it dies rather than two. That is the
  // right trade here only because this target is static files on Vercel, which
  // almost never fail on their own. The thing that actually breaks is the API,
  // and the API is checked every minute because it costs us nothing.
  //
  // It is worth checking at all because it catches what the API check cannot:
  // an expired domain, a DNS change, a Cloudflare problem, a bad deploy.
  siteIntervalMs: num(process.env.MONITOR_SITE_INTERVAL_MS, 600_000),
  timeoutMs: num(process.env.MONITOR_TIMEOUT_MS, 15_000),
  slowMs: num(process.env.MONITOR_SLOW_MS, 3_000),

  // Two bad checks in a row before anybody is emailed. One failed request is a
  // dropped packet; two a minute apart is a problem. This is the difference
  // between an alert that gets read and one that gets filtered.
  failuresBeforeAlert: num(process.env.MONITOR_FAILURES_BEFORE_ALERT, 2),

  // While something stays broken, say so again this often. Without a reminder
  // a single 3am alert is easy to miss; with one every ten minutes, nobody
  // reads any of them.
  repeatAlertMs: num(process.env.MONITOR_REPEAT_ALERT_MS, 30 * 60_000),

  to: (process.env.ALERT_EMAIL_TO || "").split(",").map((s) => s.trim()).filter(Boolean),
  from: process.env.ALERT_EMAIL_FROM || process.env.SUPPORT_EMAIL_USER,
}

// What to watch. The API is checked through /health, which touches MongoDB, so
// a drained connection pool shows up here as a real failure rather than as a
// cheerful 200 from a process that cannot serve a single page.
const TARGETS = [
  {
    name: "API (api.grabatoz.ae)",
    url: process.env.MONITOR_API_URL || "https://api.grabatoz.ae/health",
    deep: true,
    get everyMs() {
      return CONFIG.intervalMs
    },
  },
  {
    name: "Website (www.grabatoz.ae)",
    url: process.env.MONITOR_SITE_URL || "https://www.grabatoz.ae/",
    deep: false,
    get everyMs() {
      return CONFIG.siteIntervalMs
    },
  },
]

const transporter = nodemailer.createTransport({
  host: process.env.SUPPORT_EMAIL_HOST,
  port: Number(process.env.SUPPORT_EMAIL_PORT),
  secure: process.env.SUPPORT_EMAIL_SECURE === "true",
  auth: {
    user: process.env.SUPPORT_EMAIL_USER,
    pass: process.env.SUPPORT_EMAIL_PASS,
  },
})

const dubai = (date = new Date()) =>
  date.toLocaleString("en-GB", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "medium" })

const humanDuration = (ms) => {
  const totalMinutes = Math.round(ms / 60_000)
  if (totalMinutes < 1) return "less than a minute"
  if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes}m`
}

const log = (...args) => console.log(`[watchdog ${new Date().toISOString()}]`, ...args)

// One request, timed, that cannot outlive its timeout.
const check = async (target) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs)
  const startedAt = Date.now()

  try {
    const response = await fetch(target.url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "grabatoz-watchdog", "cache-control": "no-cache" },
    })
    const latencyMs = Date.now() - startedAt

    if (!response.ok) {
      return { status: "DOWN", latencyMs, httpStatus: response.status, detail: `HTTP ${response.status}` }
    }

    // /health answers 200 only when it has actually reached the database, but
    // read the body too so the alert can say which part failed.
    if (target.deep) {
      try {
        const body = await response.json()
        if (body?.status !== "ok") {
          return {
            status: "DOWN",
            latencyMs,
            httpStatus: response.status,
            detail: `health reports "${body?.status}" (database: ${body?.database?.state}${body?.database?.error ? ` -- ${body.database.error}` : ""})`,
          }
        }
      } catch {
        return { status: "DOWN", latencyMs, httpStatus: response.status, detail: "health endpoint returned something that is not JSON" }
      }
    }

    if (latencyMs > CONFIG.slowMs) {
      return { status: "SLOW", latencyMs, httpStatus: response.status, detail: `took ${latencyMs}ms (limit ${CONFIG.slowMs}ms)` }
    }
    return { status: "UP", latencyMs, httpStatus: response.status, detail: "ok" }
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    const detail = error.name === "AbortError" ? `no answer within ${CONFIG.timeoutMs}ms` : error.message
    return { status: "DOWN", latencyMs, httpStatus: null, detail }
  } finally {
    clearTimeout(timer)
  }
}

const sendAlert = async ({ subject, headline, target, result, since, incident = null }) => {
  if (!CONFIG.to.length) {
    log("NO RECIPIENTS -- set ALERT_EMAIL_TO in .env. Alert not sent:", subject)
    return
  }

  const rows = [
    ["What", target.name],
    ["Address", target.url],
    ["State", result.status],
    ["Detail", result.detail],
    ["Response time", `${result.latencyMs} ms`],
    ["HTTP status", result.httpStatus ?? "no response"],
    ["Time (Dubai)", dubai()],
    ...(since ? [["Affected for", humanDuration(Date.now() - since)]] : []),
  ]

  // The snapshot goes in the body as well as the attachment. Someone reading
  // this on a phone at night should be able to see what the server looked like
  // without downloading anything.
  const snapshot = incident?.summary ? `\n\nWHAT THE SERVER LOOKED LIKE AT THAT MOMENT\n\n${incident.summary}` : ""

  const text = `${headline}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n${snapshot}`
  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:560px">
      <p style="font-size:17px;font-weight:600;margin:0 0 14px">${headline}</p>
      <table cellpadding="7" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">
        ${rows
          .map(
            ([k, v], i) =>
              `<tr style="background:${i % 2 ? "#ffffff" : "#f6f7f9"}"><td style="color:#6b7280;white-space:nowrap">${k}</td><td style="font-weight:500">${String(v)}</td></tr>`,
          )
          .join("")}
      </table>
      ${
        incident?.summary
          ? `<p style="font-size:13px;font-weight:600;margin:20px 0 6px">What the server looked like at that moment</p>
             <pre style="background:#0f1115;color:#e5e7eb;padding:12px;border-radius:8px;font-size:11px;line-height:1.5;overflow-x:auto;white-space:pre-wrap">${incident.summary.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c])}</pre>`
          : ""
      }
      ${incident?.file ? `<p style="color:#6b7280;font-size:12px">Full snapshot saved on the server: <code>${incident.file}</code></p>` : ""}
      <p style="color:#6b7280;font-size:12px;margin-top:18px">Sent by the Grabatoz watchdog on the API server.</p>
    </div>`

  try {
    await transporter.sendMail({
      from: CONFIG.from,
      to: CONFIG.to.join(","),
      subject,
      text,
      html,
      // The whole snapshot travels with the alert, so the evidence survives even
      // if somebody restarts the server before anyone reads the mail.
      ...(incident?.body
        ? { attachments: [{ filename: incident.file ? incident.file.split("/").pop() : "incident.log", content: incident.body }] }
        : {}),
    })
    log("alert emailed:", subject)
  } catch (error) {
    // The alert failing must never stop the watching.
    log("FAILED to send alert:", error.message)
  }
}

// One entry per target: what we last decided, when that started, how many bad
// checks in a row, and when we last said something about it.
const state = new Map()

const evaluate = async (target) => {
  const result = await check(target)
  const prev = state.get(target.name) || { status: "UP", since: Date.now(), strikes: 0, lastAlertAt: 0 }
  const bad = result.status !== "UP"

  const strikes = bad ? prev.strikes + 1 : 0
  const confirmed = bad && strikes >= CONFIG.failuresBeforeAlert

  log(`${target.name}: ${result.status} ${result.latencyMs}ms -- ${result.detail}${bad ? ` (strike ${strikes}/${CONFIG.failuresBeforeAlert})` : ""}`)

  // Recovered: we had told them it was broken, and now it is not.
  if (!bad && prev.status !== "UP") {
    await sendAlert({
      subject: `✅ RECOVERED: ${target.name} is back to normal`,
      headline: `${target.name} is answering normally again.`,
      target,
      result,
      since: prev.since,
    })
    state.set(target.name, { status: "UP", since: Date.now(), strikes: 0, lastAlertAt: 0 })
    return
  }

  if (!bad) {
    state.set(target.name, { status: "UP", since: prev.status === "UP" ? prev.since : Date.now(), strikes: 0, lastAlertAt: 0 })
    return
  }

  // Still inside the grace period -- count the strike and say nothing yet.
  if (!confirmed) {
    state.set(target.name, { ...prev, strikes })
    return
  }

  const changed = prev.status !== result.status
  const due = Date.now() - prev.lastAlertAt >= CONFIG.repeatAlertMs
  const since = prev.status === "UP" || changed ? Date.now() : prev.since

  if (changed || due) {
    // Snapshot the machine BEFORE the email goes out, while it is still in the
    // broken state. This is the whole reason the last outage went unexplained:
    // restarting fixed it and erased it at the same time.
    const incident = await captureIncident({ targetName: target.name, url: target.url, result })
    if (incident.file) log("incident snapshot written:", incident.file)

    await sendAlert({
      incident,
      subject:
        result.status === "DOWN"
          ? `🔴 DOWN: ${target.name} is not responding`
          : `🟠 SLOW: ${target.name} is responding slowly`,
      headline:
        result.status === "DOWN"
          ? `${target.name} is not answering requests. Customers cannot use it right now.`
          : `${target.name} is still answering, but slowly enough that customers will notice.`,
      target,
      result,
      since,
    })
    state.set(target.name, { status: result.status, since, strikes, lastAlertAt: Date.now() })
    return
  }

  state.set(target.name, { status: result.status, since, strikes, lastAlertAt: prev.lastAlertAt })
}

// The loop ticks at the shortest interval and each target decides whether it is
// due. One timer, independent schedules, and `--once` still checks everything.
const lastCheckedAt = new Map()

const runOnce = async ({ force = false } = {}) => {
  for (const target of TARGETS) {
    const due = force || Date.now() - (lastCheckedAt.get(target.name) || 0) >= (target.everyMs || CONFIG.intervalMs)
    if (!due) continue
    lastCheckedAt.set(target.name, Date.now())
    try {
      await evaluate(target)
    } catch (error) {
      log(`check for ${target.name} threw:`, error.message)
    }
  }
}

const main = async () => {
  if (process.argv.includes("--test")) {
    log("sending a test alert to:", CONFIG.to.join(", ") || "(nobody -- ALERT_EMAIL_TO is empty)")
    await sendAlert({
      subject: "🧪 TEST: Grabatoz watchdog",
      headline: "This is a test. Alerts are configured correctly.",
      target: { name: "Test", url: "n/a" },
      result: { status: "UP", latencyMs: 0, httpStatus: 200, detail: "test message" },
    })
    process.exit(0)
  }

  if (process.argv.includes("--once")) {
    await runOnce({ force: true })
    process.exit(0)
  }

  log(
    `started -- API every ${CONFIG.intervalMs / 1000}s, website every ${CONFIG.siteIntervalMs / 1000}s, slow above ${CONFIG.slowMs}ms, alerting ${CONFIG.to.join(", ") || "NOBODY (set ALERT_EMAIL_TO)"}`,
  )
  await runOnce({ force: true })
  setInterval(runOnce, Math.min(CONFIG.intervalMs, CONFIG.siteIntervalMs))
}

main()
