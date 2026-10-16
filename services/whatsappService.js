import crypto from "crypto"
import axios from "axios"

import WhatsAppSettings from "../models/whatsappSettingsModel.js"
import WhatsAppContact from "../models/whatsappContactModel.js"
import WhatsAppMessage from "../models/whatsappMessageModel.js"

/**
 * WhatsApp order notifications and customer support, over Meta's official
 * WhatsApp Business Platform (Cloud API).
 *
 * Why the official platform and not a QR-code library: anything that logs in by
 * scanning the WhatsApp Web code is the server impersonating a linked phone. It
 * breaks WhatsApp's terms, and it -- not message volume -- is what gets business
 * numbers banned. A ban is permanent in practice, and the number lost is the one
 * printed on the invoices and the website. The Cloud API costs a little and needs
 * a one-time approval, and cannot get the number banned for being automated.
 *
 * Five rules are enforced here rather than left to staff discipline:
 *
 *   1. Only people who already dealt with the shop. A WhatsAppContact row is the
 *      permission to send, and it is created exactly two ways -- an order carried
 *      the number, or the number wrote to us first. Nothing in this file or in
 *      whatsappRoutes.js creates one from a list.
 *   2. The 24-hour window. Free text may only go out within 24 hours of the
 *      customer's last message. assertCanSendFreeText() is the gate, and the
 *      inbox asks it before it even enables its reply box, because a run of
 *      rejected sends damages the number's standing.
 *   3. Opt-out is permanent and absolute, checked before every single send.
 *   4. Notifications start switched off (see whatsappSettingsModel.js).
 *   5. Nothing here may break an order. notifyOrderEvent() resolves rather than
 *      throws, whatever happens.
 */

const GRAPH_HOST = "https://graph.facebook.com"
const SEND_TIMEOUT_MS = 10000
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000
// One test send a minute. The test button exists to prove the connection works;
// this stops it from becoming a way to message a list one number at a time.
const TEST_SEND_COOLDOWN_MS = 60 * 1000

// The four order events a customer can be written to about. Each one is off until
// the owner turns it on, and each needs its own approved template.
export const NOTIFICATION_EVENTS = ["orderPlaced", "shipped", "delivered", "cancelled"]

// Which order status raises which event. Only these four statuses message the
// customer; the rest are internal bookkeeping and stay silent.
export const STATUS_EVENTS = {
  Shipped: "shipped",
  Delivered: "delivered",
  Cancelled: "cancelled",
}

// The body variables each template is sent, in order. The Connection tab shows
// this list verbatim, because the owner writes the templates in Meta's dashboard
// and has to match it.
export const TEMPLATE_VARIABLES = {
  orderPlaced: ["Customer name", "Order number", "Order total"],
  shipped: ["Customer name", "Order number", "Tracking number"],
  delivered: ["Customer name", "Order number"],
  cancelled: ["Customer name", "Order number"],
}

// An opt-out is an exact word, not a word that appears somewhere in a sentence.
// "stop sending me the wrong size" is a complaint from a customer who wants an
// answer; silencing them would be the worst possible reading of it.
const OPT_OUT_KEYWORDS = ["stop", "unsubscribe"]

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

let settingsCache = null
let settingsCachedAt = 0
const SETTINGS_TTL_MS = 30 * 1000

/** The single settings row, created empty (and therefore switched off) on first read. */
export async function getSettings({ fresh = false } = {}) {
  if (!fresh && settingsCache && Date.now() - settingsCachedAt < SETTINGS_TTL_MS) {
    return settingsCache
  }
  let settings = await WhatsAppSettings.findOne({})
  if (!settings) {
    settings = await WhatsAppSettings.create({})
  }
  settingsCache = settings
  settingsCachedAt = Date.now()
  return settings
}

/** Called after a save so the next send does not run on the old credentials. */
export function clearSettingsCache() {
  settingsCache = null
  settingsCachedAt = 0
}

/**
 * Whether a send could even be attempted, and if not, why in plain words.
 * The Connection tab shows this; nothing is hidden behind a generic failure.
 */
export function describeReadiness(settings) {
  if (!settings?.phoneNumberId) return { ready: false, reason: "No phone number ID has been saved yet." }
  if (!settings?.accessToken) return { ready: false, reason: "No access token has been saved yet." }
  if (!settings?.enabled) return { ready: false, reason: "WhatsApp is saved but still switched off." }
  return { ready: true, reason: "" }
}

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

/**
 * Put a phone number into the digits-only E.164 form the Cloud API expects.
 * Returns "" when there is nothing usable, which every caller treats as
 * "this customer has no WhatsApp number" rather than as an error.
 */
