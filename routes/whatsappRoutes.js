import express from "express"
import asyncHandler from "express-async-handler"

import Order from "../models/orderModel.js"
import WhatsAppContact from "../models/whatsappContactModel.js"
import WhatsAppMessage from "../models/whatsappMessageModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import { checkPermission, logActivity } from "../middleware/permissionMiddleware.js"
import { syncOrderLoyaltyForStatus } from "../utils/loyalty.js"
import { syncOrderReferralForStatus } from "../utils/referral.js"
import { recordOrderCancelled } from "../utils/stockLedger.js"
import {
  NOTIFICATION_EVENTS,
  TEMPLATE_VARIABLES,
  clearSettingsCache,
  describeReadiness,
  describeWindowBlock,
  findOrCreateContact,
  getSettings,
  isOptOutKeyword,
  isWithinServiceWindow,
  normalizePhone,
  readButtonPayload,
  readInboundText,
  recordSystemNote,
  sendFreeText,
  sendTestMessage,
  serviceWindowExpiry,
  touchConversation,
  verifyWebhookSignature,
} from "../services/whatsappService.js"

const router = express.Router()

// Only the shop's own staff, and only those given the WhatsApp permission.
const adminGuard = [protect, admin, checkPermission("whatsapp")]

// Messaging never changes the catalogue, so a busy inbox must not flush the
// whole server cache once per message.
const skipCacheInvalidation = (req, res, next) => {
  req.skipAutoCacheInvalidation = true
  next()
}

// ===========================================================================
// Webhook (public -- Meta calls these)
// ===========================================================================

// @desc    Meta's one-time subscription handshake
// @route   GET /api/whatsapp/webhook
// @access  Public (proved by the verify token the owner chose)
router.get(
  "/webhook",
  asyncHandler(async (req, res) => {
    const settings = await getSettings()
    const mode = req.query["hub.mode"]
    const token = req.query["hub.verify_token"]
    const challenge = req.query["hub.challenge"]

    if (mode === "subscribe" && settings.verifyToken && token === settings.verifyToken) {
      console.log("[WHATSAPP] Webhook verified by Meta")
      return res.status(200).send(String(challenge ?? ""))
    }

    console.warn("[WHATSAPP] Webhook verification refused -- the verify token did not match")
    return res.sendStatus(403)
  }),
)

/**
 * Act on a tapped Confirm/Cancel button.
 *
 * The payload names the order it came from, but it is checked against the number
 * that sent it: a payload that leaks or is forwarded must not be able to cancel
 * somebody else's order.
 */
