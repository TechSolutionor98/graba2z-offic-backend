import admin from "firebase-admin"

import DeviceToken from "../models/deviceTokenModel.js"
import PushNotification from "../models/pushNotificationModel.js"
import config from "../config/config.js"

// Sends admin-written notifications to the mobile app through Firebase Cloud Messaging.
//
// Firebase is the one push channel that reaches both Android and iOS from a single
// server credential, and it is what React Native and Flutter apps use by default. The
// server needs a Firebase service account (Project settings → Service accounts →
// Generate new private key) in FIREBASE_SERVICE_ACCOUNT, either as the raw JSON or
// base64 of it. Without it the admin screen still works for drafts, and a send reports
// a clear "not configured" error instead of crashing.

let app = null
let initError = ""

function loadServiceAccount() {
  const raw = String(config.FIREBASE_SERVICE_ACCOUNT || "").trim()
  if (!raw) return null
  // Accept the JSON as-is, or base64-encoded so it survives .env files and dashboards
  // that dislike multi-line values.
  const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")
  const parsed = JSON.parse(text)
  // Private keys pasted through shells often arrive with literal "\n".
  if (parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, "\n")
  return parsed
}

export function getFirebase() {
  if (app) return app
  if (initError) return null
  try {
    const serviceAccount = loadServiceAccount()
    if (!serviceAccount) {
      initError = "FIREBASE_SERVICE_ACCOUNT is not set"
      return null
    }
    app = admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
    return app
  } catch (error) {
    initError = `Firebase credentials could not be loaded: ${error.message}`
    console.error("[PUSH]", initError)
    return null
  }
}

export function pushStatus() {
  const ready = Boolean(getFirebase())
  return { configured: ready, error: ready ? "" : initError || "FIREBASE_SERVICE_ACCOUNT is not set" }
}

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

/** The active device rows a notification's audience resolves to. */
export async function resolveAudienceQuery(audience = {}) {
  const query = { isActive: true }
  switch (audience.type) {
    case "platform":
      if (audience.platform) query.platform = audience.platform
      break
    case "country":
      if (audience.country) query.country = String(audience.country).toUpperCase()
      break
    case "users":
      query.user = { $in: (audience.users || []).map((id) => (typeof id === "object" && id?._id ? id._id : id)) }
      break
    case "signed_in":
      query.user = { $ne: null }
      break
    case "guests":
      query.user = null
      break
    default:
      break
  }
  return query
}

export async function countAudience(audience) {
  return DeviceToken.countDocuments(await resolveAudienceQuery(audience))
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

// What the app receives in the data payload on every push, so a tap can open the
// right screen. Every value must be a string for FCM.
export function buildDataPayload(notification) {
  const action = notification.action || {}
  return {
    notificationId: String(notification._id),
    screen: action.screen || "none",
    targetId: action.targetId || "",
    url: action.url || "",
    imageUrl: notification.imageUrl || "",
  }
}

const FCM_BATCH = 500

// Token errors that mean "this install is gone" rather than "try again later".
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
])

/**
 * Send one saved notification to its audience. Marks the row sending → sent/failed and
 * records the counts. Safe to call once per row: a second call on a row that is already
 * sending or sent is refused.
 */
export async function sendPushNotification(notificationId) {
  const firebase = getFirebase()
  const claimed = await PushNotification.findOneAndUpdate(
    { _id: notificationId, status: { $in: ["draft", "scheduled", "failed"] } },
    { $set: { status: "sending", error: "" } },
    { new: true },
  )
  if (!claimed) return { ok: false, reason: "not_sendable" }

  if (!firebase) {
    const { error } = pushStatus()
    await PushNotification.updateOne({ _id: claimed._id }, { $set: { status: "failed", error } })
    return { ok: false, reason: "not_configured", error }
  }

  try {
    const query = await resolveAudienceQuery(claimed.audience)
    const devices = await DeviceToken.find(query).select("token language").lean()

    const stats = { targeted: devices.length, sent: 0, failed: 0, invalidTokens: 0 }
    const dead = []
    const data = buildDataPayload(claimed)

    // Arabic devices get the Arabic copy when the admin wrote one.
    const groups = { en: [], ar: [] }
    for (const d of devices) (d.language === "ar" && claimed.titleAr ? groups.ar : groups.en).push(d.token)

    for (const [lang, tokens] of Object.entries(groups)) {
      const title = lang === "ar" ? claimed.titleAr : claimed.title
      const body = lang === "ar" ? claimed.bodyAr || claimed.body : claimed.body
      for (let i = 0; i < tokens.length; i += FCM_BATCH) {
        const batch = tokens.slice(i, i + FCM_BATCH)
        const message = {
          tokens: batch,
          notification: { title, body, ...(claimed.imageUrl ? { imageUrl: claimed.imageUrl } : {}) },
          data,
          android: {
            priority: "high",
            notification: { sound: "default", ...(claimed.imageUrl ? { imageUrl: claimed.imageUrl } : {}) },
          },
          apns: {
            payload: { aps: { sound: "default", "mutable-content": 1 } },
            ...(claimed.imageUrl ? { fcm_options: { image: claimed.imageUrl } } : {}),
          },
        }
        const response = await firebase.messaging().sendEachForMulticast(message)
        stats.sent += response.successCount
        stats.failed += response.failureCount
        response.responses.forEach((r, idx) => {
          if (!r.success && DEAD_TOKEN_CODES.has(r.error?.code)) dead.push(batch[idx])
        })
      }
    }

    if (dead.length) {
      stats.invalidTokens = dead.length
      await DeviceToken.updateMany(
        { token: { $in: dead } },
        { $set: { isActive: false, inactiveReason: "unregistered" } },
      )
    }

    await PushNotification.updateOne(
      { _id: claimed._id },
      { $set: { status: "sent", sentAt: new Date(), stats } },
    )
    return { ok: true, stats }
  } catch (error) {
    console.error("[PUSH] send failed:", error)
    await PushNotification.updateOne(
      { _id: claimed._id },
      { $set: { status: "failed", error: error.message || "Send failed" } },
    )
    return { ok: false, reason: "error", error: error.message }
  }
}

/** Send a one-off test to a single token without creating a campaign row. */
export async function sendTestPush({ token, title, body, imageUrl = "", action = {} }) {
  const firebase = getFirebase()
  if (!firebase) throw new Error(pushStatus().error)
  return firebase.messaging().send({
    token,
    notification: { title, body, ...(imageUrl ? { imageUrl } : {}) },
    data: {
      notificationId: "test",
      screen: action.screen || "none",
      targetId: action.targetId || "",
      url: action.url || "",
      imageUrl: imageUrl || "",
    },
    android: { priority: "high", notification: { sound: "default" } },
    apns: { payload: { aps: { sound: "default", "mutable-content": 1 } } },
  })
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

let schedulerTimer = null

/** Sends anything whose scheduled time has arrived. Runs once a minute. */
export function startPushScheduler() {
  if (schedulerTimer) return
  const tick = async () => {
    try {
      const due = await PushNotification.find({ status: "scheduled", scheduledAt: { $lte: new Date() } })
        .select("_id")
        .limit(20)
        .lean()
      for (const row of due) await sendPushNotification(row._id)
    } catch (error) {
      console.error("[PUSH] scheduler tick failed:", error)
    }
  }
  schedulerTimer = setInterval(tick, 60 * 1000)
  schedulerTimer.unref?.()
  tick()
}
