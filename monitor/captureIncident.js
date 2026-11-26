// Takes a snapshot of the server at the moment something breaks.
//
// This exists because of how the last outage went. The site was down, the owner
// looked at the server, everything seemed fine, and restarting it fixed the
// problem -- which also destroyed every piece of evidence about what the
// problem was. `pm2 logs` only keeps the last few lines on screen, a hung
// process writes nothing at all, and RAM, sockets and process state are gone
// the instant you restart.
//
// So the watchdog calls this the moment it decides something is broken, before
// anybody has touched anything. It writes one file per incident and emails the
// important parts, so the next outage leaves a body to examine.
//
// Everything here is read-only. It inspects; it never restarts or kills.

import { exec } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

const INCIDENT_DIR = process.env.INCIDENT_LOG_DIR || path.resolve(process.cwd(), "logs/incidents")

// No single command may hold up the snapshot. A hung box is exactly when these
// are most likely to be slow, and a diagnostic that hangs collects nothing.
const COMMAND_TIMEOUT_MS = Number(process.env.INCIDENT_COMMAND_TIMEOUT_MS || 5000)

// Enough to see a pattern, not so much that the file is unreadable or the mail
// bounces for size.
const MAX_OUTPUT_CHARS = 4000

const run = (command) =>
  new Promise((resolve) => {
    exec(command, { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const out = String(stdout || "").trim()
      const err = String(stderr || "").trim()
      if (out) return resolve(out.slice(0, MAX_OUTPUT_CHARS))
      if (error?.killed) return resolve(`(no answer within ${COMMAND_TIMEOUT_MS}ms -- the box may be struggling)`)
      if (err) return resolve(`(${err.slice(0, 400)})`)
      if (error) return resolve(`(unavailable: ${error.message.slice(0, 200)})`)
      return resolve("(no output)")
    })
  })

// Ordered by how often each one turns out to be the answer.
const CHECKS = [
  {
    title: "PROCESSES -- is it running, and how many times has it restarted",
    command: "pm2 jlist 2>/dev/null | head -c 100000",
    transform: (raw) => {
      try {
        const apps = JSON.parse(raw)
        return apps
          .map((a) => {
            const up = a.pm2_env?.pm_uptime ? Math.round((Date.now() - a.pm2_env.pm_uptime) / 60000) : "?"
            return `${String(a.name).padEnd(30)} ${String(a.pm2_env?.status).padEnd(10)} restarts=${String(a.pm2_env?.restart_time).padEnd(5)} uptime=${up}m  mem=${Math.round((a.monit?.memory || 0) / 1048576)}MB  cpu=${a.monit?.cpu}%`
          })
          .join("\n")
      } catch {
        return raw.slice(0, 1200)
      }
    },
  },
  {
    title: "MEMORY -- was the box out of RAM",
    command: "free -h 2>/dev/null || vm_stat 2>/dev/null | head -8",
  },
  {
    title: "LOAD -- was it overwhelmed rather than stuck",
    command: "uptime",
  },
  {
    title: "DISK -- a full disk stops writes without any application error",
    command: "df -h / 2>/dev/null",
  },
  {
    title: "DATABASE SOCKETS -- an exhausted connection pool is the known failure here",
    command:
      "ss -tan 2>/dev/null | awk '$5 ~ /:27017$/ {print $1}' | sort | uniq -c | sort -rn || netstat -an 2>/dev/null | grep 27017 | awk '{print $6}' | sort | uniq -c",
  },
  {
    title: "SOCKET SUMMARY -- too many open connections holds everything up",
    command: "ss -s 2>/dev/null | head -8 || netstat -an 2>/dev/null | wc -l",
  },
  {
    title: "OOM KILLER -- did the kernel kill something",
    command: "dmesg -T 2>/dev/null | grep -iE 'out of memory|killed process' | tail -10",
  },
  {
    title: "NGINX ERRORS -- 504 means the app accepted the request and never answered; 502 means it refused",
    command: "grep -aE '502|504|upstream|timed out' /var/log/nginx/error.log 2>/dev/null | tail -25",
  },
  {
    title: "APPLICATION ERRORS -- the last thing the app managed to say",
    command: "tail -60 /root/.pm2/logs/Grab-Server-error.log 2>/dev/null",
  },
  {
    title: "DATABASE CONNECTION EVENTS -- a stall now leaves a trace here",
    command: "grep -a '\\[db\\]' /root/.pm2/logs/Grab-Server-out.log 2>/dev/null | tail -15",
  },
]

/**
 * Snapshot the machine and write it to disk.
 * Never throws: a failure to collect evidence must not stop the alert going out.
 *
 * @returns {Promise<{file: string|null, summary: string, body: string}>}
 */
export const captureIncident = async ({ targetName, url, result }) => {
  const now = new Date()
  const stamp = now.toISOString().replace(/[:.]/g, "-")
  const slug = String(targetName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

  const header = [
    "=".repeat(74),
    `INCIDENT SNAPSHOT -- taken before anybody touched the server`,
    "=".repeat(74),
    `What        : ${targetName}`,
    `Address     : ${url}`,
    `State       : ${result?.status}`,
    `Detail      : ${result?.detail}`,
    `Response    : ${result?.latencyMs}ms, HTTP ${result?.httpStatus ?? "no response"}`,
    `Taken at    : ${now.toISOString()}  (${now.toLocaleString("en-GB", { timeZone: "Asia/Dubai" })} Dubai)`,
    "",
  ].join("\n")

  const sections = []
  for (const check of CHECKS) {
    try {
      const raw = await run(check.command)
      const text = check.transform ? check.transform(raw) : raw
      sections.push(`${"-".repeat(74)}\n${check.title}\n${"-".repeat(74)}\n${text}\n`)
    } catch (error) {
      sections.push(`${"-".repeat(74)}\n${check.title}\n${"-".repeat(74)}\n(collection failed: ${error.message})\n`)
    }
  }

  const body = header + sections.join("\n")

  let file = null
  try {
    await fs.mkdir(INCIDENT_DIR, { recursive: true })
    file = path.join(INCIDENT_DIR, `${stamp}-${slug}.log`)
    await fs.writeFile(file, body, "utf8")
    await pruneOldIncidents()
  } catch (error) {
    console.error(`[watchdog] could not write incident file: ${error.message}`)
    file = null
  }

  // The two lines most likely to explain it, for the top of the email.
  const summary = [sections[0], sections[1]].filter(Boolean).join("\n")

  return { file, summary, body }
}

// Incident files are small, but an unattended server writing them for months
// should not be the thing that fills the disk.
const pruneOldIncidents = async (keep = Number(process.env.INCIDENT_KEEP || 60)) => {
  try {
    const entries = (await fs.readdir(INCIDENT_DIR)).filter((f) => f.endsWith(".log")).sort()
    const excess = entries.slice(0, Math.max(0, entries.length - keep))
    await Promise.all(excess.map((f) => fs.unlink(path.join(INCIDENT_DIR, f)).catch(() => {})))
  } catch {
    /* nothing to prune */
  }
}

export default captureIncident