async function applyOrderButton({ contact, payload, settings }) {
  const [action, orderId] = String(payload || "").split(":")
  if (action !== "order_confirm" && action !== "order_cancel") return null
  if (!orderId || !/^[a-f\d]{24}$/i.test(orderId)) return null

  const order = await Order.findById(orderId)
  if (!order) return { reply: "We could not find that order. Please reply with your order number." }

  const orderPhone = normalizePhone(
    order.deliveryType === "pickup" ? order.pickupDetails?.phone : order.shippingAddress?.phone,
    settings.defaultCountryCode,
  )
  if (!orderPhone || orderPhone !== contact.phone) {
    console.warn(`[WHATSAPP] Button for order ${orderId} came from ${contact.phone}, which is not the order's number`)
    await recordSystemNote(contact, `Ignored a button for order ${orderId}: it belongs to another number.`, {
      order: order._id,
    })
    return { reply: "" }
  }

  const previousStatus = order.status

  if (action === "order_confirm") {
    if (!["New", "Processing", "On Hold"].includes(previousStatus)) {
      return { reply: `Order ${`#${orderId.slice(-6).toUpperCase()}`} is already ${previousStatus.toLowerCase()}.` }
    }
    order.status = "Confirmed"
  } else {
    // Once an order is on its way, cancelling it is no longer the customer's to
    // do on their own -- a person has to get involved.
    if (["Shipped", "On the Way", "Out for Delivery", "Delivered", "Returned"].includes(previousStatus)) {
      return {
        reply: `Order ${`#${orderId.slice(-6).toUpperCase()}`} is already ${previousStatus.toLowerCase()} and cannot be cancelled here. Reply to this message and we will help.`,
      }
    }
    if (["Cancelled", "Deleted"].includes(previousStatus)) {
      return { reply: `Order ${`#${orderId.slice(-6).toUpperCase()}`} is already cancelled.` }
    }
    order.status = "Cancelled"
    order.cancelReason = "Cancelled by the customer on WhatsApp"
  }

  const updated = await order.save()

  // The same bookkeeping an admin status change does, because a customer's tap
  // cancels an order every bit as much as an admin's click does.
  if (updated.status === "Cancelled" && previousStatus !== "Cancelled") {
    await recordOrderCancelled(updated).catch((error) =>
      console.error("[WHATSAPP] Returning stock after a cancellation tap failed:", error?.message || error),
    )
  }

  // Points earned on an order stay pending until it is awarded, and are unwound
  // if it is cancelled.
  if (previousStatus !== updated.status) {
    await syncOrderLoyaltyForStatus(updated._id, updated.status).catch((error) =>
      console.error("[WHATSAPP] Loyalty sync after button tap failed:", error?.message || error),
    )
    await syncOrderReferralForStatus(updated._id, updated.status).catch((error) =>
      console.error("[WHATSAPP] Referral sync after button tap failed:", error?.message || error),
    )
  }

  await recordSystemNote(
    contact,
    `Order #${orderId.slice(-6).toUpperCase()} moved from "${previousStatus}" to "${updated.status}" by the customer on WhatsApp.`,
    { order: updated._id, event: action },
  )

  const label = `#${orderId.slice(-6).toUpperCase()}`
  return {
    reply:
      action === "order_confirm"
        ? `Thank you. Order ${label} is confirmed and we are preparing it now.`
        : `Order ${label} has been cancelled. If that was a mistake, reply here and we will sort it out.`,
    orderChanged: true,
  }
}

/** One inbound message from one customer. */
async function handleInboundMessage({ message, profileName, settings }) {
  const phone = normalizePhone(message.from, settings.defaultCountryCode)
  if (!phone) return

  // Writing to the shop is itself permission to be written back to.
  const contact = await findOrCreateContact({
    phone,
    name: profileName || "",
    source: "inbound",
  })

  const text = readInboundText(message)
  const receivedAt = message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date()

  // Meta retries a webhook it did not hear a 200 from. The message id is unique,
  // so a retry loses the race here and nothing is acted on twice -- which for a
  // Cancel tap would otherwise mean cancelling an order that was already cancelled.
  try {
    await WhatsAppMessage.create({
      contact: contact._id,
      phone,
      direction: "in",
      type: message.type === "text" ? "text" : "interactive",
      body: text,
      wamid: message.id || undefined,
      status: "received",
      raw: message,
    })
  } catch (error) {
    if (error?.code === 11000) {
      console.log(`[WHATSAPP] Ignoring a repeat delivery of message ${message.id}`)
      return
    }
    throw error
  }

  await touchConversation(contact, { direction: "in", preview: text, at: receivedAt, incrementUnread: true })

  // ---- Opt-out, checked on the whole message and nothing less ----
  if (isOptOutKeyword(text)) {
    await WhatsAppContact.updateOne(
      { _id: contact._id },
      { $set: { optedOut: true, optedOutAt: new Date(), optOutMessage: text } },
    )
    await recordSystemNote(contact, `Opted out of WhatsApp messages by replying "${text}".`)
    console.log(`[WHATSAPP] ${phone} opted out`)
    return
  }

  // A customer who was opted out and has written in again is asking to be
  // answered. That is consent, and it reopens the conversation.
  if (contact.optedOut) {
    await WhatsAppContact.updateOne(
      { _id: contact._id },
      { $set: { optedOut: false, optedOutAt: null, optOutMessage: "" } },
    )
    await recordSystemNote(contact, "Messaged the shop again after opting out, so replies are allowed once more.")
    contact.optedOut = false
  }

  // ---- A tapped Confirm / Cancel button ----
  const payload = readButtonPayload(message)
  if (payload) {
    const result = await applyOrderButton({ contact, payload, settings })
    if (result?.reply) {
      // The tap is itself an inbound message, so the 24-hour window is open and a
      // written confirmation is allowed.
      const fresh = await WhatsAppContact.findById(contact._id)
      await sendFreeText({ contact: fresh, text: result.reply, settings })
    }
  }
}

// The receipt states this app stores. Meta may add others; updateOne does not run
// schema validators, so an unrecognised one would otherwise be written straight
// through and show up as nonsense in the inbox.
const DELIVERY_STATES = ["sent", "delivered", "read", "failed"]

/** Delivery receipts: sent -> delivered -> read, or failed with a reason. */
async function handleStatusUpdate(status) {
  if (!status?.id) return
  if (!DELIVERY_STATES.includes(status.status)) {
    console.log(`[WHATSAPP] Ignoring an unrecognised delivery state "${status.status}"`)
    return
  }

  const update = { status: status.status }
  if (status.status === "failed") {
    const detail = status.errors?.[0]
    update.error = detail?.error_data?.details || detail?.title || "WhatsApp could not deliver this message."
  }
  await WhatsAppMessage.updateOne({ wamid: status.id }, { $set: update })
}

// @desc    Inbound messages and delivery receipts from Meta
// @route   POST /api/whatsapp/webhook
// @access  Public (proved by the X-Hub-Signature-256 header)
router.post(
  "/webhook",
  // Order rows are not cached, and a message is not catalogue data, so an inbound
  // message must not flush the server's cache.
  skipCacheInvalidation,
  asyncHandler(async (req, res) => {
    const settings = await getSettings()

    const signature = verifyWebhookSignature(req.rawBody, req.headers["x-hub-signature-256"], settings.appSecret)
    if (!signature.valid) {
      console.warn(`[WHATSAPP] Webhook refused: ${signature.reason}`)
      return res.sendStatus(403)
    }

    // Meta expects a prompt 200 and retries anything slower. The work below is
    // short, but it is deliberately not allowed to turn a hiccup into a retry
    // storm: every branch logs and moves on.
    res.sendStatus(200)

    try {
      const entries = Array.isArray(req.body?.entry) ? req.body.entry : []
      for (const entry of entries) {
        for (const change of entry.changes || []) {
          const value = change.value || {}
          const profileName = value.contacts?.[0]?.profile?.name || ""

          for (const message of value.messages || []) {
            await handleInboundMessage({ message, profileName, settings }).catch((error) =>
              console.error("[WHATSAPP] Inbound message failed:", error?.message || error),
            )
          }

          for (const status of value.statuses || []) {
            await handleStatusUpdate(status).catch((error) =>
              console.error("[WHATSAPP] Status update failed:", error?.message || error),
            )
          }
        }
      }
    } catch (error) {
      console.error("[WHATSAPP] Webhook processing failed:", error?.message || error)
    }
  }),
)

// ===========================================================================
// Connection tab
// ===========================================================================

// @desc    The saved connection, with the secrets masked
// @route   GET /api/whatsapp/settings
// @access  Private/Admin (whatsapp)
router.get(
  "/settings",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const settings = await getSettings({ fresh: true })
    const readiness = describeReadiness(settings)
    const host = `${req.protocol}://${req.get("host")}`

    res.json({
      settings: settings.toSafeJSON(),
      readiness,
      // The address the owner registers with Meta, spelled out so it does not
      // have to be guessed from the browser's URL bar.
      webhookUrl: `${host}/api/whatsapp/webhook`,
      events: NOTIFICATION_EVENTS,
      templateVariables: TEMPLATE_VARIABLES,
    })
  }),
)

