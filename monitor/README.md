# Downtime alerts

Three separate things, each covering a failure the others cannot see.

| Layer | Catches | Survives |
|---|---|---|
| `GET /health` | the database being unreachable from inside the API | the API answering at all |
| `monitor/watchdog.js` | the API hanging, or either site going slow or down | the API dying — it is a separate process |
| UptimeRobot (set up in the browser) | the whole server or its network going down | the server dying — it runs off-site |

The watchdog runs **on the same machine as the API**. That is deliberate — it has
to survive the API hanging, which it does, because it is a different process. But
it cannot survive the machine itself going down or losing its network: a dead box
sends no email. That is the one gap, and UptimeRobot is what closes it. Do both.

## 1. Add to `.env`

```ini
NODE_ENV=production          # stops every 404 writing a full header dump to disk

ALERT_EMAIL_TO=you@grabatoz.ae,someone-else@grabatoz.ae
```

That is the minimum. The watchdog sends through the same `SUPPORT_EMAIL_*`
mailbox the app already uses, so nothing else needs configuring.

Optional, with their defaults:

```ini
MONITOR_INTERVAL_MS=60000            # how often the API is checked
MONITOR_SITE_INTERVAL_MS=600000      # how often the website is checked
MONITOR_SLOW_MS=3000                 # slower than this counts as "slow"
MONITOR_TIMEOUT_MS=15000             # no answer by now counts as "down"
MONITOR_FAILURES_BEFORE_ALERT=2      # bad checks in a row before emailing
MONITOR_REPEAT_ALERT_MS=1800000      # remind every 30 min while still broken
MONITOR_API_URL=https://api.grabatoz.ae/health
MONITOR_SITE_URL=https://www.grabatoz.ae/
HEALTH_DB_TIMEOUT_MS=4000            # database ping budget inside /health
```

## 2. Start it

```bash
cd ~/graba2z-offic-backend
git pull

pm2 restart Grab-Server --update-env          # picks up NODE_ENV + new db settings
pm2 start monitor/watchdog.js --name Grab-Watchdog
pm2 save                                      # survives a reboot
```

## 3. Check it works

```bash
node monitor/watchdog.js --test     # sends one test email, then exits
node monitor/watchdog.js --once     # one round of checks, prints, sends nothing
curl -s https://api.grabatoz.ae/health | head -20
pm2 logs Grab-Watchdog --lines 20 --nostream
```

A healthy `/health` answers `200`:

```json
{ "status": "ok", "database": { "ok": true, "state": "connected", "latencyMs": 12 } }
```

When the database is unreachable it answers `503` with `"status": "unhealthy"` —
**within four seconds**, never by hanging. That matters: during the outage this
was built for, a health check that waits forever reports nothing at all.

## What it costs

| Target | Every | Per day | Per month | Where |
|---|---|---|---|---|
| API `/health` | 60s | 1,440 | 43,200 | your own VPS — free |
| Website | 600s | 144 | **4,320** | Vercel CDN — 0.4% of the Hobby million |

The website is checked a tenth as often as the API on purpose. It is the one
that costs quota, and it is not the one that breaks: the API runs on a VPS we
manage, the website is static files on Vercel.

The cost of that is detection speed. With two strikes required, a dead website
is reported up to **20 minutes** after it dies. Set
`MONITOR_SITE_FAILURES_BEFORE_ALERT=1` to halve that, at the price of the odd
false alarm from a momentary network blip.

## 4. UptimeRobot — 5 minutes, free

1. uptimerobot.com → **Add New Monitor**
2. Type **HTTP(s)**, URL `https://api.grabatoz.ae/health`
3. Interval 5 minutes, add your email as the alert contact
4. Repeat for `https://www.grabatoz.ae/`

It reads the HTTP status, so `503` from `/health` trips it automatically.

## While it is still down

```bash
pm2 logs Grab-Server --err --lines 100 --nostream
grep -a "\[db\]" /root/.pm2/logs/Grab-Server-out.log | tail -20   # connection drops
grep -aE "502|504|upstream" /var/log/nginx/error.log | tail -20
```

`[db] main DISCONNECTED` in the log is the signature of the stall that caused the
outage this was written for. Before these changes it left no trace at all.
