import express from "express"
import asyncHandler from "express-async-handler"
import mongoose from "mongoose"
import jwt from "jsonwebtoken"

import DeviceToken from "../models/deviceTokenModel.js"
import PushNotification from "../models/pushNotificationModel.js"
import User from "../models/userModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import { checkPermission, logActivity } from "../middleware/permissionMiddleware.js"
import { countAudience, sendPushNotification, sendTestPush, pushStatus } from "../utils/push.js"
import { PUSH_SOUNDS, normalizePushSound } from "../utils/pushSounds.js"
import config from "../config/config.js"

const router = express.Router()

// Reads the bearer token when there is one and otherwise carries on. Device registration
// and the inbox work for guests too, so they cannot demand a login the way `protect` does.
const optionalAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || ""
    if (header.startsWith("Bearer ")) {
      const decoded = jwt.verify(header.slice(7), config.JWT_SECRET)
      req.user = await User.findById(decoded.id).select("_id name email").lean()
    }
  } catch {
    req.user = null
  }
  next()
}

const PLATFORMS = new Set(["android", "ios", "web"])

// ===========================================================================
// App
// ===========================================================================

// @desc    Register (or refresh) this install's push token. Called by the app on launch
//          and again after login so the token is attached to the account.
// @route   POST /api/notifications/devices
// @access  Public (bearer token optional)
router.post(
  "/devices",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const token = String(req.body.token || "").trim()
    if (!token || token.length < 20) {
      res.status(400)
      throw new Error("A push token is required")
    }
    const platform = PLATFORMS.has(String(req.body.platform || "").toLowerCase())
      ? String(req.body.platform).toLowerCase()
      : "unknown"

    const update = {
      platform,
      country: String(req.body.country || "").toUpperCase().slice(0, 2),
      language: String(req.body.language || "en").toLowerCase() === "ar" ? "ar" : "en",
      appVersion: String(req.body.appVersion || "").slice(0, 40),
      deviceName: String(req.body.deviceName || "").slice(0, 80),
      isActive: true,
      inactiveReason: "",
      lastSeenAt: new Date(),
    }
    // A signed-in registration claims the token; a guest one leaves any existing owner.
    if (req.user) update.user = req.user._id

    const row = await DeviceToken.findOneAndUpdate(
      { token },
      { $set: update, $setOnInsert: { token } },
      { new: true, upsert: true },
    )
    res.json({ ok: true, id: row._id, user: row.user || null })
  }),
)

// @desc    Stop pushes to this install (app logout or the user turning them off).
// @route   DELETE /api/notifications/devices/:token
// @access  Public
router.delete(
  "/devices/:token",
  asyncHandler(async (req, res) => {
    await DeviceToken.updateOne(
      { token: req.params.token },
      { $set: { isActive: false, inactiveReason: "user_logout", user: null } },
    )
    res.json({ ok: true })
  }),
)

// @desc    Notifications for the app's inbox screen: everything sent to everyone, plus
//          anything sent to this signed-in user. Newest first.
// @route   GET /api/notifications/inbox
// @access  Public (bearer token optional)
router.get(
  "/inbox",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20))
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const platform = String(req.query.platform || "").toLowerCase()
    const country = String(req.query.country || "").toUpperCase()
    const lang = String(req.query.lang || "en").toLowerCase() === "ar" ? "ar" : "en"

    const now = new Date()
    const audienceOr = [{ "audience.type": "all" }]
    if (platform) audienceOr.push({ "audience.type": "platform", "audience.platform": platform })
    if (country) audienceOr.push({ "audience.type": "country", "audience.country": country })
    if (req.user) {
      audienceOr.push({ "audience.type": "signed_in" })
      audienceOr.push({ "audience.type": "users", "audience.users": req.user._id })
    } else {
      audienceOr.push({ "audience.type": "guests" })
    }

    const query = {
      status: "sent",
      $or: audienceOr,
      $and: [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }],
    }

    const [rows, total] = await Promise.all([
      PushNotification.find(query)
        .sort({ sentAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("title body titleAr bodyAr imageUrl action sentAt")
        .lean(),
      PushNotification.countDocuments(query),
    ])

    res.json({
      notifications: rows.map((n) => ({
        id: String(n._id),
        title: lang === "ar" && n.titleAr ? n.titleAr : n.title,
        body: lang === "ar" && n.bodyAr ? n.bodyAr : n.body,
        imageUrl: n.imageUrl || "",
        action: n.action || { screen: "none", targetId: "", url: "" },
        sentAt: n.sentAt,
      })),
      page,
      limit,
      total,
      hasMore: page * limit < total,
    })
  }),
)