// @desc    Save the connection
// @route   PUT /api/whatsapp/settings
// @access  Private/Admin (whatsapp)
router.put(
  "/settings",
  ...adminGuard,
  skipCacheInvalidation,
  asyncHandler(async (req, res) => {
    const settings = await getSettings({ fresh: true })
    const body = req.body || {}

    const plainFields = ["phoneNumberId", "wabaId", "apiVersion", "defaultCountryCode", "businessDisplayNumber"]
    plainFields.forEach((field) => {
      if (typeof body[field] === "string") settings[field] = body[field].trim()
    })

    // A secret is only replaced when a new one is actually typed. The screen shows
    // a mask, and saving the form back must not wipe a working token.
    const secretFields = ["accessToken", "appSecret", "verifyToken"]
    secretFields.forEach((field) => {
      const value = body[field]
      if (typeof value === "string" && value.trim() && !value.includes("****")) {
        settings[field] = value.trim()
      }
    })

    if (typeof body.enabled === "boolean") settings.enabled = body.enabled

    if (body.notifications && typeof body.notifications === "object") {
      NOTIFICATION_EVENTS.forEach((event) => {
        if (typeof body.notifications[event] === "boolean") {
          settings.notifications[event] = body.notifications[event]
        }
      })
    }

    if (body.templates && typeof body.templates === "object") {
      NOTIFICATION_EVENTS.forEach((event) => {
        const incoming = body.templates[event]
        if (!incoming || typeof incoming !== "object") return
        if (typeof incoming.name === "string") settings.templates[event].name = incoming.name.trim()
        if (typeof incoming.language === "string") {
          settings.templates[event].language = incoming.language.trim() || "en"
        }
      })
    }

    settings.updatedBy = req.user._id
    const saved = await settings.save()
    clearSettingsCache()

    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "SETTINGS",
      description: "Updated the WhatsApp connection",
      targetId: saved._id.toString(),
      targetName: "WhatsApp",
      req,
    })

    res.json({ settings: saved.toSafeJSON(), readiness: describeReadiness(saved) })
  }),
)