export function normalizePhone(raw, defaultCountryCode = "971") {
  let digits = String(raw || "").replace(/[^\d+]/g, "")
  if (!digits) return ""

  // "+971..." and "00971..." are the same number written two ways.
  if (digits.startsWith("+")) digits = digits.slice(1)
  else if (digits.startsWith("00")) digits = digits.slice(2)
  else {
    const cc = String(defaultCountryCode || "").replace(/\D/g, "")
    if (cc && !digits.startsWith(cc)) {
      // A local number: "0501234567" is the same line as "971501234567".
      digits = cc + digits.replace(/^0+/, "")
    }
  }

  digits = digits.replace(/\D/g, "")
  // Shorter than this is a typo or an extension, not a reachable number.
  if (digits.length < 8 || digits.length > 15) return ""
  return digits
}

// ---------------------------------------------------------------------------
// Opt-out
// ---------------------------------------------------------------------------

/**
 * True only when the whole message is an opt-out word. Strips surrounding
 * punctuation and case, and nothing else -- deliberately strict, because the
 * cost of a false positive is a customer who can never be answered again.
 */
export function isOptOutKeyword(text) {
  const cleaned = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/^[\s"'(\[.!?,-]+/, "")
    .replace(/[\s"')\].!?,-]+$/, "")
  return OPT_OUT_KEYWORDS.includes(cleaned)
}

// ---------------------------------------------------------------------------
// The 24-hour customer service window
// ---------------------------------------------------------------------------

export function serviceWindowExpiry(contact) {
  if (!contact?.lastInboundAt) return null
  return new Date(new Date(contact.lastInboundAt).getTime() + SERVICE_WINDOW_MS)
}

export function isWithinServiceWindow(contact) {
  const expiry = serviceWindowExpiry(contact)
  return Boolean(expiry && expiry.getTime() > Date.now())
}

/**
 * Why a freely written reply cannot go out, in the words the inbox shows the
 * person typing. Returns "" when it can.
 */
export function describeWindowBlock(contact) {
  if (!contact) return "This number has never contacted the shop."
  if (contact.optedOut) return "This customer asked not to receive WhatsApp messages."
  if (!contact.lastInboundAt) {
    return "WhatsApp only allows a written reply after the customer has messaged first."
  }
  if (!isWithinServiceWindow(contact)) {
    return "WhatsApp's 24-hour reply window has closed. It reopens when the customer messages again."
  }
  return ""
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/**
 * Find the contact for a number, or create it from the thing that grants
 * permission to message it -- an order, or an inbound message. Never called with
 * anything else, which is rule 1.
 */
export async function findOrCreateContact({ phone, name = "", user = null, source, order = null }) {
  if (!phone) return null
  if (source !== "order" && source !== "inbound") {
    throw new Error(`Refusing to create a WhatsApp contact from source "${source}"`)
  }

  const existing = await WhatsAppContact.findOne({ phone })
  if (existing) {
    let touched = false
    if (name && !existing.name) {
      existing.name = name
      touched = true
    }
    if (user && !existing.user) {
      existing.user = user
      touched = true
    }
    if (order && String(existing.lastOrder || "") !== String(order)) {
      existing.lastOrder = order
      if (!existing.firstOrder) existing.firstOrder = order
      touched = true
    }
    if (touched) await existing.save()
    return existing
  }

  return WhatsAppContact.create({
    phone,
    name,
    user,
    consentSource: source,
    consentAt: new Date(),
    firstOrder: order,
    lastOrder: order,
  })
}

/** Keep the conversation list's preview column honest after every message. */
async function touchConversation(contact, { direction, preview, at = new Date(), incrementUnread = false }) {
  const update = {
    lastMessageAt: at,
    lastMessagePreview: String(preview || "").slice(0, 160),
    lastMessageDirection: direction,
  }
  if (direction === "in") update.lastInboundAt = at
  else update.lastOutboundAt = at

  const ops = { $set: update }
  if (incrementUnread) ops.$inc = { unreadCount: 1 }

  await WhatsAppContact.updateOne({ _id: contact._id }, ops)
}

// ---------------------------------------------------------------------------
// Talking to the Cloud API
// ---------------------------------------------------------------------------

async function postToGraph(settings, payload) {
  const url = `${GRAPH_HOST}/${settings.apiVersion || "v21.0"}/${settings.phoneNumberId}/messages`
  const { data } = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${settings.accessToken}`,
      "Content-Type": "application/json",
    },
    timeout: SEND_TIMEOUT_MS,
  })
  return data
}

/** Meta's error bodies are nested; pull out the sentence worth storing. */
function describeSendError(error) {
  const apiError = error?.response?.data?.error
  if (apiError) {
    const detail = apiError.error_user_msg || apiError.error_data?.details || apiError.message
    return `${detail || "WhatsApp rejected the message"}${apiError.code ? ` (code ${apiError.code})` : ""}`
  }
  if (error?.code === "ECONNABORTED") return "WhatsApp did not respond in time."
  return error?.message || "The message could not be sent."
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Send an approved template. Allowed at any time -- that is what templates are
 * for -- but still refused for an opted-out contact.
 */
export async function sendTemplate({
  contact,
  templateName,
  language = "en",
  bodyParameters = [],
  buttonPayloads = [],
  order = null,
  event = "",
  sentBy = null,
  settings: providedSettings = null,
}) {
  const settings = providedSettings || (await getSettings())
  const readiness = describeReadiness(settings)
  if (!readiness.ready) return { sent: false, reason: readiness.reason }
  if (!contact) return { sent: false, reason: "No contact for this number." }
  if (contact.optedOut) return { sent: false, reason: "This customer has opted out of WhatsApp messages." }
  if (!templateName) return { sent: false, reason: "No approved template has been named for this message." }

  const components = []
  if (bodyParameters.length > 0) {
    components.push({
      type: "body",
      parameters: bodyParameters.map((text) => ({ type: "text", text: String(text ?? "") })),
    })
  }
  // A template's quick-reply buttons carry their payload per message, which is how
  // a Confirm/Cancel tap comes back naming the order it belongs to.
  buttonPayloads.forEach((payload, index) => {
    if (!payload) return
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(index),
      parameters: [{ type: "payload", payload }],
    })
  })

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: contact.phone,
    type: "template",
    template: {
      name: templateName,
      language: { code: language || "en" },
      ...(components.length > 0 ? { components } : {}),
    },
  }

  const preview = `[${templateName}] ${bodyParameters.join(" · ")}`.trim()

  try {
    const data = await postToGraph(settings, payload)
    const wamid = data?.messages?.[0]?.id || undefined
    const message = await WhatsAppMessage.create({
      contact: contact._id,
      phone: contact.phone,
      direction: "out",
      type: "template",
      body: preview,
      templateName,
      wamid,
      status: "sent",
      order,
      event,
      sentBy,
    })
    await touchConversation(contact, { direction: "out", preview })
    return { sent: true, message, wamid }
  } catch (error) {
    const reason = describeSendError(error)
    console.error(`[WHATSAPP] Template "${templateName}" to ${contact.phone} failed: ${reason}`)
    await WhatsAppMessage.create({
      contact: contact._id,
      phone: contact.phone,
      direction: "out",
      type: "template",
      body: preview,
      templateName,
      status: "failed",
      error: reason,
      order,
      event,
      sentBy,
    })
    return { sent: false, reason }
  }
}

/**
 * Send a freely written message. Only legal inside the 24-hour window, and the
 * check happens here -- not only in the screen that disables the box -- so the
 * rule holds however the endpoint is reached.
 */
export async function sendFreeText({ contact, text, sentBy = null, settings: providedSettings = null }) {
  const settings = providedSettings || (await getSettings())
  const readiness = describeReadiness(settings)
  if (!readiness.ready) return { sent: false, reason: readiness.reason }

  const blocked = describeWindowBlock(contact)
  if (blocked) return { sent: false, reason: blocked }

  const body = String(text || "").trim()
  if (!body) return { sent: false, reason: "The message is empty." }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: contact.phone,
    type: "text",
    text: { preview_url: false, body },
  }

  try {
    const data = await postToGraph(settings, payload)
    const wamid = data?.messages?.[0]?.id || undefined
    const message = await WhatsAppMessage.create({
      contact: contact._id,
      phone: contact.phone,
      direction: "out",
      type: "text",
      body,
      wamid,
      status: "sent",
      sentBy,
    })
    await touchConversation(contact, { direction: "out", preview: body })
    return { sent: true, message, wamid }
  } catch (error) {
    const reason = describeSendError(error)
    console.error(`[WHATSAPP] Reply to ${contact.phone} failed: ${reason}`)
    const message = await WhatsAppMessage.create({
      contact: contact._id,
      phone: contact.phone,
      direction: "out",
      type: "text",
      body,
      status: "failed",
      error: reason,
      sentBy,
    })
    return { sent: false, reason, message }
  }
}

/** A line written into the history for the record. Never leaves the server. */
export async function recordSystemNote(contact, body, { order = null, event = "" } = {}) {
  if (!contact) return null
  return WhatsAppMessage.create({
    contact: contact._id,
    phone: contact.phone,
    direction: "out",
    type: "system",
    body,
    status: "skipped",
    order,
    event,
  })
}

// ---------------------------------------------------------------------------
// Order notifications
// ---------------------------------------------------------------------------

/** The customer's details, wherever this kind of order keeps them. */
export function readOrderCustomer(order) {
  const isPickup = order?.deliveryType === "pickup"
  const source = (isPickup ? order?.pickupDetails : order?.shippingAddress) || {}
  return {
    name: source.name || order?.user?.name || "there",
    phone: source.phone || "",
    email: source.email || order?.user?.email || "",
  }
}

export function orderNumber(order) {
  return `#${String(order?._id || "").slice(-6).toUpperCase()}`
}

function formatOrderTotal(order) {
  const amount = Number(order?.totalPrice || 0)
  const symbol = order?.currencySymbol || order?.currency || "AED"
  return `${symbol} ${amount.toFixed(2)}`
}

function buildParameters(event, order) {
  const customer = readOrderCustomer(order)
  switch (event) {
    case "orderPlaced":
      return [customer.name, orderNumber(order), formatOrderTotal(order)]
    case "shipped":
      return [customer.name, orderNumber(order), order?.trackingId || "not available yet"]
    case "delivered":
    case "cancelled":
      return [customer.name, orderNumber(order)]
    default:
      return []
  }
}

/**
 * Tell a customer about their order, if and only if the owner switched this
 * event on and the customer has not opted out.
 *
 * Never throws and never rejects. Checkout calls it without awaiting the outcome:
 * WhatsApp being down, misconfigured or simply refusing the message must leave
 * the order itself completely unaffected.
 */
export async function notifyOrderEvent(order, event) {
  try {
    if (!order || !NOTIFICATION_EVENTS.includes(event)) return { sent: false, reason: "Unknown event." }
    // A quotation is not an order and has no customer waiting on it.
    if (order.documentType === "quotation") return { sent: false, reason: "Quotations are not notified." }

    const settings = await getSettings()
    const readiness = describeReadiness(settings)
    if (!readiness.ready) return { sent: false, reason: readiness.reason }
    if (!settings.notifications?.[event]) {
      return { sent: false, reason: `The "${event}" notification is switched off.` }
    }

    const template = settings.templates?.[event]
    if (!template?.name) return { sent: false, reason: `No template is named for "${event}".` }

    // One message per order per event, however many times a status is flipped back
    // and forth, and however many paths reach this function.
    const alreadySent = await WhatsAppMessage.findOne({
      order: order._id,
      event,
      status: { $in: ["sent", "delivered", "read"] },
    }).select("_id")
    if (alreadySent) return { sent: false, reason: `The "${event}" message has already gone out for this order.` }

    const customer = readOrderCustomer(order)
    const phone = normalizePhone(customer.phone, settings.defaultCountryCode)
    if (!phone) return { sent: false, reason: "This order has no usable phone number." }

    // Placing the order is the consent. This is the only place an order creates a
    // contact, and it carries the order that did it.
    const contact = await findOrCreateContact({
      phone,
      name: customer.name,
      user: order.user?._id || order.user || null,
      source: "order",
      order: order._id,
    })

    if (contact.optedOut) {
      await recordSystemNote(contact, `Not sent (${event}): this customer has opted out of WhatsApp.`, {
        order: order._id,
        event,
      })
      return { sent: false, reason: "This customer has opted out of WhatsApp messages." }
    }

    // Only the order confirmation carries buttons, and they name the order they
    // belong to so a tap can act on it without the customer typing anything.
    const buttonPayloads =
      event === "orderPlaced" ? [`order_confirm:${order._id}`, `order_cancel:${order._id}`] : []

    return await sendTemplate({
      contact,
      templateName: template.name,
      language: template.language,
      bodyParameters: buildParameters(event, order),
      buttonPayloads,
      order: order._id,
      event,
      settings,
    })
  } catch (error) {
    // Rule 5: an order is never allowed to fail because of this file.
    console.error(`[WHATSAPP] Order notification "${event}" failed:`, error?.message || error)
    return { sent: false, reason: error?.message || "The notification could not be sent." }
  }
}

/** Fire-and-forget wrapper for the checkout and status paths. Returns nothing. */
export function notifyOrderEventInBackground(order, event) {
  notifyOrderEvent(order, event).catch((error) =>
    console.error(`[WHATSAPP] Background notification "${event}" failed:`, error?.message || error),
  )
}

/** The event a status change raises, or "" when the change is internal only. */
export function eventForStatus(status) {
  return STATUS_EVENTS[status] || ""
}

// ---------------------------------------------------------------------------
// Test send
// ---------------------------------------------------------------------------

/**
 * Prove the connection works. Template-only and rate-limited, because the one
 * endpoint that accepts a typed-in number is the one that could otherwise be
 * turned into a way to message strangers.
 */
export async function sendTestMessage({ phone: rawPhone, templateName, language, sentBy }) {
  const settings = await getSettings({ fresh: true })
  const readiness = describeReadiness(settings)
  if (!readiness.ready) return { sent: false, reason: readiness.reason }

  if (settings.lastTestSentAt && Date.now() - new Date(settings.lastTestSentAt).getTime() < TEST_SEND_COOLDOWN_MS) {
    const wait = Math.ceil(
      (TEST_SEND_COOLDOWN_MS - (Date.now() - new Date(settings.lastTestSentAt).getTime())) / 1000,
    )
    return { sent: false, reason: `Test messages are limited to one a minute. Try again in ${wait} seconds.` }
  }

  const phone = normalizePhone(rawPhone, settings.defaultCountryCode)
  if (!phone) return { sent: false, reason: "That does not look like a phone number." }

  const existing = await WhatsAppContact.findOne({ phone })
  if (existing?.optedOut) {
    return { sent: false, reason: "That number has opted out of WhatsApp messages." }
  }

  const template = templateName || settings.templates?.orderPlaced?.name
  if (!template) return { sent: false, reason: "Name an approved template to test with." }

  // A test does not open a conversation with a stranger, so no contact is made
  // for a number that has not dealt with the shop. The send is addressed directly.
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "template",
    template: { name: template, language: { code: language || settings.templates?.orderPlaced?.language || "en" } },
  }

  try {
    const data = await postToGraph(settings, payload)
    settings.lastTestSentAt = new Date()
    await settings.save()
    clearSettingsCache()
    console.log(`[WHATSAPP] Test template "${template}" sent to ${phone}`)
    return { sent: true, wamid: data?.messages?.[0]?.id || null }
  } catch (error) {
    const reason = describeSendError(error)
    console.error(`[WHATSAPP] Test send to ${phone} failed: ${reason}`)
    return { sent: false, reason }
  }
}

// ---------------------------------------------------------------------------
// Webhook plumbing
// ---------------------------------------------------------------------------

/**
 * Confirm the webhook body really came from Meta. Without this anyone who learns
 * the URL could post fake customer messages -- including a fake "cancel" tap.
 */
export function verifyWebhookSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return { valid: false, reason: "No app secret has been saved, so webhooks cannot be verified." }
  const header = String(signatureHeader || "")
  if (!header.startsWith("sha256=")) return { valid: false, reason: "The signature header is missing." }

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody || "", "utf8")
    .digest("hex")
  const provided = header.slice("sha256=".length)

  const expectedBuffer = Buffer.from(expected, "utf8")
  const providedBuffer = Buffer.from(provided, "utf8")
  if (expectedBuffer.length !== providedBuffer.length) return { valid: false, reason: "The signature does not match." }
  if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return { valid: false, reason: "The signature does not match." }
  }
  return { valid: true, reason: "" }
}

/** The text of an inbound message, whatever shape it arrived in. */
export function readInboundText(message) {
  if (!message) return ""
  switch (message.type) {
    case "text":
      return message.text?.body || ""
    case "button":
      return message.button?.text || ""
    case "interactive":
      return (
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        ""
      )
    default:
      return `[${message.type || "unsupported"} message]`
  }
}

/** The payload behind a tapped button, for both template and interactive replies. */
export function readButtonPayload(message) {
  if (!message) return ""
  if (message.type === "button") return message.button?.payload || ""
  if (message.type === "interactive") return message.interactive?.button_reply?.id || ""
  return ""
}

export { touchConversation, SERVICE_WINDOW_MS }

export default {
  getSettings,
  clearSettingsCache,
  describeReadiness,
  normalizePhone,
  isOptOutKeyword,
  isWithinServiceWindow,
  serviceWindowExpiry,
  describeWindowBlock,
  findOrCreateContact,
  sendTemplate,
  sendFreeText,
  recordSystemNote,
  notifyOrderEvent,
  notifyOrderEventInBackground,
  eventForStatus,
  sendTestMessage,
  verifyWebhookSignature,
  readInboundText,
  readButtonPayload,
}