// ===========================================================================
// Admin
// ===========================================================================

const adminGuard = [protect, admin, checkPermission("pushNotifications")]

const SCREENS = new Set(["home", "product", "category", "offer", "orders", "cart", "url", "none"])
const AUDIENCES = new Set(["all", "platform", "country", "users", "signed_in", "guests"])

// Pull the editable fields out of a request body, refusing anything malformed.
const readNotificationBody = (body, res) => {
  const title = String(body.title || "").trim()
  const text = String(body.body || "").trim()
  if (!title || !text) {
    res.status(400)
    throw new Error("Title and message are required")
  }
  const screen = SCREENS.has(body.action?.screen) ? body.action.screen : "none"
  const audienceType = AUDIENCES.has(body.audience?.type) ? body.audience.type : "all"
  const users = (body.audience?.users || []).filter((id) => mongoose.Types.ObjectId.isValid(id))
  if (audienceType === "users" && users.length === 0) {
    res.status(400)
    throw new Error("Choose at least one customer for a targeted notification")
  }
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
    res.status(400)
    throw new Error("The scheduled time is not a valid date")
  }
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null

  return {
    title: title.slice(0, 120),
    body: text.slice(0, 500),
    titleAr: String(body.titleAr || "").trim().slice(0, 120),
    bodyAr: String(body.bodyAr || "").trim().slice(0, 500),
    imageUrl: String(body.imageUrl || "").trim(),
    sound: normalizePushSound(body.sound),
    action: {
      screen,
      targetId: String(body.action?.targetId || "").trim(),
      url: String(body.action?.url || "").trim(),
    },
    audience: {
      type: audienceType,
      platform: ["android", "ios"].includes(body.audience?.platform) ? body.audience.platform : "",
      country: String(body.audience?.country || "").toUpperCase().slice(0, 2),
      users,
    },
    scheduledAt,
    expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
  }
}

// @desc    Whether Firebase is configured, plus device counts for the audience picker
// @route   GET /api/notifications/admin/status
// @access  Private/Admin
router.get(
  "/admin/status",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const [total, android, ios, signedIn, byCountry] = await Promise.all([
      DeviceToken.countDocuments({ isActive: true }),
      DeviceToken.countDocuments({ isActive: true, platform: "android" }),
      DeviceToken.countDocuments({ isActive: true, platform: "ios" }),
      DeviceToken.countDocuments({ isActive: true, user: { $ne: null } }),
      DeviceToken.aggregate([
        { $match: { isActive: true, country: { $ne: "" } } },
        { $group: { _id: "$country", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ])
    res.json({
      ...pushStatus(),
      // The sounds the admin screen may offer, so the list lives in one place.
      sounds: PUSH_SOUNDS.map(({ id, label }) => ({ id, label })),
      devices: {
        total,
        android,
        ios,
        signedIn,
        guests: total - signedIn,
        byCountry: byCountry.map((r) => ({ country: r._id, count: r.count })),
      },
    })
  }),
)

// @desc    How many devices a draft audience would reach
// @route   POST /api/notifications/admin/audience-count
// @access  Private/Admin
router.post(
  "/admin/audience-count",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    res.json({ count: await countAudience(req.body.audience || {}) })
  }),
)

// @desc    Campaign history
// @route   GET /api/notifications/admin/list
// @access  Private/Admin
router.get(
  "/admin/list",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25))
    const query = {}
    if (["draft", "scheduled", "sending", "sent", "failed"].includes(req.query.status)) query.status = req.query.status

    const [rows, total] = await Promise.all([
      PushNotification.find(query)
        .populate("createdBy", "name email")
        .populate("audience.users", "name email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      PushNotification.countDocuments(query),
    ])
    res.json({ notifications: rows, page, limit, total, hasMore: page * limit < total })
  }),
)

// @desc    Create a notification. `send: true` sends it straight away; a `scheduledAt`
//          in the future queues it; otherwise it is saved as a draft.
// @route   POST /api/notifications/admin
// @access  Private/Admin
router.post(
  "/admin",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const fields = readNotificationBody(req.body, res)
    const sendNow = Boolean(req.body.send)
    const status = sendNow ? "draft" : fields.scheduledAt && fields.scheduledAt > new Date() ? "scheduled" : "draft"

    const row = await PushNotification.create({ ...fields, status, createdBy: req.user._id })

    let result = null
    if (sendNow) result = await sendPushNotification(row._id)

    await logActivity({
      user: req.user,
      action: "CREATE",
      module: "OTHER",
      description: `${sendNow ? "Sent" : status === "scheduled" ? "Scheduled" : "Drafted"} push notification: ${row.title}`,
      targetId: String(row._id),
      targetName: row.title,
      req,
    })

    const fresh = await PushNotification.findById(row._id).lean()
    if (sendNow && result && !result.ok) {
      res.status(502)
      return res.json({ notification: fresh, error: result.error || "The notification could not be sent" })
    }
    res.status(201).json({ notification: fresh })
  }),
)