// @desc    Send a test template to prove the connection works
// @route   POST /api/whatsapp/test
// @access  Private/Admin (whatsapp)
router.post(
  "/test",
  ...adminGuard,
  skipCacheInvalidation,
  asyncHandler(async (req, res) => {
    const { phone, templateName, language } = req.body || {}
    const result = await sendTestMessage({ phone, templateName, language, sentBy: req.user._id })

    if (!result.sent) {
      res.status(400)
      throw new Error(result.reason)
    }

    await logActivity({
      user: req.user,
      action: "CREATE",
      module: "SETTINGS",
      description: `Sent a WhatsApp test message to ${phone}`,
      targetName: "WhatsApp",
      req,
    })

    res.json({ message: "Test message sent.", wamid: result.wamid })
  }),
)

// ===========================================================================
// Inbox tab
// ===========================================================================

const describeContact = (contact) => ({
  _id: contact._id,
  phone: contact.phone,
  name: contact.name || "",
  optedOut: contact.optedOut,
  optedOutAt: contact.optedOutAt,
  consentSource: contact.consentSource,
  unreadCount: contact.unreadCount,
  lastMessageAt: contact.lastMessageAt,
  lastMessagePreview: contact.lastMessagePreview,
  lastMessageDirection: contact.lastMessageDirection,
  lastInboundAt: contact.lastInboundAt,
  // What the reply box needs to decide whether it may be used, and what to say
  // when it may not.
  canReply: !describeWindowBlock(contact),
  replyBlockedReason: describeWindowBlock(contact),
  windowOpen: isWithinServiceWindow(contact),
  windowExpiresAt: serviceWindowExpiry(contact),
})

// @desc    The conversation list
// @route   GET /api/whatsapp/conversations
// @access  Private/Admin (whatsapp)
router.get(
  "/conversations",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50))
    const search = String(req.query.search || "").trim()

    const query = {}
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      query.$or = [{ phone: new RegExp(safe, "i") }, { name: new RegExp(safe, "i") }]
    }

    const contacts = await WhatsAppContact.find(query).sort({ lastMessageAt: -1, createdAt: -1 }).limit(limit)
    const totalUnread = await WhatsAppContact.aggregate([
      { $group: { _id: null, total: { $sum: "$unreadCount" } } },
    ])

    res.json({
      conversations: contacts.map(describeContact),
      totalUnread: totalUnread[0]?.total || 0,
    })
  }),
)

// @desc    One conversation's history
// @route   GET /api/whatsapp/conversations/:phone/messages
// @access  Private/Admin (whatsapp)
router.get(
  "/conversations/:phone/messages",
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const settings = await getSettings()
    const phone = normalizePhone(req.params.phone, settings.defaultCountryCode)
    const contact = await WhatsAppContact.findOne({ phone })

    if (!contact) {
      res.status(404)
      throw new Error("No conversation with that number.")
    }

    const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit, 10) || 100))
    const messages = await WhatsAppMessage.find({ contact: contact._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("sentBy", "name")

    res.json({
      contact: describeContact(contact),
      // Oldest first, the way a conversation reads.
      messages: messages.reverse(),
    })
  }),
)

// @desc    Reply in the 24-hour window
// @route   POST /api/whatsapp/conversations/:phone/reply
// @access  Private/Admin (whatsapp)
router.post(
  "/conversations/:phone/reply",
  ...adminGuard,
  skipCacheInvalidation,
  asyncHandler(async (req, res) => {
    const settings = await getSettings()
    const phone = normalizePhone(req.params.phone, settings.defaultCountryCode)
    const contact = await WhatsAppContact.findOne({ phone })

    if (!contact) {
      res.status(404)
      throw new Error("No conversation with that number.")
    }

    // The screen disables the box, but the rule lives here: the window and the
    // opt-out are checked again on the way through, whatever the screen believed.
    const result = await sendFreeText({
      contact,
      text: req.body?.text,
      sentBy: req.user._id,
      settings,
    })

    if (!result.sent) {
      res.status(400)
      throw new Error(result.reason)
    }

    const updated = await WhatsAppContact.findById(contact._id)
    res.json({ message: result.message, contact: describeContact(updated) })
  }),
)

// @desc    Mark a conversation read
// @route   POST /api/whatsapp/conversations/:phone/read
// @access  Private/Admin (whatsapp)
router.post(
  "/conversations/:phone/read",
  ...adminGuard,
  skipCacheInvalidation,
  asyncHandler(async (req, res) => {
    const settings = await getSettings()
    const phone = normalizePhone(req.params.phone, settings.defaultCountryCode)
    const updated = await WhatsAppContact.findOneAndUpdate({ phone }, { $set: { unreadCount: 0 } }, { new: true })

    if (!updated) {
      res.status(404)
      throw new Error("No conversation with that number.")
    }

    res.json({ contact: describeContact(updated) })
  }),
)

export default router