// @desc    Edit a draft or scheduled notification
// @route   PUT /api/notifications/admin/:id
// @access  Private/Admin
router.put(
  "/admin/:id",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400)
      throw new Error("Invalid notification id")
    }
    const row = await PushNotification.findById(req.params.id)
    if (!row) {
      res.status(404)
      throw new Error("Notification not found")
    }
    if (!["draft", "scheduled", "failed"].includes(row.status)) {
      res.status(400)
      throw new Error("A notification that has been sent cannot be edited")
    }
    const fields = readNotificationBody(req.body, res)
    Object.assign(row, fields)
    row.status = fields.scheduledAt && fields.scheduledAt > new Date() ? "scheduled" : "draft"
    row.error = ""
    await row.save()
    res.json({ notification: row })
  }),
)

// @desc    Send a draft, scheduled or failed notification now
// @route   POST /api/notifications/admin/:id/send
// @access  Private/Admin
router.post(
  "/admin/:id/send",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400)
      throw new Error("Invalid notification id")
    }
    const result = await sendPushNotification(req.params.id)
    const fresh = await PushNotification.findById(req.params.id).lean()
    if (!fresh) {
      res.status(404)
      throw new Error("Notification not found")
    }
    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "OTHER",
      description: `Sent push notification: ${fresh.title} (${fresh.stats?.sent || 0} delivered)`,
      targetId: String(fresh._id),
      targetName: fresh.title,
      req,
    })
    if (!result.ok) {
      res.status(result.reason === "not_sendable" ? 400 : 502)
      return res.json({
        notification: fresh,
        error:
          result.reason === "not_sendable"
            ? "This notification has already been sent"
            : result.error || "The notification could not be sent",
      })
    }
    res.json({ notification: fresh })
  }),
)

// @desc    Send a test to one device token, or to every device of one customer
// @route   POST /api/notifications/admin/test
// @access  Private/Admin
router.post(
  "/admin/test",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const { title, body, imageUrl, action, token, userId, sound } = req.body
    if (!title || !body) {
      res.status(400)
      throw new Error("Title and message are required")
    }
    let tokens = []
    if (token) tokens = [String(token).trim()]
    else if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      tokens = (await DeviceToken.find({ user: userId, isActive: true }).select("token").lean()).map((d) => d.token)
    }
    if (tokens.length === 0) {
      res.status(400)
      throw new Error("No device found to send the test to")
    }
    let sent = 0
    const errors = []
    for (const t of tokens) {
      try {
        await sendTestPush({ token: t, title, body, imageUrl, action, sound: normalizePushSound(sound) })
        sent += 1
      } catch (error) {
        errors.push(error.message)
      }
    }
    res.json({ sent, attempted: tokens.length, errors })
  }),
)

// @desc    Delete a notification. Sent ones disappear from the app inbox too.
// @route   DELETE /api/notifications/admin/:id
// @access  Private/Admin
router.delete(
  "/admin/:id",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400)
      throw new Error("Invalid notification id")
    }
    const row = await PushNotification.findByIdAndDelete(req.params.id)
    if (!row) {
      res.status(404)
      throw new Error("Notification not found")
    }
    await logActivity({
      user: req.user,
      action: "DELETE",
      module: "OTHER",
      description: `Deleted push notification: ${row.title}`,
      targetId: String(row._id),
      targetName: row.title,
      req,
    })
    res.json({ ok: true })
  }),
)

// @desc    Registered devices, for support and for the "specific customers" picker
// @route   GET /api/notifications/admin/devices
// @access  Private/Admin
router.get(
  "/admin/devices",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50))
    const search = String(req.query.search || "").trim()
    const query = { isActive: true }
    if (search) {
      const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      const users = await User.find({ $or: [{ name: pattern }, { email: pattern }] }).select("_id").limit(200).lean()
      query.user = { $in: users.map((u) => u._id) }
    }
    const rows = await DeviceToken.find(query)
      .populate("user", "name email")
      .sort({ lastSeenAt: -1 })
      .limit(limit)
      .lean()
    res.json({ devices: rows.map((d) => ({ ...d, token: `${d.token.slice(0, 12)}…` })) })
  }),
)

export default router
